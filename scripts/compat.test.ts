import { describe, expect, it } from 'vitest';
import {
  DSH_BASELINE_VERSION,
  DSH_COMPAT_RANGE,
  DSH_PEER_PACKAGES,
  DSH_SUPPORT_LINE,
  compatibilityProblems,
  documentationProblems,
} from './compat.ts';
import type { DshCompatibilityClaim } from './compat.ts';

function claim(overrides: Partial<DshCompatibilityClaim> = {}): DshCompatibilityClaim {
  return {
    range: DSH_COMPAT_RANGE,
    baseline: DSH_BASELINE_VERSION,
    enginesDsh: DSH_COMPAT_RANGE,
    peerDependencies: Object.fromEntries(DSH_PEER_PACKAGES.map((name) => [name, DSH_COMPAT_RANGE])),
    devDependencies: Object.fromEntries(
      DSH_PEER_PACKAGES.map((name) => [name, DSH_BASELINE_VERSION]),
    ),
    ...overrides,
  };
}

describe('DSH compatibility claim', () => {
  it('accepts the single-source range, peers and dev pins', () => {
    expect(compatibilityProblems(claim())).toEqual([]);
  });

  it('rejects an exact version instead of a bounded range', () => {
    const problems = compatibilityProblems(
      claim({ range: DSH_BASELINE_VERSION, enginesDsh: DSH_BASELINE_VERSION }),
    );
    expect(problems.join('\n')).toContain('bounded caret range');
  });

  it('rejects an unbounded range', () => {
    const problems = compatibilityProblems(
      claim({ range: `>=${DSH_BASELINE_VERSION}`, enginesDsh: `>=${DSH_BASELINE_VERSION}` }),
    );
    expect(problems.join('\n')).toContain('bounded caret range');
  });

  it('rejects a range whose floor is not the baseline', () => {
    const problems = compatibilityProblems(
      claim({ range: '^0.2.3-rc.1', enginesDsh: '^0.2.3-rc.1' }),
    );
    expect(problems.join('\n')).toContain('bounded caret range');
  });

  it('rejects engines.dsh that disagrees with the single source', () => {
    const problems = compatibilityProblems(claim({ enginesDsh: '^0.2.2' }));
    expect(problems.join('\n')).toContain('engines.dsh is');
  });

  it('rejects a missing peer package', () => {
    const peers = { ...claim().peerDependencies };
    delete peers['@deepseek-ai/dsh-llm'];
    const problems = compatibilityProblems(claim({ peerDependencies: peers }));
    expect(problems.join('\n')).toContain('peerDependencies is missing @deepseek-ai/dsh-llm');
  });

  it('rejects a peer range that does not track the declared range', () => {
    const problems = compatibilityProblems(
      claim({
        peerDependencies: {
          ...claim().peerDependencies,
          '@deepseek-ai/dsh-llm': DSH_BASELINE_VERSION,
        },
      }),
    );
    expect(problems.join('\n')).toContain('peerDependencies[@deepseek-ai/dsh-llm]');
  });

  it('keeps devDependencies pinned to the baseline version', () => {
    const problems = compatibilityProblems(
      claim({
        devDependencies: {
          ...claim().devDependencies,
          '@deepseek-ai/dsh-llm': DSH_COMPAT_RANGE,
        },
      }),
    );
    expect(problems.join('\n')).toContain('expected the baseline version');
  });

  it('rejects a host peer that the single source does not track', () => {
    const problems = compatibilityProblems(
      claim({
        peerDependencies: {
          ...claim().peerDependencies,
          '@deepseek-ai/dsh-extra': DSH_COMPAT_RANGE,
        },
      }),
    );
    expect(problems.join('\n')).toContain('untracked host package @deepseek-ai/dsh-extra');
  });

  it('rejects a baseline that is not a release version', () => {
    const problems = compatibilityProblems(
      claim({ baseline: 'latest', range: '^latest', enginesDsh: '^latest' }),
    );
    expect(problems.join('\n')).toContain('is not a release version');
  });
});

describe('DSH compatibility prose', () => {
  it('derives the supported line from the baseline', () => {
    expect(DSH_SUPPORT_LINE).toBe('0.2.x');
  });

  it('accepts a README that names the line only', () => {
    expect(documentationProblems(`Requires DSH \`${DSH_SUPPORT_LINE}\` and Node.js 24+.`)).toEqual(
      [],
    );
  });

  it('accepts a reference that quotes the range next to the line', () => {
    const text = `Snapcompact declares \`${DSH_COMPAT_RANGE}\`: every \`${DSH_SUPPORT_LINE}\` host installs.`;
    expect(documentationProblems(text)).toEqual([]);
  });

  it('rejects a document that names no line', () => {
    const problems = documentationProblems('Requires DSH 0.2 and Node.js 24+.');
    expect(problems.join('\n')).toContain('is not stated');
  });

  it('rejects a bare baseline outside the range', () => {
    const problems = documentationProblems(
      `Requires DSH \`${DSH_SUPPORT_LINE}\` (verified on \`${DSH_BASELINE_VERSION}\`).`,
    );
    expect(problems.join('\n')).toContain('appears in prose');
  });
});
