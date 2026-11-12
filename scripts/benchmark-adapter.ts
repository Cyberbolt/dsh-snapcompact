import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type {
  ContentBlock,
  Message,
  RequestMessage,
  StreamChunk,
  TokenUsage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm';
import type { Session } from '@deepseek-ai/dsh-session';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import YAML from 'yaml';
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';

export const DEFAULT_PROVIDER = 'opencode-go';
export const DEFAULT_MODEL = 'deepseek-v4.1-flash';
export const DEFAULT_API_URL = 'https://opencode.ai/inference/go/v1/chat/completions';
export const DEFAULT_VISUAL_TOKENS = 1_343;
const SESSION_HEADER = 'snapcompact-v4-' + randomUUID();

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

export class DiskAttachments {
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

export class OpenCodeAdapter extends LlmAdapter {
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
      ...(process.env.SNAPCOMPACT_BENCH_REASONING === undefined
        ? {}
        : { reasoning_effort: process.env.SNAPCOMPACT_BENCH_REASONING }),
      ...(process.env.SNAPCOMPACT_BENCH_THINKING === undefined
        ? {}
        : { thinking: { type: process.env.SNAPCOMPACT_BENCH_THINKING } }),
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

export function estimateMessage(message: Pick<Message, 'content'>): number {
  let tokens = 12;
  for (const block of message.content) {
    if (block.type === 'text') tokens += Math.ceil(block.text.length / 4);
    else if (block.type === 'image') tokens += 256;
  }
  return tokens;
}

export function createMeter() {
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
/** Read the benchmark key without printing it. */
export async function loadApiKey(): Promise<string> {
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
  return apiKey;
}
