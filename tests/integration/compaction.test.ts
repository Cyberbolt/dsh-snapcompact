import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { ArchiveRepository } from '../../src/archives/repository.js';
import { ArchiveService } from '../../src/archives/service.js';
import type { ArchiveRecord } from '../../src/archives/service.js';
import { SnapcompactEngine } from '../../src/compaction/engine.js';
import { FILE_LIST_HEADER } from '../../src/compaction/file-ops.js';
import type { MethodContext } from '../../src/compaction/method.js';
import { snapcompact } from '../../src/compaction/methods/snapcompact.js';
import { resolveConfig } from '../../src/config.js';
import type * as RendererModule from '../../src/rendering/worker-client.js';
import { createHarness } from '../fixtures/harness.js';
import { archiveProjection } from '../../src/integrations/dsh/archive-projection.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose();
});

async function setup(
  methodOrder: string[],
  model = 'vision',
  rendering: { width: number; height: number; maxFrames: number; minGlyphPx: number } = {
    width: 512,
    height: 512,
    maxFrames: 6,
    minGlyphPx: 8,
  },
  policy: Record<string, number | boolean> = {},
) {
  const harness = await createHarness(model);
  const rendererModule: typeof RendererModule = await import(
    /* @vite-ignore */ new URL('../../dist/rendering/worker-client.js', import.meta.url).href
  );
  const renderer = rendererModule.createRenderer();
  cleanups.push(harness.dispose, () => renderer.dispose());
  const archives = new ArchiveService(new ArchiveRepository(harness.attachments));
  const engine = new SnapcompactEngine(
    harness.ctx,
    resolveConfig({
      methodOrder,
      policy: { auto: false, maxTokens: 4096, ...policy },
      rendering,
    }),
    archives,
    renderer,
    new AbortController().signal,
  );
  return { ...harness, archives, engine, renderer };
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

  it('commits a local visual checkpoint without an auxiliary model call', async () => {
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
        (block) => block.type === 'text' && block.text.includes('Visual snapcompact checkpoint'),
      ),
    ).toBe(true);
    expect(result.summary.some((block) => block.type === 'file')).toBe(true);
    expect(
      result.summary.some(
        (block) => block.type === 'text' && block.text.startsWith(FILE_LIST_HEADER),
      ),
    ).toBe(false);
    // The visual path renders locally and must not spend a handoff/native call.
    expect(test.adapter.calls).toHaveLength(0);
  });

  it('sizes the checkpoint against the room left under the trigger', async () => {
    // An 11,000-token trigger leaves about 5,200 tokens of room after the retained
    // tail, so the budget binds before the frame cap does.
    const test = await setup(
      ['snapcompact', 'soft'],
      'vision',
      { width: 512, height: 512, maxFrames: 20, minGlyphPx: 8 },
      { headroomTokens: 189_000 },
    );
    test.appendText(longSource);
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });
    const threshold = 200_000 - 189_000;
    expect(test.ctx.tokenMeter.measure(test.session).totalTokens).toBeGreaterThan(threshold);

    const result = await test.engine.compactRegion(source.seq, source.seq, test.agent);

    const images = result.summary.filter((block) => block.type === 'image');
    expect(images.length).toBeGreaterThan(0);
    // Both the room and the source cap the frame count, so the frame maximum alone
    // cannot explain the result.
    expect(images.length).toBeLessThan(20);
    expect(test.ctx.tokenMeter.measure(test.session).totalTokens).toBeLessThan(threshold);
    expect(test.adapter.calls).toHaveLength(0);
  });

  it('skips the visual path when retained history already fills the trigger', async () => {
    // 1,000 tokens of threshold cannot hold the retained tail, so no frame helps.
    const test = await setup(
      ['snapcompact', 'soft'],
      'vision',
      { width: 512, height: 512, maxFrames: 6, minGlyphPx: 8 },
      { headroomTokens: 199_000 },
    );
    test.appendText(longSource);
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });

    const result = await test.engine.compactRegion(source.seq, source.seq, test.agent);

    expect(result.summary.filter((block) => block.type === 'image')).toHaveLength(0);
    expect(result.summary[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('method=soft'),
    });
    expect(test.adapter.calls).toHaveLength(1);
  });

  it('adds a cumulative FILES index to the visual checkpoint', async () => {
    const test = await setup(['snapcompact', 'handoff', 'soft']);
    const sourceMessages = [
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: longSource }],
      }),
      createAssistantMessage({
        source: { provider: 'test', model: 'vision' },
        content: [
          {
            type: 'tool-call',
            id: ToolCallId('call-files-1'),
            name: 'read',
            arguments: JSON.stringify({ file_path: 'src/compaction/file-ops.ts' }),
          },
          {
            type: 'tool-call',
            id: ToolCallId('call-files-2'),
            name: 'edit',
            arguments: JSON.stringify({ file_path: 'src/compaction/methods/snapcompact.ts' }),
          },
        ],
      }),
    ];
    const context: MethodContext = {
      input: { messages: sourceMessages },
      sourceMessages,
      sourceTokens: 100_000,
      checkpointTargetTokens: 50_000,
      meter: test.ctx.tokenMeter,
      archive: {} as ArchiveRecord,
      route: { provider: 'test', model: 'vision' },
      config: resolveConfig({
        rendering: { width: 512, height: 512, maxFrames: 3, minGlyphPx: 8 },
      }),
      llm: test.ctx.llm,
      attachments: test.ctx.attachments,
      imageSlots: 20,
      signal: new AbortController().signal,
      render: (text, options, signal) => test.renderer.render(text, options, signal),
      handoff: async () => {
        throw new Error('Handoff is not expected in this test.');
      },
      soft: async () => {
        throw new Error('Native summary is not expected in this test.');
      },
    };
    const attempt = await snapcompact(context);
    expect(attempt.kind).toBe('candidate');
    if (attempt.kind !== 'candidate') throw new Error('Expected a visual candidate');
    const files = attempt.result.summary.find(
      (block) => block.type === 'text' && block.text.startsWith(FILE_LIST_HEADER),
    );
    expect(files?.type).toBe('text');
    if (files?.type !== 'text') throw new Error('Missing FILES block');
    expect(files.text).toContain('# src/compaction/');
    expect(files.text).toContain('file-ops.ts (Read)');
    expect(files.text).toContain('snapcompact.ts (Write)');
    expect(test.adapter.calls).toHaveLength(0);
  });

  it('selects a bounded frame subset under a realistic image price', async () => {
    const test = await setup(['snapcompact', 'handoff', 'soft'], 'vision', {
      width: 1024,
      height: 1024,
      maxFrames: 9,
      minGlyphPx: 8,
    });
    test.adapter.visualTokens = 1024;
    let first: ReturnType<typeof test.appendText> | undefined;
    let last: ReturnType<typeof test.appendText> | undefined;
    for (let index = 0; index < 20; index += 1) {
      const line = Array.from(
        { length: 70 },
        (_, row) =>
          `Task ${index} row ${row}: stable fact and precise identifier ID_${index}_${row}.`,
      ).join('\n');
      const event = test.appendText(line);
      first ??= event;
      last = event;
    }
    if (first === undefined || last === undefined) throw new Error('Missing source messages');
    test.session.append('turn/start', { turn: 1 });
    const result = await test.engine.compactRegion(first.seq, last.seq, test.agent);
    const images = result.summary.filter((block) => block.type === 'image');
    expect(images.length).toBeGreaterThan(0);
    expect(images.length).toBeLessThanOrEqual(9);
    expect(result.summary[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('method=snapcompact'),
    });
    expect(test.adapter.calls).toHaveLength(0);
  });

  it('carries an existing image instead of skipping the visual path', async () => {
    const test = await setup(['snapcompact', 'handoff', 'soft'], 'vision', {
      width: 1024,
      height: 1024,
      maxFrames: 8,
      minGlyphPx: 8,
    });
    test.adapter.visualTokens = 100;
    const carried = {
      attachmentId: `sha256:${'a'.repeat(64)}` as never,
      mediaType: 'image/png' as const,
      bytes: 100,
      width: 100,
      height: 100,
    };
    const imageEvent = test.session.append(
      'user/message',
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'image', attachment: carried }],
      }),
      { surfaceOp: 'append' },
    );
    const source = test.appendText(longSource);
    test.session.append('turn/start', { turn: 1 });
    const result = await test.engine.compactRegion(imageEvent.seq, source.seq, test.agent);
    const images = result.summary.filter((block) => block.type === 'image');
    expect(images.some((block) => block.attachment.attachmentId === carried.attachmentId)).toBe(
      true,
    );
    expect(images.length).toBeGreaterThan(1);
    expect(test.adapter.calls).toHaveLength(0);
  });

  it('uses the labelled DeepSeek estimate on a gateway without adapter pricing', async () => {
    const test = await setup(['snapcompact', 'handoff', 'soft'], 'deepseek-v4.1-flash', {
      width: 1024,
      height: 1024,
      maxFrames: 8,
      minGlyphPx: 8,
    });
    test.adapter.pricingAvailable = false;
    let first: ReturnType<typeof test.appendText> | undefined;
    let last: ReturnType<typeof test.appendText> | undefined;
    for (let index = 0; index < 20; index += 1) {
      const line = Array.from(
        { length: 70 },
        (_, row) =>
          `Task ${index} row ${row}: stable fact and precise identifier ID_${index}_${row}.`,
      ).join('\n');
      const event = test.appendText(line);
      first ??= event;
      last = event;
    }
    if (first === undefined || last === undefined) throw new Error('Missing source messages');
    test.session.append('turn/start', { turn: 1 });
    const result = await test.engine.compactRegion(first.seq, last.seq, test.agent);
    expect(result.summary[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('method=snapcompact'),
    });
    expect(result.summary.some((block) => block.type === 'image')).toBe(true);
    expect(test.adapter.calls).toHaveLength(0);
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

  it('refuses to mount an infeasible explicit threshold/retention pair', async () => {
    const harness = await createHarness();
    const rendererModule: typeof RendererModule = await import(
      /* @vite-ignore */ new URL('../../dist/rendering/worker-client.js', import.meta.url).href
    );
    const renderer = rendererModule.createRenderer();
    try {
      const archives = new ArchiveService(new ArchiveRepository(harness.attachments));
      expect(
        () =>
          new SnapcompactEngine(
            harness.ctx,
            resolveConfig({
              policy: { auto: false, maxTokens: 4096, thresholdRatio: 0.2, retainRatio: 0.16 },
            }),
            archives,
            renderer,
            new AbortController().signal,
          ),
      ).toThrow(/Snapcompact cannot start: policy: .*4%.*guard\.minCompactableRatio 0\.1/);
    } finally {
      await renderer.dispose();
      await harness.dispose();
    }
  });

  it('derives the tail so a custom threshold stays mountable', async () => {
    const harness = await createHarness();
    const rendererModule: typeof RendererModule = await import(
      /* @vite-ignore */ new URL('../../dist/rendering/worker-client.js', import.meta.url).href
    );
    const renderer = rendererModule.createRenderer();
    try {
      const archives = new ArchiveService(new ArchiveRepository(harness.attachments));
      const engine = new SnapcompactEngine(
        harness.ctx,
        resolveConfig({ policy: { auto: false, maxTokens: 4096, thresholdRatio: 0.2 } }),
        archives,
        renderer,
        new AbortController().signal,
      );
      expect(engine.config.thresholdRatio).toBe(0.2);
      expect(engine.config.retainRatio).toBe(0.04);
    } finally {
      await renderer.dispose();
      await harness.dispose();
    }
  });

  it('skips a source below the guard floor before any method or model call', async () => {
    const test = await setup(['snapcompact', 'handoff', 'soft']);
    const source = test.appendText('Tiny history.');
    test.session.append('turn/start', { turn: 1 });
    const before = test.session.deriveMessages();
    await expect(test.engine.compactRegion(source.seq, source.seq, test.agent)).rejects.toThrow(
      /below the 2000-token floor .*no method ran/,
    );
    expect(test.adapter.calls).toHaveLength(0);
    expect(test.session.deriveMessages()).toEqual(before);
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
