import type { Fixture } from './fixture.js';
import type {
  ArmName,
  ArmRun,
  ArmScore,
  EvaluationArm,
  ParseMode,
  QuestionOutcome,
  Region,
  RegionTally,
} from './types.js';

/** Trim only; internal whitespace and code indentation remain significant. */
export function normalizeAnswer(text: string): string {
  return text.trim();
}

/**
 * Quoting a whole source sentence appends that sentence's terminal period. That
 * is punctuation, not a different fact, so the accepted comparison drops one.
 */
export function withoutTerminalPeriod(text: string): string {
  return /[.。]$/u.test(text) ? text.slice(0, -1) : text;
}

/** Canonical answer plus every fixture-declared equivalent spelling. */
export function acceptedAnswers(question: Fixture['questions'][string]): string[] {
  return [question.answer, ...question.accept].map(normalizeAnswer);
}

/** JSON recovery: strict object first, then a fenced or brace-delimited object. */
export function parseAnswerObject(text: string): {
  answers: Record<string, string>;
  mode: ParseMode;
} {
  const raw = text.trim();
  const object = (value: string): Record<string, string> | undefined => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
      const answers: Record<string, string> = {};
      for (const [key, answer] of Object.entries(parsed)) {
        if (typeof answer === 'string') answers[key] = answer;
      }
      return answers;
    } catch {
      return undefined;
    }
  };

  const direct = object(raw);
  if (direct !== undefined) return { answers: direct, mode: 'raw' };

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced?.[1] !== undefined) {
    const extracted = object(fenced[1].trim());
    if (extracted !== undefined) return { answers: extracted, mode: 'extracted' };
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const extracted = object(raw.slice(start, end + 1));
    if (extracted !== undefined) return { answers: extracted, mode: 'extracted' };
  }
  return { answers: {}, mode: 'failed' };
}

/** Score one parsed answer object against the fixture, optionally only selected keys. */
export function buildOutcomes(
  fixture: Fixture,
  answers: Readonly<Record<string, string>>,
  regions: ReadonlyMap<string, Region>,
  transcript: string,
  keys?: readonly string[],
): QuestionOutcome[] {
  const outcomes: QuestionOutcome[] = [];
  for (const [key, question] of Object.entries(fixture.questions)) {
    if (keys !== undefined && !keys.includes(key)) continue;
    const given = answers[key] ?? null;
    const normalized = given === null ? null : normalizeAnswer(given);
    const accepted = acceptedAnswers(question);
    const bare = normalized === null ? null : withoutTerminalPeriod(normalized);
    const region = regions.get(key) ?? 'unknown';
    outcomes.push({
      key,
      question: question.question,
      expected: question.answer,
      accepted: question.accept,
      given,
      region,
      declaredRegion: question.region,
      kind: question.kind,
      correct:
        normalized !== null &&
        (accepted.includes(normalized) ||
          (bare !== null && accepted.some((answer) => withoutTerminalPeriod(answer) === bare))),
      exact: normalized !== null && normalized === normalizeAnswer(question.answer),
      archiveContains: transcript.includes(question.source),
    });
  }
  return outcomes;
}

function range(values: readonly number[]): { mean: number; min: number; max: number } {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  return {
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

const EMPTY_TALLY: RegionTally = { correct: 0, total: 0 };

/** Aggregate runs pooled by region/kind and per-run totals as mean/min/max. */
export function aggregateArm(name: ArmName, total: number, runs: readonly ArmRun[]): EvaluationArm {
  const measured = runs.filter((run) => run.status === 'measured');
  const byRegion: Record<Region, RegionTally> = {
    head: { ...EMPTY_TALLY },
    middle: { ...EMPTY_TALLY },
    tail: { ...EMPTY_TALLY },
    unknown: { ...EMPTY_TALLY },
  };
  const byKind: Record<string, RegionTally> = {};
  for (const run of measured) {
    for (const outcome of run.outcomes) {
      const region = byRegion[outcome.region];
      byRegion[outcome.region] = {
        correct: region.correct + (outcome.correct ? 1 : 0),
        total: region.total + 1,
      };
      const kind = (byKind[outcome.kind] ??= { ...EMPTY_TALLY });
      byKind[outcome.kind] = {
        correct: kind.correct + (outcome.correct ? 1 : 0),
        total: kind.total + 1,
      };
    }
  }
  const score: ArmScore = {
    accepted: range(measured.map((run) => run.correct)),
    exact: range(measured.map((run) => run.exactCorrect)),
    byRegion,
    byKind,
  };
  return {
    name,
    total,
    measuredRuns: measured.length,
    runs,
    score,
  };
}
