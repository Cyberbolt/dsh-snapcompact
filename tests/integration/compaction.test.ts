import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { ArchiveRepository } from '../../src/archives/repository.js';
import { ArchiveService } from '../../src/archives/service.js';
import { SnapcompactEngine } from '../../src/compaction/engine.js';
import { resolveConfig } from '../../src/config.js';
import type * as RendererModule from '../../src/rendering/worker-client.js';
import { createHarness } from '../fixtures/harness.js';
import { archiveProjection } from '../../src/integrations/dsh/archive-projection.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose();
});

async function setup(methodOrder: string[], model = 'vision') {
  const harness = await createHarness(model);
  const rendererModule: typeof RendererModule = await import(
    /* @vite-ignore */ new URL('../../dist/rendering/worker-client.js', import.meta.url).href
  );
  const renderer = rendererModule.createRenderer();
  cleanups.push(harness.dispose, () => renderer.dispose());
  const archives = new ArchiveService(new ArchiveRepository(harness.attachments));
  const engine = new SnapcompactEngine(
    harness.ctx,
    resolveConfig({ methodOrder, policy: { auto: false, maxTokens: 4096 } }),
    archives,
    renderer,
    new AbortController().signal,
  );
  return { ...harness, archives, engine };
}

const longSource =
  'Original exact command: pnpm deploy -- --dry-run\n' +
  Array.from(
    { length: 350 },
    (_, line) => `Historical build line ${line}: stable fact, no instruction changes.`,
  ).join('\n');

describe('native region transaction with plugin candidates', () => {
  it('lands an archived text checkpoint and can replay its serialized log', async () => {
    const test = await setup(['soft']);
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });
    const result = await test.engine.compactRegion(source.seq, source.seq, test.agent);
    const ref = result.summary.find((block) => block.type === 'file')?.attachment;
    expect(ref).toBeDefined();
    if (!ref) throw new Error('Missing archive file');
    const page = await test.archives.read(ref, { offset: 0, limit: 100, query: 'exact command' });
    expect(page.lines.some((line) => line.text.includes('pnpm deploy -- --dry-run'))).toBe(true);
    expect(test.adapter.calls).toHaveLength(1);
    expect(
      test.session
        .deriveMessages()
        .some((message) =>
          message.content.some(
            (block) => block.type === 'text' && block.text.includes('Goal: continue'),
          ),
        ),
    ).toBe(true);
    // The native constructor is the validator for externally serialized session events.
    const seed = JSON.parse(JSON.stringify(test.session.snapshotEvents())) as SessionEvent[];
    const restored = Session.create(SessionId('session-restored-text'), seed);
    expect(restored.deriveMessages()).toEqual(test.session.deriveMessages());
    const events = test.session.snapshotEvents();
    expect(events.filter((event) => event.type === 'compaction/start')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'compaction/end')).toHaveLength(1);
    let state = archiveProjection.init();
    for (const event of events.slice(0, -1)) state = archiveProjection.apply(state, event);
    expect(state.entries).toHaveLength(0);
    const close = events.at(-1);
    if (!close) throw new Error('Missing native closing event');
    state = archiveProjection.apply(state, close);
    expect(state.entries[0]?.reference).toEqual(ref);
    let replayed = archiveProjection.init();
    for (const event of restored.snapshotEvents())
      replayed = archiveProjection.apply(replayed, event);
    expect(replayed.entries).toEqual(state.entries);
  });

  it('stores real PNG bytes and a standalone text handoff before the native commit', async () => {
    const test = await setup(['snapcompact', 'handoff', 'shake', 'soft']);
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });
    const result = await test.engine.compactRegion(source.seq, source.seq, test.agent);
    const images = result.summary.filter((block) => block.type === 'image');
    expect(images.length).toBeGreaterThan(0);
    expect(result.summary[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('method=snapcompact'),
    });
    for (const image of images) {
      const stored = await test.attachments.readImage(image.attachment);
      expect([...stored.data.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    }
    expect(
      result.summary.some(
        (block) => block.type === 'text' && block.text.includes('Goal: continue'),
      ),
    ).toBe(true);
    expect(result.summary.some((block) => block.type === 'file')).toBe(true);
  });

  it.each(['incomplete', 'oversized'])(
    'falls back when stored image metadata is %s',
    async (failure) => {
      const test = await setup(['snapcompact', 'handoff', 'soft']);
      const save = test.attachments.saveImages.bind(test.attachments);
      vi.spyOn(test.attachments, 'saveImages').mockImplementation(async (inputs) => {
        const references = await save(inputs);
        return failure === 'incomplete'
          ? []
          : references.map((reference) => ({ ...reference, bytes: 20 * 1024 * 1024 }));
      });
      const source = test.appendText(longSource);
      test.session.append('turn/start', { turn: 1 });
      const result = await test.engine.compactRegion(source.seq, source.seq, test.agent);
      expect(result.summary.some((block) => block.type === 'image')).toBe(false);
      expect(result.summary[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('method=handoff'),
      });
    },
  );

  it('does not create images for a text-only model', async () => {
    const test = await setup(['snapcompact', 'handoff', 'shake', 'soft'], 'text');
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });
    const result = await test.engine.compactRegion(source.seq, source.seq, test.agent);
    expect(result.summary.some((block) => block.type === 'image')).toBe(false);
    expect(result.summary[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('method=handoff'),
    });
  });

  it('preserves the surface and closes the bracket after all model candidates fail', async () => {
    const test = await setup(['handoff', 'soft']);
    test.adapter.reject = true;
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });
    const before = test.session.deriveMessages();
    await expect(test.engine.compactRegion(source.seq, source.seq, test.agent)).rejects.toThrow();
    expect(test.session.deriveMessages()).toEqual(before);
    const events = test.session.snapshotEvents();
    expect(events.filter((event) => event.type === 'compaction/summary')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'compaction/end')).toHaveLength(1);
  });

  it('does not fall through after cancellation', async () => {
    const test = await setup(['handoff', 'soft']);
    const controller = new AbortController();
    const reason = new Error('user cancelled');
    test.adapter.beforeStream = async () => controller.abort(reason);
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });
    await expect(
      test.engine.compactRegion(source.seq, source.seq, test.agent, controller.signal),
    ).rejects.toBe(reason);
    expect(test.adapter.calls).toHaveLength(1);
    expect(test.session.deriveMessages()[0]?.content).toEqual([{ type: 'text', text: longSource }]);
  });

  it('rejects a changed source rather than replacing a newer surface', async () => {
    const test = await setup(['soft']);
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });
    test.adapter.beforeStream = async () => {
      test.appendText('New user instruction arrived during summary.');
    };
    await expect(test.engine.compactRegion(source.seq, source.seq, test.agent)).rejects.toThrow(
      'surface changed',
    );
    expect(test.session.deriveMessages()).toHaveLength(2);
    expect(
      test.session.snapshotEvents().filter((event) => event.type === 'compaction/summary'),
    ).toHaveLength(0);
  });

  it('supports the native idle/manual maintenance entry without requiring an open turn', async () => {
    const test = await setup(['soft']);
    test.appendText(longSource);
    test.appendText('Keep the newest user request verbatim.');
    const result = await test.engine.compactNow(test.agent, new AbortController().signal);
    expect(result).not.toBeNull();
    const start = test.session.snapshotEvents().find((event) => event.type === 'compaction/start');
    expect(start?.data.turn).toBeNull();
  });
});
