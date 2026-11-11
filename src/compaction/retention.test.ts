import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic';
import { toNativePolicy } from '../config.js';
import { collectPolicyViabilityProblems } from './budget.js';
import { retentionOrigin, TAIL_SHARE_OF_TRIGGER, withDerivedRetention } from './retention.js';

describe('derived retained tail', () => {
  it('leaves an unconfigured policy to the native defaults', () => {
    expect(withDerivedRetention({})).toEqual({});
    expect(toNativePolicy({})).toEqual({});
  });

  it('derives one fifth of the trigger ratio', () => {
    expect(TAIL_SHARE_OF_TRIGGER).toBe(0.2);
    expect(withDerivedRetention({ thresholdRatio: 0.8 })).toEqual({
      thresholdRatio: 0.8,
      retainRatio: 0.16,
    });
    expect(withDerivedRetention({ thresholdRatio: 0.6 }).retainRatio).toBe(0.12);
    expect(withDerivedRetention({ thresholdRatio: 0.53 }).retainRatio).toBe(0.106);
  });

  it('never replaces an explicit retention', () => {
    expect(withDerivedRetention({ thresholdRatio: 0.8, retainRatio: 0.03 })).toEqual({
      thresholdRatio: 0.8,
      retainRatio: 0.03,
    });
    expect(withDerivedRetention({ thresholdRatio: 0.8, retainTokens: 32_768 })).toEqual({
      thresholdRatio: 0.8,
      retainTokens: 32_768,
    });
  });

  it('derives per route only when the route owns a threshold', () => {
    const policy = withDerivedRetention({
      thresholdRatio: 0.8,
      modelPolicies: [
        { provider: 'a', model: 'b', thresholdRatio: 0.5 },
        { provider: 'a', model: 'c' },
        { provider: 'a', model: 'd', retainRatio: 0.02 },
      ],
    });
    expect(policy.modelPolicies).toEqual([
      { provider: 'a', model: 'b', thresholdRatio: 0.5, retainRatio: 0.1 },
      { provider: 'a', model: 'c' },
      { provider: 'a', model: 'd', retainRatio: 0.02 },
    ]);
  });

  it('keeps an explicit global retention inherited by routes', () => {
    const policy = withDerivedRetention({
      retainRatio: 0.11,
      modelPolicies: [{ provider: 'a', model: 'b', thresholdRatio: 0.5 }],
    });
    expect(policy).toEqual({
      retainRatio: 0.11,
      modelPolicies: [{ provider: 'a', model: 'b', thresholdRatio: 0.5 }],
    });
  });

  it('keeps the derived ratio strictly below every threshold', () => {
    for (const thresholdRatio of [0.01, 0.1, 0.2, 0.5, 0.8, 1]) {
      const retainRatio = withDerivedRetention({ thresholdRatio }).retainRatio ?? 0;
      expect(retainRatio).toBeGreaterThan(0);
      expect(retainRatio).toBeLessThan(thresholdRatio);
    }
  });

  it('converts the derived tail into the native policy', () => {
    expect(toNativePolicy({ thresholdRatio: 0.6 })).toEqual({
      thresholdRatio: 0.6,
      retainRatio: 0.12,
    });
    expect(toNativePolicy({ thresholdRatio: 0.8, retainTokens: 1_024 })).toEqual({
      thresholdRatio: 0.8,
      retainTokens: 1_024,
    });
  });

  it('classifies the authored retention for status output', () => {
    expect(retentionOrigin({}, 'a', 'b')).toBe('native');
    expect(retentionOrigin({ thresholdRatio: 0.8 }, 'a', 'b')).toBe('auto');
    expect(retentionOrigin({ thresholdRatio: 0.8, retainRatio: 0.03 }, 'a', 'b')).toBe('explicit');
    expect(
      retentionOrigin(
        {
          thresholdRatio: 0.8,
          modelPolicies: [{ provider: 'a', model: 'b', thresholdRatio: 0.5 }],
        },
        'a',
        'b',
      ),
    ).toBe('auto');
    expect(
      retentionOrigin(
        {
          thresholdRatio: 0.8,
          modelPolicies: [{ provider: 'a', model: 'b', retainTokens: 2_048 }],
        },
        'a',
        'b',
      ),
    ).toBe('explicit');
  });

  it('leaves a very low YAML threshold to the usefulness guard', () => {
    const retainRatio = withDerivedRetention({ thresholdRatio: 0.1 }).retainRatio ?? 0;
    const resolved: ResolvedConfig = {
      thresholdRatio: 0.1,
      headroomTokens: 65_536,
      retainRatio,
      summarizationProvider: '',
      summarizationModel: '',
      maxTokens: 65_536,
      compactionRetries: 1,
      maxOverflowRetries: 1,
      modelPolicies: [],
      auto: true,
    };
    expect(collectPolicyViabilityProblems(resolved, 0.1)).toHaveLength(1);
  });
});
