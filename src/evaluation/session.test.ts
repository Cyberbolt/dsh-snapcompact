import { afterEach, describe, expect, it } from 'vitest';
import { evaluateSession, SESSION_SCHEDULE } from './session.js';
import { buildLongFixture } from './fixture.js';
import { resolveConfig } from '../config.js';
import { ArchiveRepository } from '../archives/repository.js';
import { ArchiveService } from '../archives/service.js';
import { createHarness } from '../../tests/fixtures/harness.js';
import type { Renderer } from '../rendering/worker-client.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(model = 'vision') {
  const fixture = await createHarness(model);
  cleanups.push(fixture.dispose);
  const archives = new ArchiveService(new ArchiveRepository(fixture.attachments));
  return { ...fixture, archives };
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

const longFixture = buildLongFixture({ paddingLines: 300 });
const allAnswers = JSON.stringify(
  Object.fromEntries(
    Object.entries(longFixture.fixture.questions).map(([key, question]) => [key, question.answer]),
  ),
);

describe('persistent session evaluation', () => {
  it('runs four arms over one history with per-turn audits and a modeled 100% point', async () => {
    const fixture = await setup('vision');
    const renderer = await rendererFor();
    cleanups.push(renderer.dispose);
    fixture.adapter.text = allAnswers;
    fixture.adapter.visualTokens = 100;
    const reports = await evaluateSession(
      fixture.ctx,
      fixture.agent,
      resolveConfig({
        rendering: { width: 512, height: 512, maxFrames: 8, minGlyphPx: 8 },
      }),
      fixture.archives,
      async () => ({
        summary: [{ type: 'text' as const, text: 'Independent baseline summary.' }],
        provider: 'test',
        model: 'vision',
        usage: { inputTokens: 12, outputTokens: 5 },
      }),
      renderer.render,
      new AbortController().signal,
      { runs: 1, paddingLines: 300 },
    );
    expect(reports).toHaveLength(1);
    const report = reports[0];
    if (report === undefined) throw new Error('missing session report');
    expect(report.schedule).toEqual([...SESSION_SCHEDULE]);
    expect(report.arms.map((arm) => arm.status)).toEqual([
      'measured',
      'measured',
      'measured',
      'measured',
    ]);
    for (const arm of report.arms) {
      expect(arm.turns, arm.name).toHaveLength(6);
      expect(arm.total, arm.name).toBe(8);
      expect(arm.turns.map((turn) => turn.mode)).toEqual([...SESSION_SCHEDULE]);
    }
    const native = report.arms.find((arm) => arm.name === 'native-text');
    expect(native?.promptTokens).toBe(612);
    expect(report.usageAudit.requests).toBe(25);
    expect(report.usageAudit.complete).toBe(true);
    expect(report.sensitivity).toHaveLength(3);
    expect(report.sensitivity[0]?.modeled).toBe(false);
    expect(report.sensitivity[2]?.modeled).toBe(true);
    expect(report.attribution.checkpointResendTokens).toBeGreaterThan(0);
    expect(report.capacity).toHaveLength(3);
    expect(report.capacity[0]?.contextWindow).toBe(200_000);
  });

  it('skips the visual and recall arms without a rendered checkpoint', async () => {
    const fixture = await setup('text');
    const reports = await evaluateSession(
      fixture.ctx,
      fixture.agent,
      resolveConfig({}),
      fixture.archives,
      async () => ({
        summary: [{ type: 'text' as const, text: 'Independent baseline summary.' }],
        provider: 'test',
        model: 'text',
        usage: { inputTokens: 12, outputTokens: 5 },
      }),
      async (): Promise<never> => {
        throw new Error('Text-only route must not render');
      },
      new AbortController().signal,
      { runs: 1, paddingLines: 300 },
    );
    const report = reports[0];
    if (report === undefined) throw new Error('missing session report');
    expect(report.arms.map((arm) => arm.status)).toEqual([
      'measured',
      'measured',
      'skipped',
      'skipped',
    ]);
    expect(report.sensitivity).toEqual([]);
    expect(report.capacity[0]?.checkpointEstimatedTokens).toBe(0);
  });
});
