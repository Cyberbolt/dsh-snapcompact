import type { Context } from '@deepseek-ai/cordis';
import type { ArchiveService } from '../../archives/service.js';
import type { SnapcompactEngine } from '../../compaction/engine.js';
import type { ArchiveIndex } from './archive-projection.js';
import { evaluate } from '../../evaluation/runner.js';
import { renderEvaluationReport } from '../../evaluation/report.js';
import { formatStatus } from './status.js';

export function registerCommands(
  ctx: Context,
  engine: SnapcompactEngine,
  archives: ArchiveService,
  index: ArchiveIndex,
  lifetime: AbortSignal,
): void {
  ctx.commands.register({
    name: 'snapcompact',
    description: '检查压缩状态、立即压缩，或运行会产生模型调用费用的合成语料对照评测。',
    input: { hint: 'status | run | benchmark（最多四次辅助模型调用）' },
    handler: async ({ agent, rawInput, signal: requestSignal, commandId }) => {
      const signal = AbortSignal.any([requestSignal, lifetime]);
      const action = rawInput.trim() || 'status';
      signal.throwIfAborted();
      if (action === 'run') {
        const result = await engine.compactNow(agent, signal, commandId);
        return {
          kind: 'success',
          text: result
            ? `已压缩 ${result.shadowedSeqs.length} 个历史节点。原文可通过 snapcompact_recall 回查；节省量为估算，非计费测量。`
            : '没有可以安全压缩的历史区间。',
        };
      }
      if (action === 'status') {
        return {
          kind: 'success',
          text: await formatStatus(ctx, engine.settings, engine.config, index, agent, signal),
        };
      }
      if (action === 'benchmark') {
        const report = await evaluate(
          ctx,
          agent,
          engine.settings,
          archives,
          (input, owner, abort) => engine.nativeSummaryForEvaluation(input, owner, abort),
          (text, options, abort) => engine.renderer.render(text, options, abort),
          signal,
        );
        return {
          kind: 'success',
          text: `${renderEvaluationReport(report)}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``,
        };
      }
      return {
        kind: 'error',
        text: '用法：/snapcompact status | run | benchmark。benchmark 使用合成语料，最多产生四次模型调用费用。',
      };
    },
  });
}
