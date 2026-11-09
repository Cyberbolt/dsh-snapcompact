import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { LlmAdapter, LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm';
import type {
  GenerateOptions,
  LlmImageRequestPricing,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm';
import type {
  ImageAttachmentRef,
  FileAttachmentRef,
  ImageRequestTarget,
} from '@deepseek-ai/dsh-attachment';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { fileAttachmentReferenceSchema } from '../../src/archives/format.js';
import type { FileStore } from '../../src/archives/repository.js';

/** Real disk bytes with a deliberately small, deterministic host policy; no provider I/O. */
export class DiskAttachments implements FileStore {
  readonly imageLimits = {
    maxImageBytes: 16 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 16 * 1024 * 1024,
    maxImagePixels: 4 * 1024 * 1024,
    maxImageDimension: 4096,
    mediaTypes: ['image/png'] as const,
  };
  constructor(readonly directory: string) {}

  async saveFile(input: { data: Uint8Array; name?: string }): Promise<FileAttachmentRef> {
    const digest = createHash('sha256').update(input.data).digest('hex');
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, digest), input.data);
    return fileAttachmentReferenceSchema.parse({
      attachmentId: `sha256:${digest}`,
      bytes: input.data.byteLength,
      name: input.name ?? 'file.bin',
    });
  }

  async *readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    if (!/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId))
      throw new Error('Invalid test attachment ID');
    const stream = createReadStream(join(this.directory, ref.attachmentId.slice(7)), {
      ...(signal ? { signal } : {}),
    });
    for await (const chunk of stream) yield Buffer.from(chunk);
  }

  async saveImages(
    inputs: readonly { data: Uint8Array; mediaType: string; name?: string }[],
  ): Promise<readonly ImageAttachmentRef[]> {
    const refs: ImageAttachmentRef[] = [];
    for (const input of inputs) {
      const raster = PNG.sync.read(Buffer.from(input.data));
      const ref = await this.saveFile(input);
      refs.push({ ...ref, mediaType: 'image/png', width: raster.width, height: raster.height });
    }
    return refs;
  }

  async readImage(ref: ImageAttachmentRef): Promise<{ data: Uint8Array; ref: ImageAttachmentRef }> {
    return { data: await readFile(join(this.directory, ref.attachmentId.slice(7))), ref };
  }
}

export class TestAdapter extends LlmAdapter {
  calls: GenerateOptions[] = [];
  text =
    '## Goal\nGoal: continue the requested implementation.\n## Constraints\nPreserve exact commands.\n## Decisions\nUse the approved design.\n## Files and exact commands\npnpm test\n## Completed work\n(none)\n## Unfinished work\nIntegration tests.\n## Next action\nRun integration tests.\n## Critical facts\nNever infer exact code from uncertain OCR.';
  reject = false;
  pricingAvailable = true;
  visualTokens = 100;
  targetScale = 1;
  beforeStream: (() => Promise<void>) | undefined;

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      inputModalities: model === 'text' ? ['text'] : ['text', 'image'],
      context: { contextWindow: 200_000 },
    };
  }
  override imageRequestPricing(): LlmImageRequestPricing | undefined {
    if (!this.pricingAvailable) return undefined;
    return {
      priceImages: (images) =>
        images.map(() => ({ visualTokens: this.visualTokens, text: 'test image' })),
    };
  }
  override imageRequestTarget(
    _provider: string,
    _model: string,
    image: ImageAttachmentRef,
  ): ImageRequestTarget {
    return {
      width: Math.max(1, Math.round(image.width * this.targetScale)),
      height: Math.max(1, Math.round(image.height * this.targetScale)),
      maxBytes: 1024 * 1024,
    };
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options);
    await this.beforeStream?.();
    options.signal?.throwIfAborted();
    if (this.reject) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { code: 'TEST_FAILURE', message: 'Injected model failure' },
        },
      };
      return;
    }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: this.text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.text } };
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

function heuristic(message: { content: readonly { type: string; text?: string }[] }): number {
  return (
    12 + message.content.reduce((sum, block) => sum + Math.ceil((block.text?.length ?? 256) / 4), 0)
  );
}

export async function createHarness(model = 'vision'): Promise<{
  ctx: Context;
  session: Session;
  agent: Agent;
  attachments: DiskAttachments;
  adapter: TestAdapter;
  appendText: (text: string) => ReturnType<Session['append']>;
  dispose: () => Promise<void>;
}> {
  const root = resolve(process.cwd());
  const directory = await mkdtemp(join(root, '.test-artifacts-'));
  const ctx = new Context();
  const attachments = new DiskAttachments(directory);
  const llm = new LlmRuntime(ctx);
  const adapter = new TestAdapter();
  llm.registerAdapter(['test'], adapter);
  ctx.reflect.provide('attachments', attachments);
  ctx.reflect.provide('sessions', { flush: async () => true });
  ctx.reflect.provide('tokenMeter', {
    estimateMessage: heuristic,
    measure: (session: Session) => {
      const messages = session.deriveMessages();
      const nodes = session.surface.nodes.map((seq, index) => ({
        seq,
        tokens: heuristic(messages[index] ?? { content: [] }),
        heuristicTokens: heuristic(messages[index] ?? { content: [] }),
      }));
      const tokens = nodes.reduce((sum, node) => sum + node.tokens, 0);
      return {
        logRevision: session.seq,
        baseline: { kind: 'estimated', tokens },
        surfaceDeltaTokens: 0,
        totalTokens: tokens,
        surfaceTokens: tokens,
        nodes,
      };
    },
  });
  const session = Session.create(SessionId(`session-test-${crypto.randomUUID()}`));
  session.append('request/header', {
    header: { config: { provider: 'test', model } },
    reason: 'initial',
  });
  // Only these Agent capabilities are used by the pinned native compaction seam. Keep this
  // single test-double boundary explicit instead of inventing a second full Agent loop.
  const agent = {
    id: session.id,
    ctx,
    session,
    options: { provider: 'test', model },
    runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) =>
      task(new AbortController().signal),
  } as Agent;
  return {
    ctx,
    session,
    agent,
    attachments,
    adapter,
    appendText: (text) =>
      session.append(
        'user/message',
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
        { surfaceOp: 'append' },
      ),
    dispose: async () => {
      const target = resolve(directory);
      if (!target.startsWith(join(root, '.test-artifacts-')))
        throw new Error('Unsafe test cleanup path');
      await rm(target, { recursive: true, force: true });
    },
  };
}
