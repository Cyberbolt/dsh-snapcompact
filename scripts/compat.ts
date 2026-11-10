/**
 * The single source of the DSH compatibility claim.
 *
 * `DSH_VERIFIED_VERSION` is the newest host release this package was built,
 * tested and install-checked against. `DSH_COMPAT_RANGE` widens that point into
 * a bounded range the host's own semver gate accepts: the floor is exactly the
 * verified release and the caret ceiling is the next minor line, so a 0.2.x
 * patch can install without an exact-version exemption while a 0.3 release is
 * still rejected until it has been verified.
 *
 * The host evaluates the range with `semver.satisfies(runtime, range,
 * { includePrerelease: true })`: with that flag `^0.2.2-rc.1` accepts
 * `0.2.3-rc.1` and rejects `0.3.0-rc.1`.
 *
 * Raise the floor only after `pnpm run check:install` passes on that release,
 * and never replace the caret range with an exact point or an unbounded `>=`.
 */
export const DSH_VERIFIED_VERSION = '0.2.2-rc.1';

/** Published `engines.dsh` and every `@deepseek-ai/dsh*` peer range. */
export const DSH_COMPAT_RANGE = `^${DSH_VERIFIED_VERSION}`;

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

/** `<major>.<minor>.<patch>[-<prerelease>]`; the verified release is never a range. */
const releaseVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface DshCompatibilityClaim {
  /** The range this build publishes. */
  readonly range: string;
  /** The release the range floor must name. */
  readonly verified: string;
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
 * The check derives the only permitted range shape, `^` plus the verified
 * release, so a passing claim is a valid semver range with an exact floor and a
 * finite ceiling by construction. An exact point, `*`, an unbounded `>=` or a
 * stale floor all fail here instead of being discovered at install time.
 */
export function compatibilityProblems(claim: DshCompatibilityClaim): readonly string[] {
  const problems: string[] = [];
  const expectedRange = `^${claim.verified}`;

  if (!releaseVersion.test(claim.verified)) {
    problems.push(`verified version ${JSON.stringify(claim.verified)} is not a release version`);
  }
  if (claim.range !== expectedRange) {
    problems.push(
      `compatibility range ${JSON.stringify(claim.range)} must be the bounded caret range ` +
        `${JSON.stringify(expectedRange)} on the verified version`,
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
    } else if (dev !== claim.verified) {
      problems.push(
        `devDependencies[${name}] is ${JSON.stringify(dev)}; expected the verified version ` +
          JSON.stringify(claim.verified),
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
