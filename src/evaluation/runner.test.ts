import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluate } from './runner.js';
import { resolveConfig } from '../config.js';
import { ArchiveRepository } from '../archives/repository.js';
import { ArchiveService } from '../archives/service.js';
import { createHarness } from '../../tests/fixtures/harness.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(model = 'text') {
  const fixture = await createHarness(model);
  cleanups.push(fixture.dispose);
  const archives = new ArchiveService(new ArchiveRepository(fixture.attachments));
  return { ...fixture, archives };
}

const noRender = async (): Promise<never> => {
  throw new Error('Text-only route must not render');
};
const fixtureAnswers = JSON.parse(
  readFileSync(new URL('../../assets/benchmarks/engineering.json', import.meta.url), 'utf8'),
).answers as Record<string, string>;

describe('truthful evaluation accounting', () => {
  it('reports charged usage even when the answer is not valid JSON and never uploads private messages', async () => {
    const fixture = await setup();
    fixture.appendText('PRIVATE HISTORY SENTINEL: do not upload this message.');
    const before = fixture.session.deriveMessages();
    const summarize = vi.fn(async () => ({
      summary: [{ type: 'text' as const, text: 'Independent baseline summary.' }],
      provider: 'test',
      model: 'text',
      usage: { inputTokens: 12, outputTokens: 5 },
    }));
    const report = await evaluate(
      fixture.ctx,
      fixture.agent,
      resolveConfig({}),
      fixture.archives,
      summarize,
      noRender,
      new AbortController().signal,
    );
    expect(report.arms.map((arm) => arm.status)).toEqual(['measured', 'measured', 'skipped']);
    expect(report.arms[0]).toMatchObject({
      correct: 0,
      promptTokens: 100,
      usage: { outputTokens: 20 },
    });
    expect(report.arms[0]?.reason).toContain('JSON');
    expect(report.summaryUsage?.inputTokens).toBe(12);
    expect(summarize).toHaveBeenCalledOnce();
    expect(fixture.adapter.calls).toHaveLength(2);
    expect(JSON.stringify(fixture.adapter.calls.map((call) => call.messages))).not.toContain(
      'PRIVATE HISTORY SENTINEL',
    );
    expect(fixture.session.deriveMessages()).toEqual(before);
  });

  it('keeps completed-arm costs in a partial report if native summary generation fails', async () => {
    const fixture = await setup();
    const report = await evaluate(
      fixture.ctx,
      fixture.agent,
      resolveConfig({}),
      fixture.archives,
      async () => {
        throw new Error('Injected summary failure');
      },
      noRender,
      new AbortController().signal,
    );
    expect(report.arms[0]?.promptTokens).toBe(100);
    expect(report.arms[1]).toMatchObject({ status: 'failed', reason: 'Injected summary failure' });
    expect(report.arms[2]?.status).toBe('skipped');
    expect(fixture.adapter.calls).toHaveLength(1);
  });

  it('measures a local visual arm with frames and an adapter price', async () => {
    const fixture = await setup('vision');
    const client = await import(
      /* @vite-ignore */ new URL('../../dist/rendering/worker-client.js', import.meta.url).href
    );
    const renderer = client.createRenderer();
    cleanups.push(() => renderer.dispose());
    fixture.adapter.text = JSON.stringify(fixtureAnswers);
    fixture.adapter.visualTokens = 100;
    const summarize = vi.fn(async () => ({
      summary: [{ type: 'text' as const, text: 'Independent baseline summary.' }],
      provider: 'test',
      model: 'vision',
      usage: { inputTokens: 12, outputTokens: 5 },
    }));
    const report = await evaluate(
      fixture.ctx,
      fixture.agent,
      resolveConfig({ rendering: { width: 512, height: 512, maxFrames: 8, minGlyphPx: 8 } }),
      fixture.archives,
      summarize,
      (text, options, signal) => renderer.render(text, options, signal),
      new AbortController().signal,
    );
    expect(report.arms[2]).toMatchObject({
      status: 'measured',
      pricedBy: 'adapter',
      correct: Object.keys(fixtureAnswers).length,
      total: Object.keys(fixtureAnswers).length,
    });
    expect(report.arms[2]?.frames).toBeGreaterThan(0);
    expect(report.arms[2]?.estimatedCheckpointTokens).toBeGreaterThan(0);
  });

  it('renders the default 1568 visual arm for the long fixture instead of skipping it', async () => {
    const fixture = await setup('vision');
    const client = await import(
      /* @vite-ignore */ new URL('../../dist/rendering/worker-client.js', import.meta.url).href
    );
    const renderer = client.createRenderer();
    cleanups.push(() => renderer.dispose());
    fixture.adapter.text = JSON.stringify(fixtureAnswers);
    fixture.adapter.visualTokens = 1024;
    const summarize = vi.fn(async () => ({
      summary: [{ type: 'text' as const, text: 'Independent baseline summary.' }],
      provider: 'test',
      model: 'vision',
      usage: { inputTokens: 12, outputTokens: 5 },
    }));
    const report = await evaluate(
      fixture.ctx,
      fixture.agent,
      resolveConfig({}),
      fixture.archives,
      summarize,
      (text, options, signal) => renderer.render(text, options, signal),
      new AbortController().signal,
    );
    expect(report.arms[2]).toMatchObject({
      status: 'measured',
      pricedBy: 'adapter',
      correct: Object.keys(fixtureAnswers).length,
    });
    expect(report.arms[2]?.frames).toBeGreaterThan(0);
    expect(report.frames?.[0]?.width).toBe(1568);
  });

  it('honors cancellation before starting any model call', async () => {
    const fixture = await setup();
    const controller = new AbortController();
    const reason = new Error('cancelled benchmark');
    controller.abort(reason);
    const summarize = vi.fn(async (): Promise<never> => {
      throw new Error('Must not run');
    });
    await expect(
      evaluate(
        fixture.ctx,
        fixture.agent,
        resolveConfig({}),
        fixture.archives,
        summarize,
        noRender,
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(fixture.adapter.calls).toHaveLength(0);
    expect(summarize).not.toHaveBeenCalled();
  });
});
