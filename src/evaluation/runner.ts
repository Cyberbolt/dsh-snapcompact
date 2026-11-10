import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { ArchiveService } from '../archives/service.js';
import type { SnapcompactConfig } from '../config.js';
import type { CompactionInput, CompactionSummary } from '../compaction/method.js';
import { snapcompact } from '../compaction/methods/snapcompact.js';
import { billedPromptTokens, estimateCheckpoint } from '../budgeting/pricing.js';
import type { Renderer } from '../rendering/worker-client.js';

const probeSchema = z.strictObject({
  line: z.number().int().min(0),
  text: z.string().min(1),
  key: z.string().min(1),
});

const fixtureSchema = z
  .strictObject({
    id: z.string(),
    text: z.string(),
    paddingLines: z.number().int().min(0).max(2000).default(400),
    suffix: z.string().default(''),
    probes: z.array(probeSchema).default([]),
    questions: z.record(z.string(), z.string()),
    answers: z.record(z.string(), z.string()),
  })
  .superRefine((fixture, context) => {
    const questionKeys = Object.keys(fixture.questions).sort();
    const answerKeys = Object.keys(fixture.answers).sort();
    if (questionKeys.join('\0') !== answerKeys.join('\0')) {
      context.addIssue({
        code: 'custom',
        path: ['answers'],
        message: 'Questions and answers must use the same keys.',
      });
    }
    const lines = new Set<number>();
    for (const [index, probe] of fixture.probes.entries()) {
      if (!(probe.key in fixture.questions) || !(probe.key in fixture.answers)) {
        context.addIssue({
          code: 'custom',
          path: ['probes', index, 'key'],
          message: 'Every probe key needs a question and an answer.',
        });
      }
      if (probe.line >= fixture.paddingLines - 1) {
        context.addIssue({
          code: 'custom',
          path: ['probes', index, 'line'],
          message: 'Probes must leave the final padding line to SNAP_PADDING_42.',
        });
      }
      if (lines.has(probe.line)) {
        context.addIssue({
          code: 'custom',
          path: ['probes', index, 'line'],
          message: 'Probe lines must be unique.',
        });
      }
      lines.add(probe.line);
    }
  });

export interface EvaluationArm {
  name: 'original' | 'native-text' | 'snapcompact';
  status: 'measured' | 'skipped' | 'failed';
  correct?: number;
  total: number;
  elapsedMs: number;
  promptTokens?: number;
  usage?: TokenUsage;
  estimatedCheckpointTokens?: number;
  frames?: number;
  pricedBy?: string;
  /** Question keys whose answer was missing, malformed or wrong. */
  missed?: string[];
  reason?: string;
}
export interface EvaluationReport {
  version: 1;
  fixture: string;
  provider: string;
  model: string;
  timestamp: string;
  summaryUsage?: TokenUsage;
  summaryElapsedMs?: number;
  visualPreparationElapsedMs?: number;
  frames?: { width: number; height: number; bytes: number }[];
  pricingSource?: string;
  arms: EvaluationArm[];
  warning: string;
}

type NativeSummarizer = (
  input: CompactionInput,
  agent: Agent,
  signal?: AbortSignal,
) => Promise<CompactionSummary>;

/** Four bounded auxiliary calls at most: one native summary plus three comprehension arms. */
export async function evaluate(
  ctx: Context,
  agent: Agent,
  settings: SnapcompactConfig,
  archives: ArchiveService,
  summarize: NativeSummarizer,
  render: Renderer['render'],
  signal: AbortSignal,
): Promise<EvaluationReport> {
  const fixture = fixtureSchema.parse(
    JSON.parse(
      await readFile(new URL('../../assets/benchmarks/engineering.json', import.meta.url), 'utf8'),
    ),
  );
  const target = agent.session.requestHeader()?.config ?? agent.options;
  if (!target.provider || !target.model)
    throw new Error('Route a model before running the benchmark.');
  const route = { provider: target.provider, model: target.model };
  const probeByLine = new Map(fixture.probes.map((probe) => [probe.line, probe.text]));
  const paddingLines = Array.from({ length: fixture.paddingLines }, (_, index) => {
    const probe = probeByLine.get(index);
    if (probe !== undefined) return probe;
    return index === fixture.paddingLines - 1
      ? `Observation ${index}: SNAP_PADDING_42 is the last synthetic history marker.`
      : `Observation ${index}: historical build log; no change to user constraints.`;
  });
  // Keep each message under the compact-format per-message cap so the exact
  // facts at the newest edge actually reach the bitmap middle.
  const chunkSize = Math.max(1, Math.ceil(fixture.paddingLines / 10));
  const paddingMessages = Array.from(
    { length: Math.ceil(paddingLines.length / chunkSize) },
    (_, index) =>
      createUserMessage({
        source: { kind: 'user' },
        content: [
          {
            type: 'text',
            text: paddingLines.slice(index * chunkSize, (index + 1) * chunkSize).join('\n'),
          },
        ],
      }),
  );
  const factMessage = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: `${fixture.text}\n${fixture.suffix}` }],
  });
  const messages = [...paddingMessages, factMessage];
  const input = { messages };
  const archive = await archives.create({ sessionId: agent.id, messages }, signal);
  const sourceTokens = messages.reduce(
    (total, message) => total + ctx.tokenMeter.estimateMessage(message),
    0,
  );
  const report: EvaluationReport = {
    version: 1,
    fixture: fixture.id,
    ...route,
    timestamp: new Date().toISOString(),
    arms: [],
    warning:
      'Synthetic fixture only. Image/token estimates are not billed usage. Prompt totals include cache buckets; token savings do not imply monetary savings. Summary overhead must be amortized over subsequent turns.',
  };
  const questions =
    '\nAnswer these questions using ONLY the preceding historical material. ' +
    'Return a JSON object with exactly these keys and string answers; no Markdown.\n' +
    JSON.stringify(fixture.questions);

  async function run(
    name: EvaluationArm['name'],
    content: readonly ContentBlock[],
  ): Promise<EvaluationArm> {
    signal.throwIfAborted();
    const start = performance.now();
    const assembler = new BlockAssembler();
    try {
      for await (const chunk of ctx.llm.stream({
        ...route,
        messages: [{ role: 'user', content: [...content, { type: 'text', text: questions }] }],
        maxTokens: 8192,
        sessionId: agent.id,
        purpose: 'compaction',
        signal,
      }))
        assembler.push(chunk);
      signal.throwIfAborted();
      if (assembler.finish.kind !== 'stop')
        throw new Error('Evaluation response did not finish normally.');
      const text = assembler
        .blocks()
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n');
      const usage = assembler.usage;
      let correct = 0;
      let missed: string[] | undefined;
      let answerError: string | undefined;
      try {
        const answers = z.record(z.string(), z.string()).parse(JSON.parse(text));
        const wrong: string[] = [];
        for (const [key, expected] of Object.entries(fixture.answers)) {
          const given = answers[key];
          if (typeof given === 'string' && given.trim() === expected.trim()) correct += 1;
          else wrong.push(key);
        }
        missed = wrong;
      } catch {
        missed = Object.keys(fixture.answers);
        answerError =
          'Response was not a string-valued JSON answer object; exact-match score is zero.';
      }
      return {
        name,
        status: usage ? 'measured' : 'failed',
        total: Object.keys(fixture.answers).length,
        correct,
        ...(missed === undefined ? {} : { missed }),
        ...(answerError === undefined ? {} : { reason: answerError }),
        elapsedMs: performance.now() - start,
        ...(usage
          ? { usage, promptTokens: billedPromptTokens(usage) }
          : { reason: 'Provider returned no usage; not a measurement.' }),
      };
    } catch (error) {
      signal.throwIfAborted();
      return {
        name,
        status: 'failed',
        elapsedMs: performance.now() - start,
        total: Object.keys(fixture.answers).length,
        reason: error instanceof Error ? error.message.slice(0, 1000) : 'Evaluation failed',
        ...(assembler.usage
          ? { usage: assembler.usage, promptTokens: billedPromptTokens(assembler.usage) }
          : {}),
      };
    }
  }

  report.arms.push(
    await run(
      'original',
      messages.flatMap((message) => message.content),
    ),
  );
  const summaryStart = performance.now();
  let baseline: CompactionSummary;
  try {
    baseline = await summarize(input, agent, signal);
  } catch (error) {
    signal.throwIfAborted();
    report.summaryElapsedMs = performance.now() - summaryStart;
    report.arms.push({
      name: 'native-text',
      status: 'failed',
      elapsedMs: 0,
      total: Object.keys(fixture.answers).length,
      reason: error instanceof Error ? error.message.slice(0, 1000) : 'Native summary failed',
    });
    report.arms.push({
      name: 'snapcompact',
      status: 'skipped',
      elapsedMs: 0,
      total: Object.keys(fixture.answers).length,
      reason: 'No usable independent summary baseline.',
    });
    return report;
  }
  report.summaryElapsedMs = performance.now() - summaryStart;
  if (baseline.usage) report.summaryUsage = baseline.usage;
  report.arms.push(await run('native-text', baseline.summary));
  try {
    const visualStart = performance.now();
    const candidate = await snapcompact({
      input,
      sourceMessages: messages,
      sourceTokens,
      // The fixture has no live session surface to price against a trigger, so the
      // benchmark applies the same half-of-the-source rule the engine falls back to.
      checkpointTargetTokens: Math.floor(sourceTokens / 2),
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
      handoff: async () => baseline,
      soft: async () => baseline,
    });
    report.visualPreparationElapsedMs = performance.now() - visualStart;
    if (candidate.kind === 'skipped') {
      report.arms.push({
        name: 'snapcompact',
        status: 'skipped',
        reason: candidate.reason,
        elapsedMs: 0,
        total: Object.keys(fixture.answers).length,
      });
    } else {
      report.frames = candidate.result.summary.flatMap((block) =>
        block.type === 'image'
          ? [
              {
                width: block.attachment.width,
                height: block.attachment.height,
                bytes: block.attachment.bytes,
              },
            ]
          : [],
      );
      const arm = await run('snapcompact', candidate.result.summary);
      arm.frames = report.frames.length;
      if (candidate.imageRoute !== undefined) {
        arm.pricedBy = candidate.imageRoute.pricingSource;
        report.pricingSource = candidate.imageRoute.pricingSource;
      }
      arm.estimatedCheckpointTokens = estimateCheckpoint(
        candidate.result.summary,
        ctx.tokenMeter,
        candidate.imageRoute,
      );
      report.arms.push(arm);
    }
  } catch (error) {
    signal.throwIfAborted();
    report.arms.push({
      name: 'snapcompact',
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Visual arm failed',
      elapsedMs: 0,
      total: Object.keys(fixture.answers).length,
    });
  }
  return report;
}
