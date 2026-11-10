import type { ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic';

/**
 * Trigger-relative budgets shared by the engine and the status command.
 *
 * Both sides mirror the pinned backend's pressure formula. The status command
 * only displays it; the engine uses the same numbers to decide how large a
 * checkpoint may be, so the two can never disagree about the trigger.
 */

/** Policy view merged exactly like the native backend before capacity scaling. */
export interface TargetPolicy {
  readonly thresholdRatio: number;
  readonly headroomTokens: number;
  readonly retainRatio?: number;
  readonly retainTokens?: number;
}

export type PressureBudget =
  | {
      readonly kind: 'ok';
      readonly thresholdTokens: number;
      readonly retainTokens: number;
      readonly retainTooLarge: boolean;
      readonly messageBudgetTokens: number;
    }
  | { readonly kind: 'error'; readonly reason: string };

/** Exact-target override first, then global defaults; retention fields stay mutually exclusive. */
export function resolveTargetPolicy(
  config: ResolvedConfig,
  provider: string,
  model: string,
): TargetPolicy {
  const override = config.modelPolicies.find(
    (policy) => policy.provider === provider && policy.model === model,
  );
  const thresholdRatio = override?.thresholdRatio ?? config.thresholdRatio;
  const headroomTokens = override?.headroomTokens ?? config.headroomTokens;
  if (override?.retainTokens !== undefined) {
    return { thresholdRatio, headroomTokens, retainTokens: override.retainTokens };
  }
  if (override?.retainRatio !== undefined) {
    return { thresholdRatio, headroomTokens, retainRatio: override.retainRatio };
  }
  if (config.retainTokens !== undefined) {
    return { thresholdRatio, headroomTokens, retainTokens: config.retainTokens };
  }
  return { thresholdRatio, headroomTokens, retainRatio: config.retainRatio };
}

/**
 * Mirror of the pinned backend's trigger formula:
 * `floor(min(W × ratio, W − O − headroom))`, with the retained tail below it.
 * The native engine remains the sole authority over when to compact.
 */
export function resolvePressureBudget(
  policy: TargetPolicy,
  contextWindow: number,
  reservedCompletionTokens: number,
): PressureBudget {
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
    return { kind: 'error', reason: `模型声明了无效的上下文窗口（${contextWindow}）` };
  }
  if (!Number.isInteger(reservedCompletionTokens) || reservedCompletionTokens < 0) {
    return { kind: 'error', reason: `输出预留不是有效的非负整数（${reservedCompletionTokens}）` };
  }
  const messageBudgetTokens = contextWindow - reservedCompletionTokens;
  if (messageBudgetTokens <= 0) {
    return {
      kind: 'error',
      reason: `窗口 ${formatTokens(contextWindow)} 扣除输出预留 ${formatTokens(reservedCompletionTokens)} 后没有剩余消息预算`,
    };
  }
  const pressureBudgetTokens = messageBudgetTokens - policy.headroomTokens;
  if (pressureBudgetTokens <= 0) {
    return {
      kind: 'error',
      reason:
        `窗口 ${formatTokens(contextWindow)} 扣除输出预留 ${formatTokens(reservedCompletionTokens)} ` +
        `与 headroom ${formatTokens(policy.headroomTokens)} 后没有触发预算；` +
        '请降低 headroomTokens 或换用更大窗口的模型',
    };
  }
  const thresholdTokens = Math.floor(
    Math.min(contextWindow * policy.thresholdRatio, pressureBudgetTokens),
  );
  const retainTokens =
    policy.retainTokens ?? Math.floor(messageBudgetTokens * (policy.retainRatio ?? 0));
  return {
    kind: 'ok',
    thresholdTokens,
    retainTokens,
    retainTooLarge: retainTokens >= thresholdTokens,
    messageBudgetTokens,
  };
}

export interface CheckpointBudgetInput {
  /** Whole request pressure the next turn would cost; ignores this compaction. */
  readonly totalTokens: number;
  /** Estimated tokens of the history this checkpoint replaces. */
  readonly sourceTokens: number;
  /** Trigger threshold for the routed model; absent when the route declares no window. */
  readonly thresholdTokens?: number;
}

export type CheckpointBudget =
  | {
      readonly kind: 'ok';
      /** `threshold` when bounded by the trigger room, `source` when the window is unknown. */
      readonly basis: 'threshold' | 'source';
      /** Largest estimated checkpoint the visual path may produce. */
      readonly tokens: number;
      /** Space between the trigger threshold and everything a checkpoint cannot replace. */
      readonly roomTokens: number;
    }
  | { readonly kind: 'unreachable' };

/**
 * Size one checkpoint against the room left under the trigger.
 *
 * Everything a checkpoint cannot replace — system prompt, tool schemas, output
 * reservation, retained tail — keeps its tokens after compaction. Spending at
 * most half of the remaining room guarantees the post-compaction total stays
 * below the threshold with an equal share of headroom, which is the condition
 * the native engine re-checks before it accepts a checkpoint.
 *
 * At the moment automatic pressure fires, `room ≈ source`, so this equals the
 * previous `source / 2` rule; it only tightens by the amount the session
 * overshot the threshold, and it stays correct for a manual compaction that
 * happens below the threshold.
 *
 * Without a declared context window there is no trigger to measure against, so
 * the same half-of-the-source rule applies unchanged.
 */
export function resolveCheckpointBudget({
  totalTokens,
  sourceTokens,
  thresholdTokens,
}: CheckpointBudgetInput): CheckpointBudget {
  const source = Math.max(0, Math.floor(sourceTokens));
  if (thresholdTokens === undefined || !Number.isInteger(thresholdTokens) || thresholdTokens <= 0) {
    return { kind: 'ok', basis: 'source', tokens: Math.floor(source / 2), roomTokens: source };
  }
  const fixed = Math.max(0, Math.floor(totalTokens) - source);
  const room = thresholdTokens - fixed;
  if (room <= 0) return { kind: 'unreachable' };
  return {
    kind: 'ok',
    basis: 'threshold',
    tokens: Math.floor(Math.min(room, source) / 2),
    roomTokens: room,
  };
}

const TOKEN_FORMAT = new Intl.NumberFormat('en-US');

/** Avoid locale-dependent separators in command output and tests. */
export function formatTokens(value: number): string {
  return TOKEN_FORMAT.format(value);
}
