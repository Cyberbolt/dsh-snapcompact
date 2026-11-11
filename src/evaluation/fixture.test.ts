import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../config.js';
import {
  buildFixtureMessages,
  classifyQuestionRegions,
  countArchiveCoverage,
  loadFixture,
  parseFixture,
} from './fixture.js';

const config = resolveConfig({});

describe('benchmark fixture v3', () => {
  it('loads 40 questions across head, middle and tail', async () => {
    const fixture = await loadFixture();
    const questions = Object.values(fixture.questions);
    expect(questions).toHaveLength(40);
    expect(fixture.probes).toHaveLength(20);
    expect(fixture.decoys).toHaveLength(40);
    expect(questions.filter((question) => question.region === 'head')).toHaveLength(7);
    expect(questions.filter((question) => question.region === 'middle')).toHaveLength(20);
    expect(questions.filter((question) => question.region === 'tail')).toHaveLength(13);
    expect(fixture.head.length).toBeLessThanOrEqual(1_800);
    expect((fixture.text + fixture.suffix).length).toBeLessThanOrEqual(1_800);
  });

  it('puts every declared fact in the declared region under default settings', async () => {
    const fixture = await loadFixture();
    const messages = buildFixtureMessages(fixture);
    const { serialized, regions } = classifyQuestionRegions(
      fixture,
      messages,
      config.serialization,
    );
    for (const [key, question] of Object.entries(fixture.questions)) {
      expect(regions.get(key), key).toBe(question.region);
      expect(serialized.split(question.source).length - 1, key).toBe(1);
    }
    expect(countArchiveCoverage(fixture, serialized)).toEqual({ correct: 40, total: 40 });
  });

  it('never lets a decoy contain a scored source', async () => {
    const fixture = await loadFixture();
    for (const decoy of fixture.decoys) {
      for (const question of Object.values(fixture.questions)) {
        expect(decoy.text.includes(question.source)).toBe(false);
      }
    }
  });

  it('rejects duplicate probe and decoy lines', async () => {
    const fixture = await loadFixture();
    const firstProbe = fixture.probes[0];
    if (firstProbe === undefined) throw new Error('fixture has no probes');
    expect(() =>
      parseFixture({
        ...fixture,
        decoys: [...fixture.decoys, { line: firstProbe.line, text: 'duplicate' }],
      }),
    ).toThrow();
  });
});
