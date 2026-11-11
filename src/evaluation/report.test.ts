import { describe, expect, it } from 'vitest';
import { renderEvaluationReport } from './report.js';
import { aggregateArm } from './scoring.js';
import type { ArmRun, EvaluationArm, EvaluationReport, QuestionOutcome, Region } from './types.js';

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
  version: 2,
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
  warning: 'Synthetic fixture warning.',
};

describe('evaluation report', () => {
  it('renders split accuracy, cost, recall and missed answers', () => {
    const text = renderEvaluationReport(report);
    expect(text).toContain('# Snapcompact 对照评测 v3');
    expect(text).toContain('## 准确性');
    expect(text).toContain('| original |');
    expect(text).toContain('## 成本');
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
