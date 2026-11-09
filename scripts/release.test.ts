import { describe, expect, it } from 'vitest';
import { compareVersions, planRelease } from './release.js';

describe('release planning', () => {
  it('publishes a version the registry has never seen', () => {
    expect(planRelease({ version: '0.1.2', published: ['0.0.0-stage', '0.1.1'] })).toEqual({
      version: '0.1.2',
      publish: true,
      reason: 'new-version',
      distTag: 'latest',
    });
  });

  it('publishes the first release of an unpublished package', () => {
    expect(planRelease({ version: '0.1.0', published: [] }).publish).toBe(true);
  });

  it('skips a version that is already on the registry', () => {
    expect(planRelease({ version: '0.1.1', published: ['0.0.0-stage', '0.1.1'] })).toEqual({
      version: '0.1.1',
      publish: false,
      reason: 'already-published',
      distTag: 'latest',
    });
  });

  it('refuses to move the release line backwards', () => {
    expect(() => planRelease({ version: '0.1.0', published: ['0.0.0-stage', '0.1.1'] })).toThrow(
      /highest published version is 0\.1\.1/,
    );
  });

  it('rejects malformed versions', () => {
    expect(() => planRelease({ version: '0.1', published: [] })).toThrow(/invalid version/);
    expect(() => planRelease({ version: '0.1.2.3', published: [] })).toThrow(/invalid version/);
    expect(() => planRelease({ version: 'v0.1.2', published: [] })).toThrow(/invalid version/);
  });

  it('publishes prereleases under the next dist-tag', () => {
    expect(planRelease({ version: '0.2.0-rc.1', published: ['0.1.1'] }).distTag).toBe('next');
    expect(planRelease({ version: '0.2.0-rc.1', published: ['0.1.1'] }).publish).toBe(true);
    expect(planRelease({ version: '0.2.0-rc.2', published: ['0.1.1', '0.2.0-rc.1'] }).publish).toBe(
      true,
    );
  });

  it('refuses a prerelease older than an already released stable version', () => {
    expect(() => planRelease({ version: '0.1.2-rc.1', published: ['0.1.2'] })).toThrow(
      /highest published version is 0\.1\.2/,
    );
  });
});

describe('version precedence', () => {
  it('orders numeric segments numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.1.1', '0.1.1')).toBe(0);
  });

  it('orders prereleases below their release', () => {
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBe(-1);
    expect(compareVersions('0.2.0', '0.2.0-rc.1')).toBe(1);
  });

  it('compares prerelease identifiers by semver rules', () => {
    expect(compareVersions('0.2.0-rc.2', '0.2.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
  });
});
