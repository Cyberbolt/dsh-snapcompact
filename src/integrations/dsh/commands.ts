import type { Context } from '@deepseek-ai/cordis';
import type { ArchiveService } from '../../archives/service.js';
import type { SnapcompactEngine } from '../../compaction/engine.js';
import type { ArchiveIndex } from './archive-projection.js';
import { evaluate } from '../../evaluation/runner.js';
import { evaluateSession } from '../../evaluation/session.js';
import { renderEvaluationReport, renderSessionReport } from '../../evaluation/report.js';
import { formatStatus } from './status.js';

const USAGE =
  '用法：/snapcompact status | benchmark [1-5] | benchmark session [1-5]。' +
  '手动压缩请用 /compact；benchmark 使用合成语料，session 套件可能运行数分钟并产生费用。';
const MAX_BENCHMARK_RUNS = 5;

export type BenchmarkRequest =
  | { readonly kind: 'accuracy'; readonly runs: number }
  | { readonly kind: 'session'; readonly runs: number };

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
  if (input === 'benchmark session') return { kind: 'session', runs: 1 };
  const session = /^benchmark\s+session\s+(\d+)$/.exec(input);
  if (session !== null) {
    const runs = Number(session[1]);
    if (!Number.isInteger(runs) || runs < 1 || runs > MAX_BENCHMARK_RUNS) return { error: USAGE };
    return { kind: 'session', runs };
  }
  return { error: USAGE };
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
    description:
      '查看压缩状态，或运行合成语料对照评测（accuracy 或长会话 session）；手动压缩请用 /compact。',
    input: { hint: 'status | benchmark [1-5] | benchmark session [1-5]' },
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
      const benchmark = parseBenchmarkRequest(action);
      if (benchmark !== null) {
        if ('error' in benchmark) return { kind: 'error', text: benchmark.error };
        if (benchmark.kind === 'session') {
          const reports = await evaluateSession(
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
            text: `${reports.map(renderSessionReport).join('\n---\n')}\n\n\`\`\`json\n${JSON.stringify(reports, null, 2)}\n\`\`\``,
          };
        }
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
