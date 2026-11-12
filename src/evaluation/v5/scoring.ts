import type { V5ParseMode, V5Question, V5QuestionOutcome, V5Rubric } from './types.js';

/**
 * Trim outer whitespace and one surrounding code/quote pair. The value itself
 * stays case- and separator-sensitive; Markdown fences are presentation, not
 * a different answer.
 */
export function normalizeExact(text: string): string {
  let value = text.trim();
  for (const [open, close] of [
    ['`', '`'],
    ['"', '"'],
    ["'", "'"],
  ] as const) {
    if (value.length >= 2 && value.startsWith(open) && value.endsWith(close)) {
      value = value.slice(1, -1).trim();
      break;
    }
  }
  return value;
}

/** A quoted source sentence may append one terminal period; that is punctuation. */
export function withoutTerminalPeriod(text: string): string {
  return /[.。]$/u.test(text) ? text.slice(0, -1) : text;
}

/** Recover one JSON object from a model answer. */
export function parseAnswerObject(text: string): {
  readonly answers: Readonly<Record<string, string>>;
  readonly mode: V5ParseMode;
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
  const fenced = /\x60{3}(?:json)?\s*([\s\S]*?)\x60{3}/iu.exec(raw);
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

function exactPass(rubric: Extract<V5Rubric, { kind: 'exact' }>, given: string): boolean {
  const normalized = normalizeExact(given);
  const bare = withoutTerminalPeriod(normalized);
  return rubric.accept.some(
    (accepted) =>
      normalizeExact(accepted) === normalized ||
      withoutTerminalPeriod(normalizeExact(accepted)) === bare,
  );
}

function literalPass(rubric: Extract<V5Rubric, { kind: 'all' | 'any' }>, given: string): boolean {
  const normalized = given.toLocaleLowerCase('en-US');
  const forbidden = rubric.forbidden.some((token) =>
    normalized.includes(token.toLocaleLowerCase('en-US')),
  );
  if (forbidden) return false;
  if (rubric.kind === 'all') {
    return rubric.required.every((token) => normalized.includes(token.toLocaleLowerCase('en-US')));
  }
  return rubric.anyOf.some((token) => normalized.includes(token.toLocaleLowerCase('en-US')));
}

export function rubricPass(rubric: V5Rubric, given: string | null): boolean {
  if (given === null) return false;
  if (rubric.kind === 'exact') return exactPass(rubric, given);
  return literalPass(rubric, given);
}

/** Levenshtein edit distance over Unicode code points. */
export function editDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1);
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] ?? 0) + 1;
      const deletion = (previous[j] ?? 0) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

export function scoreQuestion(
  question: V5Question,
  given: string | null,
  region: {
    readonly region: 'head' | 'middle' | 'tail' | 'multi' | 'unknown';
    readonly primaryRegion: 'head' | 'middle' | 'tail' | 'unknown';
  },
): V5QuestionOutcome {
  const correct = rubricPass(question.rubric, given);
  const normalizedGiven = given === null ? null : normalizeExact(given);
  return {
    key: question.key,
    turn: question.turn,
    question: question.question,
    expected: question.answer,
    given: normalizedGiven,
    kind: question.kind,
    tags: question.tags,
    region: region.region,
    primaryRegion: region.primaryRegion,
    correct,
    charErrors: normalizedGiven === null ? null : editDistance(question.answer, normalizedGiven),
    charTotal: [...question.answer].length,
  };
}

/** Character classes used by the per-class error report. */
export type CharacterClass = 'uppercase' | 'lowercase' | 'digit' | 'punctuation' | 'cjk' | 'other';

export function characterClass(character: string): CharacterClass {
  if (/\p{Script=Han}/u.test(character)) return 'cjk';
  if (/[A-Z]/u.test(character)) return 'uppercase';
  if (/[a-z]/u.test(character)) return 'lowercase';
  if (/[0-9]/u.test(character)) return 'digit';
  if (/\p{P}/u.test(character)) return 'punctuation';
  return 'other';
}

/** Approximate per-class errors by charging each edit to the expected character at that position. */
export function classErrors(
  expected: string,
  given: string | null,
): Record<CharacterClass, number> {
  const counts: Record<CharacterClass, number> = {
    uppercase: 0,
    lowercase: 0,
    digit: 0,
    punctuation: 0,
    cjk: 0,
    other: 0,
  };
  if (given === null) {
    for (const character of expected) counts[characterClass(character)] += 1;
    return counts;
  }
  const a = [...expected];
  const b = [...given];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const rows: number[][] = [previous];
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1);
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] ?? 0) + 1;
      const deletion = (previous[j] ?? 0) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    rows.push(current);
    previous = current;
  }
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const current = rows[i]?.[j] ?? 0;
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && current === (rows[i - 1]?.[j - 1] ?? 0)) {
      i -= 1;
      j -= 1;
    } else if (i > 0 && current === (rows[i - 1]?.[j] ?? 0) + 1) {
      counts[characterClass(a[i - 1] ?? '')] += 1;
      i -= 1;
    } else if (j > 0 && current === (rows[i]?.[j - 1] ?? 0) + 1) {
      j -= 1;
    } else {
      if (i > 0) counts[characterClass(a[i - 1] ?? '')] += 1;
      i = Math.max(0, i - 1);
      j = Math.max(0, j - 1);
    }
  }
  return counts;
}
