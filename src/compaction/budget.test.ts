import { describe, expect, it } from 'vitest';
import { resolveCheckpointBudget } from './budget.js';

describe('checkpoint budget', () => {
  it('spends half of the trigger room when the source folds into it', () => {
    // At the moment pressure fires the surface total is the threshold.
    const budget = resolveCheckpointBudget({
      totalTokens: 126_272,
      sourceTokens: 84_272,
      thresholdTokens: 126_272,
    });
    expect(budget).toEqual({
      kind: 'ok',
      basis: 'threshold',
      tokens: 42_136,
      roomTokens: 84_272,
    });
  });

  it('falls back to half of the source without a declared window', () => {
    expect(resolveCheckpointBudget({ totalTokens: 0, sourceTokens: 1_001 })).toEqual({
      kind: 'ok',
      basis: 'source',
      tokens: 500,
      roomTokens: 1_001,
    });
  });

  it('reports unreachable when fixed overhead already fills the threshold', () => {
    expect(
      resolveCheckpointBudget({
        totalTokens: 140_000,
        sourceTokens: 10_000,
        thresholdTokens: 126_272,
      }),
    ).toEqual({ kind: 'unreachable' });
  });

  it('tightens below half of the source when the session overshot its trigger', () => {
    const budget = resolveCheckpointBudget({
      totalTokens: 150_000,
      sourceTokens: 50_000,
      thresholdTokens: 104_000,
    });
    expect(budget).toMatchObject({ basis: 'threshold', tokens: 2_000, roomTokens: 4_000 });
    expect(budget.kind).toBe('ok');
    if (budget.kind !== 'ok') throw new Error('Expected a usable budget');
    expect(budget.tokens).toBeLessThan(50_000 / 2);
  });

  it('never plans more than half of the source below the trigger', () => {
    const budget = resolveCheckpointBudget({
      totalTokens: 100_000,
      sourceTokens: 30_000,
      thresholdTokens: 126_272,
    });
    expect(budget).toMatchObject({ basis: 'threshold', tokens: 15_000, roomTokens: 56_272 });
  });

  it('clamps a negative fixed share to zero', () => {
    expect(
      resolveCheckpointBudget({ totalTokens: 10, sourceTokens: 1_000, thresholdTokens: 1_000 }),
    ).toMatchObject({ basis: 'threshold', tokens: 500 });
  });

  it('always leaves the post-compaction total under the threshold', () => {
    for (const [total, source, threshold] of [
      [126_272, 84_272, 126_272],
      [150_000, 50_000, 104_000],
      [130_000, 120_000, 125_000],
      [90_000, 30_000, 126_272],
    ] as const) {
      const budget = resolveCheckpointBudget({
        totalTokens: total,
        sourceTokens: source,
        thresholdTokens: threshold,
      });
      if (budget.kind !== 'ok') continue;
      const fixed = total - source;
      expect(fixed + budget.tokens).toBeLessThan(threshold);
      expect(budget.tokens).toBeLessThanOrEqual(source / 2);
    }
  });
});
