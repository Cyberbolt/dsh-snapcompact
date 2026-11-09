import type { MethodName } from '../config.js';

/**
 * Mirror of `DEFAULT_METHOD_ORDER` without importing the plugin's config module:
 * this file is also loaded directly by the client build script, and a runtime
 * import would drag the parser, zod and the native compaction engine along.
 * `metadata.test.ts` asserts the two stay identical.
 */
export const METHOD_NAMES = ['snapcompact', 'handoff', 'shake', 'soft'] as const;

export const DEFAULT_USER_CHAIN: readonly MethodName[] = [
  'snapcompact',
  'handoff',
  'shake',
  'soft',
];

/**
 * The profile row that owns the editable settings.
 *
 * Its Config schema is projected into the Host settings document, so it is both
 * the settings namespace the browser form reads and the entry whose volatile
 * fields carry the live values. It is deliberately separate from the preset row:
 * only profile-plane entries are editable through `ctx.settings`, while the
 * compaction plugin itself must stay inside the opt-in preset.
 */
export const SETTINGS_ENTRY_ID = 'snapcompact-settings';

/** Service key the settings row provides for the preset's plugin instance. */
export const SETTINGS_SERVICE = 'snapcompactSettings';

export const SETTINGS_GROUPS = ['chain', 'trigger', 'rendering', 'advanced'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/**
 * One user-editable knob.
 *
 * `paths` maps the flat settings key onto the plugin config. A single key may
 * write several destinations: `frameSize` keeps the frames square by writing
 * both `rendering.width` and `rendering.height`.
 */
export interface SettingsField {
  readonly key: string;
  readonly paths: readonly (readonly string[])[];
  readonly kind: 'chain' | 'number';
  readonly group: SettingsGroup;
  /** Value shown when the user has not overridden the field. */
  readonly defaultValue?: number | readonly MethodName[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Display scale for the form only; the stored value stays in base units. */
  readonly scale?: number;
  /** English copy for schema-driven surfaces; the plugin page uses its own locale. */
  readonly description: string;
}

const MIB = 1024 * 1024;

/** Ordered as rendered on the plugin page. */
export const SETTINGS_FIELDS: readonly SettingsField[] = [
  {
    key: 'methodOrder',
    paths: [['methodOrder']],
    kind: 'chain',
    group: 'chain',
    defaultValue: DEFAULT_USER_CHAIN,
    description:
      'Compaction methods in fallback order. The first candidate that succeeds wins, and the chain must end with soft.',
  },
  {
    key: 'thresholdRatio',
    paths: [['policy', 'thresholdRatio']],
    kind: 'number',
    group: 'trigger',
    min: 0.5,
    max: 0.95,
    step: 0.01,
    description:
      'Share of the context window that triggers compaction. Leave unset to inherit the host policy default (0.8).',
  },
  {
    key: 'frameSize',
    paths: [
      ['rendering', 'width'],
      ['rendering', 'height'],
    ],
    kind: 'number',
    group: 'rendering',
    defaultValue: 2048,
    min: 1024,
    max: 2048,
    step: 256,
    description: 'Edge length of one rendered frame in pixels; frames stay square.',
  },
  {
    key: 'maxFrames',
    paths: [['rendering', 'maxFrames']],
    kind: 'number',
    group: 'rendering',
    defaultValue: 20,
    min: 1,
    max: 20,
    step: 1,
    description: 'Upper bound on rendered frames per checkpoint, below the host image cap.',
  },
  {
    key: 'minCompressionRatio',
    paths: [['minCompressionRatio']],
    kind: 'number',
    group: 'rendering',
    defaultValue: 2,
    min: 1.1,
    max: 10,
    step: 0.1,
    description:
      'Minimum reduction the visual checkpoint must reach, measured with the host token estimate.',
  },
  {
    key: 'archiveMaxBytes',
    paths: [['archiveMaxBytes']],
    kind: 'number',
    group: 'advanced',
    defaultValue: 64 * MIB,
    min: MIB,
    max: 64 * MIB,
    step: MIB,
    scale: MIB,
    description: 'Maximum size of the exact-text archive kept behind a checkpoint.',
  },
  {
    key: 'handoffMaxTokens',
    paths: [['handoffMaxTokens']],
    kind: 'number',
    group: 'advanced',
    defaultValue: 4096,
    min: 256,
    max: 16_384,
    step: 256,
    description: 'Token budget for the handoff method when it runs.',
  },
  {
    key: 'shakeThresholdChars',
    paths: [['shakeThresholdChars']],
    kind: 'number',
    group: 'advanced',
    defaultValue: 8192,
    min: 1024,
    max: 65_536,
    step: 1024,
    description: 'Tool-output size above which the shake method externalizes results.',
  },
];

export const SETTINGS_KEYS: readonly string[] = SETTINGS_FIELDS.map((field) => field.key);

/** Values the browser persists: only the keys the user actually changed. */
export type UserSettings = Record<string, number | readonly MethodName[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Volatile Config fields arrive as stable references rather than plain values. */
function unwrap(value: unknown): unknown {
  if (isRecord(value) && typeof value.get === 'function') {
    return (value.get as () => unknown)();
  }
  return value;
}

function isMethod(value: unknown): value is MethodName {
  return typeof value === 'string' && (METHOD_NAMES as readonly string[]).includes(value);
}

function fieldValue(
  field: SettingsField,
  value: unknown,
): number | readonly MethodName[] | undefined {
  if (field.kind === 'chain') {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    if (!value.every(isMethod)) return undefined;
    if (new Set(value).size !== value.length) return undefined;
    // The settings schema cannot express ordering; the strict parser requires
    // soft to close the chain, so an invalid saved chain is dropped here.
    if (value.at(-1) !== 'soft') return undefined;
    return value as readonly MethodName[];
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (field.min !== undefined && value < field.min) return undefined;
  if (field.max !== undefined && value > field.max) return undefined;
  return value;
}

/**
 * Read the settings row's Config into a flat override map.
 *
 * Unknown or out-of-range values are dropped rather than forwarded: the form
 * validates too, but the plugin must never build an engine from a value the
 * strict parser would reject later.
 */
export function readUserSettings(config: unknown): UserSettings {
  if (!isRecord(config)) return {};
  const result: UserSettings = {};
  for (const field of SETTINGS_FIELDS) {
    const value = fieldValue(field, unwrap(config[field.key]));
    if (value !== undefined) result[field.key] = value;
  }
  return result;
}

function withPath(source: unknown, path: readonly string[], value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const base = isRecord(source) ? { ...source } : {};
  base[head] = rest.length === 0 ? value : withPath(base[head], rest, value);
  return base;
}

/**
 * Layer user settings over the preset row's config.
 *
 * A field is applied only when it carries a value, so leaving `thresholdRatio`
 * untouched keeps a preset-level `policy.thresholdRatio` in force. Fields the
 * settings schema defaults (frame size, frame count, budgets) are always
 * present and therefore take precedence over the same key in preset YAML.
 */
export function applyUserSettings(input: unknown, settings: UserSettings | undefined): unknown {
  if (settings === undefined) return input;
  const entries = Object.entries(settings).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return input;
  let result = input;
  for (const [key, value] of entries) {
    const field = SETTINGS_FIELDS.find((candidate) => candidate.key === key);
    if (field === undefined) continue;
    for (const path of field.paths) {
      result = withPath(
        result,
        path,
        field.kind === 'chain' ? [...(value as readonly string[])] : value,
      );
    }
  }
  return result;
}

/** Defaults declared by the settings schema, keyed by settings field. */
export function defaultUserSettings(): UserSettings {
  const result: UserSettings = {};
  for (const field of SETTINGS_FIELDS) {
    if (field.defaultValue !== undefined) result[field.key] = field.defaultValue;
  }
  return result;
}
