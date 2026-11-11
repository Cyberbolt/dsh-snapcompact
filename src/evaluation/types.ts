import type { TokenUsage } from '@deepseek-ai/dsh-llm';

/** Every arm a v3 benchmark can run. */
export type ArmName = 'original' | 'native-text' | 'snapcompact' | 'snapcompact-recall';

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
  readonly promptTokens?: number;
  readonly outputTokens?: number;
  readonly elapsedMs: number;
  readonly parseMode?: ParseMode;
  readonly recallCalls?: number;
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

/** A versioned evaluation report. */
export interface EvaluationReport {
  readonly version: 2;
  readonly fixture: string;
  readonly provider: string;
  readonly model: string;
  readonly timestamp: string;
  readonly runs: number;
  readonly arms: readonly EvaluationArm[];
  readonly archiveCoverage: RegionTally;
  readonly summaryGeneration: SummaryGeneration;
  readonly visualPreparation: VisualPreparation;
  readonly warning: string;
}
