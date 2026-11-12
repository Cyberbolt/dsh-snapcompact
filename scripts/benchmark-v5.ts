import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import {
  DEFAULT_API_URL,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DiskAttachments,
  OpenCodeAdapter,
  createMeter,
  estimateMessage,
  loadApiKey,
} from './benchmark-adapter.ts';
import { resolveConfig } from '../dist/config.js';
import { SnapcompactEngine } from '../dist/compaction/engine.js';
import { createRenderer } from '../dist/rendering/worker-client.js';
import { generateFixture, fixtureMeta } from '../dist/evaluation/v5/generator.js';
import { prepareV5Arms, runV5Suite } from '../dist/evaluation/v5/runner.js';
import type { V5ArmInput } from '../dist/evaluation/v5/runner.js';
import type { V5Preparation } from '../dist/evaluation/v5/types.js';
import { renderV5Report } from '../dist/evaluation/v5/report.js';

type Split = 'dev' | 'test';

interface CliOptions {
  readonly split: Split;
  readonly seed?: number;
  readonly runs: number;
  readonly share: number;
  readonly out: string;
  readonly generateOnly: boolean;
  readonly preflight: boolean;
  readonly degraded: boolean;
  readonly noNative: boolean;
  readonly arms?: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly apiUrl: string;
}

const DEV_SEED = 20261112;
const TEST_SEED = 20261113;

function usage(): string {
  return [
    'Usage: node --experimental-strip-types scripts/benchmark-v5.ts [options]',
    '  --split=dev|test       default dev; test is generated outside the repository',
    '  --seed=N               override the split seed',
    '  --runs=N               repeats per arm; default 1 (1-5)',
    '  --share=0.4            checkpoint share (0.25-0.5)',
    '  --out=PATH             output directory',
    '  --generate-only        write the fixture and print only its hash/counts',
    '  --preflight            same as --generate-only; no model call',
    '  --no-degraded          skip the degraded-renderer negative control',
    '  --no-native            skip the native-summary arm for fast iteration',
    '  --arms=a,b             run only the named arms (debug)',
    '  --provider=... --model=... --api-url=...',
  ].join('\n');
}

function parseNumber(value: string, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(name + ' must be a number from ' + min + ' to ' + max);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let split: Split = 'dev';
  let seed: number | undefined;
  let runs = 1;
  let share = 0.4;
  let out = '.artifacts/bench-v5/dev';
  let generateOnly = false;
  let preflight = false;
  let degraded = true;
  let noNative = false;
  let arms: string[] | undefined;
  let provider = process.env.SNAPCOMPACT_BENCH_PROVIDER ?? DEFAULT_PROVIDER;
  let model = process.env.SNAPCOMPACT_BENCH_MODEL ?? DEFAULT_MODEL;
  let apiUrl = process.env.SNAPCOMPACT_BENCH_API_URL ?? DEFAULT_API_URL;
  for (const arg of argv) {
    if (arg === '--generate-only') {
      generateOnly = true;
      continue;
    }
    if (arg === '--preflight') {
      preflight = true;
      continue;
    }
    if (arg === '--no-degraded') {
      degraded = false;
      continue;
    }
    if (arg === '--no-native') {
      noNative = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/u.exec(arg);
    if (match === null) throw new Error('Unknown argument: ' + arg + '\n' + usage());
    const [, key, value] = match;
    switch (key) {
      case 'split':
        if (value !== 'dev' && value !== 'test') throw new Error('split must be dev or test');
        split = value;
        if (value === 'test') out = '.artifacts/bench-v5/test';
        break;
      case 'seed':
        seed = parseNumber(value ?? '', 'seed', 1, Number.MAX_SAFE_INTEGER);
        if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
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
      case 'provider':
        provider = value ?? provider;
        break;
      case 'model':
        model = value ?? model;
        break;
      case 'api-url':
        apiUrl = value ?? apiUrl;
        break;
      case 'arms':
        arms = (value ?? '')
          .split(',')
          .map((arm) => arm.trim())
          .filter((arm) => arm.length > 0);
        if (arms.length === 0) throw new Error('arms must be a non-empty comma-separated list');
        break;
      default:
        throw new Error('Unknown argument: --' + key + '\n' + usage());
    }
  }
  return {
    split,
    ...(seed === undefined ? {} : { seed }),
    runs,
    share,
    out,
    generateOnly,
    preflight,
    degraded,
    noNative,
    ...(arms === undefined ? {} : { arms }),
    provider,
    model,
    apiUrl,
  };
}

function estimate(messages: readonly Message[]): {
  readonly chars: number;
  readonly tokens: number;
} {
  let chars = 0;
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateMessage(message);
    for (const block of message.content) {
      if (block.type === 'text') chars += block.text.length;
    }
  }
  return { chars, tokens };
}

function pixel(source: PNG, x: number, y: number): [number, number, number, number] {
  const index = (y * source.width + x) * 4;
  return [
    source.data[index] ?? 0,
    source.data[index + 1] ?? 0,
    source.data[index + 2] ?? 0,
    source.data[index + 3] ?? 255,
  ];
}

/** Downscale 50% then nearest-neighbor upscale: a deterministic renderer negative control. */
function degradePng(data: Uint8Array): Buffer {
  const source = PNG.sync.read(Buffer.from(data));
  const halfWidth = Math.max(1, Math.floor(source.width / 2));
  const halfHeight = Math.max(1, Math.floor(source.height / 2));
  const small = new PNG({ width: halfWidth, height: halfHeight });
  for (let y = 0; y < halfHeight; y += 1) {
    for (let x = 0; x < halfWidth; x += 1) {
      const [r, g, b, a] = pixel(
        source,
        Math.min(source.width - 1, x * 2),
        Math.min(source.height - 1, y * 2),
      );
      const index = (y * halfWidth + x) * 4;
      small.data[index] = r;
      small.data[index + 1] = g;
      small.data[index + 2] = b;
      small.data[index + 3] = a;
    }
  }
  const out = new PNG({ width: source.width, height: source.height });
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const [r, g, b, a] = pixel(
        small,
        Math.min(halfWidth - 1, Math.floor(x / 2)),
        Math.min(halfHeight - 1, Math.floor(y / 2)),
      );
      const index = (y * source.width + x) * 4;
      out.data[index] = r;
      out.data[index + 1] = g;
      out.data[index + 2] = b;
      out.data[index + 3] = a;
    }
  }
  return PNG.sync.write(out);
}

async function degradedArm(
  input: V5ArmInput,
  attachments: DiskAttachments,
): Promise<{ readonly arm: V5ArmInput; readonly preparation: V5Preparation }> {
  const started = performance.now();
  const first = input.messages[0];
  if (first === undefined) throw new Error('The visual arm has no checkpoint message.');
  const blocks: ContentBlock[] = [];
  let imageIndex = 0;
  for (const block of first.content) {
    if (block.type === 'text' && block.text.startsWith('Exact-token index (deterministic;')) {
      continue;
    }
    if (block.type !== 'image') {
      blocks.push(block);
      continue;
    }
    imageIndex += 1;
    if (imageIndex % 2 === 0) continue;
    const { data } = await attachments.readImage(block.attachment);
    const refs = await attachments.saveImages([
      { data: degradePng(data), mediaType: 'image/png', name: 'snapcompact-degraded.png' },
    ]);
    const ref = refs[0];
    if (ref === undefined) throw new Error('Degraded image was not stored.');
    blocks.push({ type: 'image', attachment: ref });
  }
  blocks.unshift({
    type: 'text',
    text:
      'Degraded visual checkpoint: every frame is downscaled 50%, every other frame is kept, ' +
      'and the exact-token index is omitted. Read only the frames.',
  });
  return {
    arm: {
      ...input,
      arm: 'degraded-visual',
      messages: [{ ...first, content: blocks }],
    },
    preparation: {
      elapsedMs: performance.now() - started,
      frames: imageIndex === 0 ? 0 : Math.ceil(imageIndex / 2),
      ...(input.checkpointTokens === undefined ? {} : { checkpointTokens: input.checkpointTokens }),
    },
  };
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
  const seed = options.seed ?? (options.split === 'test' ? TEST_SEED : DEV_SEED);
  const fixture = generateFixture(seed);
  const meta = fixtureMeta(fixture, estimate);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
  console.log(
    'fixture=' +
      meta.id +
      ' seed=' +
      meta.seed +
      ' hash=' +
      meta.hash +
      ' questions=' +
      meta.questions +
      ' turns=' +
      meta.turns +
      ' messages=' +
      meta.messages +
      ' chars=' +
      meta.sourceChars +
      ' tokens=' +
      meta.estimatedSourceTokens,
  );
  if (options.generateOnly || options.preflight) return;

  const apiKey = await loadApiKey();
  const directory = await mkdtemp(join(tmpdir(), 'snapcompact-v5-'));
  const attachments = new DiskAttachments(directory);
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  llm.registerAdapter([options.provider], new OpenCodeAdapter(attachments, apiKey, options.apiUrl));
  ctx.reflect.provide('attachments', attachments);
  ctx.reflect.provide('sessions', { flush: async () => true });
  ctx.reflect.provide('tokenMeter', createMeter());
  const session = Session.create(SessionId('session-v5-' + Date.now()));
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
  const settings = resolveConfig({
    budget: { checkpointShare: options.share },
    rendering: { maxFrames: 40 },
  });
  const renderer = createRenderer();
  const lifetime = new AbortController();
  const engine = new SnapcompactEngine(ctx, settings, renderer, lifetime.signal);
  const summarize = (
    input: Parameters<typeof engine.nativeSummaryForEvaluation>[0],
    owner: Agent,
    signal?: AbortSignal,
  ) => engine.nativeSummaryForEvaluation(input, owner, signal);
  const render = (
    text: string,
    renderOptions: Parameters<typeof renderer.render>[1],
    signal: AbortSignal,
  ) => renderer.render(text, renderOptions, signal);
  const signal = new AbortController().signal;
  try {
    const prepared = await prepareV5Arms({
      ctx,
      agent,
      route: { provider: options.provider, model: options.model },
      fixture,
      settings,
      signal,
      skipNative: options.noNative,
      onProgress: (message) => console.log('[progress] ' + message),
      summarize,
      render,
    });
    const visual = prepared.arms.find((arm) => arm.arm === 'pure-visual');
    const selected =
      options.arms === undefined
        ? prepared.arms
        : prepared.arms.filter((arm) => options.arms?.includes(arm.arm) === true);
    if (selected.length === 0) throw new Error('No selected arms are available.');
    const extraArms: V5ArmInput[] = [];
    let degradedPreparation: V5Preparation = { elapsedMs: 0, reason: 'not run' };
    if (
      options.degraded &&
      options.arms?.includes('degraded-visual') !== false &&
      visual !== undefined &&
      visual.skipReason === undefined
    ) {
      const degraded = await degradedArm(visual, attachments);
      extraArms.push(degraded.arm);
      degradedPreparation = degraded.preparation;
    }
    const { report } = await runV5Suite({
      ctx,
      agent,
      route: { provider: options.provider, model: options.model },
      fixture,
      settings,
      signal,
      summarize,
      render,
      runs: options.runs,
      prepared: { ...prepared, arms: selected },
      extraArms,
      degradedPreparation,
      reproducible: true,
      onArmStart: (arm) => {
        if (arm === 'gold-text') {
          delete process.env.SNAPCOMPACT_BENCH_REASONING;
        } else {
          process.env.SNAPCOMPACT_BENCH_REASONING = 'low';
        }
      },
      onProgress: (message) => console.log('[progress] ' + message),
    });
    const markdown = renderV5Report(report);
    const reportHash = createHash('sha256')
      .update(JSON.stringify(report, (key, value) => (key === 'timestamp' ? undefined : value)))
      .digest('hex');
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(join(outDir, 'report.md'), markdown + '\n');
    await writeFile(join(outDir, 'report.sha256'), reportHash + '\n');
    await writeFile(
      join(outDir, 'run.log'),
      [
        'fixture=' + meta.id,
        'fixtureHash=' + meta.hash,
        'reportHash=' + reportHash,
        'split=' + options.split,
        'seed=' + seed,
        'runs=' + options.runs,
        'share=' + options.share,
        'provider=' + options.provider,
        'model=' + options.model,
        'degraded=' + options.degraded,
        'reasoning=low (gold: default)',
      ].join('\n') + '\n',
    );
    console.log(markdown);
    console.log('reportHash=' + reportHash);
    const failed =
      report.gates.some((gate) => !gate.pass) || report.instrument.some((check) => !check.pass);
    if (failed) process.exitCode = 1;
  } finally {
    lifetime.abort(new Error('Benchmark finished.'));
    await renderer.dispose();
  }
}

await main();
