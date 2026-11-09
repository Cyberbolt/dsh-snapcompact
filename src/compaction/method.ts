import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-token-meter';
import type { ContentBlock, Message, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm';
import type { ArchiveRecord } from '../archives/service.js';
import type { SnapcompactConfig, MethodName } from '../config.js';
import type { ImageRoute, ModelRoute } from '../budgeting/capabilities.js';
import type { Renderer } from '../rendering/worker-client.js';

/** Structural mirror of the pinned engine's sole protected extension seam. */
export interface CompactionInput {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSchema[];
}

export type CompactionSummary = {
  summary: ContentBlock[];
  provider: string;
  model: string;
  maxTokens?: number;
  usage?: TokenUsage;
} & (
  | { rawOutput: ContentBlock[]; llmStreamCall: true }
  | { rawOutput?: ContentBlock[]; llmStreamCall?: never }
);

export interface MethodContext {
  readonly input: CompactionInput;
  readonly sourceMessages: readonly Message[];
  readonly sourceTokens: number;
  readonly meter: Context['tokenMeter'];
  readonly archive: ArchiveRecord;
  readonly config: SnapcompactConfig;
  readonly route: ModelRoute;
  readonly llm: Context['llm'];
  readonly attachments: Context['attachments'];
  readonly imageSlots: number;
  readonly render: Renderer['render'];
  readonly signal: AbortSignal | undefined;
  readonly handoff: () => Promise<CompactionSummary>;
  readonly soft: () => Promise<CompactionSummary>;
}

export type MethodAttempt =
  | { readonly kind: 'skipped'; readonly reason: string }
  | {
      readonly kind: 'candidate';
      readonly method: MethodName;
      readonly result: CompactionSummary;
      readonly imageRoute?: ImageRoute;
    };

export type CompactionMethod = (context: MethodContext) => Promise<MethodAttempt>;
