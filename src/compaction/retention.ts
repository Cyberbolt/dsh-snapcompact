import type { SnapcompactConfig } from '../config.js';

/**
 * Share of the trigger ratio that stays verbatim after compaction.
 *
 * The host default pair (threshold 0.8, retention 0.16) is exactly this share,
 * so deriving the tail as `thresholdRatio × 0.2` reproduces the native default
 * at the default threshold and keeps both budgets moving together when the
 * threshold changes. The card no longer edits the tail; YAML can still override
 * it with `retainRatio` or `retainTokens`.
 *
 * The rule lives in ratio space: the native engine resolves
 * `retain = floor((W − O) × retainRatio)`, while the threshold may be capped by
 * headroom. The token share can therefore exceed 1/5 on a capped route; use
 * `/snapcompact status` for the exact numbers.
 */
export const TAIL_SHARE_OF_TRIGGER = 0.2;

/** Where the effective retention of one route came from. */
export type RetentionOrigin = 'auto' | 'explicit' | 'native';

/** Three decimals cover the card's 0.01 threshold step without float noise. */
function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isExplicit(policy: {
  retainRatio?: number | undefined;
  retainTokens?: number | undefined;
}): boolean {
  return policy.retainRatio !== undefined || policy.retainTokens !== undefined;
}

/**
 * Fill in the derived tail for every scope that configures a threshold but no
 * retention. Explicit retention always wins, and a globally explicit retention
 * is inherited by routes instead of being recomputed, so the authored intent
 * stays the single source of truth.
 *
 * With neither threshold nor retention configured the policy is returned
 * unchanged: the native defaults (0.8 / 0.16) already satisfy the rule and
 * remain owned by the host.
 */
export function withDerivedRetention(
  policy: SnapcompactConfig['policy'],
): SnapcompactConfig['policy'] {
  const globalExplicit = isExplicit(policy);
  const next: SnapcompactConfig['policy'] = { ...policy };
  if (!globalExplicit && policy.thresholdRatio !== undefined) {
    next.retainRatio = roundRatio(policy.thresholdRatio * TAIL_SHARE_OF_TRIGGER);
  }
  if (policy.modelPolicies !== undefined) {
    next.modelPolicies = policy.modelPolicies.map((route) => {
      if (isExplicit(route) || globalExplicit || route.thresholdRatio === undefined) return route;
      return {
        ...route,
        retainRatio: roundRatio(route.thresholdRatio * TAIL_SHARE_OF_TRIGGER),
      };
    });
  }
  return next;
}

/**
 * Classify the authored retention for one route so status output can explain
 * whether the tail is derived, explicit, or inherited from the host default.
 */
export function retentionOrigin(
  policy: SnapcompactConfig['policy'],
  provider: string,
  model: string,
): RetentionOrigin {
  const route = policy.modelPolicies?.find(
    (candidate) => candidate.provider === provider && candidate.model === model,
  );
  if (route !== undefined && isExplicit(route)) return 'explicit';
  if (isExplicit(policy)) return 'explicit';
  const threshold = route?.thresholdRatio ?? policy.thresholdRatio;
  return threshold === undefined ? 'native' : 'auto';
}
