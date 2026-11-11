import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluate } from './runner.js';
import { loadFixture } from './fixture.js';
import { resolveConfig } from '../config.js';
import { ArchiveRepository } from '../archives/repository.js';
import { ArchiveService } from '../archives/service.js';
import { createHarness } from '../../tests/fixtures/harness.js';
import type { Renderer } from '../rendering/worker-client.js';

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

async function answersForFixture(): Promise<string> {
  const fixture = await loadFixture();
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(fixture.questions).map(([key, question]) => [key, question.answer]),
    ),
  );
}

async function rendererFor(): Promise<{
  render: Renderer['render'];
  dispose: () => Promise<void>;
}> {
  const client = await import(
    /* @vite-ignore */ new URL('../../dist/rendering/worker-client.js', import.meta.url).href
  );
  const renderer = client.createRenderer();
  return {
    render: (text: string, options: unknown, signal: AbortSignal) =>
      renderer.render(text, options, signal),
    dispose: () => renderer.dispose(),
  };
}

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
    fixture.adapter.text = 'not a JSON answer object';
    const report = await evaluate(
      fixture.ctx,
      fixture.agent,
      resolveConfig({}),
      fixture.archives,
      summarize,
      noRender,
      new AbortController().signal,
    );
    expect(report.version).toBe(2);
    expect(report.arms.map((arm) => arm.runs[0]?.status)).toEqual([
      'measured',
      'measured',
      'skipped',
      'skipped',
    ]);
    expect(report.arms[0]?.runs[0]).toMatchObject({
      correct: 0,
      promptTokens: 100,
      parseMode: 'failed',
    });
    expect(report.arms[0]?.runs[0]?.outcomes).toHaveLength(40);
    expect(report.arms[0]?.runs[0]?.missed).toHaveLength(40);
    expect(report.summaryGeneration.usage?.inputTokens).toBe(12);
    expect(report.archiveCoverage).toEqual({ correct: 40, total: 40 });
    expect(summarize).toHaveBeenCalledOnce();
    expect(fixture.adapter.calls).toHaveLength(2);
    expect(fixture.adapter.calls[0]?.maxTokens).toBeGreaterThan(8192);
    expect(JSON.stringify(fixture.adapter.calls.map((call) => call.messages))).not.toContain(
      'PRIVATE HISTORY SENTINEL',
    );
    expect(fixture.session.deriveMessages()).toEqual(before);
  });

  it('keeps completed-arm costs in a partial report if native summary generation fails', async () => {
    const fixture = await setup();
    fixture.adapter.text = await answersForFixture();
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
    expect(report.arms[0]?.runs[0]?.status).toBe('measured');
    expect(report.arms[1]?.runs[0]).toMatchObject({
      status: 'skipped',
      reason: 'Injected summary failure',
    });
    expect(report.arms[2]?.runs[0]?.status).toBe('skipped');
    expect(report.summaryGeneration.failed).toBe('Injected summary failure');
    expect(fixture.adapter.calls).toHaveLength(1);
  });

  it('measures a local visual OCR arm and an untouched recall arm', async () => {
    const fixture = await setup('vision');
    const renderer = await rendererFor();
    cleanups.push(renderer.dispose);
    fixture.adapter.text = await answersForFixture();
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
      renderer.render,
      new AbortController().signal,
    );
    const visual = report.arms.find((arm) => arm.name === 'snapcompact');
    const recall = report.arms.find((arm) => arm.name === 'snapcompact-recall');
    expect(visual?.runs[0]).toMatchObject({
      status: 'measured',
      correct: 40,
      total: 40,
      missed: [],
    });
    expect(visual?.frames).toBeGreaterThan(0);
    expect(visual?.estimatedCheckpointTokens).toBeGreaterThan(0);
    expect(visual?.score.byRegion.head).toEqual({ correct: 7, total: 7 });
    expect(visual?.score.byRegion.middle).toEqual({ correct: 20, total: 20 });
    expect(visual?.score.byRegion.tail).toEqual({ correct: 13, total: 13 });
    expect(recall?.runs[0]).toMatchObject({ status: 'measured', recallCalls: 0, correct: 40 });
    expect(report.visualPreparation.overBudget).toBeTypeOf('boolean');
    expect(report.archiveCoverage).toEqual({ correct: 40, total: 40 });
    expect(fixture.adapter.calls).toHaveLength(4);
  });

  it('runs one bounded recall tool round and feeds the page back to the model', async () => {
    const fixture = await setup('vision');
    const renderer = await rendererFor();
    cleanups.push(renderer.dispose);
    const answers = await answersForFixture();
    fixture.adapter.visualTokens = 100;
    fixture.adapter.responses = [
      { text: answers },
      { text: answers },
      { text: answers },
      {
        toolCalls: [
          {
            name: 'snapcompact_recall',
            arguments: JSON.stringify({ action: 'search', query: 'E_LOCK_TIMEOUT' }),
          },
        ],
      },
      { text: answers },
    ];
    const report = await evaluate(
      fixture.ctx,
      fixture.agent,
      resolveConfig({ rendering: { width: 512, height: 512, maxFrames: 8, minGlyphPx: 8 } }),
      fixture.archives,
      async () => ({
        summary: [{ type: 'text' as const, text: 'Independent baseline summary.' }],
        provider: 'test',
        model: 'vision',
        usage: { inputTokens: 12, outputTokens: 5 },
      }),
      renderer.render,
      new AbortController().signal,
    );
    const recall = report.arms.find((arm) => arm.name === 'snapcompact-recall');
    expect(recall?.runs[0]).toMatchObject({ status: 'measured', correct: 40, recallCalls: 1 });
    expect(recall?.runs[0]?.recallRounds).toBeGreaterThanOrEqual(2);
    expect(recall?.runs[0]?.recallBytes).toBeGreaterThan(0);
    expect(fixture.adapter.calls[3]?.tools?.[0]?.name).toBe('snapcompact_recall');
    expect(fixture.adapter.calls[0]?.tools).toBeUndefined();
    expect(JSON.stringify(fixture.adapter.calls[4]?.messages)).toContain('E_LOCK_TIMEOUT');
    expect(fixture.adapter.calls).toHaveLength(5);
  });

  it('forces a final answer when the recall tool-call budget is exhausted', async () => {
    const fixture = await setup('vision');
    const renderer = await rendererFor();
    cleanups.push(renderer.dispose);
    const answers = await answersForFixture();
    fixture.adapter.visualTokens = 100;
    const toolCall = {
      toolCalls: [
        {
          name: 'snapcompact_recall',
          arguments: JSON.stringify({ action: 'search', query: 'Observation 60' }),
        },
      ],
    };
    fixture.adapter.responses = [
      { text: answers },
      { text: answers },
      { text: answers },
      toolCall,
      toolCall,
      toolCall,
      toolCall,
      toolCall,
      toolCall,
      { text: answers },
    ];
    const report = await evaluate(
      fixture.ctx,
      fixture.agent,
      resolveConfig({ rendering: { width: 512, height: 512, maxFrames: 8, minGlyphPx: 8 } }),
      fixture.archives,
      async () => ({
        summary: [{ type: 'text' as const, text: 'Independent baseline summary.' }],
        provider: 'test',
        model: 'vision',
        usage: { inputTokens: 12, outputTokens: 5 },
      }),
      renderer.render,
      new AbortController().signal,
    );
    const recall = report.arms.find((arm) => arm.name === 'snapcompact-recall');
    expect(recall?.runs[0]).toMatchObject({ status: 'measured', correct: 40, recallCalls: 6 });
    expect(fixture.adapter.calls).toHaveLength(10);
    expect(fixture.adapter.calls[3]?.tools?.[0]?.name).toBe('snapcompact_recall');
    expect(fixture.adapter.calls[9]?.tools).toBeUndefined();
    expect(JSON.stringify(fixture.adapter.calls[9]?.messages)).toContain(
      'Recall tool-call limit reached',
    );
  });

  it('repeats only the QA arms when runs is greater than one', async () => {
    const fixture = await setup();
    fixture.adapter.text = await answersForFixture();
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
      { runs: 2 },
    );
    expect(report.runs).toBe(2);
    expect(report.arms[0]?.runs).toHaveLength(2);
    expect(report.arms[0]?.measuredRuns).toBe(2);
    expect(report.arms[1]?.runs).toHaveLength(2);
    expect(report.arms[2]?.runs).toHaveLength(2);
    expect(report.arms[2]?.runs.every((run) => run.status === 'skipped')).toBe(true);
    expect(summarize).toHaveBeenCalledOnce();
    expect(fixture.adapter.calls).toHaveLength(4);
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
