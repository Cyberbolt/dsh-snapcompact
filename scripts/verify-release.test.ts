import { describe, expect, it } from 'vitest';
import type { RegistryDocument } from './registry.js';
import { inspectRelease, waitForVersion } from './verify-release.js';

const attestationUrl = 'https://registry.npmjs.org/-/npm/v1/attestations/dsh-snapcompact@1.2.3';

function document(overrides: { readonly withAttestation?: boolean } = {}): RegistryDocument {
  const metadata: Record<string, unknown> = {
    gitHead: 'a86e61d89923dc69100492449a6945d6c0b6ef67',
    dist: {
      integrity: 'sha512-abc',
      ...(overrides.withAttestation === false ? {} : { attestations: { url: attestationUrl } }),
    },
  };
  return { versions: { '1.2.3': metadata }, 'dist-tags': { latest: '1.2.3' } };
}

describe('post-publish verification', () => {
  it('accepts a release the registry fully exposes', () => {
    const inspection = inspectRelease({
      document: document(),
      version: '1.2.3',
      distTag: 'latest',
    });
    expect(inspection.errors).toEqual([]);
    expect(inspection.warnings).toEqual([]);
    expect(inspection.integrity).toBe('sha512-abc');
    expect(inspection.attestations).toBe(attestationUrl);
    expect(inspection.distTagVersion).toBe('1.2.3');
  });

  it('reports a dist-tag that points elsewhere as an error', () => {
    const wrong: RegistryDocument = { ...document(), 'dist-tags': { latest: '1.2.2' } };
    const inspection = inspectRelease({ document: wrong, version: '1.2.3', distTag: 'latest' });
    expect(inspection.errors).toContainEqual('dist-tag latest points at 1.2.2, expected 1.2.3');
  });

  it('reports a missing integrity as an error', () => {
    const broken: RegistryDocument = { versions: { '1.2.3': { dist: {} } } };
    const inspection = inspectRelease({ document: broken, version: '1.2.3', distTag: 'latest' });
    expect(inspection.errors).toContainEqual('1.2.3 has no dist.integrity');
    expect(inspection.errors).toContainEqual('dist-tag latest points at nothing, expected 1.2.3');
  });

  it('reports a missing version as an error', () => {
    const empty: RegistryDocument = { versions: {} };
    const inspection = inspectRelease({ document: empty, version: '1.2.3', distTag: 'latest' });
    expect(inspection.errors).toContainEqual('1.2.3 is missing from the packument');
  });

  it('warns instead of failing when provenance is absent', () => {
    const inspection = inspectRelease({
      document: document({ withAttestation: false }),
      version: '1.2.3',
      distTag: 'latest',
    });
    expect(inspection.errors).toEqual([]);
    expect(inspection.warnings).toContainEqual('no provenance attestation is attached to 1.2.3');
  });
});

describe('waiting for a published version', () => {
  it('returns on the first attempt when the registry already serves the version', async () => {
    const sleeps: number[] = [];
    const result = await waitForVersion({
      version: '1.2.3',
      load: async () => document(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.attempts).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retries with exponential backoff until the version appears', async () => {
    const delays: number[] = [];
    let clock = 0;
    let calls = 0;
    const result = await waitForVersion({
      version: '1.2.3',
      budgetMs: 60_000,
      initialDelayMs: 2_000,
      maxDelayMs: 15_000,
      now: () => clock,
      sleep: async (ms) => {
        delays.push(ms);
        clock += ms;
      },
      load: async () => {
        calls += 1;
        return calls < 3 ? { versions: {} } : document();
      },
    });
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([2_000, 4_000]);
    expect(result.elapsedMs).toBe(6_000);
  });

  it('gives up after the budget and reports what it attempted', async () => {
    let clock = 0;
    const delays: number[] = [];
    const attempt = waitForVersion({
      version: '1.2.3',
      budgetMs: 10_000,
      initialDelayMs: 1_000,
      maxDelayMs: 4_000,
      now: () => clock,
      sleep: async (ms) => {
        delays.push(ms);
        clock += ms;
      },
      load: async () => ({ versions: {} }),
    });
    await expect(attempt).rejects.toThrow(
      /1\.2\.3 is still absent.*5 attempts in 10s \(budget 10s\)/,
    );
    expect(delays).toEqual([1_000, 2_000, 4_000, 3_000]);
  });
});
