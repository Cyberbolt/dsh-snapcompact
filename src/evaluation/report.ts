import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import { WEIGHTED_COST } from './usage.js';
import type {
  EvaluationArm,
  EvaluationReport,
  QuestionOutcome,
  Region,
  SessionArm,
  SessionReport,
  UsageAudit,
} from './types.js';

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

interface Counts {
  readonly requests: number;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
}

const ZERO: Counts = { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

function countsOf(usage: TokenUsage | undefined): Counts {
  if (usage === undefined) return ZERO;
  return {
    requests: 1,
    input: usage.inputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    output: usage.outputTokens,
  };
}

function countsOfAudit(audit: UsageAudit | undefined): Counts {
  if (audit === undefined) return ZERO;
  return {
    requests: audit.requests,
    input: audit.inputTokens,
    cacheRead: audit.cacheReadTokens,
    cacheWrite: audit.cacheWriteTokens,
    output: audit.outputTokens,
  };
}

function addCounts(left: Counts, right: Counts): Counts {
  return {
    requests: left.requests + right.requests,
    input: left.input + right.input,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    output: left.output + right.output,
  };
}

function divideCounts(counts: Counts, divisor: number): Counts {
  if (divisor <= 0) return counts;
  return {
    requests: counts.requests / divisor,
    input: counts.input / divisor,
    cacheRead: counts.cacheRead / divisor,
    cacheWrite: counts.cacheWrite / divisor,
    output: counts.output / divisor,
  };
}

function weighted(counts: Counts): number {
  return (
    counts.input * WEIGHTED_COST.input +
    counts.cacheRead * WEIGHTED_COST.cacheRead +
    counts.cacheWrite * WEIGHTED_COST.cacheWrite +
    counts.output * WEIGHTED_COST.output
  );
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
    `| recall 模型请求（每次运行均值） | ${rounds.toFixed(1)} |`,
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

function usageRows(report: EvaluationReport): string[] {
  const generation =
    report.summaryGeneration.usage === undefined
      ? ZERO
      : divideCounts(countsOf(report.summaryGeneration.usage), report.runs);
  return report.arms.map((arm) => {
    const measured = arm.runs.filter((run) => run.status === 'measured');
    const counts = divideCounts(
      measured
        .map((run) => (run.audit === undefined ? countsOf(run.usage) : countsOfAudit(run.audit)))
        .reduce(addCounts, ZERO),
      measured.length,
    );
    const withGeneration = arm.name === 'native-text' ? addCounts(counts, generation) : counts;
    return (
      `| ${arm.name} | ${statusText(arm, report.runs)} | ${withGeneration.input.toFixed(0)} | ` +
      `${withGeneration.cacheRead.toFixed(0)} | ${withGeneration.cacheWrite.toFixed(0)} | ` +
      `${withGeneration.output.toFixed(0)} | ${weighted(withGeneration).toFixed(0)} | ` +
      `${withGeneration.requests.toFixed(1)} |`
    );
  });
}

function auditLines(audit: UsageAudit): string[] {
  return [
    '## Usage 审计',
    '',
    `- 请求：${audit.requests}；input ${audit.inputTokens}；cache read ${audit.cacheReadTokens}；` +
      `cache write ${audit.cacheWriteTokens}；output ${audit.outputTokens}`,
    `- provider total：${audit.reportedTotalTokens}；映射合计：${audit.computedTotalTokens}；` +
      `未上报 prompt：${audit.unreportedPromptTokens}`,
    `- 结论：${audit.complete ? '通过' : '失败（该运行的数字不可用于比较）'}`,
    '',
  ];
}

export function renderEvaluationReport(report: EvaluationReport): string {
  return [
    '# Snapcompact 对照评测 v4',
    '',
    `模型：${report.provider}/${report.model}；语料：${report.fixture}；运行次数：${report.runs}；时间：${report.timestamp}`,
    '',
    '## 准确性压力测试',
    '',
    '| 方案 | 状态 | 接受匹配 | 严格匹配 | head | middle | tail | 有效运行 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.arms.map(
      (arm) =>
        `| ${arm.name} | ${statusText(arm, report.runs)} | ${scoreText(arm, 'accepted')} | ${scoreText(arm, 'exact')} | ` +
        `${regionText(arm, 'head')} | ${regionText(arm, 'middle')} | ${regionText(arm, 'tail')} | ${arm.measuredRuns}/${report.runs} |`,
    ),
    '',
    '本套件一次请求携带全部 40 题，用于准确率压力测试，不代表稳态会话成本。head/middle/tail 为多次有效运行合并后的计数；接受匹配包含 fixture 声明的等价写法。',
    '',
    '## 用量与相对成本（诊断）',
    '',
    '| 方案 | 状态 | input | cache read | cache write | output | 加权成本（相对） | 请求/运行 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...usageRows(report),
    '',
    '加权成本 = input + 0.1×cacheRead + 1.25×cacheWrite + 4×output；相对单位，不是账单。native-text 行按运行次数摊销一次摘要生成。',
    '',
    ...auditLines(report.usageAudit),
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
    '',
  ].join('\n');
}

function armStatus(arm: SessionArm): string {
  return arm.status;
}

function accuracyText(arm: SessionArm): string {
  if (arm.status !== 'measured') return '—';
  return `${arm.correct}/${arm.total}`;
}

function ratioText(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${(part / whole).toFixed(2)}×`;
}

function sessionArmRows(report: SessionReport): string[] {
  const original = report.arms.find((arm) => arm.name === 'original');
  const originalCost = original?.weightedCost ?? 0;
  return report.arms.map(
    (arm) =>
      `| ${arm.name} | ${armStatus(arm)} | ${arm.promptTokens.toFixed(0)} | ${arm.peakPromptTokens.toFixed(0)} | ` +
      `${arm.outputTokens.toFixed(0)} | ${arm.weightedCost.toFixed(0)} | ${ratioText(arm.weightedCost, originalCost)} | ` +
      `${accuracyText(arm)} | ${arm.rounds} | ${arm.recallCalls} | ${arm.recallBytes} |`,
  );
}

function sessionTurnRows(report: SessionReport): string[] {
  const rows: string[] = [];
  for (const arm of report.arms) {
    for (const turn of arm.turns) {
      rows.push(
        `| ${arm.name} | ${turn.index + 1} | ${turn.mode} | ${turn.promptTokens.toFixed(0)} | ` +
          `${turn.peakPromptTokens.toFixed(0)} | ${turn.outputTokens.toFixed(0)} | ${turn.weightedCost.toFixed(0)} | ${turn.rounds} | ` +
          `${turn.recallCalls} | ${turn.recallBytes} | ${turn.correct}/${turn.total} | ${turn.offSchedule ? 'yes' : 'no'} |`,
      );
    }
  }
  return rows;
}

function sensitivityRows(report: SessionReport): string[] {
  return report.sensitivity.map(
    (point) =>
      `| ${Math.round(point.recallRate * 100)}% | ${point.weightedCost.toFixed(0)} | ${point.ratioToOriginal.toFixed(2)}× | ${point.modeled ? 'modeled' : 'measured'} |`,
  );
}

function attributionRows(report: SessionReport): string[] {
  const total =
    report.attribution.otherPromptTokens +
    report.attribution.checkpointResendTokens +
    report.attribution.toolPageTokens;
  const percent = (value: number): string =>
    total <= 0 ? '—' : `${((value / total) * 100).toFixed(1)}%`;
  return [
    `| checkpoint 重发 | ${report.attribution.checkpointResendTokens.toFixed(0)} | ${percent(report.attribution.checkpointResendTokens)} |`,
    `| recall 工具页 | ${report.attribution.toolPageTokens.toFixed(0)} | ${percent(report.attribution.toolPageTokens)} |`,
    `| 其它 prompt | ${report.attribution.otherPromptTokens.toFixed(0)} | ${percent(report.attribution.otherPromptTokens)} |`,
    `| output | ${report.attribution.outputTokens.toFixed(0)} | — |`,
  ];
}

export function renderSessionReport(report: SessionReport): string {
  const recall = report.arms.find((arm) => arm.name === 'snapcompact-recall');
  return [
    '# Snapcompact 长会话成本 v4',
    '',
    `模型：${report.provider}/${report.model}；语料：${report.fixture}；运行：${report.run}；时间：${report.timestamp}`,
    '',
    '## 会话成本（33% 检索轮）',
    '',
    '| 方案 | 状态 | 6 轮 prompt | 峰值 prompt | output | 加权成本 | 相对 original | 准确率 | 请求 | 调用 | 工具字节 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...sessionArmRows(report),
    '',
    '每臂使用同一条持久历史：source/checkpoint 只在开头放一次，之后只追加问题、回答和 recall 工具页。加权成本为相对单位，不是账单。',
    '',
    ...report.arms
      .filter((arm) => arm.note !== undefined)
      .map((arm) => `- ${arm.name}：${arm.note}`),
    ...report.arms
      .filter((arm) => arm.reason !== undefined)
      .map((arm) => `- ${arm.name}：${arm.reason}`),
    '',
    '## 每轮明细',
    '',
    '| 方案 | 轮 | 类型 | prompt（累计） | 峰值 prompt | output | 加权成本 | 请求 | 调用 | 工具字节 | 正确 | off-schedule |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...sessionTurnRows(report),
    '',
    '## 敏感性（0% / 33% / 100% 检索轮）',
    '',
    '| 检索轮比例 | 加权成本 | 相对 original | 来源 |',
    '| --- | --- | --- | --- |',
    ...sensitivityRows(report),
    '',
    '0% 为纯视觉臂实测；33% 为当前 schedule 实测；100% 用实测 heavy/plain 轮次线性外推，标注 modeled。',
    '',
    '## Recall 归因',
    '',
    '| 项 | token（估算） | 占 prompt |',
    '| --- | --- | --- |',
    ...attributionRows(report),
    '',
    'checkpoint 重发 = 视觉 checkpoint 估算 × 模型请求数；工具页 = 工具载荷字节 ÷ 4；其它 prompt 为差额。',
    '',
    '## 容量（确定性估算）',
    '',
    '| source 字符 | source token（≈ chars/4） | original 装得下 | checkpoint token | 窗口 |',
    '| --- | --- | --- | --- | --- |',
    ...report.capacity.map(
      (point) =>
        `| ${point.sourceChars.toLocaleString('en-US')} | ${point.estimatedSourceTokens.toLocaleString('en-US')} | ${point.originalFits ? 'yes' : 'no'} | ${point.checkpointEstimatedTokens} | ${point.contextWindow.toLocaleString('en-US')} |`,
    ),
    '',
    ...auditLines(report.usageAudit),
    `recall 臂状态：${recall?.status ?? 'skipped'}；工具调用 ${recall?.recallCalls ?? 0} 次，工具载荷 ${recall?.recallBytes ?? 0} 字节。`,
    '',
    report.warning,
    '',
  ].join('\n');
}
