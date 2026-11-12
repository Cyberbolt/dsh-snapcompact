/**
 * The single source of the DSH compatibility claim.
 *
 * `DSH_BASELINE_VERSION` is the host release this build targets: the floor of
 * the published range, the version the dev dependencies and the preset fixtures
 * pin, and the first leg of CI's install check. It is not "the newest verified
 * host": CI also install-checks the newest published 0.2.x release (`latest`),
 * and that host must install without moving this value. A bare copy of it in
 * prose would age with every DSH patch, so the documents state
 * {@link DSH_COMPAT_RANGE} only and point here for the exact floor.
 *
 * `DSH_COMPAT_RANGE` widens the baseline into a bounded range the host's own
 * semver gate accepts: the floor is the baseline and the caret ceiling is the
 * next minor line, so a 0.2.x patch can install without an exact-version
 * exemption while a 0.3 release is still rejected until it has been verified
 * and the range widened deliberately.
 *
 * The host evaluates the range with `semver.satisfies(runtime, range,
 * { includePrerelease: true })`: with that flag `^0.2.2-rc.1` accepts
 * `0.2.2-rc.2` and `0.2.3-rc.1` and rejects `0.3.0-rc.1`.
 *
 * Change the baseline only when the supported window changes — dropping an old
 * minor or opening a new one — never to record a passing install check, and
 * never replace the caret range with an exact point or an unbounded `>=`.
 */
export const DSH_BASELINE_VERSION = '0.2.2-rc.1';

/** Published `engines.dsh` and every `@deepseek-ai/dsh*` peer range. */
export const DSH_COMPAT_RANGE = `^${DSH_BASELINE_VERSION}`;

/**
 * The supported DSH line as prose names it: `0.2.x`.
 *
 * README states this line, never a release, so a 0.2.x patch ships without a
 * documentation edit. The range and its exact floor belong to the manifest and
 * `docs/configuration.md`.
 */
export const DSH_SUPPORT_LINE = `${DSH_BASELINE_VERSION.split('.').slice(0, 2).join('.')}.x`;

/** Host packages whose peer range tracks {@link DSH_COMPAT_RANGE}. */
export const DSH_PEER_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-tools',
];

/** `<major>.<minor>.<patch>[-<prerelease>]`; the baseline is never a range. */
const releaseVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface DshCompatibilityClaim {
  /** The range this build publishes. */
  readonly range: string;
  /** The release the range floor must name. */
  readonly baseline: string;
  /** `engines.dsh` from package.json. */
  readonly enginesDsh: string;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

function isHostPackage(name: string): boolean {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-');
}

/**
 * Every way the manifest can disagree with the single compatibility claim.
 *
 * The check derives the only permitted range shape, `^` plus the baseline
 * release, so a passing claim is a valid semver range with an exact floor and a
 * finite ceiling by construction. An exact point, `*`, an unbounded `>=` or a
 * stale floor all fail here instead of being discovered at install time.
 */
export function compatibilityProblems(claim: DshCompatibilityClaim): readonly string[] {
  const problems: string[] = [];
  const expectedRange = `^${claim.baseline}`;

  if (!releaseVersion.test(claim.baseline)) {
    problems.push(`baseline version ${JSON.stringify(claim.baseline)} is not a release version`);
  }
  if (claim.range !== expectedRange) {
    problems.push(
      `compatibility range ${JSON.stringify(claim.range)} must be the bounded caret range ` +
        `${JSON.stringify(expectedRange)} on the baseline version`,
    );
  }
  if (claim.enginesDsh !== claim.range) {
    problems.push(
      `engines.dsh is ${JSON.stringify(claim.enginesDsh)}; expected the single-source range ` +
        JSON.stringify(claim.range),
    );
  }

  for (const name of DSH_PEER_PACKAGES) {
    const peer = claim.peerDependencies[name];
    if (peer === undefined) {
      problems.push(`peerDependencies is missing ${name}`);
    } else if (peer !== claim.range) {
      problems.push(
        `peerDependencies[${name}] is ${JSON.stringify(peer)}; expected ` +
          `${JSON.stringify(claim.range)}`,
      );
    }
    const dev = claim.devDependencies[name];
    if (dev === undefined) {
      problems.push(`devDependencies is missing ${name}`);
    } else if (dev !== claim.baseline) {
      problems.push(
        `devDependencies[${name}] is ${JSON.stringify(dev)}; expected the baseline version ` +
          JSON.stringify(claim.baseline),
      );
    }
  }

  for (const name of Object.keys(claim.peerDependencies)) {
    if (isHostPackage(name) && !DSH_PEER_PACKAGES.includes(name)) {
      problems.push(`peerDependencies has an untracked host package ${name}`);
    }
  }

  return problems;
}

/**
 * Problems with a document's DSH compatibility prose.
 *
 * Documents name the supported line (`0.2.x`), never a release: a pinned host
 * version is the claim that ages badly ("verified on `0.2.2-rc.1`) and the
 * reason a DSH patch release used to require a documentation edit. The range is
 * stripped before the baseline check, so a reference may still quote it.
 */
export function documentationProblems(text: string): readonly string[] {
  const problems: string[] = [];
  if (!text.includes(DSH_SUPPORT_LINE)) {
    problems.push(`the supported DSH line ${JSON.stringify(DSH_SUPPORT_LINE)} is not stated`);
  }
  if (text.split(DSH_COMPAT_RANGE).join('').includes(DSH_BASELINE_VERSION)) {
    problems.push(
      `the bare DSH version ${JSON.stringify(DSH_BASELINE_VERSION)} appears in prose; ` +
        'name the supported line and leave the exact release to scripts/compat.ts',
    );
  }
  return problems;
}
