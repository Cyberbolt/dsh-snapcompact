import { describe, expect, it } from 'vitest';
import { renderEvaluationReport, renderSessionReport } from './report.js';
import { aggregateArm } from './scoring.js';
import type {
  ArmRun,
  EvaluationArm,
  EvaluationReport,
  QuestionOutcome,
  Region,
  SessionArm,
  SessionReport,
} from './types.js';

function outcome(key: string, region: Region, correct: boolean): QuestionOutcome {
  return {
    key,
    question: 'question ' + key,
    expected: 'expected-' + key,
    accepted: [],
    given: correct ? 'expected-' + key : 'wrong-answer',
    region,
    declaredRegion: region,
    kind: 'identifier',
    correct,
    exact: correct,
    archiveContains: true,
  };
}

function run(correct: boolean): ArmRun {
  return {
    run: 1,
    status: 'measured',
    correct: correct ? 3 : 2,
    exactCorrect: correct ? 3 : 2,
    total: 3,
    missed: correct ? [] : ['middle'],
    exactMissed: correct ? [] : ['middle'],
    outcomes: [
      outcome('head', 'head', true),
      outcome('middle', 'middle', correct),
      outcome('tail', 'tail', true),
    ],
    usage: { inputTokens: 10, outputTokens: 5 },
    promptTokens: 10,
    outputTokens: 5,
    elapsedMs: 1,
    parseMode: 'raw',
  };
}

function arm(name: EvaluationArm['name'], correct: boolean): EvaluationArm {
  return aggregateArm(name, 3, [run(correct)]);
}

const report: EvaluationReport = {
  version: 3,
  fixture: 'test-fixture',
  provider: 'test',
  model: 'text',
  timestamp: '2026-01-01T00:00:00.000Z',
  runs: 1,
  arms: [
    arm('original', true),
    arm('native-text', true),
    arm('snapcompact', false),
    arm('snapcompact-recall', true),
  ],
  archiveCoverage: { correct: 3, total: 3 },
  summaryGeneration: { elapsedMs: 5, usage: { inputTokens: 40, outputTokens: 10 } },
  visualPreparation: {
    elapsedMs: 2,
    frames: 2,
    checkpointTokens: 800,
    budgetTokens: 900,
    overBudget: false,
  },
  usageAudit: {
    requests: 2,
    inputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 15,
    reportedTotalTokens: 65,
    computedTotalTokens: 65,
    unreportedPromptTokens: 0,
    complete: true,
  },
  warning: 'Synthetic fixture warning.',
};

describe('evaluation report', () => {
  it('renders split accuracy, cost, recall and missed answers', () => {
    const text = renderEvaluationReport(report);
    expect(text).toContain('# Snapcompact 对照评测 v4');
    expect(text).toContain('## 准确性压力测试');
    expect(text).toContain('| original |');
    expect(text).toContain('## 用量与相对成本（诊断）');
    expect(text).toContain('## Usage 审计');
    expect(text).toContain('## Recall 路径');
    expect(text).toContain('## 未命中');
    expect(text).toContain('expected=expected-middle');
    expect(text).toContain('given=wrong-answer');
    expect(text).toContain('归档完整性：3/3');
    expect(text).toContain('Synthetic fixture warning.');
  });

  it('does not dump every passing raw answer into Markdown', () => {
    const text = renderEvaluationReport(report);
    expect(text).not.toContain('given=expected-head');
  });
});

const skippedSessionArm = (name: SessionArm['name']): SessionArm => ({
  name,
  status: 'skipped',
  turns: [],
  peakPromptTokens: 0,
  promptTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  weightedCost: 0,
  correct: 0,
  total: 8,
  rounds: 0,
  recallCalls: 0,
  recallBytes: 0,
  reason: 'unavailable in this fixture',
});

const sessionReport: SessionReport = {
  version: 1,
  fixture: 'long-test',
  provider: 'test',
  model: 'vision',
  timestamp: '2026-01-01T00:00:00.000Z',
  run: 1,
  schedule: ['plain', 'plain', 'light', 'plain', 'heavy', 'plain'],
  arms: [
    skippedSessionArm('original'),
    skippedSessionArm('native-text'),
    skippedSessionArm('snapcompact'),
    skippedSessionArm('snapcompact-recall'),
  ],
  usageAudit: {
    requests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reportedTotalTokens: 0,
    computedTotalTokens: 0,
    unreportedPromptTokens: 0,
    complete: true,
  },
  capacity: [],
  sensitivity: [],
  attribution: {
    checkpointResendTokens: 0,
    toolPageTokens: 0,
    otherPromptTokens: 0,
    outputTokens: 0,
  },
  warning: 'Session fixture warning.',
};

describe('session report', () => {
  it('renders the cost, sensitivity, attribution and capacity sections', () => {
    const text = renderSessionReport(sessionReport);
    expect(text).toContain('# Snapcompact 长会话成本 v4');
    expect(text).toContain('## 会话成本（33% 检索轮）');
    expect(text).toContain('| snapcompact-recall | skipped |');
    expect(text).toContain('## 敏感性（0% / 33% / 100% 检索轮）');
    expect(text).toContain('## Recall 归因');
    expect(text).toContain('## 容量（确定性估算）');
    expect(text).toContain('## Usage 审计');
    expect(text).toContain('Session fixture warning.');
  });
});
