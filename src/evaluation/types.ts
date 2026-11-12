import type { TokenUsage } from '@deepseek-ai/dsh-llm';

/** Every arm a v4 benchmark can run. */
export type ArmName = 'original' | 'native-text' | 'snapcompact' | 'snapcompact-recall';

/**
 * Reconciliation of one run's provider usage.
 *
 * `inputTokens` is fresh (uncached) input. `reportedTotalTokens` is what the
 * provider said; `computedTotalTokens` is the sum of the mapped components.
 * Any positive gap is unreported prompt and invalidates the measurement.
 */
export interface UsageAudit {
  readonly requests: number;
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly reportedTotalTokens: number;
  readonly computedTotalTokens: number;
  readonly unreportedPromptTokens: number;
  readonly complete: boolean;
}

/** Where the question's source text lives in the checkpoint projection. */
export type Region = 'head' | 'middle' | 'tail' | 'unknown';

/** How the strict JSON answer object was recovered from the model response. */
export type ParseMode = 'raw' | 'extracted' | 'failed';

/** One question's score in one arm run. */
export interface QuestionOutcome {
  readonly key: string;
  readonly question: string;
  readonly expected: string;
  readonly accepted: readonly string[];
  /** null when the model omitted the key or its answer was not a string. */
  readonly given: string | null;
  /** Region computed from the actual checkpoint projection. */
  readonly region: Region;
  /** Region declared by the fixture, kept to detect fixture drift. */
  readonly declaredRegion: Region;
  readonly kind: string;
  /** Accepted match, including fixture-declared equivalent spellings. */
  readonly correct: boolean;
  /** Strict match against the canonical answer only. */
  readonly exact: boolean;
  /** The exact source line was found in the archive transcript. */
  readonly archiveContains: boolean;
}

/** One arm executed once. */
export interface ArmRun {
  readonly run: number;
  readonly status: 'measured' | 'failed' | 'skipped';
  readonly correct: number;
  readonly exactCorrect: number;
  readonly total: number;
  readonly missed: readonly string[];
  readonly exactMissed: readonly string[];
  readonly outcomes: readonly QuestionOutcome[];
  readonly usage?: TokenUsage;
  readonly audit?: UsageAudit;
  readonly promptTokens?: number;
  readonly outputTokens?: number;
  readonly elapsedMs: number;
  readonly parseMode?: ParseMode;
  readonly recallCalls?: number;
  /** Model requests in this arm, including the final answer round. */
  readonly recallRounds?: number;
  /** Serialized recall tool-result bytes sent back to the model. */
  readonly recallBytes?: number;
  /** One entry per executed recall call, for evidence in the report. */
  readonly recallQueries?: readonly string[];
  readonly reason?: string;
}

/** Pooled region or kind tally across measured runs. */
export interface RegionTally {
  readonly correct: number;
  readonly total: number;
}

/** Mean/min/max of a per-run correct count. */
export interface ScoreRange {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

/** Aggregated score for one arm. */
export interface ArmScore {
  readonly accepted: ScoreRange;
  readonly exact: ScoreRange;
  readonly byRegion: Readonly<Record<Region, RegionTally>>;
  readonly byKind: Readonly<Record<string, RegionTally>>;
}

/** One arm with every run and its aggregate. */
export interface EvaluationArm {
  readonly name: ArmName;
  readonly total: number;
  readonly measuredRuns: number;
  readonly runs: readonly ArmRun[];
  readonly score: ArmScore;
  readonly frames?: number;
  readonly estimatedCheckpointTokens?: number;
  readonly pricedBy?: string;
}

/** Native summary generation metadata; generated once per evaluation. */
export interface SummaryGeneration {
  readonly elapsedMs: number;
  readonly usage?: TokenUsage;
  readonly failed?: string;
}

/** Visual checkpoint preparation metadata; rendered once per evaluation. */
export interface VisualPreparation {
  readonly elapsedMs: number;
  readonly frames?: number;
  readonly checkpointTokens?: number;
  readonly budgetTokens?: number;
  readonly overBudget?: boolean;
  readonly pricedBy?: string;
  readonly reason?: string;
}

/** A versioned accuracy-suite report. */
export interface EvaluationReport {
  readonly version: 3;
  readonly fixture: string;
  readonly provider: string;
  readonly model: string;
  readonly timestamp: string;
  readonly runs: number;
  readonly arms: readonly EvaluationArm[];
  readonly archiveCoverage: RegionTally;
  readonly summaryGeneration: SummaryGeneration;
  readonly visualPreparation: VisualPreparation;
  readonly usageAudit: UsageAudit;
  readonly warning: string;
}

/** One controlled turn in the long-session cost suite. */
export type SessionTurnMode = 'plain' | 'light' | 'heavy';

/** One model turn in a persistent session, with its own reconciled usage. */
export interface SessionTurn {
  readonly index: number;
  readonly mode: SessionTurnMode;
  readonly correct: number;
  readonly total: number;
  readonly missed: readonly string[];
  /** Sum over this turn's requests. */
  readonly promptTokens: number;
  /** Largest single-request prompt in this turn. */
  readonly peakPromptTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** Relative weighted cost; not currency. */
  readonly weightedCost: number;
  /** Model requests in this turn, including tool rounds and the final answer. */
  readonly rounds: number;
  readonly recallCalls: number;
  readonly recallBytes: number;
  readonly elapsedMs: number;
  /** The turn used more recall calls than its schedule allowed. */
  readonly offSchedule: boolean;
  readonly audit: UsageAudit;
}

/** One arm of the persistent long-session suite. */
export interface SessionArm {
  readonly name: ArmName;
  readonly status: 'measured' | 'failed' | 'skipped';
  readonly turns: readonly SessionTurn[];
  readonly peakPromptTokens: number;
  readonly promptTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly weightedCost: number;
  readonly correct: number;
  readonly total: number;
  readonly rounds: number;
  readonly recallCalls: number;
  readonly recallBytes: number;
  readonly frames?: number;
  readonly estimatedCheckpointTokens?: number;
  readonly note?: string;
  readonly reason?: string;
}

/** Deterministic capacity estimate; no model call. */
export interface CapacityPoint {
  readonly sourceChars: number;
  readonly estimatedSourceTokens: number;
  readonly originalFits: boolean;
  readonly checkpointEstimatedTokens: number;
  readonly contextWindow: number;
}

/** Modeled recall-rate sensitivity using measured components. */
export interface SensitivityPoint {
  readonly recallRate: number;
  readonly weightedCost: number;
  readonly ratioToOriginal: number;
  readonly modeled: boolean;
}

/** Where the recall arm's prompt tokens went. */
export interface SessionAttribution {
  readonly checkpointResendTokens: number;
  readonly toolPageTokens: number;
  readonly otherPromptTokens: number;
  readonly outputTokens: number;
}

/** A versioned long-session report. */
export interface SessionReport {
  readonly version: 1;
  readonly fixture: string;
  readonly provider: string;
  readonly model: string;
  readonly timestamp: string;
  readonly run: number;
  readonly schedule: readonly SessionTurnMode[];
  readonly arms: readonly SessionArm[];
  readonly usageAudit: UsageAudit;
  readonly capacity: readonly CapacityPoint[];
  readonly sensitivity: readonly SensitivityPoint[];
  readonly attribution: SessionAttribution;
  readonly warning: string;
}
