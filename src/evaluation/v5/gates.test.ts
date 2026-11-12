import { describe, expect, it } from 'vitest';
import type { ArmTallies } from './runner.js';
import { classMean, showTally } from './runner.js';

function arm(byKind: Record<string, { correct: number; total: number }>, runs = 3): ArmTallies {
  return { arm: 'pure-visual', measuredRuns: runs, byKind };
}

describe('per-run class gates', () => {
  it('divides pooled tallies by the measured run count', () => {
    // 18 of 18 across three runs is 6.00 of 6 per run, not a score of 18.
    const mean = classMean([arm({ 'cross-region': { correct: 18, total: 18 } })], 'pure-visual', [
      'cross-region',
    ]);
    expect(mean).toEqual({ correct: 6, total: 6 });
    expect(showTally(mean)).toBe('6.00/6');
  });

  it('sums several classes before dividing', () => {
    const mean = classMean(
      [arm({ temporal: { correct: 12, total: 12 }, causal: { correct: 6, total: 6 } })],
      'pure-visual',
      ['temporal', 'causal'],
    );
    expect(mean).toEqual({ correct: 6, total: 6 });
  });

  it('fails a per-run gate that a pooled count used to pass', () => {
    // Regression: 5 hits over three runs is 1.67 per run and must not satisfy ">= 5/6".
    const mean = classMean([arm({ 'cross-region': { correct: 5, total: 18 } })], 'pure-visual', [
      'cross-region',
    ]);
    expect(mean.correct).toBeCloseTo(1.67, 2);
    expect(mean.correct >= 5).toBe(false);
  });

  it('reports fractional per-run means and integer denominators', () => {
    expect(showTally({ correct: 80 / 3, total: 27 })).toBe('26.67/27');
    expect(showTally({ correct: 0, total: 0 })).toBe('0.00/0');
  });
});
