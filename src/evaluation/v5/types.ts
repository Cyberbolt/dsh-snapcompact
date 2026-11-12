import type { Message } from '@deepseek-ai/dsh-llm';
import type { TokenUsage } from '@deepseek-ai/dsh-llm';

/** The arms a production v5 run can execute. */
export type V5ArmName =
  | 'original'
  | 'native-text'
  | 'pure-visual'
  | 'gold-text'
  | 'degraded-visual';

/** Primary question class; cross-cutting tags are reported separately. */
export type V5QuestionKind =
  | 'exact-command'
  | 'exact-path'
  | 'exact-checksum'
  | 'exact-identifier'
  | 'numeric'
  | 'cross-region'
  | 'temporal'
  | 'causal'
  | 'negation'
  | 'cjk';

/** A deterministic, source-derived rubric. No model judges an answer. */
export type V5Rubric =
  | {
      readonly kind: 'exact';
      /** Canonical answer plus equivalent spellings. */
      readonly accept: readonly string[];
    }
  | {
      readonly kind: 'all';
      /** Every literal must appear in the answer (case-insensitive). */
      readonly required: readonly string[];
      /** No literal may appear in the answer (case-insensitive). */
      readonly forbidden: readonly string[];
    }
  | {
      readonly kind: 'any';
      /** At least one literal must appear (case-insensitive). */
      readonly anyOf: readonly string[];
      readonly forbidden: readonly string[];
    };

export interface V5Question {
  readonly key: string;
  readonly turn: number;
  readonly question: string;
  /** Canonical expected answer, shown in the report. */
  readonly answer: string;
  readonly rubric: V5Rubric;
  /** Exact source snippet used to locate the fact in the serialized projection. */
  readonly source: string;
  /** Additional sources for cross-region questions. */
  readonly sources: readonly string[];
  readonly kind: V5QuestionKind;
  readonly tags: readonly string[];
}

export interface V5Turn {
  readonly index: number;
  readonly keys: readonly string[];
}

export interface V5Fixture {
  readonly version: 5;
  readonly generator: 'v5.0.0';
  readonly id: string;
  readonly seed: number;
  readonly project: string;
  readonly messages: readonly Message[];
  readonly questions: Readonly<Record<string, V5Question>>;
  readonly turns: readonly V5Turn[];
  readonly decoys: readonly string[];
}

export type V5ParseMode = 'raw' | 'extracted' | 'failed';

export interface V5QuestionOutcome {
  readonly key: string;
  readonly turn: number;
  readonly question: string;
  readonly expected: string;
  readonly given: string | null;
  readonly kind: V5QuestionKind;
  readonly tags: readonly string[];
  readonly region: 'head' | 'middle' | 'tail' | 'multi' | 'unknown';
  readonly primaryRegion: 'head' | 'middle' | 'tail' | 'unknown';
  readonly correct: boolean;
  /** Character edit distance from the canonical answer; null when not scored. */
  readonly charErrors: number | null;
  readonly charTotal: number | null;
}

export interface V5UsageAudit {
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

export interface V5TurnResult {
  readonly index: number;
  readonly keys: readonly string[];
  readonly outcomes: readonly V5QuestionOutcome[];
  readonly correct: number;
  readonly total: number;
  readonly promptTokens: number;
  readonly peakPromptTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly weightedCost: number;
  readonly rounds: number;
  readonly toolCalls: number;
  readonly toolBytes: number;
  readonly elapsedMs: number;
  readonly parseMode: V5ParseMode;
  readonly audit: V5UsageAudit;
  readonly answerText: string;
  readonly reason?: string;
}

export interface V5ArmRun {
  readonly arm: V5ArmName;
  readonly run: number;
  readonly status: 'measured' | 'failed' | 'skipped';
  readonly turns: readonly V5TurnResult[];
  readonly correct: number;
  readonly total: number;
  readonly peakPromptTokens: number;
  readonly promptTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly weightedCost: number;
  readonly rounds: number;
  readonly toolCalls: number;
  readonly toolBytes: number;
  readonly elapsedMs: number;
  readonly audit: V5UsageAudit;
  readonly frames?: number;
  readonly checkpointTokens?: number;
  readonly budgetTokens?: number;
  readonly reason?: string;
  readonly usage?: TokenUsage;
}

export interface V5Range {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly sd: number;
  readonly ci95: readonly [number, number];
}

export interface V5Tally {
  readonly correct: number;
  readonly total: number;
}

export interface V5ArmReport {
  readonly arm: V5ArmName;
  readonly total: number;
  readonly measuredRuns: number;
  readonly runs: readonly V5ArmRun[];
  readonly accepted: V5Range;
  readonly exact: V5Range;
  readonly byKind: Readonly<Record<string, V5Tally>>;
  readonly byRegion: Readonly<Record<string, V5Tally>>;
  readonly byTag: Readonly<Record<string, V5Tally>>;
  readonly byCharacterClass: Readonly<
    Record<string, { readonly errors: number; readonly total: number }>
  >;
  readonly parseModes: Readonly<Record<string, number>>;
  readonly frames?: number;
  readonly checkpointTokens?: number;
}

export interface V5Preparation {
  readonly elapsedMs: number;
  readonly frames?: number;
  readonly checkpointTokens?: number;
  readonly budgetTokens?: number;
  readonly overBudget?: boolean;
  readonly pricedBy?: string;
  readonly reason?: string;
  readonly usage?: TokenUsage;
}

export interface V5FixtureMeta {
  readonly id: string;
  readonly seed: number;
  readonly hash: string;
  readonly sourceChars: number;
  readonly estimatedSourceTokens: number;
  readonly messages: number;
  readonly questions: number;
  readonly turns: number;
}

export interface V5Report {
  readonly version: 5;
  readonly fixture: V5FixtureMeta;
  readonly provider: string;
  readonly model: string;
  readonly timestamp: string;
  readonly runs: number;
  readonly schedule: readonly (readonly string[])[];
  readonly arms: readonly V5ArmReport[];
  readonly nativePreparation: V5Preparation;
  readonly visualPreparation: V5Preparation;
  readonly degradedPreparation: V5Preparation;
  readonly usageAudit: V5UsageAudit;
  readonly instrument: readonly {
    readonly check: string;
    readonly expected: string;
    readonly actual: string;
    readonly pass: boolean;
  }[];
  readonly gates: readonly {
    readonly check: string;
    readonly expected: string;
    readonly actual: string;
    readonly pass: boolean;
  }[];
  readonly warning: string;
}
