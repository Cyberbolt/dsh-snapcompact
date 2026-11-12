import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, RequestMessage, TokenUsage } from '@deepseek-ai/dsh-llm';
import type { ArchiveRecord, ArchiveService } from '../archives/service.js';
import type { SnapcompactConfig } from '../config.js';
import type { CompactionInput, CompactionSummary } from '../compaction/method.js';
import { snapcompact } from '../compaction/methods/snapcompact.js';
import { checkpointSummary } from '../compaction/checkpoint.js';
import { estimateCheckpoint } from '../budgeting/pricing.js';
import type { Renderer } from '../rendering/worker-client.js';
import { buildLongFixture, classifyQuestionRegions } from './fixture.js';
import type { Fixture } from './fixture.js';
import { questionsPrompt, runAgentTurn } from './runner.js';
import { buildOutcomes, parseAnswerObject } from './scoring.js';
import { auditFailure, auditUsage, mergeAudits, promptTokens, weightedCost } from './usage.js';
import type {
  ArmName,
  CapacityPoint,
  Region,
  SessionArm,
  SessionAttribution,
  SensitivityPoint,
  SessionReport,
  SessionTurn,
  SessionTurnMode,
} from './types.js';

type NativeSummarizer = (
  input: CompactionInput,
  agent: Agent,
  signal?: AbortSignal,
) => Promise<CompactionSummary>;

export interface SessionEvaluationOptions {
  /** Full session repeats. The preparation is shared, like the accuracy suite. */
  readonly runs?: number;
  /** Padding lines for the long fixture; the default is 5,000. */
  readonly paddingLines?: number;
}

const MAX_SESSION_RUNS = 5;
const MAX_SESSION_TOKENS = 16_384;
const SESSION_MAX_TOOL_ROUNDS = 3;
const SESSION_MAX_TOOL_CALLS = 10;

/** Two recall turns in six: one light, one heavy. */
export const SESSION_SCHEDULE: readonly SessionTurnMode[] = [
  'plain',
  'plain',
  'light',
  'plain',
  'heavy',
  'plain',
];

const SCHEDULE_KEYS: readonly (readonly string[])[] = [
  ['l_head'],
  ['l_tail'],
  ['s0'],
  ['l_head'],
  ['s1', 's2', 's3'],
  ['l_tail'],
];

const PLAIN_NOTE =
  'This turn asks about exact text visible outside the frames; answer from the checkpoint alone. ' +
  'Do not call snapcompact_recall.';
const RECALL_NOTE =
  'Use at most one batched snapcompact_recall call; send every independent literal in it. ' +
  'When complete=true, answer immediately; do not retry a query that already matched.';

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function turnTotal(mode: SessionTurnMode): number {
  return mode === 'heavy' ? 3 : 1;
}

function scheduledTotal(): number {
  return sum(SESSION_SCHEDULE.map(turnTotal));
}

function skippedArm(name: ArmName, reason: string): SessionArm {
  return {
    name,
    status: 'skipped',
    turns: [],
    peakPromptTokens: 0,
    promptTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    weightedCost: 0,
    correct: 0,
    total: scheduledTotal(),
    rounds: 0,
    recallCalls: 0,
    recallBytes: 0,
    reason,
  };
}

interface ArmInput {
  readonly ctx: Context;
  readonly agent: Agent;
  readonly archives: ArchiveService;
  readonly route: { readonly provider: string; readonly model: string };
  readonly signal: AbortSignal;
  readonly fixture: Fixture;
  readonly regions: ReadonlyMap<string, Region>;
  readonly transcript: string;
  readonly archive: ArchiveRecord;
  readonly name: ArmName;
  readonly history: RequestMessage[];
  readonly summaryUsage?: TokenUsage;
  readonly frames?: number;
  readonly checkpointTokens?: number;
  readonly note?: string;
}

/** Run one arm's six turns against one persistent history. */
async function runSessionArm(input: ArmInput): Promise<SessionArm> {
  const turns: SessionTurn[] = [];
  let status: 'measured' | 'failed' = 'measured';
  let reason: string | undefined;

  for (const [index, mode] of SESSION_SCHEDULE.entries()) {
    input.signal.throwIfAborted();
    const keys = SCHEDULE_KEYS[index] ?? [];
    const note = mode === 'plain' ? PLAIN_NOTE : RECALL_NOTE;
    input.history.push(
      createUserMessage({
        source: { kind: 'user' },
        content: [
          {
            type: 'text',
            text: `${questionsPrompt(input.fixture, keys)}\n${note}`,
          },
        ],
      }),
    );
    const started = performance.now();
    const result = await runAgentTurn({
      ctx: input.ctx,
      agent: input.agent,
      archives: input.archives,
      route: input.route,
      signal: input.signal,
      messages: input.history,
      withTools: input.name === 'snapcompact-recall',
      archive: input.archive,
      appendFinal: true,
      maxTokens: MAX_SESSION_TOKENS,
      maxToolRounds: SESSION_MAX_TOOL_ROUNDS,
      maxToolCalls: SESSION_MAX_TOOL_CALLS,
    });
    const elapsedMs = performance.now() - started;
    if (result.status !== 'stop') {
      status = 'failed';
      reason = result.reason ?? 'Session turn did not finish normally.';
      break;
    }
    if (result.usage === undefined) {
      status = 'failed';
      reason = 'Provider returned no usage; not a measurement.';
      break;
    }
    const audit = { ...auditUsage([result.usage]), requests: result.rounds };
    const auditError = auditFailure(audit);
    if (auditError !== undefined) {
      status = 'failed';
      reason = auditError;
      break;
    }
    const parsed = parseAnswerObject(result.text ?? '');
    const outcomes = buildOutcomes(
      input.fixture,
      parsed.answers,
      input.regions,
      input.transcript,
      keys,
    );
    const missed = outcomes.filter((outcome) => !outcome.correct).map((outcome) => outcome.key);
    const expectedCalls = mode === 'plain' ? 0 : 1;
    turns.push({
      index,
      mode,
      correct: outcomes.length - missed.length,
      total: outcomes.length,
      missed,
      promptTokens: promptTokens(result.usage),
      peakPromptTokens: result.peakPromptTokens,
      outputTokens: audit.outputTokens,
      cacheReadTokens: audit.cacheReadTokens,
      cacheWriteTokens: audit.cacheWriteTokens,
      weightedCost: weightedCost(result.usage),
      rounds: result.rounds,
      recallCalls: result.recallCalls,
      recallBytes: result.recallBytes,
      elapsedMs,
      offSchedule: result.recallCalls > expectedCalls,
      audit,
    });
  }

  const setupPrompt = input.summaryUsage === undefined ? 0 : promptTokens(input.summaryUsage);
  const setupOutput = input.summaryUsage?.outputTokens ?? 0;
  const setupWeighted = input.summaryUsage === undefined ? 0 : weightedCost(input.summaryUsage);
  const prompt = sum(turns.map((turn) => turn.promptTokens)) + setupPrompt;
  return {
    name: input.name,
    status,
    turns,
    peakPromptTokens: Math.max(0, ...turns.map((turn) => turn.peakPromptTokens)),
    promptTokens: prompt,
    outputTokens: sum(turns.map((turn) => turn.outputTokens)) + setupOutput,
    cacheReadTokens: sum(turns.map((turn) => turn.cacheReadTokens)),
    cacheWriteTokens: sum(turns.map((turn) => turn.cacheWriteTokens)),
    weightedCost: sum(turns.map((turn) => turn.weightedCost)) + setupWeighted,
    correct: sum(turns.map((turn) => turn.correct)),
    total: sum(turns.map((turn) => turn.total)),
    rounds: sum(turns.map((turn) => turn.rounds)),
    recallCalls: sum(turns.map((turn) => turn.recallCalls)),
    recallBytes: sum(turns.map((turn) => turn.recallBytes)),
    ...(input.frames === undefined ? {} : { frames: input.frames }),
    ...(input.checkpointTokens === undefined
      ? {}
      : { estimatedCheckpointTokens: input.checkpointTokens }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function capacityPoints(
  serializedChars: number,
  contextWindow: number,
  checkpointTokens: number,
): CapacityPoint[] {
  const points: CapacityPoint[] = [];
  for (const sourceChars of [250_000, 500_000, 1_000_000]) {
    const estimatedSourceTokens = Math.ceil(sourceChars / 4);
    points.push({
      sourceChars,
      estimatedSourceTokens,
      originalFits: contextWindow > 0 && estimatedSourceTokens < Math.floor(contextWindow * 0.8),
      checkpointEstimatedTokens: checkpointTokens,
      contextWindow,
    });
  }
  if (serializedChars <= 0) return points;
  return points;
}

function sensitivityPoints(
  arms: readonly SessionArm[],
  schedule: readonly SessionTurnMode[],
): SensitivityPoint[] {
  const original = arms.find((arm) => arm.name === 'original');
  const visual = arms.find((arm) => arm.name === 'snapcompact');
  const recall = arms.find((arm) => arm.name === 'snapcompact-recall');
  if (
    original?.status !== 'measured' ||
    visual?.status !== 'measured' ||
    recall?.status !== 'measured'
  ) {
    return [];
  }
  const originalCost = original.weightedCost;
  const visualCost = visual.weightedCost;
  const recallCost = recall.weightedCost;
  const heavy = recall.turns.filter((turn) => turn.mode === 'heavy');
  // The first visual turn is cold and its cache write dominates the mean; it
  // is not the price of an ordinary plain turn. Use warm plain turns when a
  // second one exists, and fall back to all plain turns for tiny schedules.
  const warmPlain = visual.turns.filter((turn) => turn.mode === 'plain' && turn.index > 0);
  const plainVisual =
    warmPlain.length > 0 ? warmPlain : visual.turns.filter((turn) => turn.mode === 'plain');
  const modeled100 =
    heavy.length === 0 || plainVisual.length === 0
      ? recallCost
      : recallCost +
        schedule.filter((mode) => mode === 'plain').length *
          (mean(heavy.map((turn) => turn.weightedCost)) -
            mean(plainVisual.map((turn) => turn.weightedCost)));
  const ratio = (cost: number): number => (originalCost <= 0 ? 0 : cost / originalCost);
  return [
    { recallRate: 0, weightedCost: visualCost, ratioToOriginal: ratio(visualCost), modeled: false },
    {
      recallRate: 1 / 3,
      weightedCost: recallCost,
      ratioToOriginal: ratio(recallCost),
      modeled: false,
    },
    {
      recallRate: 1,
      weightedCost: modeled100,
      ratioToOriginal: ratio(modeled100),
      modeled: true,
    },
  ];
}

function attributionOf(
  recall: SessionArm | undefined,
  checkpointPrompt: number,
): SessionAttribution {
  if (recall === undefined || recall.status !== 'measured') {
    return {
      checkpointResendTokens: 0,
      toolPageTokens: 0,
      otherPromptTokens: 0,
      outputTokens: 0,
    };
  }
  const checkpointResendTokens = checkpointPrompt * recall.rounds;
  const toolPageTokens = Math.ceil(recall.recallBytes / 4);
  return {
    checkpointResendTokens,
    toolPageTokens,
    otherPromptTokens: Math.max(0, recall.promptTokens - checkpointResendTokens - toolPageTokens),
    outputTokens: recall.outputTokens,
  };
}

/**
 * Run the persistent-session cost suite.
 *
 * The source history is placed once per arm; later turns append only the
 * question, the answer and any recall pages. That makes checkpoint resend and
 * page residency visible instead of hiding them in independent cold starts.
 */
export async function evaluateSession(
  ctx: Context,
  agent: Agent,
  settings: SnapcompactConfig,
  archives: ArchiveService,
  summarize: NativeSummarizer,
  render: Renderer['render'],
  signal: AbortSignal,
  options: SessionEvaluationOptions = {},
): Promise<SessionReport[]> {
  const runs = options.runs ?? 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_SESSION_RUNS) {
    throw new Error(
      'Session benchmark runs must be an integer from 1 to ' + MAX_SESSION_RUNS + '.',
    );
  }
  const target = agent.session.requestHeader()?.config ?? agent.options;
  if (!target.provider || !target.model)
    throw new Error('Route a model before running the benchmark.');
  const route = { provider: target.provider, model: target.model };
  const { fixture, messages } = buildLongFixture({
    paddingLines: options.paddingLines ?? 5_000,
  });
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
        'Long fixture source for ' + key + ' occurs ' + occurrences + ' times in the projection.',
      );
  }
  const budgetTokens = Math.floor(sourceTokens * settings.budget.checkpointShare);

  let summaryUsage: TokenUsage | undefined;
  let summaryFailure: string | undefined;
  let baseline: CompactionSummary | undefined;
  try {
    baseline = await summarize(input, agent, signal);
    summaryUsage = baseline.usage;
  } catch (error) {
    signal.throwIfAborted();
    summaryFailure =
      error instanceof Error ? error.message.slice(0, 1_000) : 'Native summary failed.';
  }

  let visualSummary: ContentBlock[] | undefined;
  let visualFailure: string | undefined;
  let frames = 0;
  let checkpointTokens = 0;
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
      soft: async (): Promise<CompactionSummary> => {
        throw new Error('The session suite does not fall back to a native summary.');
      },
    });
    if (candidate.kind === 'skipped') {
      visualFailure = candidate.reason;
    } else {
      visualSummary = checkpointSummary(candidate.method, archive, candidate.result.summary);
      checkpointTokens = estimateCheckpoint(visualSummary, ctx.tokenMeter, candidate.imageRoute);
      frames = visualSummary.filter((block) => block.type === 'image').length;
    }
  } catch (error) {
    signal.throwIfAborted();
    visualFailure =
      error instanceof Error ? error.message.slice(0, 1_000) : 'Visual preparation failed.';
  }

  let contextWindow = 0;
  try {
    const info = await ctx.llm.resolveModelInfo(route.provider, route.model, signal);
    contextWindow = info?.context?.contextWindow ?? 0;
  } catch {
    contextWindow = 0;
  }
  signal.throwIfAborted();

  const reports: SessionReport[] = [];
  for (let run = 1; run <= runs; run += 1) {
    signal.throwIfAborted();
    const original = await runSessionArm({
      ctx,
      agent,
      archives,
      route,
      signal,
      fixture,
      regions,
      transcript: archive.document.transcript,
      archive,
      name: 'original',
      history: [...messages],
    });
    const native =
      baseline === undefined
        ? skippedArm('native-text', summaryFailure ?? 'Native summary is unavailable.')
        : await runSessionArm({
            ctx,
            agent,
            archives,
            route,
            signal,
            fixture,
            regions,
            transcript: archive.document.transcript,
            archive,
            name: 'native-text',
            history: [{ role: 'user', content: baseline.summary }],
            ...(summaryUsage === undefined ? {} : { summaryUsage }),
            note: 'Includes one native summary generation for the initial checkpoint.',
          });
    const visual =
      visualSummary === undefined
        ? skippedArm('snapcompact', visualFailure ?? 'Visual checkpoint is unavailable.')
        : await runSessionArm({
            ctx,
            agent,
            archives,
            route,
            signal,
            fixture,
            regions,
            transcript: archive.document.transcript,
            archive,
            name: 'snapcompact',
            history: [{ role: 'user', content: visualSummary }],
            frames,
            checkpointTokens,
            note: 'Checkpoint rendered once locally; per-turn cost is model-only.',
          });
    const recall =
      visualSummary === undefined
        ? skippedArm('snapcompact-recall', visualFailure ?? 'Visual checkpoint is unavailable.')
        : await runSessionArm({
            ctx,
            agent,
            archives,
            route,
            signal,
            fixture,
            regions,
            transcript: archive.document.transcript,
            archive,
            name: 'snapcompact-recall',
            history: [{ role: 'user', content: visualSummary }],
            frames,
            checkpointTokens,
            note: 'Recall pages stay in the persistent history; later turns re-send them.',
          });
    const arms: SessionArm[] = [original, native, visual, recall];
    const visualCheckpointPrompt =
      visual.status === 'measured'
        ? mean(
            visual.turns.filter((turn) => turn.mode === 'plain').map((turn) => turn.promptTokens),
          )
        : 0;
    const usageAudit = mergeAudits([
      ...arms.flatMap((arm) => arm.turns.map((turn) => turn.audit)),
      ...(summaryUsage === undefined ? [] : [auditUsage([summaryUsage])]),
    ]);
    reports.push({
      version: 1,
      fixture: fixture.id,
      provider: route.provider,
      model: route.model,
      timestamp: new Date().toISOString(),
      run,
      schedule: [...SESSION_SCHEDULE],
      arms,
      usageAudit,
      capacity: capacityPoints(serialized.length, contextWindow, checkpointTokens),
      sensitivity: sensitivityPoints(arms, SESSION_SCHEDULE),
      attribution: attributionOf(recall, visualCheckpointPrompt),
      warning:
        'Long synthetic session with 33% recall turns. Weighted costs are relative units, not a bill. ' +
        'The 0% and 33% points are measured arms; the 100% point is modeled from measured heavy and plain turns. ' +
        'Recall tool pages stay in the history, so later prompts include them. Token counts are estimates from the benchmark meter.',
    });
  }
  return reports;
}
