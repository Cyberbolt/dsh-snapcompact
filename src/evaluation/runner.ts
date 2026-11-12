import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import {
  BlockAssembler,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm';
import type { ContentBlock, RequestMessage, TokenUsage } from '@deepseek-ai/dsh-llm';
import type { ArchiveRecord, ArchiveService } from '../archives/service.js';
import type { SnapcompactConfig } from '../config.js';
import type { CompactionInput, CompactionSummary } from '../compaction/method.js';
import { snapcompact } from '../compaction/methods/snapcompact.js';
import { checkpointSummary } from '../compaction/checkpoint.js';
import { estimateCheckpoint } from '../budgeting/pricing.js';
import type { Renderer } from '../rendering/worker-client.js';
import { recallArgumentsSchema, readRecallPage, recallToolSchema } from '../archives/recall.js';
import {
  buildFixtureMessages,
  classifyQuestionRegions,
  countArchiveCoverage,
  loadFixture,
} from './fixture.js';
import type { Fixture } from './fixture.js';
import { aggregateArm, buildOutcomes, parseAnswerObject } from './scoring.js';
import { auditFailure, auditUsage, mergeAudits, mergeUsage, promptTokens } from './usage.js';
import type {
  ArmRun,
  EvaluationArm,
  EvaluationReport,
  Region,
  SummaryGeneration,
  UsageAudit,
  VisualPreparation,
} from './types.js';

type NativeSummarizer = (
  input: CompactionInput,
  agent: Agent,
  signal?: AbortSignal,
) => Promise<CompactionSummary>;

export interface EvaluationOptions {
  /** Repeat only the QA arms; the native summary and visual checkpoint are prepared once. */
  runs?: number;
}

/** The 40-question fixture can exceed 8k output tokens on reasoning routes. */
const EVALUATION_MAX_TOKENS = 32_768;
const MAX_RUNS = 5;
const MAX_TOOL_ROUNDS = 5;
/** The production agent has no hard recall cap; keep a generous bench ceiling. */
const MAX_TOOL_CALLS = 40;

function failedRun(
  run: number,
  total: number,
  elapsedMs: number,
  reason: string,
  usage?: TokenUsage,
  audit?: UsageAudit,
): ArmRun {
  return {
    run,
    status: 'failed',
    correct: 0,
    exactCorrect: 0,
    total,
    missed: [],
    exactMissed: [],
    outcomes: [],
    elapsedMs,
    ...(usage === undefined
      ? {}
      : {
          usage,
          promptTokens: promptTokens(usage),
          outputTokens: usage.outputTokens,
        }),
    ...(audit === undefined ? {} : { audit }),
    reason,
  };
}

function skippedRun(run: number, total: number, reason: string): ArmRun {
  return {
    run,
    status: 'skipped',
    correct: 0,
    exactCorrect: 0,
    total,
    missed: [],
    exactMissed: [],
    outcomes: [],
    elapsedMs: 0,
    reason,
  };
}

/** Question block shared by the accuracy suite and one long-session turn. */
export function questionsPrompt(fixture: Fixture, keys?: readonly string[]): string {
  const questions: Record<string, string> = {};
  for (const [key, question] of Object.entries(fixture.questions)) {
    if (keys === undefined || keys.includes(key)) questions[key] = question.question;
  }
  return (
    '\nAnswer these questions using ONLY the preceding historical material. ' +
    'Return a JSON object with exactly these keys and string answers; no Markdown.\n' +
    JSON.stringify(questions)
  );
}

export interface RunAgentTurnOptions {
  readonly ctx: Context;
  readonly agent: Agent;
  readonly archives: ArchiveService;
  readonly route: { readonly provider: string; readonly model: string };
  readonly signal: AbortSignal;
  /** Mutable request history; tool traffic and optionally the final answer are appended. */
  readonly messages: RequestMessage[];
  readonly withTools?: boolean;
  readonly archive?: ArchiveRecord;
  /** Persist the final assistant text for the next turn of a session benchmark. */
  readonly appendFinal?: boolean;
  readonly maxTokens?: number;
  readonly maxToolRounds?: number;
  readonly maxToolCalls?: number;
}

export interface RunAgentTurnResult {
  readonly status: 'stop' | 'error' | 'limit';
  readonly text?: string;
  readonly usage?: TokenUsage;
  readonly rounds: number;
  /** Largest single-request prompt in this turn, not the sum over tool rounds. */
  readonly peakPromptTokens: number;
  readonly recallCalls: number;
  readonly recallBytes: number;
  readonly recallQueries: readonly string[];
  readonly reason?: string;
}

/**
 * Drive one model turn against a mutable message history.
 *
 * This is the only place tool traffic is appended, so the accuracy arm and the
 * persistent session arm share one round discipline. The caller scores the
 * final text; this function only reports what happened.
 */
export async function runAgentTurn(options: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  const maxToolRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;
  const maxToolCalls = options.maxToolCalls ?? MAX_TOOL_CALLS;
  const maxTokens = options.maxTokens ?? EVALUATION_MAX_TOKENS;
  let usage: TokenUsage | undefined;
  let recallCalls = 0;
  let recallBytes = 0;
  let rounds = 0;
  let peakPromptTokens = 0;
  const recallQueries: string[] = [];
  let toolsAllowed = options.withTools === true;
  try {
    for (let round = 0; round <= maxToolRounds + 1; round += 1) {
      options.signal.throwIfAborted();
      rounds += 1;
      const assembler = new BlockAssembler();
      for await (const chunk of options.ctx.llm.stream({
        ...options.route,
        messages: options.messages,
        maxTokens,
        sessionId: options.agent.id,
        purpose: 'compaction',
        signal: options.signal,
        ...(toolsAllowed ? { tools: [recallToolSchema] } : {}),
      })) {
        assembler.push(chunk);
      }
      options.signal.throwIfAborted();
      usage = mergeUsage(usage, assembler.usage);
      if (assembler.usage !== undefined) {
        peakPromptTokens = Math.max(peakPromptTokens, promptTokens(assembler.usage));
      }
      const finish = assembler.finish;

      if (finish.kind === 'stop') {
        const blocks = assembler.blocks();
        const text = blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n');
        if (options.appendFinal === true && text.length > 0) {
          options.messages.push(
            createAssistantMessage({
              content: [{ type: 'text', text }],
              source: { provider: options.route.provider, model: options.route.model },
            }),
          );
        }
        return {
          status: 'stop',
          text,
          ...(usage === undefined ? {} : { usage }),
          rounds,
          recallCalls,
          recallBytes,
          recallQueries,
          peakPromptTokens,
        };
      }

      if (finish.kind === 'tool-calls' && toolsAllowed && options.archive) {
        const blocks = assembler.blocks();
        const calls = blocks.filter(
          (block): block is Extract<ContentBlock, { type: 'tool-call' }> =>
            block.type === 'tool-call',
        );
        if (calls.length === 0) throw new Error('Tool-call finish carried no calls.');
        const assistantBlocks = blocks.filter(
          (block) => block.type === 'text' || block.type === 'tool-call',
        );
        options.messages.push(
          createAssistantMessage({
            content: assistantBlocks,
            source: { provider: options.route.provider, model: options.route.model },
          }),
        );
        for (const call of calls) {
          if (recallCalls >= maxToolCalls) {
            options.messages.push(
              createToolResultMessage({
                callId: call.id,
                content: [{ type: 'text', text: '{"error":"Recall tool-call limit reached."}' }],
                isError: true,
              }),
            );
            continue;
          }
          let result: unknown;
          let isError = false;
          let trace = `invalid:${call.arguments.slice(0, 80)}`;
          try {
            const args = recallArgumentsSchema.parse(JSON.parse(call.arguments));
            trace =
              `${args.action}` +
              (args.query === undefined ? '' : `:${args.query}`) +
              (args.queries === undefined ? '' : `:[q${args.queries.length}]`);
            if (args.action === 'list') {
              result = {
                archives: [
                  {
                    archiveId: options.archive.reference.attachmentId,
                    bytes: options.archive.reference.bytes,
                    compactionId: null,
                    method: 'snapcompact',
                    summarySeq: null,
                  },
                ],
                nextOffset: null,
                total: 1,
              };
            } else {
              result = await readRecallPage(
                options.archives,
                options.archive.reference,
                args,
                options.signal,
              );
            }
          } catch (error) {
            isError = true;
            result = {
              error: error instanceof Error ? error.message.slice(0, 1_000) : 'Recall failed',
            };
          }
          recallCalls += 1;
          recallQueries.push(trace);
          const payload = JSON.stringify(result);
          recallBytes += payload.length;
          options.messages.push(
            createToolResultMessage({
              callId: call.id,
              content: [{ type: 'text', text: payload }],
              isError,
            }),
          );
        }
        if (round >= maxToolRounds || recallCalls >= maxToolCalls) {
          toolsAllowed = false;
          options.messages.push(
            createUserMessage({
              source: { kind: 'user' },
              content: [
                {
                  type: 'text',
                  text:
                    'Recall tool-call limit reached. Answer the questions now ' +
                    'with the JSON object; no more tools are available.',
                },
              ],
            }),
          );
        }
        continue;
      }

      if (finish.kind === 'error') {
        return {
          status: 'error',
          reason: finish.failure.message.slice(0, 1_000) || 'Evaluation call failed.',
          ...(usage === undefined ? {} : { usage }),
          rounds,
          recallCalls,
          recallBytes,
          recallQueries,
          peakPromptTokens,
        };
      }
      return {
        status: 'error',
        reason: 'Evaluation response did not finish normally: ' + finish.kind + '.',
        ...(usage === undefined ? {} : { usage }),
        rounds,
        recallCalls,
        recallBytes,
        recallQueries,
        peakPromptTokens,
      };
    }
    return {
      status: 'limit',
      reason: 'Recall tool-call round limit reached.',
      ...(usage === undefined ? {} : { usage }),
      rounds,
      recallCalls,
      recallBytes,
      recallQueries,
      peakPromptTokens,
    };
  } catch (error) {
    options.signal.throwIfAborted();
    return {
      status: 'error',
      reason: error instanceof Error ? error.message.slice(0, 1_000) : 'Evaluation failed.',
      ...(usage === undefined ? {} : { usage }),
      rounds,
      recallCalls,
      recallBytes,
      recallQueries,
      peakPromptTokens,
    };
  }
}

interface AskOptions {
  readonly ctx: Context;
  readonly agent: Agent;
  readonly archives: ArchiveService;
  readonly route: { readonly provider: string; readonly model: string };
  readonly fixture: Fixture;
  readonly regions: ReadonlyMap<string, Region>;
  readonly transcript: string;
  readonly questions: string;
  readonly signal: AbortSignal;
  readonly run: number;
  readonly content: readonly ContentBlock[];
  readonly withTools?: boolean;
  /** Appended to the question block when the arm deliberately runs without tools. */
  readonly note?: string;
  readonly archive?: ArchiveRecord;
}

async function ask(options: AskOptions): Promise<ArmRun> {
  const started = performance.now();
  const total = Object.keys(options.fixture.questions).length;
  const messages: RequestMessage[] = [
    {
      role: 'user',
      content: [
        ...options.content,
        {
          type: 'text',
          text:
            options.note === undefined
              ? options.questions
              : `${options.questions}\n${options.note}`,
        },
      ],
    },
  ];
  const result = await runAgentTurn({
    ctx: options.ctx,
    agent: options.agent,
    archives: options.archives,
    route: options.route,
    signal: options.signal,
    messages,
    ...(options.withTools === true ? { withTools: true } : {}),
    ...(options.archive === undefined ? {} : { archive: options.archive }),
  });
  const elapsedMs = performance.now() - started;
  const audit =
    result.usage === undefined
      ? undefined
      : { ...auditUsage([result.usage]), requests: result.rounds };
  if (result.status !== 'stop') {
    return failedRun(
      options.run,
      total,
      elapsedMs,
      result.reason ?? 'Evaluation failed.',
      result.usage,
      audit,
    );
  }
  if (result.usage === undefined) {
    return failedRun(
      options.run,
      total,
      elapsedMs,
      'Provider returned no usage; not a measurement.',
    );
  }
  if (audit === undefined) throw new Error('Usage audit disappeared.');
  const auditError = auditFailure(audit);
  if (auditError !== undefined) {
    return failedRun(options.run, total, elapsedMs, auditError, result.usage, audit);
  }
  const parsed = parseAnswerObject(result.text ?? '');
  const outcomes = buildOutcomes(
    options.fixture,
    parsed.answers,
    options.regions,
    options.transcript,
  );
  const missed = outcomes.filter((outcome) => !outcome.correct).map((outcome) => outcome.key);
  const exactMissed = outcomes.filter((outcome) => !outcome.exact).map((outcome) => outcome.key);
  return {
    run: options.run,
    status: 'measured',
    correct: outcomes.length - missed.length,
    exactCorrect: outcomes.length - exactMissed.length,
    total,
    missed,
    exactMissed,
    outcomes,
    usage: result.usage,
    audit,
    promptTokens: promptTokens(result.usage),
    outputTokens: result.usage.outputTokens,
    elapsedMs,
    parseMode: parsed.mode,
    ...(options.withTools === true
      ? {
          recallCalls: result.recallCalls,
          recallQueries: result.recallQueries,
          recallRounds: result.rounds,
          recallBytes: result.recallBytes,
        }
      : {}),
  };
}

function visualArm(arm: EvaluationArm, preparation: VisualPreparation): EvaluationArm {
  return {
    ...arm,
    ...(preparation.frames === undefined ? {} : { frames: preparation.frames }),
    ...(preparation.checkpointTokens === undefined
      ? {}
      : { estimatedCheckpointTokens: preparation.checkpointTokens }),
    ...(preparation.pricedBy === undefined ? {} : { pricedBy: preparation.pricedBy }),
  };
}

/** Four bounded QA arms; the summary and visual checkpoint are prepared once. */
export async function evaluate(
  ctx: Context,
  agent: Agent,
  settings: SnapcompactConfig,
  archives: ArchiveService,
  summarize: NativeSummarizer,
  render: Renderer['render'],
  signal: AbortSignal,
  options: EvaluationOptions = {},
): Promise<EvaluationReport> {
  const runs = options.runs ?? 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS)
    throw new Error('Benchmark runs must be an integer from 1 to ' + MAX_RUNS + '.');

  const fixture = await loadFixture();
  const target = agent.session.requestHeader()?.config ?? agent.options;
  if (!target.provider || !target.model)
    throw new Error('Route a model before running the benchmark.');
  const route = { provider: target.provider, model: target.model };
  const messages = buildFixtureMessages(fixture);
  const input: CompactionInput = { messages };
  const archive = await archives.create({ sessionId: agent.id, messages }, signal);
  const sourceTokens = messages.reduce(
    (total, message) => total + ctx.tokenMeter.estimateMessage(message),
    0,
  );
  const { serialized, regions } = classifyQuestionRegions(
    fixture,
    messages,
    settings.serialization,
  );
  for (const [key, question] of Object.entries(fixture.questions)) {
    const occurrences = serialized.split(question.source).length - 1;
    if (occurrences !== 1)
      throw new Error(
        'Fixture source for ' + key + ' occurs ' + occurrences + ' times in the projection.',
      );
  }
  const archiveCoverage = countArchiveCoverage(fixture, archive.document.transcript);
  const questions = questionsPrompt(fixture);
  const total = Object.keys(fixture.questions).length;
  const budgetTokens = Math.floor(sourceTokens * settings.budget.checkpointShare);

  let summaryGeneration: SummaryGeneration = { elapsedMs: 0 };
  let baseline: CompactionSummary | undefined;
  const summaryStarted = performance.now();
  try {
    baseline = await summarize(input, agent, signal);
    summaryGeneration = {
      elapsedMs: performance.now() - summaryStarted,
      ...(baseline.usage === undefined ? {} : { usage: baseline.usage }),
    };
  } catch (error) {
    signal.throwIfAborted();
    summaryGeneration = {
      elapsedMs: performance.now() - summaryStarted,
      failed: error instanceof Error ? error.message.slice(0, 1_000) : 'Native summary failed.',
    };
  }

  let visualPreparation: VisualPreparation = { elapsedMs: 0 };
  let visualSummary: ContentBlock[] | undefined;
  const visualStarted = performance.now();
  try {
    const candidate = await snapcompact({
      input,
      sourceMessages: messages,
      sourceTokens,
      checkpointTargetTokens: budgetTokens,
      meter: ctx.tokenMeter,
      archive,
      config: settings,
      route,
      llm: ctx.llm,
      attachments: ctx.attachments,
      imageSlots: Math.min(
        settings.rendering.maxFrames,
        ctx.attachments.imageLimits.maxImagesPerMessage,
      ),
      signal,
      render,
      soft:
        baseline === undefined
          ? async (): Promise<CompactionSummary> => {
              throw new Error('Native summary is unavailable for this evaluation.');
            }
          : async () => baseline,
    });
    if (candidate.kind === 'skipped') {
      visualPreparation = {
        elapsedMs: performance.now() - visualStarted,
        budgetTokens,
        reason: candidate.reason,
      };
    } else {
      const wrapped = checkpointSummary(candidate.method, archive, candidate.result.summary);
      const checkpointTokens = estimateCheckpoint(wrapped, ctx.tokenMeter, candidate.imageRoute);
      visualSummary = wrapped;
      visualPreparation = {
        elapsedMs: performance.now() - visualStarted,
        frames: wrapped.filter((block) => block.type === 'image').length,
        checkpointTokens,
        budgetTokens,
        overBudget: checkpointTokens > budgetTokens,
        ...(candidate.imageRoute === undefined
          ? {}
          : { pricedBy: candidate.imageRoute.pricingSource }),
      };
    }
  } catch (error) {
    signal.throwIfAborted();
    visualPreparation = {
      elapsedMs: performance.now() - visualStarted,
      budgetTokens,
      reason: error instanceof Error ? error.message.slice(0, 1_000) : 'Visual preparation failed.',
    };
  }

  const originalRuns: ArmRun[] = [];
  const nativeRuns: ArmRun[] = [];
  const visualRuns: ArmRun[] = [];
  const recallRuns: ArmRun[] = [];
  const originalContent = messages.flatMap((message) => message.content);
  const visualReason = visualPreparation.reason ?? 'Visual checkpoint is unavailable.';
  const nativeReason = summaryGeneration.failed ?? 'Native summary is unavailable.';

  for (let run = 1; run <= runs; run += 1) {
    signal.throwIfAborted();
    originalRuns.push(
      await ask({
        ctx,
        agent,
        archives,
        route,
        fixture,
        regions,
        transcript: archive.document.transcript,
        questions,
        signal,
        run,
        content: originalContent,
      }),
    );
    nativeRuns.push(
      baseline === undefined
        ? skippedRun(run, total, nativeReason)
        : await ask({
            ctx,
            agent,
            archives,
            route,
            fixture,
            regions,
            transcript: archive.document.transcript,
            questions,
            signal,
            run,
            content: baseline.summary,
          }),
    );
    visualRuns.push(
      visualSummary === undefined
        ? skippedRun(run, total, visualReason)
        : await ask({
            ctx,
            agent,
            archives,
            route,
            fixture,
            regions,
            transcript: archive.document.transcript,
            questions,
            signal,
            run,
            content: visualSummary,
            note:
              'This run provides no tools: answer from the checkpoint content alone and do not ' +
              'request a recall tool.',
          }),
    );
    recallRuns.push(
      visualSummary === undefined
        ? skippedRun(run, total, visualReason)
        : await ask({
            ctx,
            agent,
            archives,
            route,
            fixture,
            regions,
            transcript: archive.document.transcript,
            questions,
            signal,
            run,
            content: visualSummary,
            withTools: true,
            archive,
            note:
              'Use at most two batched snapcompact_recall calls; send every independent literal ' +
              'in each call. When complete=true, answer immediately and do not retry a query ' +
              'that already matched.',
          }),
    );
  }

  const arms: EvaluationArm[] = [
    aggregateArm('original', total, originalRuns),
    aggregateArm('native-text', total, nativeRuns),
    visualArm(aggregateArm('snapcompact', total, visualRuns), visualPreparation),
    visualArm(aggregateArm('snapcompact-recall', total, recallRuns), visualPreparation),
  ];
  const usageAudit = mergeAudits([
    ...[...originalRuns, ...nativeRuns, ...visualRuns, ...recallRuns].flatMap((run) =>
      run.audit === undefined ? [] : [run.audit],
    ),
    ...(summaryGeneration.usage === undefined ? [] : [auditUsage([summaryGeneration.usage])]),
  ]);

  return {
    version: 3,
    fixture: fixture.id,
    provider: route.provider,
    model: route.model,
    timestamp: new Date().toISOString(),
    runs,
    arms,
    archiveCoverage,
    summaryGeneration,
    visualPreparation,
    usageAudit,
    warning:
      'Synthetic accuracy pressure test only: one request carries all 40 questions, so its cost is ' +
      'not steady-state session cost. Accepted matches are the primary score; exact matches are ' +
      'stricter. Image/token estimates are not billed usage. The benchmark archive is not a committed ' +
      'compaction, so the recall arm reads its known archive directly instead of the session index. ' +
      (runs === 1
        ? 'Single run: a one- or two-question difference is within rubric noise; run benchmark 3 for a range.'
        : 'Aggregates pool measured runs; the native summary and visual checkpoint were generated once.'),
  };
}
