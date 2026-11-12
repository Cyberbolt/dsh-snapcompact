import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic';
import {
  collectPolicyViabilityProblems,
  resolveCheckpointBudget,
  resolvePressureBudget,
  resolveTargetPolicy,
} from './budget.js';

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

  it('spends the configured share of the trigger room instead of half', () => {
    const budget = resolveCheckpointBudget({
      totalTokens: 126_272,
      sourceTokens: 84_272,
      thresholdTokens: 126_272,
      share: 0.4,
    });
    expect(budget).toMatchObject({ kind: 'ok', basis: 'threshold', tokens: 33_708 });
  });

  it('applies the configured share to the source fallback', () => {
    expect(
      resolveCheckpointBudget({ totalTokens: 0, sourceTokens: 1_001, share: 0.4 }),
    ).toMatchObject({ kind: 'ok', basis: 'source', tokens: 400 });
  });

  it('rejects shares outside (0, 1]', () => {
    for (const share of [0, -0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveCheckpointBudget({ totalTokens: 0, sourceTokens: 1_000, share })).toThrow(
        RangeError,
      );
    }
    expect(() =>
      resolveCheckpointBudget({ totalTokens: 0, sourceTokens: 1_000, share: 0.25 }),
    ).not.toThrow();
    expect(() =>
      resolveCheckpointBudget({ totalTokens: 0, sourceTokens: 1_000, share: 0.5 }),
    ).not.toThrow();
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

const BASE_CONFIG: ResolvedConfig = {
  thresholdRatio: 0.8,
  headroomTokens: 65_536,
  retainRatio: 0.16,
  summarizationProvider: '',
  summarizationModel: '',
  maxTokens: 65_536,
  compactionRetries: 1,
  maxOverflowRetries: 1,
  modelPolicies: [],
  auto: true,
};

describe('pressure budget compactable space', () => {
  it('reports the room left between the threshold and the retained tail', () => {
    expect(resolvePressureBudget(BASE_CONFIG, 200_000, 0)).toMatchObject({
      kind: 'ok',
      thresholdTokens: 134_464,
      retainTokens: 32_000,
      compactableTokens: 102_464,
    });
  });

  it('never reports a negative compactable space', () => {
    expect(
      resolvePressureBudget(
        { thresholdRatio: 0.2, headroomTokens: 0, retainTokens: 50_000 },
        200_000,
        0,
      ),
    ).toMatchObject({ retainTooLarge: true, compactableTokens: 0 });
  });
});

describe('policy viability', () => {
  it('rejects the 0.2 threshold with the native 0.16 tail', () => {
    const problems = collectPolicyViabilityProblems({ ...BASE_CONFIG, thresholdRatio: 0.2 }, 0.1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('policy:');
    expect(problems[0]).toContain('4%');
    expect(problems[0]).toContain('guard.minCompactableRatio 0.1');
  });

  it('accepts a gap at or above the minimum despite float error', () => {
    expect(
      collectPolicyViabilityProblems(
        { ...BASE_CONFIG, thresholdRatio: 0.26, retainRatio: 0.16 },
        0.1,
      ),
    ).toEqual([]);
    expect(
      collectPolicyViabilityProblems(
        { ...BASE_CONFIG, thresholdRatio: 0.6, retainRatio: 0.16 },
        0.1,
      ),
    ).toEqual([]);
  });

  it('skips the absolute token form because it depends on the window', () => {
    const tokensConfig: ResolvedConfig = {
      thresholdRatio: 0.2,
      headroomTokens: 65_536,
      retainTokens: 20_000,
      summarizationProvider: '',
      summarizationModel: '',
      maxTokens: 65_536,
      compactionRetries: 1,
      maxOverflowRetries: 1,
      modelPolicies: [],
      auto: true,
    };
    expect(collectPolicyViabilityProblems(tokensConfig, 0.1)).toEqual([]);
  });

  it('checks every exact model override after native inheritance', () => {
    const problems = collectPolicyViabilityProblems(
      {
        ...BASE_CONFIG,
        thresholdRatio: 0.6,
        modelPolicies: [
          { provider: 'a', model: 'tight', thresholdRatio: 0.2 },
          { provider: 'a', model: 'tokens', retainTokens: 8_000 },
        ],
      },
      0.1,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('modelPolicies[0] (a/tight)');
    expect(problems[0]).toContain('4%');
  });

  it('is disabled when the minimum is zero', () => {
    expect(collectPolicyViabilityProblems({ ...BASE_CONFIG, thresholdRatio: 0.2 }, 0)).toEqual([]);
  });

  it('resolves overrides exactly like the native merge', () => {
    expect(
      resolveTargetPolicy(
        {
          ...BASE_CONFIG,
          modelPolicies: [{ provider: 'a', model: 'b', retainTokens: 4_096 }],
        },
        'a',
        'b',
      ),
    ).toMatchObject({ thresholdRatio: 0.8, retainTokens: 4_096 });
  });
});
