import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Message } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SnapcompactConfig } from '../config.js';
import { serializeConversation } from '../compaction/visual-source.js';
import type { Region } from './types.js';

/** The fixed question vocabulary keeps report grouping stable across fixtures. */
export const QUESTION_KINDS = [
  'constraint',
  'path',
  'command',
  'numeric',
  'code',
  'cjk',
  'config',
  'negation',
  'identifier',
  'next-action',
  'ordered-step',
] as const;

export const REGIONS = ['head', 'middle', 'tail'] as const;

const questionSchema = z.strictObject({
  question: z.string().min(1),
  answer: z.string().min(1),
  /** Equivalent spellings the rubric accepts in addition to the canonical answer. */
  accept: z.array(z.string().min(1)).default([]),
  /** Exact source text used to locate the fact in the checkpoint projection. */
  source: z.string().min(1),
  region: z.enum(REGIONS),
  kind: z.enum(QUESTION_KINDS),
});

const probeSchema = z.strictObject({
  line: z.number().int().min(0),
  text: z.string().min(1),
  key: z.string().min(1),
});

const decoySchema = z.strictObject({
  line: z.number().int().min(0),
  text: z.string().min(1),
});

const fixtureSchema = z
  .strictObject({
    version: z.literal(3),
    id: z.string().min(1),
    paddingLines: z.number().int().min(100).max(20_000),
    /** First message: facts that must stay in the exact head text. */
    head: z.string().default(''),
    /** Final message: facts that must stay in the exact tail text. */
    text: z.string().min(1),
    suffix: z.string().default(''),
    probes: z.array(probeSchema).default([]),
    /** Plausible facts that are never asked; they make summarization choose. */
    decoys: z.array(decoySchema).default([]),
    questions: z.record(z.string(), questionSchema),
  })
  .superRefine((fixture, context) => {
    const questionKeys = Object.keys(fixture.questions);
    if (questionKeys.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'Fixture has no questions.',
      });

    const lines = new Map<number, string>();
    const probeKeys = new Set<string>();
    for (const [index, probe] of fixture.probes.entries()) {
      if (probe.line >= fixture.paddingLines)
        context.addIssue({
          code: 'custom',
          path: ['probes', index, 'line'],
          message: 'Probe line is outside the padding range.',
        });
      if (lines.has(probe.line))
        context.addIssue({
          code: 'custom',
          path: ['probes', index, 'line'],
          message: 'Probe and decoy lines must be unique.',
        });
      lines.set(probe.line, 'probe');
      if (probeKeys.has(probe.key))
        context.addIssue({
          code: 'custom',
          path: ['probes', index, 'key'],
          message: 'Probe keys must be unique.',
        });
      probeKeys.add(probe.key);
      if (!(probe.key in fixture.questions))
        context.addIssue({
          code: 'custom',
          path: ['probes', index, 'key'],
          message: 'Every probe key needs a question.',
        });
    }
    for (const [index, decoy] of fixture.decoys.entries()) {
      if (decoy.line >= fixture.paddingLines)
        context.addIssue({
          code: 'custom',
          path: ['decoys', index, 'line'],
          message: 'Decoy line is outside the padding range.',
        });
      if (lines.has(decoy.line))
        context.addIssue({
          code: 'custom',
          path: ['decoys', index, 'line'],
          message: 'Probe and decoy lines must be unique.',
        });
      lines.set(decoy.line, 'decoy');
    }
    for (const [key, question] of Object.entries(fixture.questions)) {
      if (question.region === 'middle' && !probeKeys.has(key))
        context.addIssue({
          code: 'custom',
          path: ['questions', key, 'region'],
          message: 'A middle question needs a probe at a fixed line.',
        });
      for (const decoy of fixture.decoys) {
        if (decoy.text.includes(question.source))
          context.addIssue({
            code: 'custom',
            path: ['decoys'],
            message: 'A decoy contains a question source; it would corrupt recall coverage.',
          });
      }
    }
  });

export type Fixture = z.infer<typeof fixtureSchema>;
export type FixtureQuestion = z.infer<typeof questionSchema>;

export const DEFAULT_FIXTURE_URL = new URL(
  '../../assets/benchmarks/engineering-v3.json',
  import.meta.url,
);

/** Parse and validate one fixture document. Exported so tests can use a small fixture. */
export function parseFixture(raw: unknown): Fixture {
  return fixtureSchema.parse(raw);
}

export async function loadFixture(url: URL = DEFAULT_FIXTURE_URL): Promise<Fixture> {
  return parseFixture(JSON.parse(await readFile(url, 'utf8')));
}

function fillerLine(index: number): string {
  return `Observation ${index}: routine build log entry; no user-visible change.`;
}

export interface BuildFixtureOptions {
  /**
   * Physical lines per user message. The serialization clips each message at
   * `messageTextMaxChars`, so long fixtures must use small chunks; the default
   * keeps the historical ten-message shape.
   */
  readonly chunkLines?: number;
}

/** Build the deterministic conversation a fixture describes. */
export function buildFixtureMessages(
  fixture: Fixture,
  options: BuildFixtureOptions = {},
): Message[] {
  const override = new Map<number, string>();
  for (const decoy of fixture.decoys) override.set(decoy.line, decoy.text);
  for (const probe of fixture.probes) override.set(probe.line, probe.text);
  const lines = Array.from(
    { length: fixture.paddingLines },
    (_, index) => override.get(index) ?? fillerLine(index),
  );
  const requestedChunk = options.chunkLines ?? Math.ceil(lines.length / 10);
  const chunkSize = Math.max(1, Math.min(lines.length, Math.floor(requestedChunk)));
  const padding: Message[] = [];
  for (let offset = 0; offset < lines.length; offset += chunkSize) {
    padding.push(
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: lines.slice(offset, offset + chunkSize).join('\n') }],
      }),
    );
  }
  const head =
    fixture.head.length > 0
      ? [
          createUserMessage({
            source: { kind: 'user' },
            content: [{ type: 'text', text: fixture.head }],
          }),
        ]
      : [];
  const tail = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: `${fixture.text}\n${fixture.suffix}` }],
  });
  return [...head, ...padding, tail];
}

/** Serialize once and derive every question's real region from its source text. */
export function classifyQuestionRegions(
  fixture: Fixture,
  messages: readonly Message[],
  serialization: SnapcompactConfig['serialization'],
): { serialized: string; regions: ReadonlyMap<string, Region> } {
  const serialized = serializeConversation(messages, serialization);
  const headEnd = Math.max(0, serialization.headChars);
  const tailStart = Math.max(0, serialized.length - serialization.tailChars);
  const regions = new Map<string, Region>();
  for (const [key, question] of Object.entries(fixture.questions)) {
    const index = serialized.indexOf(question.source);
    if (index < 0) {
      regions.set(key, 'unknown');
      continue;
    }
    regions.set(key, index < headEnd ? 'head' : index >= tailStart ? 'tail' : 'middle');
  }
  return { serialized, regions };
}

/** Deterministic archive-integrity check; no model call. */
export function countArchiveCoverage(
  fixture: Fixture,
  transcript: string,
): { correct: number; total: number } {
  let correct = 0;
  for (const question of Object.values(fixture.questions)) {
    if (transcript.includes(question.source)) correct += 1;
  }
  return { correct, total: Object.keys(fixture.questions).length };
}

const LONG_HEAD =
  'User constraints: archive before delete; reply in Simplified Chinese.\n' +
  'The pinned runtime is 4.8.2-rc.1.\n' +
  'Never run migrations with --force.';

const LONG_TAIL =
  'Release note: read-only verification passed before writes.\n' +
  'The final release tag is v9.9.9-rc.1.\n' +
  'The next action is run integration tests; do not deploy yet.';

const LONG_FACTS = [
  {
    key: 's0',
    fraction: 0.08,
    value: 'MIGRATION_LOCK_V4',
    question: 'What is the migration lock code?',
    sentence: 'the migration lock code is MIGRATION_LOCK_V4.',
  },
  {
    key: 's1',
    fraction: 0.22,
    value: 'RETRY_LIMIT_V4',
    question: 'What is the retry limit identifier?',
    sentence: 'the retry limit identifier is RETRY_LIMIT_V4.',
  },
  {
    key: 's2',
    fraction: 0.38,
    value: 'BUCKET_V4',
    question: 'What is the backup bucket identifier?',
    sentence: 'the backup bucket identifier is BUCKET_V4.',
  },
  {
    key: 's3',
    fraction: 0.54,
    value: 'FEATURE_FLAG_V4',
    question: 'What is the feature flag identifier?',
    sentence: 'the feature flag identifier is FEATURE_FLAG_V4.',
  },
  {
    key: 's4',
    fraction: 0.68,
    value: 'TIMEOUT_V4',
    question: 'What is the verification timeout identifier?',
    sentence: 'the verification timeout identifier is TIMEOUT_V4.',
  },
  {
    key: 's5',
    fraction: 0.82,
    value: 'OWNER_V4',
    question: 'What is the owner team identifier?',
    sentence: 'the owner team identifier is OWNER_V4.',
  },
] as const;

export interface LongFixtureOptions {
  /** Physical padding lines; the default is 5,000. */
  readonly paddingLines?: number;
  /** Lines per user message; the default 100 stays below messageTextMaxChars. */
  readonly chunkLines?: number;
}

export interface LongFixture {
  readonly fixture: Fixture;
  readonly messages: readonly Message[];
}

/**
 * A deterministic long session with head, tail and six middle facts.
 *
 * The facts are spread across the padding so a recall search cannot get all of
 * them from one region. Pass `chunkLines` small enough that serialization does
 * not clip a chunk; the default is safe for the default filler line.
 */
export function buildLongFixture(options: LongFixtureOptions = {}): LongFixture {
  const paddingLines = options.paddingLines ?? 5_000;
  const used = new Set<number>();
  const probes = LONG_FACTS.map((fact) => {
    const line = Math.floor(paddingLines * fact.fraction);
    if (line < 1 || line >= paddingLines - 1 || used.has(line)) {
      throw new Error(`Long fixture fact ${fact.key} has an unusable line ${line}.`);
    }
    used.add(line);
    return {
      line,
      text: `Observation ${line}: ${fact.sentence}`,
      key: fact.key,
    };
  });
  const questions: Record<
    string,
    {
      question: string;
      answer: string;
      source: string;
      region: 'head' | 'middle' | 'tail';
      kind: 'identifier';
    }
  > = {
    l_head: {
      question: 'What is the pinned runtime version?',
      answer: '4.8.2-rc.1',
      source: '4.8.2-rc.1',
      region: 'head',
      kind: 'identifier',
    },
    l_tail: {
      question: 'What is the final release tag?',
      answer: 'v9.9.9-rc.1',
      source: 'v9.9.9-rc.1',
      region: 'tail',
      kind: 'identifier',
    },
  };
  for (const fact of LONG_FACTS) {
    questions[fact.key] = {
      question: fact.question,
      answer: fact.value,
      source: fact.value,
      region: 'middle',
      kind: 'identifier',
    };
  }
  const fixture = parseFixture({
    version: 3,
    id: `engineering-long-${paddingLines}`,
    paddingLines,
    head: LONG_HEAD,
    text: LONG_TAIL,
    suffix: '',
    probes,
    decoys: [],
    questions,
  });
  return {
    fixture,
    messages: buildFixtureMessages(fixture, { chunkLines: options.chunkLines ?? 100 }),
  };
}
