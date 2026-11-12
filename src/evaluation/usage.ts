import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import type { UsageAudit } from './types.js';

/**
 * Relative cost weights for benchmark diagnostics, not a bill.
 *
 * Input is the unit; a cache read is assumed to cost a tenth of fresh input, a
 * cache write a quarter more, and output four times. The exact multipliers
 * depend on the provider and the prompt-cache lifetime, so the report always
 * labels weighted costs as relative units.
 */
export const WEIGHTED_COST = Object.freeze({
  input: 1,
  cacheRead: 0.1,
  cacheWrite: 1.25,
  output: 4,
});

/** Add one model response's usage into another without losing optional fields. */
export function mergeUsage(
  total: TokenUsage | undefined,
  addition: TokenUsage | undefined,
): TokenUsage | undefined {
  if (addition === undefined) return total;
  if (total === undefined) return { ...addition };
  const sum = (left: number | undefined, right: number | undefined): number | undefined =>
    left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
  const totalTokens = sum(total.totalTokens, addition.totalTokens);
  const cacheReadTokens = sum(total.cacheReadTokens, addition.cacheReadTokens);
  const cacheWriteTokens = sum(total.cacheWriteTokens, addition.cacheWriteTokens);
  const reasoningTokens = sum(total.reasoningTokens, addition.reasoningTokens);
  return {
    inputTokens: total.inputTokens + addition.inputTokens,
    outputTokens: total.outputTokens + addition.outputTokens,
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  };
}

/** Billed prompt tokens: fresh input plus both cache sides. */
export function promptTokens(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/** Relative weighted cost; not currency. */
export function weightedCost(usage: TokenUsage): number {
  return (
    usage.inputTokens * WEIGHTED_COST.input +
    (usage.cacheReadTokens ?? 0) * WEIGHTED_COST.cacheRead +
    (usage.cacheWriteTokens ?? 0) * WEIGHTED_COST.cacheWrite +
    usage.outputTokens * WEIGHTED_COST.output
  );
}

/**
 * Reconcile provider usage with `total_tokens`.
 *
 * A provider that reports `total_tokens` larger than input + cache read + cache
 * write + output has hidden a prompt side that was not mapped. That number may
 * not be used as a measurement. Missing `total_tokens` is not an error: the
 * components are then the complete record.
 */
export function auditUsage(usages: readonly (TokenUsage | undefined)[]): UsageAudit {
  let requests = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;
  let reportedTotalTokens = 0;
  for (const usage of usages) {
    if (usage === undefined) continue;
    requests += 1;
    const read = usage.cacheReadTokens ?? 0;
    const write = usage.cacheWriteTokens ?? 0;
    const computed = usage.inputTokens + read + write + usage.outputTokens;
    inputTokens += usage.inputTokens;
    cacheReadTokens += read;
    cacheWriteTokens += write;
    outputTokens += usage.outputTokens;
    reportedTotalTokens += usage.totalTokens ?? computed;
  }
  const computedTotalTokens = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens;
  const unreportedPromptTokens = Math.max(0, reportedTotalTokens - computedTotalTokens);
  return {
    requests,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    reportedTotalTokens,
    computedTotalTokens,
    unreportedPromptTokens,
    complete: unreportedPromptTokens === 0,
  };
}

/** Combine per-turn audits without losing an unreported side. */
export function mergeAudits(audits: readonly UsageAudit[]): UsageAudit {
  const sum = (pick: (audit: UsageAudit) => number): number =>
    audits.reduce((total, audit) => total + pick(audit), 0);
  const reportedTotalTokens = sum((audit) => audit.reportedTotalTokens);
  const computedTotalTokens = sum((audit) => audit.computedTotalTokens);
  const unreportedPromptTokens = Math.max(0, reportedTotalTokens - computedTotalTokens);
  return {
    requests: sum((audit) => audit.requests),
    inputTokens: sum((audit) => audit.inputTokens),
    cacheReadTokens: sum((audit) => audit.cacheReadTokens),
    cacheWriteTokens: sum((audit) => audit.cacheWriteTokens),
    outputTokens: sum((audit) => audit.outputTokens),
    reportedTotalTokens,
    computedTotalTokens,
    unreportedPromptTokens,
    complete: unreportedPromptTokens === 0,
  };
}

/** Human-readable audit failure used in run reasons and reports. */
export function auditFailure(audit: UsageAudit): string | undefined {
  if (audit.complete) return undefined;
  return (
    `Usage audit failed: provider reported ${audit.reportedTotalTokens} total tokens but only ` +
    `${audit.computedTotalTokens} are accounted for (input ${audit.inputTokens}, cache read ` +
    `${audit.cacheReadTokens}, cache write ${audit.cacheWriteTokens}, output ${audit.outputTokens}); ` +
    `${audit.unreportedPromptTokens} prompt tokens are unreported.`
  );
}
