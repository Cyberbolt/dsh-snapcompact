import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import {
  BlockAssembler,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm';
import type {
  ContentBlock,
  Message,
  RequestMessage,
  TokenUsage,
  ToolSchema,
} from '@deepseek-ai/dsh-llm';
import type { SnapcompactConfig } from '../../config.js';
import type { CompactionSummary } from '../../compaction/method.js';
import type { Renderer } from '../../rendering/worker-client.js';
import { buildVisualCheckpoint } from '../../compaction/visual-checkpoint.js';
import {
  buildVisualSource,
  exactTokenIndex,
  serializeConversation,
} from '../../compaction/visual-source.js';
import { auditUsage, mergeUsage, promptTokens, weightedCost } from '../usage.js';
import type {
  V5ArmName,
  V5ArmReport,
  V5ArmRun,
  V5Fixture,
  V5Preparation,
  V5QuestionOutcome,
  V5Range,
  V5Report,
  V5Tally,
  V5TurnResult,
  V5UsageAudit,
} from './types.js';
import {
  classifyQuestionRegions,
  fixtureMeta,
  questionPrompt,
  questionsForTurn,
} from './generator.js';
import { characterClass, classErrors, parseAnswerObject, scoreQuestion } from './scoring.js';

export interface V5ToolHarness {
  readonly schema: ToolSchema;
  execute(
    call: { readonly name: string; readonly arguments: string },
    signal: AbortSignal,
  ): Promise<{ readonly text: string; readonly isError: boolean }>;
}

export interface V5ArmInput {
  readonly arm: V5ArmName;
  readonly messages: readonly RequestMessage[];
  readonly tools?: V5ToolHarness;
  readonly skipReason?: string;
  readonly frames?: number;
  readonly checkpointTokens?: number;
}

export interface RunV5ArmOptions {
  readonly ctx: Context;
  readonly agent: Agent;
  readonly route: { readonly provider: string; readonly model: string };
  readonly fixture: V5Fixture;
  readonly regions: ReadonlyMap<
    string,
    {
      readonly region: 'head' | 'middle' | 'tail' | 'multi' | 'unknown';
      readonly primaryRegion: 'head' | 'middle' | 'tail' | 'unknown';
    }
  >;
  readonly input: V5ArmInput;
  readonly run: number;
  readonly signal: AbortSignal;
  readonly maxTokens?: number;
  readonly onProgress?: (message: string) => void;
}

const DEFAULT_MAX_TOKENS = 32_768;
const MAX_TOOL_ROUNDS = 5;
const MAX_TOOL_CALLS = 20;

interface ModelTurnResult {
  readonly status: 'stop' | 'error' | 'limit';
  readonly text?: string;
  readonly usage?: TokenUsage;
  readonly usages: readonly TokenUsage[];
  readonly audit: V5UsageAudit;
  readonly rounds: number;
  readonly peakPromptTokens: number;
  readonly toolCalls: number;
  readonly toolBytes: number;
  readonly reason?: string;
  readonly missingUsage: boolean;
}

async function runModelTurn(options: {
  readonly ctx: Context;
  readonly agent: Agent;
  readonly route: { readonly provider: string; readonly model: string };
  readonly messages: RequestMessage[];
  readonly tools?: V5ToolHarness;
  readonly signal: AbortSignal;
  readonly maxTokens: number;
}): Promise<ModelTurnResult> {
  const usages: TokenUsage[] = [];
  let merged: TokenUsage | undefined;
  let rounds = 0;
  let peakPromptTokens = 0;
  let toolCalls = 0;
  let toolBytes = 0;
  let missingUsage = false;
  let toolsAllowed = options.tools !== undefined;
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS + 1; round += 1) {
      options.signal.throwIfAborted();
      rounds += 1;
      const assembler = new BlockAssembler();
      for await (const chunk of options.ctx.llm.stream({
        ...options.route,
        messages: options.messages,
        maxTokens: options.maxTokens,
        sessionId: options.agent.id,
        purpose: 'compaction',
        signal: options.signal,
        ...(toolsAllowed && options.tools !== undefined ? { tools: [options.tools.schema] } : {}),
      })) {
        assembler.push(chunk);
      }
      options.signal.throwIfAborted();
      const usage = assembler.usage;
      if (usage === undefined) {
        missingUsage = true;
      } else {
        usages.push(usage);
        merged = mergeUsage(merged, usage);
        peakPromptTokens = Math.max(peakPromptTokens, promptTokens(usage));
      }
      const finish = assembler.finish;
      if (finish.kind === 'stop') {
        const text = assembler
          .blocks()
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n');
        return {
          status: 'stop',
          text,
          ...(merged === undefined ? {} : { usage: merged }),
          usages,
          audit: auditUsage(usages),
          rounds,
          peakPromptTokens,
          toolCalls,
          toolBytes,
          missingUsage,
        };
      }
      if (finish.kind === 'tool-calls' && toolsAllowed && options.tools !== undefined) {
        const blocks = assembler.blocks();
        const calls = blocks.filter(
          (block): block is Extract<ContentBlock, { type: 'tool-call' }> =>
            block.type === 'tool-call',
        );
        if (calls.length === 0) {
          return {
            status: 'error',
            reason: 'Tool-call finish carried no calls.',
            usages,
            audit: auditUsage(usages),
            rounds,
            peakPromptTokens,
            toolCalls,
            toolBytes,
            missingUsage,
          };
        }
        const assistantBlocks = blocks.filter(
          (block) => block.type === 'text' || block.type === 'tool-call',
        );
        options.messages.push(
          createAssistantMessage({
            content: assistantBlocks,
            source: options.route,
          }),
        );
        for (const call of calls) {
          if (toolCalls >= MAX_TOOL_CALLS) {
            options.messages.push(
              createToolResultMessage({
                callId: call.id,
                content: [{ type: 'text', text: '{"error":"Tool-call limit reached."}' }],
                isError: true,
              }),
            );
            continue;
          }
          let result: { readonly text: string; readonly isError: boolean };
          try {
            result = await options.tools.execute(
              { name: call.name, arguments: call.arguments },
              options.signal,
            );
          } catch (error) {
            result = {
              text: JSON.stringify({
                error: error instanceof Error ? error.message.slice(0, 1_000) : 'Tool failed.',
              }),
              isError: true,
            };
          }
          toolCalls += 1;
          toolBytes += result.text.length;
          options.messages.push(
            createToolResultMessage({
              callId: call.id,
              content: [{ type: 'text', text: result.text }],
              isError: result.isError,
            }),
          );
        }
        if (round >= MAX_TOOL_ROUNDS || toolCalls >= MAX_TOOL_CALLS) {
          toolsAllowed = false;
          options.messages.push(
            createUserMessage({
              source: { kind: 'user' },
              content: [
                {
                  type: 'text',
                  text:
                    'Tool-call limit reached. Answer the questions now with the JSON object; ' +
                    'no more tools are available.',
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
          ...(merged === undefined ? {} : { usage: merged }),
          usages,
          audit: auditUsage(usages),
          rounds,
          peakPromptTokens,
          toolCalls,
          toolBytes,
          missingUsage,
        };
      }
      return {
        status: 'error',
        reason: 'Evaluation response did not finish normally: ' + finish.kind + '.',
        ...(merged === undefined ? {} : { usage: merged }),
        usages,
        audit: auditUsage(usages),
        rounds,
        peakPromptTokens,
        toolCalls,
        toolBytes,
        missingUsage,
      };
    }
    return {
      status: 'limit',
      reason: 'Tool-call round limit reached.',
      ...(merged === undefined ? {} : { usage: merged }),
      usages,
      audit: auditUsage(usages),
      rounds,
      peakPromptTokens,
      toolCalls,
      toolBytes,
      missingUsage,
    };
  } catch (error) {
    options.signal.throwIfAborted();
    return {
      status: 'error',
      reason: error instanceof Error ? error.message.slice(0, 1_000) : 'Evaluation failed.',
      ...(merged === undefined ? {} : { usage: merged }),
      usages,
      audit: auditUsage(usages),
      rounds,
      peakPromptTokens,
      toolCalls,
      toolBytes,
      missingUsage,
    };
  }
}

/** Execute one arm against the persistent 10-turn history. */
export async function runV5Arm(options: RunV5ArmOptions): Promise<V5ArmRun> {
  const started = performance.now();
  const total = Object.keys(options.fixture.questions).length;
  if (options.input.skipReason !== undefined) {
    return {
      arm: options.input.arm,
      run: options.run,
      status: 'skipped',
      turns: [],
      correct: 0,
      total,
      peakPromptTokens: 0,
      promptTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      weightedCost: 0,
      rounds: 0,
      toolCalls: 0,
      toolBytes: 0,
      elapsedMs: 0,
      audit: auditUsage([]),
      reason: options.input.skipReason,
      ...(options.input.frames === undefined ? {} : { frames: options.input.frames }),
      ...(options.input.checkpointTokens === undefined
        ? {}
        : { checkpointTokens: options.input.checkpointTokens }),
    };
  }
  const history: RequestMessage[] = options.input.messages.map((message) => ({
    ...message,
    content: [...message.content],
  }));
  const turns: V5TurnResult[] = [];
  let failedReason: string | undefined;
  for (const turn of options.fixture.turns) {
    options.signal.throwIfAborted();
    const questions = questionsForTurn(options.fixture, turn);
    const prompt = questionPrompt(questions);
    history.push(
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: prompt }],
      }),
    );
    const turnStarted = performance.now();
    options.onProgress?.(
      'arm=' + options.input.arm + ' run=' + options.run + ' turn=' + turn.index + ' start',
    );
    const result = await runModelTurn({
      ctx: options.ctx,
      agent: options.agent,
      route: options.route,
      messages: history,
      ...(options.input.tools === undefined ? {} : { tools: options.input.tools }),
      signal: options.signal,
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
    const parsed = parseAnswerObject(result.text ?? '');
    const outcomes: V5QuestionOutcome[] = questions.map((question) =>
      scoreQuestion(
        question,
        parsed.answers[question.key] ?? null,
        options.regions.get(question.key) ?? { region: 'unknown', primaryRegion: 'unknown' },
      ),
    );
    const correct = outcomes.filter((outcome) => outcome.correct).length;
    const turnResult: V5TurnResult = {
      index: turn.index,
      keys: turn.keys,
      outcomes,
      correct,
      total: questions.length,
      promptTokens: result.usages.reduce((sum, usage) => sum + promptTokens(usage), 0),
      peakPromptTokens: result.peakPromptTokens,
      outputTokens: result.usages.reduce((sum, usage) => sum + usage.outputTokens, 0),
      cacheReadTokens: result.usages.reduce((sum, usage) => sum + (usage.cacheReadTokens ?? 0), 0),
      cacheWriteTokens: result.usages.reduce(
        (sum, usage) => sum + (usage.cacheWriteTokens ?? 0),
        0,
      ),
      weightedCost: result.usages.reduce((sum, usage) => sum + weightedCost(usage), 0),
      rounds: result.rounds,
      toolCalls: result.toolCalls,
      toolBytes: result.toolBytes,
      elapsedMs: performance.now() - turnStarted,
      parseMode: parsed.mode,
      audit: result.audit,
      answerText: result.text ?? '',
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    };
    turns.push(turnResult);
    options.onProgress?.(
      'arm=' +
        options.input.arm +
        ' run=' +
        options.run +
        ' turn=' +
        turn.index +
        ' done correct=' +
        correct +
        '/' +
        questions.length +
        ' requests=' +
        result.rounds,
    );
    if (result.status !== 'stop' || result.missingUsage || !result.audit.complete) {
      failedReason =
        result.reason ??
        (!result.audit.complete
          ? 'Usage audit is incomplete.'
          : 'Provider returned no usage; not a measurement.');
      break;
    }
    history.push(
      createAssistantMessage({
        content: [{ type: 'text', text: result.text ?? '' }],
        source: options.route,
      }),
    );
  }
  const usage = turns.reduce<TokenUsage | undefined>(
    (merged, turn) =>
      mergeUsage(merged, {
        inputTokens: turn.audit.inputTokens,
        outputTokens: turn.audit.outputTokens,
        cacheReadTokens: turn.audit.cacheReadTokens,
        cacheWriteTokens: turn.audit.cacheWriteTokens,
      }),
    undefined,
  );
  const audit = turns.reduce<V5UsageAudit>(
    (merged, turn) => {
      const reported = merged.reportedTotalTokens + turn.audit.reportedTotalTokens;
      const computed = merged.computedTotalTokens + turn.audit.computedTotalTokens;
      return {
        requests: merged.requests + turn.audit.requests,
        inputTokens: merged.inputTokens + turn.audit.inputTokens,
        cacheReadTokens: merged.cacheReadTokens + turn.audit.cacheReadTokens,
        cacheWriteTokens: merged.cacheWriteTokens + turn.audit.cacheWriteTokens,
        outputTokens: merged.outputTokens + turn.audit.outputTokens,
        reportedTotalTokens: reported,
        computedTotalTokens: computed,
        unreportedPromptTokens: Math.max(0, reported - computed),
        complete: merged.complete && turn.audit.complete,
      };
    },
    {
      requests: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reportedTotalTokens: 0,
      computedTotalTokens: 0,
      unreportedPromptTokens: 0,
      complete: true,
    },
  );
  return {
    arm: options.input.arm,
    run: options.run,
    status: failedReason === undefined ? 'measured' : 'failed',
    turns,
    correct: turns.reduce((sum, turn) => sum + turn.correct, 0),
    total,
    peakPromptTokens: turns.reduce((max, turn) => Math.max(max, turn.peakPromptTokens), 0),
    promptTokens: turns.reduce((sum, turn) => sum + turn.promptTokens, 0),
    outputTokens: turns.reduce((sum, turn) => sum + turn.outputTokens, 0),
    cacheReadTokens: turns.reduce((sum, turn) => sum + turn.cacheReadTokens, 0),
    cacheWriteTokens: turns.reduce((sum, turn) => sum + turn.cacheWriteTokens, 0),
    weightedCost: turns.reduce((sum, turn) => sum + turn.weightedCost, 0),
    rounds: turns.reduce((sum, turn) => sum + turn.rounds, 0),
    toolCalls: turns.reduce((sum, turn) => sum + turn.toolCalls, 0),
    toolBytes: turns.reduce((sum, turn) => sum + turn.toolBytes, 0),
    elapsedMs: performance.now() - started,
    audit,
    ...(failedReason === undefined ? {} : { reason: failedReason }),
    ...(usage === undefined ? {} : { usage }),
    ...(options.input.frames === undefined ? {} : { frames: options.input.frames }),
    ...(options.input.checkpointTokens === undefined
      ? {}
      : { checkpointTokens: options.input.checkpointTokens }),
  };
}

export interface PrepareV5Options {
  readonly ctx: Context;
  readonly agent: Agent;
  readonly route: { readonly provider: string; readonly model: string };
  readonly fixture: V5Fixture;
  readonly settings: SnapcompactConfig;
  readonly signal: AbortSignal;
  readonly skipNative?: boolean;
  readonly onProgress?: (message: string) => void;
  readonly summarize: (
    input: { readonly messages: readonly Message[] },
    agent: Agent,
    signal?: AbortSignal,
  ) => Promise<CompactionSummary>;
  readonly render: Renderer['render'];
}

export interface PreparedV5 {
  readonly arms: readonly V5ArmInput[];
  readonly regions: ReadonlyMap<
    string,
    {
      readonly region: 'head' | 'middle' | 'tail' | 'multi' | 'unknown';
      readonly primaryRegion: 'head' | 'middle' | 'tail' | 'unknown';
    }
  >;
  readonly serialized: string;
  readonly sourceTokens: number;
  readonly nativePreparation: V5Preparation;
  readonly visualPreparation: V5Preparation;
  readonly goldPreparation: V5Preparation;
}

function estimateFixture(messages: readonly Message[]): {
  readonly chars: number;
  readonly tokens: number;
} {
  let chars = 0;
  let tokens = 0;
  for (const message of messages) {
    tokens += 12;
    for (const block of message.content) {
      if (block.type === 'text') {
        chars += block.text.length;
        tokens += Math.ceil(block.text.length / 4);
      }
    }
  }
  return { chars, tokens };
}

/** Prepare the four production arms once; runs reuse the same checkpoint. */
export async function prepareV5Arms(options: PrepareV5Options): Promise<PreparedV5> {
  const sourceTokens = options.fixture.messages.reduce(
    (total, message) => total + options.ctx.tokenMeter.estimateMessage(message),
    0,
  );
  const serialized = serializeConversation(
    options.fixture.messages,
    options.settings.serialization,
  );
  const regions = classifyQuestionRegions(
    options.fixture,
    serialized,
    options.settings.serialization.headChars,
    options.settings.serialization.tailChars,
  );
  const originalMessages: RequestMessage[] = options.fixture.messages.map((message) => ({
    ...message,
    content: [...message.content],
  }));

  let nativePreparation: V5Preparation = { elapsedMs: 0 };
  let nativeArm: V5ArmInput | undefined;
  const nativeStarted = performance.now();
  if (options.skipNative === true) {
    nativePreparation = { elapsedMs: 0, reason: 'skipped by --no-native' };
  } else
    try {
      const summary = await options.summarize(
        { messages: options.fixture.messages },
        options.agent,
        options.signal,
      );
      nativePreparation = {
        elapsedMs: performance.now() - nativeStarted,
        ...(summary.usage === undefined ? {} : { usage: summary.usage }),
      };
      nativeArm = {
        arm: 'native-text',
        messages: [{ role: 'user', content: summary.summary }],
      };
    } catch (error) {
      options.signal.throwIfAborted();
      nativePreparation = {
        elapsedMs: performance.now() - nativeStarted,
        reason: error instanceof Error ? error.message.slice(0, 1_000) : 'Native summary failed.',
      };
    }

  options.onProgress?.('native preparation: ' + (nativePreparation.reason ?? 'ready'));
  let visualPreparation: V5Preparation = { elapsedMs: 0 };
  let visualArm: V5ArmInput | undefined;
  const visualStarted = performance.now();
  options.onProgress?.('visual preparation: start');
  try {
    const result = await buildVisualCheckpoint({
      messages: options.fixture.messages,
      sourceTokens,
      checkpointTargetTokens: Math.floor(sourceTokens * options.settings.budget.checkpointShare),
      meter: options.ctx.tokenMeter,
      config: options.settings,
      route: options.route,
      llm: options.ctx.llm,
      attachments: options.ctx.attachments,
      imageSlots: Math.min(
        options.settings.rendering.maxFrames,
        options.ctx.attachments.imageLimits.maxImagesPerMessage,
      ),
      signal: options.signal,
      render: options.render,
    });
    if (result.kind === 'skipped') {
      visualPreparation = {
        elapsedMs: performance.now() - visualStarted,
        reason: result.reason,
      };
    } else {
      visualPreparation = {
        elapsedMs: performance.now() - visualStarted,
        frames: result.frames,
        checkpointTokens: result.checkpointTokens,
        budgetTokens: result.budgetTokens,
        overBudget: result.overBudget,
        pricedBy: result.pricedBy,
      };
      visualArm = {
        arm: 'pure-visual',
        messages: [{ role: 'user', content: [...result.blocks] }],
        frames: result.frames,
        checkpointTokens: result.checkpointTokens,
      };
    }
  } catch (error) {
    options.signal.throwIfAborted();
    visualPreparation = {
      elapsedMs: performance.now() - visualStarted,
      reason: error instanceof Error ? error.message.slice(0, 1_000) : 'Visual preparation failed.',
    };
  }

  options.onProgress?.(
    'visual preparation: ' + (visualPreparation.reason ?? visualPreparation.frames + ' frames'),
  );
  const source = buildVisualSource(options.fixture.messages, options.settings.serialization);
  const goldIndex = exactTokenIndex(source.middle);
  const goldBlocks: ContentBlock[] = [
    {
      type: 'text',
      text:
        'Exact-text gold checkpoint: the complete serialized history follows as text, then the ' +
        'same exact-token index as the pure-visual checkpoint. Read the relevant text or index for ' +
        'every question; do not answer from memory. Copy exact strings character for character; ' +
        'there is no search tool.',
    },
    ...(source.head.length > 0 ? [{ type: 'text' as const, text: source.head }] : []),
    ...(source.middle.length > 0 ? [{ type: 'text' as const, text: source.middle }] : []),
    ...(source.tail.length > 0 ? [{ type: 'text' as const, text: source.tail }] : []),
    ...(goldIndex.length > 0
      ? [
          {
            type: 'text' as const,
            text:
              'Exact-token index (same as the pure-visual checkpoint):\n' + goldIndex.join('\n'),
          },
        ]
      : []),
    {
      type: 'text' as const,
      text:
        'Checkpoint rule: for every later question, re-read the relevant text or exact-token index; ' +
        'do not answer from memory or from an earlier answer. The text and index above are the only source.',
    },
  ];
  const goldPreparation: V5Preparation = {
    elapsedMs: 0,
    ...(source.middle.length === 0 ? { reason: 'The serialized middle is empty.' } : {}),
  };
  const goldArm: V5ArmInput = {
    arm: 'gold-text',
    messages: [{ role: 'user', content: goldBlocks }],
    ...(source.middle.length === 0 ? { skipReason: 'The serialized middle is empty.' } : {}),
  };

  const arms: V5ArmInput[] = [
    { arm: 'original', messages: originalMessages },
    ...(nativeArm === undefined
      ? [
          {
            arm: 'native-text' as const,
            messages: [],
            skipReason: nativePreparation.reason ?? 'Native summary is unavailable.',
          },
        ]
      : [nativeArm]),
    ...(visualArm === undefined
      ? [
          {
            arm: 'pure-visual' as const,
            messages: [],
            skipReason: visualPreparation.reason ?? 'Visual checkpoint is unavailable.',
          },
        ]
      : [visualArm]),
    goldArm,
  ];
  return {
    arms,
    regions,
    serialized,
    sourceTokens,
    nativePreparation,
    visualPreparation,
    goldPreparation,
  };
}

function range(values: readonly number[]): V5Range {
  if (values.length === 0) return { mean: 0, min: 0, max: 0, sd: 0, ci95: [0, 0] };
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  const t =
    values.length <= 1 ? 0 : values.length === 2 ? 12.706 : values.length === 3 ? 4.303 : 2.776;
  const margin = values.length <= 1 ? 0 : (t * sd) / Math.sqrt(values.length);
  return {
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    sd,
    ci95: [mean - margin, mean + margin],
  };
}

function exactCount(run: V5ArmRun): number {
  return run.turns
    .flatMap((turn) => turn.outcomes)
    .filter((outcome) => outcome.kind.startsWith('exact-') && outcome.correct).length;
}

function tally(map: Record<string, V5Tally>, key: string, correct: boolean): void {
  const current = map[key] ?? { correct: 0, total: 0 };
  map[key] = { correct: current.correct + (correct ? 1 : 0), total: current.total + 1 };
}

/** Aggregate measured runs; failed runs stay in `runs` and are not scored. */
export function aggregateV5Arm(
  arm: V5ArmName,
  total: number,
  runs: readonly V5ArmRun[],
): V5ArmReport {
  const measured = runs.filter((run) => run.status === 'measured');
  const byKind: Record<string, V5Tally> = {};
  const byRegion: Record<string, V5Tally> = {};
  const byTag: Record<string, V5Tally> = {};
  const byCharacterClass: Record<string, { errors: number; total: number }> = {};
  const parseModes: Record<string, number> = {};
  for (const run of measured) {
    for (const turn of run.turns) {
      parseModes[turn.parseMode] = (parseModes[turn.parseMode] ?? 0) + 1;
      for (const outcome of turn.outcomes) {
        tally(byKind, outcome.kind, outcome.correct);
        tally(byRegion, outcome.primaryRegion, outcome.correct);
        for (const tag of outcome.tags) tally(byTag, tag, outcome.correct);
        for (const character of outcome.expected) {
          const cls = characterClass(character);
          const current = byCharacterClass[cls] ?? { errors: 0, total: 0 };
          byCharacterClass[cls] = {
            errors: current.errors + (outcome.correct ? 0 : 0),
            total: current.total + 1,
          };
        }
        if (!outcome.correct) {
          const errors = classErrors(outcome.expected, outcome.given);
          for (const [cls, count] of Object.entries(errors)) {
            const current = byCharacterClass[cls] ?? { errors: 0, total: 0 };
            byCharacterClass[cls] = { errors: current.errors + count, total: current.total };
          }
        }
      }
    }
  }
  const first = measured[0];
  return {
    arm,
    total,
    measuredRuns: measured.length,
    runs,
    accepted: range(measured.map((run) => run.correct)),
    exact: range(measured.map(exactCount)),
    byKind,
    byRegion,
    byTag,
    byCharacterClass,
    parseModes,
    ...(first?.frames === undefined ? {} : { frames: first.frames }),
    ...(first?.checkpointTokens === undefined ? {} : { checkpointTokens: first.checkpointTokens }),
  };
}

function check(
  check: string,
  expected: string,
  actual: string,
  pass: boolean,
): { check: string; expected: string; actual: string; pass: boolean } {
  return { check, expected, actual, pass };
}

function armTally(arms: readonly V5ArmReport[], arm: V5ArmName, key: string): number {
  const entry = arms.find((candidate) => candidate.arm === arm);
  return entry?.byKind[key]?.correct ?? 0;
}

function gate(
  name: string,
  expected: string,
  actual: string,
  pass: boolean,
): { check: string; expected: string; actual: string; pass: boolean } {
  return { check: name, expected, actual, pass };
}

export interface V5SuiteOptions extends PrepareV5Options {
  readonly runs: number;
  readonly prepared?: PreparedV5;
  readonly extraArms?: readonly V5ArmInput[];
  readonly degradedPreparation?: V5Preparation;
  readonly reproducible?: boolean;
  readonly onArmStart?: (arm: V5ArmName) => void;
}

/** Run the prepared arms, aggregate, and evaluate the frozen gates. */
export async function runV5Suite(
  options: V5SuiteOptions,
): Promise<{ readonly report: V5Report; readonly prepared: PreparedV5 }> {
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 5) {
    throw new Error('runs must be an integer from 1 to 5.');
  }
  const prepared = options.prepared ?? (await prepareV5Arms(options));
  const arms = [...prepared.arms, ...(options.extraArms ?? [])];
  const runsByArm = new Map<V5ArmName, V5ArmRun[]>();
  for (const input of arms) {
    options.onArmStart?.(input.arm);
    const runs: V5ArmRun[] = [];
    for (let run = 1; run <= options.runs; run += 1) {
      options.signal.throwIfAborted();
      runs.push(
        await runV5Arm({
          ctx: options.ctx,
          agent: options.agent,
          route: options.route,
          fixture: options.fixture,
          regions: prepared.regions,
          input,
          run,
          signal: options.signal,
          ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
        }),
      );
    }
    runsByArm.set(input.arm, runs);
  }
  const total = Object.keys(options.fixture.questions).length;
  const reports = arms.map((input) =>
    aggregateV5Arm(input.arm, total, runsByArm.get(input.arm) ?? []),
  );
  const visual = reports.find((entry) => entry.arm === 'pure-visual');
  const gold = reports.find((entry) => entry.arm === 'gold-text');
  const degraded = reports.find((entry) => entry.arm === 'degraded-visual');
  const original = reports.find((entry) => entry.arm === 'original');
  const visualMean = visual?.accepted.mean ?? 0;
  const goldMean = gold?.accepted.mean ?? 0;
  const degradedMean = degraded?.accepted.mean ?? 0;
  const instrument = [
    check('Gold-text ceiling', '>= 38/40', goldMean.toFixed(2), goldMean >= 38),
    check(
      'Gold >= pure visual',
      'gold >= visual',
      goldMean.toFixed(2) + ' vs ' + visualMean.toFixed(2),
      goldMean >= visualMean,
    ),
    ...(degraded === undefined
      ? []
      : [
          check(
            'Degraded negative control',
            '<= 32/40',
            degradedMean.toFixed(2),
            degradedMean <= 32,
          ),
          check(
            'Degraded worse than visual',
            '>= 4 questions worse',
            (visualMean - degradedMean).toFixed(2),
            visualMean - degradedMean >= 4,
          ),
          check(
            'Ordering',
            'gold >= visual >= degraded',
            goldMean.toFixed(2) + ' / ' + visualMean.toFixed(2) + ' / ' + degradedMean.toFixed(2),
            goldMean >= visualMean && visualMean > degradedMean,
          ),
        ]),
    check(
      'No leakage',
      'generator assertions pass',
      '40 questions, ' + options.fixture.decoys.length + ' decoys',
      total === 40 && options.fixture.decoys.length >= 20,
    ),
    check(
      'Reproducible',
      'fixture and report hashes recorded',
      options.reproducible === true ? 'recorded' : 'not verified in-suite',
      options.reproducible === true,
    ),
  ];
  const regionMean = (region: string): { correct: number; total: number } => {
    const tally = visual?.byRegion[region] ?? { correct: 0, total: 0 };
    const runs = Math.max(1, visual?.measuredRuns ?? 1);
    return { correct: tally.correct / runs, total: tally.total / runs };
  };
  const visualPeak = visual?.runs.find((run) => run.status === 'measured')?.peakPromptTokens ?? 0;
  const originalPeak =
    original?.runs.find((run) => run.status === 'measured')?.peakPromptTokens ?? 0;
  const visualCost = visual?.runs.find((run) => run.status === 'measured')?.weightedCost ?? 0;
  const originalCost = original?.runs.find((run) => run.status === 'measured')?.weightedCost ?? 0;
  const gates = [
    gate('Overall accepted', '>= 38/40', visualMean.toFixed(2), visualMean >= 38),
    gate(
      'Exact-string subset',
      '>= 15/16',
      (visual?.exact.mean ?? 0).toFixed(2),
      (visual?.exact.mean ?? 0) >= 15,
    ),
    gate(
      'Cross-region',
      '>= 5/6',
      String(armTally(reports, 'pure-visual', 'cross-region')),
      armTally(reports, 'pure-visual', 'cross-region') >= 5,
    ),
    gate(
      'Temporal/causal',
      '>= 5/6',
      String(
        armTally(reports, 'pure-visual', 'temporal') + armTally(reports, 'pure-visual', 'causal'),
      ),
      armTally(reports, 'pure-visual', 'temporal') + armTally(reports, 'pure-visual', 'causal') >=
        5,
    ),
    gate(
      'Negation/constraint',
      '>= 4/5',
      String(armTally(reports, 'pure-visual', 'negation')),
      armTally(reports, 'pure-visual', 'negation') >= 4,
    ),
    gate(
      'CJK',
      '>= 3/4',
      String(armTally(reports, 'pure-visual', 'cjk')),
      armTally(reports, 'pure-visual', 'cjk') >= 3,
    ),
    gate(
      'Numeric',
      '>= 2/3',
      String(armTally(reports, 'pure-visual', 'numeric')),
      armTally(reports, 'pure-visual', 'numeric') >= 2,
    ),
    gate(
      'Head region',
      '>= 6/7',
      regionMean('head').correct + '/' + regionMean('head').total,
      regionMean('head').correct >= 6,
    ),
    gate(
      'Middle region',
      '>= 25/27',
      regionMean('middle').correct + '/' + regionMean('middle').total,
      regionMean('middle').correct >= 25,
    ),
    gate(
      'Tail region',
      '>= 5/6',
      regionMean('tail').correct + '/' + regionMean('tail').total,
      regionMean('tail').correct >= 5,
    ),
    gate(
      'Peak prompt',
      '<= 0.40x original',
      originalPeak === 0 ? 'no baseline' : (visualPeak / originalPeak).toFixed(3) + 'x',
      originalPeak > 0 && visualPeak / originalPeak <= 0.4,
    ),
    gate(
      'Weighted cost',
      '<= 0.78x original',
      originalCost === 0 ? 'no baseline' : (visualCost / originalCost).toFixed(3) + 'x',
      originalCost > 0 && visualCost / originalCost <= 0.78,
    ),
  ];
  const usageAudit = reports
    .flatMap((report) => report.runs)
    .reduce<V5UsageAudit>(
      (merged, run) => {
        const reported = merged.reportedTotalTokens + run.audit.reportedTotalTokens;
        const computed = merged.computedTotalTokens + run.audit.computedTotalTokens;
        return {
          requests: merged.requests + run.audit.requests,
          inputTokens: merged.inputTokens + run.audit.inputTokens,
          cacheReadTokens: merged.cacheReadTokens + run.audit.cacheReadTokens,
          cacheWriteTokens: merged.cacheWriteTokens + run.audit.cacheWriteTokens,
          outputTokens: merged.outputTokens + run.audit.outputTokens,
          reportedTotalTokens: reported,
          computedTotalTokens: computed,
          unreportedPromptTokens: Math.max(0, reported - computed),
          complete: merged.complete && run.audit.complete,
        };
      },
      {
        requests: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reportedTotalTokens: 0,
        computedTotalTokens: 0,
        unreportedPromptTokens: 0,
        complete: true,
      },
    );
  const report: V5Report = {
    version: 5,
    fixture: fixtureMeta(options.fixture, estimateFixture),
    provider: options.route.provider,
    model: options.route.model,
    timestamp: new Date().toISOString(),
    runs: options.runs,
    schedule: options.fixture.turns.map((turn) => turn.keys),
    arms: reports,
    nativePreparation: prepared.nativePreparation,
    visualPreparation: prepared.visualPreparation,
    degradedPreparation: options.degradedPreparation ?? { elapsedMs: 0, reason: 'not run' },
    usageAudit,
    instrument,
    gates,
    warning:
      'v5 is a generated task-level suite. Weighted cost is relative, not a bill. ' +
      'The test split is generated outside the repository and is not part of this report ' +
      'unless this run used the frozen test seed.',
  };
  return { report, prepared };
}
