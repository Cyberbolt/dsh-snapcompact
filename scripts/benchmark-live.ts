import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm';
import type {
  ContentBlock,
  Message,
  RequestMessage,
  StreamChunk,
  TokenUsage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import YAML from 'yaml';
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { FileStore } from '../dist/archives/repository.js';
import { ArchiveRepository } from '../dist/archives/repository.js';
import { ArchiveService } from '../dist/archives/service.js';
import { resolveConfig } from '../dist/config.js';
import { SnapcompactEngine } from '../dist/compaction/engine.js';
import {
  buildVisualSource,
  serializeConversation,
  trimMiddle,
} from '../dist/compaction/visual-source.js';
import { summaryBlocks } from '../dist/compaction/methods/snapcompact.js';
import { buildLongFixture } from '../dist/evaluation/fixture.js';
import { evaluate } from '../dist/evaluation/runner.js';
import { renderEvaluationReport, renderSessionReport } from '../dist/evaluation/report.js';
import { evaluateSession } from '../dist/evaluation/session.js';
import { createRenderer } from '../dist/rendering/worker-client.js';
import type { Renderer } from '../dist/rendering/worker-client.js';

const DEFAULT_PROVIDER = 'opencode-go';
const DEFAULT_MODEL = 'deepseek-v4.1-flash';
const DEFAULT_API_URL = 'https://opencode.ai/inference/go/v1/chat/completions';
const DEFAULT_VISUAL_TOKENS = 1_343;
const SESSION_HEADER = 'snapcompact-v4-' + randomUUID();

type Suite = 'accuracy' | 'session' | 'all';

interface CliOptions {
  readonly suite: Suite;
  readonly runs: number;
  readonly share: number;
  readonly out: string;
  readonly preflight: boolean;
  readonly lines: number;
  readonly provider: string;
  readonly model: string;
  readonly apiUrl: string;
}

function usage(): string {
  return [
    'Usage: node --experimental-strip-types scripts/benchmark-live.ts [options]',
    '  --suite=accuracy|session|all   default all',
    '  --runs=N                       repeats; default 1 (1-5)',
    '  --share=0.4                    checkpoint share (0.25-0.5)',
    '  --out=.artifacts/v4            output directory',
    '  --lines=5000                   long-fixture padding lines',
    '  --preflight                    render the long fixture once; no model call',
    '  --provider=... --model=...     route override',
    '  --api-url=...                  OpenAI-compatible chat-completions endpoint',
  ].join('\n');
}

function parseNumber(value: string, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let suite: Suite = 'all';
  let runs = 1;
  let share = 0.4;
  let out = '.artifacts/v4';
  let preflight = false;
  let lines = 5_000;
  let provider = process.env.SNAPCOMPACT_BENCH_PROVIDER ?? DEFAULT_PROVIDER;
  let model = process.env.SNAPCOMPACT_BENCH_MODEL ?? DEFAULT_MODEL;
  let apiUrl = process.env.SNAPCOMPACT_BENCH_API_URL ?? DEFAULT_API_URL;
  for (const arg of argv) {
    if (arg === '--preflight') {
      preflight = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/u.exec(arg);
    if (match === null) throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    const [, key, value] = match;
    switch (key) {
      case 'suite':
        if (value !== 'accuracy' && value !== 'session' && value !== 'all') {
          throw new Error('suite must be accuracy, session or all');
        }
        suite = value;
        break;
      case 'runs':
        runs = parseNumber(value ?? '', 'runs', 1, 5);
        if (!Number.isInteger(runs)) throw new Error('runs must be an integer');
        break;
      case 'share':
        share = parseNumber(value ?? '', 'share', 0.25, 0.5);
        break;
      case 'out':
        out = value ?? out;
        break;
      case 'lines':
        lines = parseNumber(value ?? '', 'lines', 100, 20_000);
        if (!Number.isInteger(lines)) throw new Error('lines must be an integer');
        break;
      case 'provider':
        provider = value ?? provider;
        break;
      case 'model':
        model = value ?? model;
        break;
      case 'api-url':
        apiUrl = value ?? apiUrl;
        break;
      default:
        throw new Error(`Unknown argument: --${key}\n${usage()}`);
    }
  }
  return { suite, runs, share, out, preflight, lines, provider, model, apiUrl };
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; uncached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/**
 * Map the provider's usage into DSH's disjoint TokenUsage.
 *
 * Some OpenAI-compatible providers report `prompt_tokens` as the uncached
 * input and put cache hits in a separate field, while others fold hits into
 * prompt_tokens. The presence of a hit counter distinguishes the two shapes;
 * v3 only read prompt_tokens_details.cached_tokens, which silently dropped a
 * separate prompt_cache_hit_tokens side.
 */
function usageOf(raw: RawUsage | null | undefined): TokenUsage | undefined {
  if (raw === undefined || raw === null) return undefined;
  const prompt = raw.prompt_tokens ?? 0;
  const completion = raw.completion_tokens ?? 0;
  const hit =
    raw.prompt_cache_hit_tokens ??
    raw.cache_read_input_tokens ??
    raw.prompt_tokens_details?.cached_tokens ??
    0;
  const cacheWrite = raw.cache_creation_input_tokens ?? 0;
  const separatePrompt =
    raw.prompt_cache_hit_tokens !== undefined ||
    raw.cache_read_input_tokens !== undefined ||
    raw.cache_creation_input_tokens !== undefined;
  const input =
    raw.prompt_cache_miss_tokens ??
    raw.prompt_tokens_details?.uncached_tokens ??
    (separatePrompt ? prompt : Math.max(0, prompt - hit));
  const computed = input + hit + cacheWrite + completion;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens;
  return {
    inputTokens: Math.max(0, input),
    outputTokens: completion,
    totalTokens: raw.total_tokens ?? computed,
    ...(hit > 0 ? { cacheReadTokens: hit } : {}),
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  };
}

class DiskAttachments implements FileStore {
  readonly imageLimits = {
    maxImageBytes: 16 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 64 * 1024 * 1024,
    maxImagePixels: 4 * 1024 * 1024,
    maxImageDimension: 4096,
    mediaTypes: ['image/png'] as const,
  };
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async saveFile(input: { data: Uint8Array; name?: string }): Promise<FileAttachmentRef> {
    const digest = createHash('sha256').update(input.data).digest('hex');
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, digest), input.data);
    return {
      attachmentId: `sha256:${digest}` as FileAttachmentRef['attachmentId'],
      bytes: input.data.byteLength,
      name: input.name ?? 'file.bin',
    };
  }

  async *readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    const stream = createReadStream(join(this.directory, ref.attachmentId.slice(7)), {
      ...(signal === undefined ? {} : { signal }),
    });
    for await (const chunk of stream) yield Buffer.from(chunk);
  }

  async saveImages(
    inputs: readonly { data: Uint8Array; mediaType: string; name?: string }[],
  ): Promise<readonly ImageAttachmentRef[]> {
    const refs = [];
    for (const input of inputs) {
      const raster = PNG.sync.read(Buffer.from(input.data));
      const ref = await this.saveFile(input);
      refs.push({
        ...ref,
        mediaType: 'image/png' as const,
        width: raster.width,
        height: raster.height,
      });
    }
    return refs;
  }

  async readImage(ref: ImageAttachmentRef): Promise<{
    data: Uint8Array;
    ref: ImageAttachmentRef;
  }> {
    return {
      data: await readFile(join(this.directory, ref.attachmentId.slice(7))),
      ref,
    };
  }
}

function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

interface RawToolCall {
  readonly index?: number;
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

interface RawChoice {
  readonly delta?: {
    readonly content?: string;
    readonly tool_calls?: readonly RawToolCall[];
  };
  readonly finish_reason?: string | null;
}

interface RawChunk {
  readonly usage?: RawUsage | null;
  readonly choices?: readonly RawChoice[];
}

interface ToolState {
  id: string;
  name?: string;
}

class OpenCodeAdapter extends LlmAdapter {
  private readonly attachments: DiskAttachments;
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(attachments: DiskAttachments, apiKey: string, apiUrl: string) {
    super();
    this.attachments = attachments;
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }

  override async resolveModel(provider: string, model: string) {
    return {
      provider,
      id: model,
      name: model,
      inputModalities: ['text', 'image'] as const,
      context: { contextWindow: 200_000 },
    };
  }

  override imageRequestPricing() {
    return {
      priceImages: (images: readonly unknown[]) =>
        images.map(() => ({ visualTokens: DEFAULT_VISUAL_TOKENS, text: 'estimated image' })),
    };
  }

  override imageRequestTarget(_provider: string, _model: string, image: ImageAttachmentRef) {
    return {
      width: image.width,
      height: image.height,
      maxBytes: 16 * 1024 * 1024,
    };
  }

  private async toMessage(message: RequestMessage): Promise<Record<string, unknown>> {
    const role = message.role;
    if (role === 'system' || role === 'developer') {
      return { role: 'system', content: textOf(message.content) };
    }
    if (role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: textOf(message.content),
      };
    }
    if (role === 'assistant') {
      const toolCalls = message.content.flatMap((block) =>
        block.type === 'tool-call'
          ? [
              {
                id: block.id,
                type: 'function',
                function: { name: block.name, arguments: block.arguments },
              },
            ]
          : [],
      );
      return {
        role: 'assistant',
        content: textOf(message.content) || null,
        ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
      };
    }
    const content: Record<string, unknown>[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        const { data } = await this.attachments.readImage(block.attachment);
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${block.attachment.mediaType};base64,${Buffer.from(data).toString('base64')}`,
          },
        });
      } else if (block.type === 'file') {
        content.push({
          type: 'text',
          text: `[archived transcript attachment: ${block.attachment.name}]`,
        });
      }
    }
    return { role: 'user', content };
  }

  override async *stream(options: Parameters<LlmAdapter['stream']>[0]): AsyncIterable<StreamChunk> {
    const messages: Record<string, unknown>[] = [];
    for (const message of options.messages) messages.push(await this.toMessage(message));
    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      ...(options.tools === undefined
        ? {}
        : {
            tools: options.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: 'auto',
          }),
    };
    options.signal?.throwIfAborted();
    const requestTimeout = AbortSignal.timeout(360_000);
    const signal =
      options.signal === undefined
        ? requestTimeout
        : AbortSignal.any([options.signal, requestTimeout]);
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        'x-opencode-session': SESSION_HEADER,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000);
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    if (response.body === null) throw new Error('Provider returned no response body.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let started = false;
    let finishReason: string | null = null;
    let usage: TokenUsage | undefined;
    const toolState = new Map<number, ToolState>();

    const handle = async function* (event: string): AsyncIterable<StreamChunk> {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (data === '' || data === '[DONE]') return;
      const chunk = JSON.parse(data) as RawChunk;
      if (chunk.usage !== undefined && chunk.usage !== null) {
        usage = usageOf(chunk.usage) ?? usage;
      }
      const choice = chunk.choices?.[0];
      if (choice === undefined) return;
      if (typeof choice.delta?.content === 'string' && choice.delta.content.length > 0) {
        if (!started) {
          started = true;
          yield { type: 'block-start', index: 0, blockType: 'text' };
        }
        text += choice.delta.content;
        yield { type: 'text-delta', index: 0, text: choice.delta.content };
      }
      for (const call of choice.delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const state: ToolState = toolState.get(index) ?? { id: `call_${index}` };
        if (call.id !== undefined) state.id = call.id;
        if (call.function?.name !== undefined) state.name = call.function.name;
        toolState.set(index, state);
        yield {
          type: 'tool-call-delta',
          index: 100 + index,
          id: state.id as ToolCallId,
          ...(state.name === undefined ? {} : { name: state.name }),
          argumentsDelta: call.function?.arguments ?? '',
        };
      }
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        finishReason = choice.finish_reason;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        yield* handle(event);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim().length > 0) yield* handle(buffer);
    if (started) {
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    }
    if (usage !== undefined) yield { type: 'usage', usage };
    if (finishReason === 'tool_calls') yield { type: 'finish', reason: { kind: 'tool-calls' } };
    else if (finishReason === 'length') yield { type: 'finish', reason: { kind: 'max-tokens' } };
    else yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

function estimateMessage(message: Pick<Message, 'content'>): number {
  let tokens = 12;
  for (const block of message.content) {
    if (block.type === 'text') tokens += Math.ceil(block.text.length / 4);
    else if (block.type === 'image') tokens += 256;
  }
  return tokens;
}

function createMeter() {
  return {
    estimateMessage,
    measure(session: Session) {
      const messages = session.deriveMessages();
      const nodes = session.surface.nodes.map((seq, index) => ({
        seq,
        tokens: estimateMessage(messages[index] ?? { content: [] }),
        heuristicTokens: estimateMessage(messages[index] ?? { content: [] }),
      }));
      const tokens = nodes.reduce((sum, node) => sum + node.tokens, 0);
      return {
        logRevision: session.seq,
        baseline: { kind: 'estimated' as const, tokens },
        surfaceDeltaTokens: 0,
        totalTokens: tokens,
        surfaceTokens: tokens,
        nodes,
      };
    },
  };
}

function logLine(lines: string[], text: string): void {
  console.log(text);
  lines.push(text);
}

async function preflight(options: CliOptions): Promise<void> {
  const settings = resolveConfig({ budget: { checkpointShare: options.share } });
  const { fixture, messages } = buildLongFixture({ paddingLines: options.lines });
  const serialized = serializeConversation(messages, settings.serialization);
  const sourceTokens = messages.reduce((total, message) => total + estimateMessage(message), 0);
  const source = buildVisualSource(messages, settings.serialization);
  const guideBlocks = summaryBlocks(source, '', [], [], 0, 0);
  const baseTokens =
    guideBlocks.reduce(
      (total, block) => total + (block.type === 'text' ? 12 + Math.ceil(block.text.length / 4) : 0),
      0,
    ) + 256;
  const budgetTokens = Math.floor(sourceTokens * options.share);
  const maxFrames = Math.min(settings.rendering.maxFrames, 20);
  const plannedFrames = Math.max(
    0,
    Math.min(maxFrames, Math.floor((budgetTokens - baseTokens) / DEFAULT_VISUAL_TOKENS)),
  );
  const rows = Math.floor(
    (settings.rendering.height - 2 * 16 - 24 - 24) / settings.rendering.lineHeight,
  );
  const columns = Math.floor((settings.rendering.width - 2 * 16) / 8);
  const maxChars = Math.floor(plannedFrames * rows * columns * 0.94);
  const trimmed = trimMiddle(source, maxChars);
  const renderer = createRenderer();
  const started = performance.now();
  let frames = 0;
  let error: string | undefined;
  try {
    if (plannedFrames < 1) throw new Error('No frame fits the checkpoint budget.');
    const rendered = await renderer.render(
      trimmed.middle,
      {
        width: settings.rendering.width,
        height: settings.rendering.height,
        maxFrames: plannedFrames,
        maxTotalBytes: settings.rendering.maxTotalBytes,
        maxSourceBytes: settings.rendering.maxSourceBytes,
        timeoutMs: settings.rendering.timeoutMs,
        lineHeight: settings.rendering.lineHeight,
      },
      undefined,
    );
    frames = rendered.frames.length;
  } catch (caught) {
    const code =
      typeof caught === 'object' && caught !== null && 'code' in caught
        ? (caught as { code?: unknown }).code
        : undefined;
    error = `${code === undefined ? '' : `${String(code)}: `}${caught instanceof Error ? caught.message : String(caught)}`;
  } finally {
    await renderer.dispose();
  }
  const elapsedMs = performance.now() - started;
  console.log(
    JSON.stringify(
      {
        lines: fixture.paddingLines,
        messages: messages.length,
        sourceChars: serialized.length,
        sourceTokens,
        budgetTokens,
        baseTokens,
        plannedFrames,
        renderedFrames: frames,
        renderedChars: trimmed.middle.length,
        checkpointTokens: baseTokens + frames * DEFAULT_VISUAL_TOKENS,
        elapsedMs: Math.round(elapsedMs),
        ...(error === undefined ? {} : { error }),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  if (options.preflight) {
    await preflight(options);
    return;
  }

  const credentialPath = join(homedir(), '.dsh', '.credentials.yaml');
  const credentials = YAML.parse(await readFile(credentialPath, 'utf8')) as {
    refs?: Record<string, unknown>;
  };
  const apiKey =
    process.env.OPENCODE_GO_API_KEY ??
    process.env.SNAPCOMPACT_BENCH_API_KEY ??
    credentials.refs?.OPENCODE_GO_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('No OPENCODE_GO_API_KEY / SNAPCOMPACT_BENCH_API_KEY is available.');
  }

  const directory = await mkdtemp(join(tmpdir(), 'snapcompact-v4-'));
  const attachments = new DiskAttachments(directory);
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  llm.registerAdapter([options.provider], new OpenCodeAdapter(attachments, apiKey, options.apiUrl));
  ctx.reflect.provide('attachments', attachments);
  ctx.reflect.provide('sessions', { flush: async () => true });
  ctx.reflect.provide('tokenMeter', createMeter());
  const session = Session.create(SessionId(`session-live-v4-${Date.now()}`));
  session.append('request/header', {
    header: { config: { provider: options.provider, model: options.model } },
    reason: 'initial',
  });
  const agent = {
    id: session.id,
    ctx,
    session,
    options: { provider: options.provider, model: options.model },
    runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) =>
      task(new AbortController().signal),
  } as Agent;
  const settings = resolveConfig({ budget: { checkpointShare: options.share } });
  const archives = new ArchiveService(new ArchiveRepository(attachments));
  const renderer = createRenderer();
  const engine = new SnapcompactEngine(
    ctx,
    settings,
    archives,
    renderer,
    new AbortController().signal,
  );
  const summarize = (
    input: Parameters<typeof engine.nativeSummaryForEvaluation>[0],
    owner: Agent,
    signal?: AbortSignal,
  ) => engine.nativeSummaryForEvaluation(input, owner, signal);
  const render = (
    text: string,
    renderOptions: Parameters<Renderer['render']>[1],
    signal: AbortSignal,
  ) => renderer.render(text, renderOptions, signal);

  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const logs: string[] = [];
  const failures: string[] = [];
  const started = performance.now();
  logLine(
    logs,
    `provider=${options.provider} model=${options.model} share=${options.share} runs=${options.runs} lines=${options.lines}`,
  );
  logLine(logs, `suite=${options.suite} out=${outDir} at=${new Date().toISOString()}`);

  try {
    if (options.suite === 'accuracy' || options.suite === 'all') {
      logLine(logs, '\n== accuracy suite ==');
      const report = await evaluate(
        ctx,
        agent,
        settings,
        archives,
        summarize,
        render,
        new AbortController().signal,
        { runs: options.runs },
      );
      await writeFile(join(outDir, 'accuracy.json'), JSON.stringify(report, null, 2) + '\n');
      const markdown = renderEvaluationReport(report);
      await writeFile(join(outDir, 'accuracy.md'), markdown + '\n');
      logLine(logs, markdown);
      if (!report.usageAudit.complete) failures.push('accuracy usage audit is incomplete');
    }
    if (options.suite === 'session' || options.suite === 'all') {
      logLine(logs, '\n== session suite ==');
      const reports = await evaluateSession(
        ctx,
        agent,
        settings,
        archives,
        summarize,
        render,
        new AbortController().signal,
        { runs: options.runs, paddingLines: options.lines },
      );
      await writeFile(join(outDir, 'session.json'), JSON.stringify(reports, null, 2) + '\n');
      const markdown = reports.map(renderSessionReport).join('\n---\n');
      await writeFile(join(outDir, 'session.md'), markdown + '\n');
      logLine(logs, markdown);
      for (const report of reports) {
        if (!report.usageAudit.complete) {
          failures.push(`session run ${report.run} usage audit is incomplete`);
        }
      }
    }
  } finally {
    await renderer.dispose();
  }

  const elapsedMs = performance.now() - started;
  logLine(logs, `\nelapsed=${(elapsedMs / 1000).toFixed(1)}s`);
  await writeFile(join(outDir, 'run.log'), logs.join('\n') + '\n');
  await writeFile(
    join(outDir, 'run.json'),
    JSON.stringify(
      {
        provider: options.provider,
        model: options.model,
        share: options.share,
        runs: options.runs,
        lines: options.lines,
        suite: options.suite,
        outDir,
        elapsedMs: Math.round(elapsedMs),
        failures,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  if (failures.length > 0) {
    console.error('\nFAILED: ' + failures.join('; '));
    process.exitCode = 1;
  }
}

await main();
