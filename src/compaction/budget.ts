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

/** Absolute clamp shared by the source floor and the status floor. */
export const MIN_USEFUL_TOKENS = 1_024;

/** Tolerance for ratio arithmetic such as `0.26 - 0.16`. */
const RATIO_EPSILON = 1e-9;

export type PressureBudget =
  | {
      readonly kind: 'ok';
      readonly thresholdTokens: number;
      readonly retainTokens: number;
      /** Space a checkpoint may actually replace: `max(0, threshold - retained tail)`. */
      readonly compactableTokens: number;
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
    compactableTokens: Math.max(0, thresholdTokens - retainTokens),
    retainTooLarge: retainTokens >= thresholdTokens,
    messageBudgetTokens,
  };
}

/**
 * Per-window fraction of the room left for a checkpoint, formatted for errors.
 * One decimal keeps `0.26 - 0.16` human-readable without float noise.
 */
function formatCompactablePercent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

/**
 * Reject retention policies that leave a window with no room to pay for a
 * checkpoint.
 *
 * The native backend already rejects `retainRatio >= thresholdRatio`, but it
 * cannot know that a 4% gap still costs more than the checkpoint saves: at a
 * 1M window, the default 16% tail leaves about 41K squeeze room, while a
 * checkpoint plus the retained text costs far more. Only the ratio form is
 * checked here; an absolute `retainTokens` budget is window-dependent and is
 * reported by `/snapcompact status` instead.
 *
 * @param config - resolved native policy after defaults were applied.
 * @param minimumCompactableRatio - smallest `thresholdRatio - retainRatio`
 *   that may load; `0` disables the check.
 * @returns actionable English messages, one per infeasible scope.
 */
export function collectPolicyViabilityProblems(
  config: ResolvedConfig,
  minimumCompactableRatio: number,
): string[] {
  if (!Number.isFinite(minimumCompactableRatio) || minimumCompactableRatio <= 0) return [];
  const problems: string[] = [];
  // An empty target can never match a model override: provider/model are
  // validated non-empty by the native backend, so this resolves the defaults.
  const check = (label: string, policy: TargetPolicy): void => {
    if (policy.retainTokens !== undefined) return;
    const retainRatio = policy.retainRatio ?? 0;
    const compactable = policy.thresholdRatio - retainRatio;
    if (compactable + RATIO_EPSILON >= minimumCompactableRatio) return;
    problems.push(
      `${label}: thresholdRatio ${policy.thresholdRatio} - retainRatio ${retainRatio} leaves ` +
        `only ${formatCompactablePercent(compactable)} of the window compactable, below ` +
        `guard.minCompactableRatio ${minimumCompactableRatio}; raise thresholdRatio or lower ` +
        'retainRatio/retainTokens.',
    );
  };
  check('policy', resolveTargetPolicy(config, '', ''));
  config.modelPolicies.forEach((policy, index) => {
    check(
      `modelPolicies[${index}] (${policy.provider}/${policy.model})`,
      resolveTargetPolicy(config, policy.provider, policy.model),
    );
  });
  return problems;
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
