import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import { billedPromptTokens } from '../budgeting/pricing.js';
import type { EvaluationArm, EvaluationReport, QuestionOutcome, Region } from './types.js';

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function totalTokens(usage: TokenUsage | undefined): number {
  if (usage === undefined) return 0;
  return billedPromptTokens(usage) + usage.outputTokens;
}

function scoreText(arm: EvaluationArm, kind: 'accepted' | 'exact'): string {
  const range = arm.score[kind];
  if (arm.measuredRuns === 0) return '—';
  if (range.max === range.min) return `${range.mean}/${arm.total}`;
  return `${range.mean.toFixed(1)}/${arm.total} (${range.min}–${range.max})`;
}

function statusText(arm: EvaluationArm, runs: number): string {
  if (arm.measuredRuns === 0)
    return arm.runs.some((run) => run.status === 'failed') ? 'failed' : 'skipped';
  return arm.measuredRuns === runs ? 'measured' : `partial ${arm.measuredRuns}/${runs}`;
}

function regionText(arm: EvaluationArm, region: Region): string {
  const tally = arm.score.byRegion[region];
  if (tally.total === 0) return '—';
  return `${tally.correct}/${tally.total}`;
}

function runCost(arm: EvaluationArm): {
  prompt: number;
  output: number;
  elapsed: number;
} {
  const measured = arm.runs.filter((run) => run.status === 'measured');
  return {
    prompt: mean(measured.map((run) => run.promptTokens ?? 0)),
    output: mean(measured.map((run) => run.outputTokens ?? 0)),
    elapsed: mean(measured.map((run) => run.elapsedMs)),
  };
}

function truncate(value: string, limit = 160): string {
  const oneLine = value.replaceAll('\n', '\\n');
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, limit)}…`;
}

function missedLines(arm: EvaluationArm): string[] {
  const counts = new Map<string, { count: number; outcome: QuestionOutcome }>();
  const measured = arm.runs.filter((run) => run.status === 'measured');
  if (measured.length === 0) {
    const run = arm.runs.find((candidate) => candidate.reason !== undefined) ?? arm.runs[0];
    if (run === undefined) return [`- ${arm.name}：skipped`];
    return [`- ${arm.name}：${run.status}${run.reason === undefined ? '' : ` — ${run.reason}`}`];
  }
  for (const run of measured) {
    for (const outcome of run.outcomes) {
      if (outcome.correct) continue;
      const existing = counts.get(outcome.key);
      if (existing === undefined) counts.set(outcome.key, { count: 1, outcome });
      else existing.count += 1;
    }
  }
  if (counts.size === 0) return [`- ${arm.name}：无`];
  const lines = [`- ${arm.name}（${measured.length} 次有效运行）：`];
  for (const [key, entry] of [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(
      `  - \`${key}\` [${entry.outcome.region}/${entry.outcome.kind}] expected=${truncate(entry.outcome.expected)} given=${truncate(entry.outcome.given ?? '(missing)')} ×${entry.count}`,
    );
  }
  return lines;
}

function recallSummary(report: EvaluationReport): string[] {
  const visual = report.arms.find((arm) => arm.name === 'snapcompact');
  const recall = report.arms.find((arm) => arm.name === 'snapcompact-recall');
  if (visual === undefined || recall === undefined) return [];
  const measuredRecallRuns = recall.runs.filter((run) => run.status === 'measured');
  const calls = mean(measuredRecallRuns.map((run) => run.recallCalls ?? 0));
  const rounds = mean(measuredRecallRuns.map((run) => run.recallRounds ?? 0));
  const bytes = mean(measuredRecallRuns.map((run) => run.recallBytes ?? 0));
  const delta =
    recall.measuredRuns === 0 || visual.measuredRuns === 0
      ? '—'
      : (() => {
          const value = recall.score.accepted.mean - visual.score.accepted.mean;
          return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
        })();
  return [
    '## Recall 路径',
    '',
    '| 指标 | 值 |',
    '| --- | --- |',
    `| recall 工具调用（每次运行均值） | ${calls.toFixed(1)} |`,
    `| recall 模型轮次（每次运行均值） | ${rounds.toFixed(1)} |`,
    `| recall 工具载荷（每次运行均值，字节） | ${bytes.toFixed(0)} |`,
    `| accepted 变化（recall − OCR） | ${delta} |`,
    `| recall 臂 strict 匹配 | ${scoreText(recall, 'exact')} |`,
    ...(recall.measuredRuns === 0
      ? [
          `| recall 臂状态 | ${recall.runs[0]?.status ?? 'skipped'}${recall.runs[0]?.reason === undefined ? '' : ` — ${recall.runs[0].reason}`} |`,
        ]
      : []),
    '',
  ];
}

function costRows(report: EvaluationReport): string[] {
  return report.arms.map((arm) => {
    const cost = runCost(arm);
    const generation = arm.name === 'native-text' ? totalTokens(report.summaryGeneration.usage) : 0;
    return (
      `| ${arm.name} | ${generation} | ${cost.prompt.toFixed(0)} | ${(generation + cost.prompt + cost.output).toFixed(0)} | ` +
      `${(generation + 3 * cost.prompt).toFixed(0)} | ${arm.frames ?? '—'} | ${cost.elapsed.toFixed(0)} |`
    );
  });
}

export function renderEvaluationReport(report: EvaluationReport): string {
  const lines: string[] = [
    '# Snapcompact 对照评测 v3',
    '',
    `模型：${report.provider}/${report.model}；语料：${report.fixture}；运行次数：${report.runs}；时间：${report.timestamp}`,
    '',
    '## 准确性',
    '',
    '| 方案 | 状态 | 接受匹配 | 严格匹配 | head | middle | tail | 有效轮次 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.arms.map(
      (arm) =>
        `| ${arm.name} | ${statusText(arm, report.runs)} | ${scoreText(arm, 'accepted')} | ${scoreText(arm, 'exact')} | ` +
        `${regionText(arm, 'head')} | ${regionText(arm, 'middle')} | ${regionText(arm, 'tail')} | ${arm.measuredRuns}/${report.runs} |`,
    ),
    '',
    'head/middle/tail 为多次有效运行合并后的计数；接受匹配包含 fixture 声明的等价写法。',
    '',
    '## 成本',
    '',
    '| 方案 | 生成 token | 每轮读取 token | 本轮总 token | 3 轮上下文 token | 帧数 | 请求耗时 ms |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...costRows(report),
    '',
    '生成 token 只计入 native summary 的一次生成；视觉路径的生成成本为 0。图片 token 是估算，不是账单。',
    '',
    '## 归档与准备',
    '',
    `- 归档完整性：${report.archiveCoverage.correct}/${report.archiveCoverage.total} 道题的 source 可按字面找回`,
    ...(report.arms.some((arm) => arm.score.byRegion.unknown.total > 0)
      ? [
          `- 未能归区的题：${report.arms.reduce((total, arm) => total + arm.score.byRegion.unknown.total, 0)}（检查 fixture source 与 head/tail 配置）`,
        ]
      : []),
    `- 摘要生成：${report.summaryGeneration.failed ?? '完成'}；usage=${JSON.stringify(report.summaryGeneration.usage ?? '未提供')}；耗时 ${report.summaryGeneration.elapsedMs.toFixed(0)} ms`,
    `- 视觉准备：帧数=${report.visualPreparation.frames ?? '—'}；checkpoint=${report.visualPreparation.checkpointTokens ?? '—'} token；预算=${report.visualPreparation.budgetTokens ?? '—'} token；超预算=${report.visualPreparation.overBudget ?? '—'}；耗时 ${report.visualPreparation.elapsedMs.toFixed(0)} ms`,
    ...(report.visualPreparation.reason === undefined
      ? []
      : [`- 视觉跳过原因：${report.visualPreparation.reason}`]),
    '',
    ...recallSummary(report),
    '## 未命中',
    '',
    ...report.arms.flatMap((arm) => missedLines(arm)),
    '',
    report.warning,
  ];
  return lines.join('\n');
}
