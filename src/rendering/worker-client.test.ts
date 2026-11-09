import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import type { RenderOptions } from './types.js';

import type * as ClientModule from './worker-client.js';
type Client = typeof ClientModule;
let client: Client;
let renderer: InstanceType<Client['Renderer']>;
const options: RenderOptions = {
  width: 1536,
  height: 1024,
  maxFrames: 12,
  maxTotalBytes: 16 * 1024 * 1024,
  maxSourceBytes: 64 * 1024 * 1024,
  timeoutMs: 15_000,
  lineHeight: 20,
};

beforeAll(async () => {
  // Deliberately load emitted ESM, not Vitest's transformed source. The worker
  // must resolve its own emitted .js imports and the package-relative font asset.
  const url = new URL('../../dist/rendering/worker-client.js', import.meta.url);
  client = (await import(/* @vite-ignore */ url.href)) as Client;
});
beforeEach(() => {
  renderer = client.createRenderer();
});
afterEach(async () => {
  await renderer?.dispose();
});

describe('dist worker integration', () => {
  it('renders CJK, astral symbols, spaces and explicit controls to decodable PNG', async () => {
    const result = await renderer.render('  你好，世界 😀\n\tcode\x1b[31m\n', options);
    expect(result.lineCount).toBe(3);
    expect(result.frames).toHaveLength(1);
    const frame = result.frames[0];
    if (frame === undefined) throw new Error('Missing worker frame');
    expect([frame.firstLine, frame.lastLine]).toEqual([1, 3]);
    const png = PNG.sync.read(Buffer.from(frame.data));
    expect([png.width, png.height]).toEqual([1536, 140]);
    expect(png.data.some((byte, index) => index % 4 !== 3 && byte < 100)).toBe(true);
  });

  it('does not clip a paginated source tail', async () => {
    const result = await renderer.render('a\nb\nc\nd\ne', { ...options, width: 128, height: 128 });
    expect(result.frames.map((frame) => [frame.firstLine, frame.lastLine])).toEqual([
      [1, 2],
      [3, 4],
      [5, 5],
    ]);
    await expect(
      renderer.render('a\nb\nc', { ...options, width: 128, height: 128, maxFrames: 1 }),
    ).rejects.toMatchObject({ code: 'FRAME_LIMIT' });
    await expect(renderer.render('a', { ...options, maxTotalBytes: 1 })).rejects.toMatchObject({
      code: 'BYTE_LIMIT',
    });
  });

  it('replaces unsupported shaping with a visible fallback and keeps rendering', async () => {
    const arabic = await renderer.render('العربية', options);
    expect(arabic.frames).toHaveLength(1);
    expect(arabic.unrenderableChars).toBeGreaterThan(0);
    const combining = await renderer.render('e\u0301', options);
    expect(combining.unrenderableChars).toBe(1);
    const unassigned = await renderer.render('\u{10FFFF}', options);
    expect(unassigned.unrenderableChars).toBe(1);
    expect((await renderer.render('recovered', options)).lineCount).toBe(1);
  });

  it('bounds concurrency to one active worker and four queued jobs', async () => {
    const controllers = Array.from({ length: 6 }, () => new AbortController());
    const results = controllers.map((controller) =>
      renderer.render('queue test', options, controller.signal).then(
        () => 'SUCCESS',
        (error: unknown) => (error as { code: string }).code,
      ),
    );
    expect(await results[5]).toBe('QUEUE_FULL');
    for (const controller of controllers) controller.abort();
    expect(await Promise.all(results.slice(0, 5))).toEqual(Array(5).fill('ABORTED'));
    expect((await renderer.render('after cancellation', options)).frames).toHaveLength(1);
  });

  it('honors pre-abort, active abort and queued abort without leaking work', async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(renderer.render('pre', options, pre.signal)).rejects.toMatchObject({
      code: 'ABORTED',
      name: 'AbortError',
    });
    const running = new AbortController();
    const queued = new AbortController();
    const first = renderer.render('first', options, running.signal);
    const second = renderer.render('second', options, queued.signal);
    const checks = Promise.all([
      expect(first).rejects.toMatchObject({ code: 'ABORTED' }),
      expect(second).rejects.toMatchObject({ code: 'ABORTED' }),
    ]);
    queued.abort();
    running.abort();
    await checks;
  });

  it('times out startup/queued work and recovers by replacing the worker', async () => {
    const first = renderer.render('startup deadline', { ...options, timeoutMs: 1 });
    const second = renderer.render('queue deadline', { ...options, timeoutMs: 1 });
    await Promise.all([
      expect(first).rejects.toMatchObject({ code: 'TIMEOUT' }),
      expect(second).rejects.toMatchObject({ code: 'TIMEOUT' }),
    ]);
    expect((await renderer.render('new worker', options)).frames).toHaveLength(1);
  });

  it('dispose rejects all outstanding jobs, awaits cleanup and is idempotent', async () => {
    const first = renderer.render('active', options);
    const second = renderer.render('queued', options);
    const checks = Promise.all([
      expect(first).rejects.toMatchObject({ code: 'DISPOSED' }),
      expect(second).rejects.toMatchObject({ code: 'DISPOSED' }),
    ]);
    const cleanup = renderer.dispose();
    expect(renderer.dispose()).toBe(cleanup);
    await expect(renderer.render('during disposal', options)).rejects.toMatchObject({
      code: 'DISPOSED',
    });
    await Promise.all([checks, cleanup]);
    expect(renderer.dispose()).toBe(cleanup);
    await expect(renderer.render('after disposal', options)).rejects.toMatchObject({
      code: 'DISPOSED',
    });
    const replacement = client.createRenderer();
    try {
      expect((await replacement.render('new lifecycle', options)).frames).toHaveLength(1);
    } finally {
      await replacement.dispose();
    }
  });

  it('isolates preset-owned renderer lifecycles', async () => {
    const other = client.createRenderer();
    const first = renderer.render('disposed preset', options);
    const check = expect(first).rejects.toMatchObject({ code: 'DISPOSED' });
    try {
      const otherResult = other.render('independent preset', options);
      await renderer.dispose();
      await check;
      expect((await otherResult).lineCount).toBe(1);
      await expect(renderer.render('cannot revive disposed preset', options)).rejects.toMatchObject(
        { code: 'DISPOSED' },
      );
    } finally {
      await other.dispose();
    }
  });

  it('checks byte limits and option validity before starting work', async () => {
    await expect(renderer.render('中', { ...options, maxSourceBytes: 2 })).rejects.toMatchObject({
      code: 'SOURCE_LIMIT',
    });
    await expect(renderer.render('a', { ...options, timeoutMs: 15_001 })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });
});
