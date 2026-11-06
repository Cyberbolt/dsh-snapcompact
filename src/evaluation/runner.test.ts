import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluate } from './runner.js';
import { resolveConfig } from '../config.js';
import { ArchiveRepository } from '../archives/repository.js';
import { ArchiveService } from '../archives/service.js';
import { createHarness } from '../../tests/fixtures/harness.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const fixture = await createHarness('text');
  cleanups.push(fixture.dispose);
  const archives = new ArchiveService(new ArchiveRepository(fixture.attachments));
  return { ...fixture, archives };
}

const noRender = async (): Promise<never> => {
  throw new Error('Text-only route must not render');
};

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
