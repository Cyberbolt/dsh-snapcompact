import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../config.js';
import { buildFixtureMessages, classifyQuestionRegions, loadFixture } from './fixture.js';
import { aggregateArm, buildOutcomes, normalizeAnswer, parseAnswerObject } from './scoring.js';
import type { ArmRun } from './types.js';

const config = resolveConfig({});

describe('benchmark scoring', () => {
  it('trims outer whitespace but preserves internal indentation', () => {
    expect(normalizeAnswer('  value  ')).toBe('value');
    expect(normalizeAnswer('def f():\n    return 1')).toBe('def f():\n    return 1');
  });

  it('recovers strict, fenced and brace-delimited JSON objects', () => {
    expect(parseAnswerObject('{"a":"b"}')).toEqual({ answers: { a: 'b' }, mode: 'raw' });
    expect(parseAnswerObject('prefix\n```json\n{"a":"b"}\n```')).toMatchObject({
      answers: { a: 'b' },
      mode: 'extracted',
    });
    expect(parseAnswerObject('noise {"a":"b"} tail')).toMatchObject({
      answers: { a: 'b' },
      mode: 'extracted',
    });
    expect(parseAnswerObject('not json')).toEqual({ answers: {}, mode: 'failed' });
  });

  it('accepts a fixture-declared equivalent spelling without making it exact', async () => {
    const fixture = await loadFixture();
    const messages = buildFixtureMessages(fixture);
    const { serialized, regions } = classifyQuestionRegions(
      fixture,
      messages,
      config.serialization,
    );
    const outcomes = buildOutcomes(
      fixture,
      { h_constraint: '用户约束：未经确认禁止删除归档；默认语言为简体中文。' },
      regions,
      serialized,
    );
    const constraint = outcomes.find((outcome) => outcome.key === 'h_constraint');
    expect(constraint).toMatchObject({ correct: true, exact: false, archiveContains: true });
  });

  it('ignores one terminal period from quoting the source sentence', async () => {
    const fixture = await loadFixture();
    const messages = buildFixtureMessages(fixture);
    const { serialized, regions } = classifyQuestionRegions(
      fixture,
      messages,
      config.serialization,
    );
    const outcomes = buildOutcomes(
      fixture,
      { m_build: '20270131.4.', t_next: 'run integration tests' },
      regions,
      serialized,
    );
    const build = outcomes.find((outcome) => outcome.key === 'm_build');
    expect(build).toMatchObject({ correct: true, exact: false });
    // The period rule never forgives a missing clause.
    const next = outcomes.find((outcome) => outcome.key === 't_next');
    expect(next?.correct).toBe(false);
  });

  it('aggregates per-run totals and pools regions', async () => {
    const fixture = await loadFixture();
    const messages = buildFixtureMessages(fixture);
    const { serialized, regions } = classifyQuestionRegions(
      fixture,
      messages,
      config.serialization,
    );
    const answers = Object.fromEntries(
      Object.entries(fixture.questions).map(([key, question]) => [key, question.answer]),
    );
    const outcomes = buildOutcomes(fixture, answers, regions, serialized);
    const run = (index: number, wrong: number): ArmRun => ({
      run: index,
      status: 'measured',
      correct: 40 - wrong,
      exactCorrect: 40 - wrong,
      total: 40,
      missed: [],
      exactMissed: [],
      outcomes: outcomes.map((outcome, position) =>
        position < wrong ? { ...outcome, correct: false, exact: false } : outcome,
      ),
      elapsedMs: 1,
    });
    const arm = aggregateArm('snapcompact', 40, [run(1, 0), run(2, 4)]);
    expect(arm.score.accepted).toEqual({ mean: 38, min: 36, max: 40 });
    expect(arm.score.byRegion.middle.total).toBe(40);
    expect(arm.measuredRuns).toBe(2);
  });
});
