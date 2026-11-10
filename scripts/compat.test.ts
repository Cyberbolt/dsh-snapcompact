import { describe, expect, it } from 'vitest';
import {
  DSH_COMPAT_RANGE,
  DSH_PEER_PACKAGES,
  DSH_VERIFIED_VERSION,
  compatibilityProblems,
} from './compat.ts';
import type { DshCompatibilityClaim } from './compat.ts';

function claim(overrides: Partial<DshCompatibilityClaim> = {}): DshCompatibilityClaim {
  return {
    range: DSH_COMPAT_RANGE,
    verified: DSH_VERIFIED_VERSION,
    enginesDsh: DSH_COMPAT_RANGE,
    peerDependencies: Object.fromEntries(DSH_PEER_PACKAGES.map((name) => [name, DSH_COMPAT_RANGE])),
    devDependencies: Object.fromEntries(
      DSH_PEER_PACKAGES.map((name) => [name, DSH_VERIFIED_VERSION]),
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
      claim({ range: DSH_VERIFIED_VERSION, enginesDsh: DSH_VERIFIED_VERSION }),
    );
    expect(problems.join('\n')).toContain('bounded caret range');
  });

  it('rejects an unbounded range', () => {
    const problems = compatibilityProblems(
      claim({ range: `>=${DSH_VERIFIED_VERSION}`, enginesDsh: `>=${DSH_VERIFIED_VERSION}` }),
    );
    expect(problems.join('\n')).toContain('bounded caret range');
  });

  it('rejects a range whose floor is not the verified version', () => {
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
          '@deepseek-ai/dsh-llm': DSH_VERIFIED_VERSION,
        },
      }),
    );
    expect(problems.join('\n')).toContain('peerDependencies[@deepseek-ai/dsh-llm]');
  });

  it('keeps devDependencies pinned to the verified version', () => {
    const problems = compatibilityProblems(
      claim({
        devDependencies: {
          ...claim().devDependencies,
          '@deepseek-ai/dsh-llm': DSH_COMPAT_RANGE,
        },
      }),
    );
    expect(problems.join('\n')).toContain('expected the verified version');
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

  it('rejects a verified version that is not a release version', () => {
    const problems = compatibilityProblems(
      claim({ verified: 'latest', range: '^latest', enginesDsh: '^latest' }),
    );
    expect(problems.join('\n')).toContain('is not a release version');
  });
});
