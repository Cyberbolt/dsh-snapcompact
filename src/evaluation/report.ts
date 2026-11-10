import type { EvaluationReport } from './runner.js';

export function renderEvaluationReport(report: EvaluationReport): string {
  const rows = report.arms.map(
    (arm) =>
      `| ${arm.name} | ${arm.status} | ${arm.correct ?? '—'}/${arm.total} | ` +
      `${arm.promptTokens ?? '未实测'} | ${Math.round(arm.elapsedMs)} | ${arm.reason ?? ''} |`,
  );
  const missed = report.arms.flatMap((arm) => {
    if (arm.missed === undefined || arm.missed.length === 0) return [];
    const shown = arm.missed.slice(0, 20);
    const suffix = arm.missed.length > shown.length ? ` …（共 ${arm.missed.length} 题）` : '';
    return [`- ${arm.name}：${shown.join('、')}${suffix}`];
  });
  return [
    '# Snapcompact 对照评测',
    '',
    `模型：${report.provider}/${report.model}；语料：${report.fixture}；时间：${report.timestamp}`,
    '',
    '| 方案 | 状态 | 精确匹配 | 实际 prompt token | 请求耗时 ms | 说明 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    ...(missed.length > 0 ? ['', '**未命中题键：**', ...missed] : ['']),
    `摘要调用额外 usage：${JSON.stringify(report.summaryUsage ?? '未提供')}`,
    `视觉帧数：${report.arms.find((arm) => arm.name === 'snapcompact')?.frames ?? '未生成'}；计价来源：${report.pricingSource ?? '未测量'}`,
    '',
    report.warning,
  ].join('\n');
}
