import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/**
 * Offline smoke test for the shipped browser half.
 *
 * It evaluates client/client.js with a minimal React stub and a fake Client
 * context, then renders the card in both the served and the unavailable state.
 * That catches bundle-level syntax, registration and component crashes without
 * a browser; it does not replace looking at the real page.
 */

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

type Node = Element | string | number | null | undefined | Node[];

function isElement(value: unknown): value is Element {
  return value !== null && typeof value === 'object' && 'type' in value && 'props' in value;
}

const React = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: Node[]) => ({
    type,
    props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
  }),
  useCallback: <T>(callback: T): T => callback,
  useState: <T>(initial: T | (() => T)): [T, () => void] => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    () => {},
  ],
  useEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
};

/** Render function components until only host elements remain. */
function render(node: Node): Node {
  if (Array.isArray(node)) return node.map(render);
  if (!isElement(node)) return node;
  if (typeof node.type === 'function') {
    return render((node.type as (props: Record<string, unknown>) => Node)(node.props));
  }
  return {
    type: node.type,
    props: { ...node.props, children: render(node.props.children as Node) },
  };
}

function collectText(node: Node): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  return collectText(node.props.children as Node);
}

async function loadClient() {
  const registrations: { id: string; factory: (require: (id: string) => unknown) => unknown }[] =
    [];
  (globalThis as { window?: unknown }).window = {
    __ModuleLoader__: {
      load: (registration: (typeof registrations)[number]) => registrations.push(registration),
    },
  };
  const source = fileURLToPath(new URL('../client/client.js', import.meta.url));
  await import(`${source}?smoke=${Date.now()}`);
  expect(registrations).toHaveLength(1);
  const registration = registrations[0];
  if (registration === undefined) throw new Error('client bundle did not register a module');
  expect(registration.id).toBe('dsh-snapcompact');
  const plugin = registration.factory((id: string) => {
    if (id === 'react') return React;
    throw new Error(`unexpected client require: ${id}`);
  }) as { inject: string[]; apply: (ctx: unknown) => void };
  return plugin;
}

function fakeContext(form: unknown) {
  const register = vi.fn();
  const locale = {
    register: vi.fn(() => () => {}),
    bind: () => (key: string) => `t:${key}`,
  };
  const slots = {
    inject: (_owner: string, contribution: () => unknown) => contribution(),
    register,
  };
  const ctx = {
    get: (name: string) => {
      if (name === 'locale') return locale;
      if (name === 'slots') return slots;
      if (name === 'configForms') return form === undefined ? undefined : { get: () => form };
      return undefined;
    },
    effect: (body: () => unknown) => body(),
    logger: { warn: vi.fn() },
  };
  return { ctx, register };
}

function readyForm(overrides: Record<string, unknown> = {}) {
  return {
    getSnapshot: () => ({
      status: 'ready',
      value: { maxFrames: 12 },
      base: {},
      user: { maxFrames: 12 },
      revision: 3,
      writable: true,
      ...overrides,
    }),
    subscribe: () => () => {},
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
  };
}

describe('client bundle', () => {
  it('registers the plugin-page settings card under the bundle name', async () => {
    const plugin = await loadClient();
    const { ctx, register } = fakeContext(readyForm());

    plugin.apply(ctx);

    expect(plugin.inject).toEqual(['slots', 'locale']);
    expect(register).toHaveBeenCalledTimes(1);
    const [options, component] = register.mock.calls[0] as [
      { name: string; key: string; locale: string; inject: () => Record<string, unknown> },
      (props: Record<string, unknown>) => Node,
    ];
    expect(options).toMatchObject({
      name: 'plugins.bundle.config',
      key: 'dsh-snapcompact',
      locale: 'dsh-snapcompact',
    });
    expect(typeof component).toBe('function');
  });

  it('renders the ready state with the effective chain and controls', async () => {
    const plugin = await loadClient();
    const form = readyForm();
    const { ctx, register } = fakeContext(form);
    plugin.apply(ctx);
    const [options, component] = register.mock.calls[0] as [
      { inject: () => Record<string, unknown> },
      (props: Record<string, unknown>) => Node,
    ];

    const tree = render(component(options.inject()));
    const text = collectText(tree);

    expect(text).toContain('t:title');
    expect(text).toContain('snapcompact \u2192 handoff \u2192 shake \u2192 soft');
    expect(text).toContain('t:chainTitle');
    expect(text).toContain('t:save');
    expect(text).not.toContain('t:unavailableTitle');
  });

  it('renders the fallback guidance while the settings row is unavailable', async () => {
    const plugin = await loadClient();
    const form = readyForm({ status: 'unavailable', value: undefined, user: undefined });
    const { ctx, register } = fakeContext(form);
    plugin.apply(ctx);
    const [options, component] = register.mock.calls[0] as [
      { inject: () => Record<string, unknown> },
      (props: Record<string, unknown>) => Node,
    ];

    const text = collectText(render(component(options.inject())));

    expect(text).toContain('t:unavailableTitle');
    expect(text).toContain('dsh-snapcompact/settings');
    expect(text).not.toContain('t:save');
  });

  it('renders the unsupported guidance without the configForms service', async () => {
    const plugin = await loadClient();
    const { ctx, register } = fakeContext(undefined);
    plugin.apply(ctx);
    const [options, component] = register.mock.calls[0] as [
      { inject: () => Record<string, unknown> },
      (props: Record<string, unknown>) => Node,
    ];

    const text = collectText(render(component(options.inject())));

    expect(text).toContain('t:unsupportedTitle');
    expect(text).toContain('dsh-snapcompact/settings');
  });

  it('ships a field table generated from the settings metadata', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../client/client.js', import.meta.url)),
      'utf8',
    );
    const metadata = await readFile(
      fileURLToPath(new URL('../src/settings/metadata.ts', import.meta.url)),
      'utf8',
    );
    for (const key of [
      'methodOrder',
      'thresholdRatio',
      'frameSize',
      'maxFrames',
      'minCompressionRatio',
      'archiveMaxBytes',
      'handoffMaxTokens',
      'shakeThresholdChars',
    ]) {
      expect(source).toContain(`"key": "${key}"`);
      expect(metadata).toContain(`key: '${key}'`);
    }
    expect(source).not.toContain('__SNAPCOMPACT_SETTINGS_FIELDS__');
  });
});
