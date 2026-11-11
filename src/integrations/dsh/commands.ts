import type { Context } from '@deepseek-ai/cordis';
import type { ArchiveService } from '../../archives/service.js';
import type { SnapcompactEngine } from '../../compaction/engine.js';
import type { ArchiveIndex } from './archive-projection.js';
import { evaluate } from '../../evaluation/runner.js';
import { renderEvaluationReport } from '../../evaluation/report.js';
import { formatStatus } from './status.js';

const USAGE =
  '用法：/snapcompact status | benchmark [1-5]。手动压缩请用 /compact；benchmark 使用合成语料。';
const MAX_BENCHMARK_RUNS = 5;

/** Parse only the benchmark command family; null means another action. */
export function parseBenchmarkRuns(input: string): { runs: number } | { error: string } | null {
  if (!input.startsWith('benchmark')) return null;
  if (input === 'benchmark') return { runs: 1 };
  const match = /^benchmark\s+(\d+)$/.exec(input);
  if (match === null) return { error: USAGE };
  const runs = Number(match[1]);
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_BENCHMARK_RUNS) return { error: USAGE };
  return { runs };
}

export function registerCommands(
  ctx: Context,
  engine: SnapcompactEngine,
  archives: ArchiveService,
  index: ArchiveIndex,
  lifetime: AbortSignal,
): void {
  ctx.commands.register({
    name: 'snapcompact',
    description: '查看压缩状态，或运行合成语料对照评测；手动压缩请用 /compact。',
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
          text: await formatStatus(ctx, engine.settings, engine.config, index, agent, signal),
        };
      }
      const benchmark = parseBenchmarkRuns(action);
      if (benchmark !== null) {
        if ('error' in benchmark) return { kind: 'error', text: benchmark.error };
        const report = await evaluate(
          ctx,
          agent,
          engine.settings,
          archives,
          (input, owner, abort) => engine.nativeSummaryForEvaluation(input, owner, abort),
          (text, options, abort) => engine.renderer.render(text, options, abort),
          signal,
          { runs: benchmark.runs },
        );
        return {
          kind: 'success',
          text: `${renderEvaluationReport(report)}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``,
        };
      }
      return { kind: 'error', text: USAGE };
    },
  });
}
