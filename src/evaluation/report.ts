import type { EvaluationReport } from './runner.js';

export function renderEvaluationReport(report: EvaluationReport): string {
  const rows = report.arms.map(
    (arm) =>
      `| ${arm.name} | ${arm.status} | ${arm.correct ?? '—'}/${arm.total} | ` +
      `${arm.promptTokens ?? '未实测'} | ${Math.round(arm.elapsedMs)} | ${arm.reason ?? ''} |`,
  );
  return [
    '# Snapcompact 对照评测',
    '',
    `模型：${report.provider}/${report.model}；语料：${report.fixture}；时间：${report.timestamp}`,
    '',
    '| 方案 | 状态 | 精确匹配 | 实际 prompt token | 请求耗时 ms | 说明 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `摘要调用额外 usage：${JSON.stringify(report.summaryUsage ?? '未提供')}`,
    '',
    report.warning,
  ].join('\n');
}
