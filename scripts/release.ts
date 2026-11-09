/**
 * Release gate for npm trusted publishing.
 *
 * The version in package.json is the only release switch: a push to main
 * publishes exactly that version when the registry does not have it yet, and
 * does nothing otherwise. The module is dependency-free on purpose, so the gate
 * can run before `pnpm install` in CI and the decision can be unit tested
 * without network access.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultRegistry = 'https://registry.npmjs.org';
/** `<major>.<minor>.<patch>[-<prerelease>]`; build metadata is irrelevant to release order. */
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export interface ReleasePlan {
  readonly version: string;
  readonly publish: boolean;
  readonly reason: 'new-version' | 'already-published';
  readonly distTag: 'latest' | 'next';
}

interface ParsedVersion {
  readonly core: readonly number[];
  readonly prerelease: readonly string[];
}

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly registry: string;
}

function parseVersion(version: string): ParsedVersion {
  const match = versionPattern.exec(version);
  if (!match) {
    throw new Error(
      `invalid version "${version}": expected <major>.<minor>.<patch>[-<prerelease>]`,
    );
  }
  const core = [Number(match[1]), Number(match[2]), Number(match[3])];
  const prerelease = match[4] === undefined ? [] : match[4].split('.');
  return { core, prerelease };
}

/**
 * Semver precedence for the version shapes this package publishes: numeric core
 * comparison, release above prerelease, numeric identifiers below alphanumeric
 * ones, and a shorter identifier list below a longer list with the same prefix.
 */
export function compareVersions(left: string, right: string): number {
  const first = parseVersion(left);
  const second = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (first.core[index] ?? 0) - (second.core[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  const firstPre = first.prerelease;
  const secondPre = second.prerelease;
  if (firstPre.length === 0 || secondPre.length === 0) {
    return firstPre.length === secondPre.length ? 0 : firstPre.length === 0 ? 1 : -1;
  }
  const length = Math.max(firstPre.length, secondPre.length);
  for (let index = 0; index < length; index += 1) {
    const firstId = firstPre[index];
    const secondId = secondPre[index];
    if (firstId === undefined) return -1;
    if (secondId === undefined) return 1;
    const difference = compareIdentifiers(firstId, secondId);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const difference = Number(left) - Number(right);
    return difference === 0 ? 0 : difference < 0 ? -1 : 1;
  }
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Decides whether the packaged version may be published. Throws instead of
 * skipping when the version is malformed or would move the release line
 * backwards, because both mean a human must look at the commit.
 */
export function planRelease(input: {
  readonly version: string;
  readonly published: readonly string[];
}): ReleasePlan {
  const { version, published } = input;
  const parsed = parseVersion(version);
  const distTag = parsed.prerelease.length === 0 ? 'latest' : 'next';
  if (published.includes(version)) {
    return { version, publish: false, reason: 'already-published', distTag };
  }
  const highest = published.reduce<string | undefined>(
    (current, candidate) =>
      current === undefined || compareVersions(candidate, current) > 0 ? candidate : current,
    undefined,
  );
  if (highest !== undefined && compareVersions(version, highest) < 0) {
    throw new Error(`refusing to publish ${version}: highest published version is ${highest}`);
  }
  return { version, publish: true, reason: 'new-version', distTag };
}

function parseManifest(text: string): PackageManifest {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('package.json must contain a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const name = record['name'];
  const version = record['version'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('package.json is missing a package name');
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('package.json is missing a version');
  }
  const publishConfig = record['publishConfig'];
  const configured =
    typeof publishConfig === 'object' && publishConfig !== null
      ? (publishConfig as Record<string, unknown>)['registry']
      : undefined;
  const registry =
    typeof configured === 'string' && configured.length > 0 ? configured : defaultRegistry;
  return { name, version, registry };
}

/** Published versions come from the registry, never from git: manual releases leave no trace in history. */
async function publishedVersions(registry: string, name: string): Promise<string[]> {
  const base = registry.replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(name)}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`registry answered ${response.status} ${response.statusText} for ${url}`);
  }
  const document: unknown = await response.json();
  const versions =
    typeof document === 'object' && document !== null
      ? (document as Record<string, unknown>)['versions']
      : undefined;
  if (typeof versions !== 'object' || versions === null) {
    throw new Error(`registry document for ${name} has no versions map`);
  }
  return Object.keys(versions);
}

async function main(): Promise<void> {
  const manifest = parseManifest(await readFile(resolve(root, 'package.json'), 'utf8'));
  const published = await publishedVersions(manifest.registry, manifest.name);
  const plan = planRelease({ version: manifest.version, published });
  const summary = [
    `${manifest.name} ${plan.version}`,
    `published: ${published.length === 0 ? '(none)' : [...published].sort(compareVersions).join(', ')}`,
    plan.publish
      ? `decision: publish under dist-tag ${plan.distTag}`
      : 'decision: skip (already on the registry)',
  ];
  for (const line of summary) console.log(line);
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined) {
    const lines = [
      `version=${plan.version}`,
      `publish=${String(plan.publish)}`,
      `reason=${plan.reason}`,
      `dist_tag=${plan.distTag}`,
    ];
    await appendFile(output, `${lines.join('\n')}\n`);
  }
  if (!plan.publish) console.log('::notice::Version already published; nothing to release.');
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
