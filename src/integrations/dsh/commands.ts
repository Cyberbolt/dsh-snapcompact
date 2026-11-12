import type { Context } from '@deepseek-ai/cordis';
import type { SnapcompactEngine } from '../../compaction/engine.js';
import { generateFixture } from '../../evaluation/v5/generator.js';
import { runV5Suite } from '../../evaluation/v5/runner.js';
import { renderV5Report } from '../../evaluation/v5/report.js';
import { formatStatus } from './status.js';

const USAGE =
  '用法：/snapcompact status | benchmark [1-5]。' +
  '手动压缩请用 /compact；benchmark 使用生成的 dev 语料，会启动模型请求并产生费用。';
const MAX_BENCHMARK_RUNS = 5;
const DEV_SEED = 20261112;

export type BenchmarkRequest = { readonly kind: 'accuracy'; readonly runs: number };

/** Parse only the benchmark command family; null means another action. */
export function parseBenchmarkRequest(
  input: string,
): BenchmarkRequest | { readonly error: string } | null {
  if (!input.startsWith('benchmark')) return null;
  if (input === 'benchmark') return { kind: 'accuracy', runs: 1 };
  const accuracy = /^benchmark\s+(\d+)$/.exec(input);
  if (accuracy !== null) {
    const runs = Number(accuracy[1]);
    if (!Number.isInteger(runs) || runs < 1 || runs > MAX_BENCHMARK_RUNS) return { error: USAGE };
    return { kind: 'accuracy', runs };
  }
  return { error: USAGE };
}

export function registerCommands(
  ctx: Context,
  engine: SnapcompactEngine,
  lifetime: AbortSignal,
): void {
  ctx.commands.register({
    name: 'snapcompact',
    description:
      '查看压缩状态，或运行生成的 task-level 对照评测（dev 划分）；手动压缩请用 /compact。',
    input: { hint: 'status | benchmark [1-5]' },
    handler: async ({ agent, rawInput, signal: requestSignal }) => {
      const signal = AbortSignal.any([requestSignal, lifetime]);
      const action = rawInput.trim() || 'status';
      signal.throwIfAborted();
      if (action === 'run') {
        return {
          kind: 'error',
          text: '手动压缩请直接使用 /compact；/snapcompact 只提供 status 和 benchmark。',
        };
      }
      if (action === 'status') {
        return {
          kind: 'success',
          text: await formatStatus(ctx, engine.settings, engine.config, agent, signal),
        };
      }
      const benchmark = parseBenchmarkRequest(action);
      if (benchmark !== null) {
        if ('error' in benchmark) return { kind: 'error', text: benchmark.error };
        const header = agent.session.requestHeader();
        const route = header?.config ?? agent.options;
        if (!route.provider || !route.model) {
          return { kind: 'error', text: '请先选择一个支持视觉输入的模型路由。' };
        }
        const fixture = generateFixture(DEV_SEED);
        const { report } = await runV5Suite({
          ctx,
          agent,
          route: { provider: route.provider, model: route.model },
          fixture,
          settings: engine.settings,
          signal,
          summarize: (input, owner, abort) =>
            engine.nativeSummaryForEvaluation(input, owner, abort),
          render: (text, options, abort) => engine.renderer.render(text, options, abort),
          runs: benchmark.runs,
        });
        return { kind: 'success', text: renderV5Report(report) };
      }
      return { kind: 'error', text: USAGE };
    },
  });
}
