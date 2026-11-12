import { describe, expect, it } from 'vitest';
import {
  auditFailure,
  auditUsage,
  mergeAudits,
  mergeUsage,
  promptTokens,
  weightedCost,
} from './usage.js';

describe('usage audit', () => {
  it('accounts for cached and written prompt sides and passes an exact total', () => {
    const audit = auditUsage([
      {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 30,
        totalTokens: 200,
      },
    ]);
    expect(audit).toMatchObject({
      requests: 1,
      inputTokens: 100,
      cacheReadTokens: 50,
      cacheWriteTokens: 30,
      outputTokens: 20,
      reportedTotalTokens: 200,
      computedTotalTokens: 200,
      unreportedPromptTokens: 0,
      complete: true,
    });
    expect(auditFailure(audit)).toBeUndefined();
  });

  it('rejects the v3 failure where total_tokens hid an unmapped cache side', () => {
    const hidden = auditUsage([
      {
        inputTokens: 12_548,
        outputTokens: 1_357,
        cacheReadTokens: 18_688,
        totalTokens: 32_593,
      },
    ]);
    expect(hidden.computedTotalTokens).toBe(32_593);
    expect(hidden.complete).toBe(true);

    const bug = auditUsage([
      {
        inputTokens: 12_548,
        outputTokens: 1_357,
        totalTokens: 32_593,
      },
    ]);
    expect(bug.unreportedPromptTokens).toBe(18_688);
    expect(bug.complete).toBe(false);
    expect(auditFailure(bug)).toContain('18688 prompt tokens are unreported');
  });

  it('treats a missing total as the mapped sum and merges audits without losing a gap', () => {
    const missing = auditUsage([{ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 }]);
    expect(missing).toMatchObject({
      reportedTotalTokens: 17,
      computedTotalTokens: 17,
      complete: true,
    });
    const merged = mergeAudits([
      missing,
      auditUsage([{ inputTokens: 1, outputTokens: 1, totalTokens: 100 }]),
    ]);
    expect(merged.requests).toBe(2);
    expect(merged.unreportedPromptTokens).toBe(98);
    expect(merged.complete).toBe(false);
  });

  it('sums optional fields and prices output at four times input', () => {
    const merged = mergeUsage(
      { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, totalTokens: 10 },
      { inputTokens: 4, outputTokens: 5, cacheWriteTokens: 6, totalTokens: 20 },
    );
    expect(merged).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 6,
      totalTokens: 30,
    });
    expect(promptTokens({ inputTokens: 5, outputTokens: 7, cacheReadTokens: 3 })).toBe(8);
    expect(weightedCost({ inputTokens: 5, outputTokens: 7, cacheReadTokens: 3 })).toBe(
      5 + 0.3 + 28,
    );
  });
});
