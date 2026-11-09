/**
 * Post-publish verification for npm trusted publishing.
 *
 * `npm publish` returns before the public registry serves the new version. On
 * this repository the packument exposed 0.1.2 about 56 s and 0.2.0 about 78 s
 * after the publish step finished, so the previous fixed 60 s window passed or
 * failed by luck. The check now polls with exponential backoff for five minutes
 * and only then asserts what the registry actually holds.
 *
 * Usage: node --experimental-strip-types scripts/verify-release.ts [version] [dist-tag]
 */
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { type RegistryDocument, readManifest, readPackage } from './registry.ts';

const defaultBudgetMs = 5 * 60_000;
const defaultInitialDelayMs = 2_000;
const defaultMaxDelayMs = 15_000;

export interface WaitResult {
  readonly document: RegistryDocument;
  readonly attempts: number;
  readonly elapsedMs: number;
}

export interface WaitOptions {
  readonly version: string;
  readonly load: (attempt: number) => Promise<RegistryDocument | undefined>;
  readonly budgetMs?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

/**
 * Polls until the version exists in the packument. Failing after the budget
 * reports what was attempted, so the next failure is diagnosable from the log
 * alone instead of looking like a bare npm 404.
 */
export async function waitForVersion(options: WaitOptions): Promise<WaitResult> {
  const budgetMs = options.budgetMs ?? defaultBudgetMs;
  const maxDelayMs = options.maxDelayMs ?? defaultMaxDelayMs;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const started = now();
  let delay = options.initialDelayMs ?? defaultInitialDelayMs;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const document = await options.load(attempts);
    if (document?.versions?.[options.version] !== undefined) {
      return { document, attempts, elapsedMs: now() - started };
    }
    const elapsed = now() - started;
    if (elapsed >= budgetMs) {
      throw new Error(
        `${options.version} is still absent from the registry after ${attempts} attempts ` +
          `in ${Math.round(elapsed / 1000)}s (budget ${Math.round(budgetMs / 1000)}s)`,
      );
    }
    await sleep(Math.min(delay, budgetMs - elapsed));
    delay = Math.min(delay * 2, maxDelayMs);
  }
}

export interface ReleaseInspection {
  readonly version: string;
  readonly distTag: string;
  readonly distTagVersion: string | undefined;
  readonly integrity: string | undefined;
  readonly attestations: string | undefined;
  readonly gitHead: string | undefined;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Checks the published document against what the workflow intended to release.
 * Dist-tag and integrity mismatches are errors: they mean the registry holds
 * something other than the verified tree. A missing attestation is only a
 * warning, because provenance availability is the registry's call.
 */
export function inspectRelease(input: {
  readonly document: RegistryDocument;
  readonly version: string;
  readonly distTag: string;
}): ReleaseInspection {
  const { document, version, distTag } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const metadata = document.versions?.[version];
  const dist = field(metadata, 'dist');
  const integrity = text(field(dist, 'integrity'));
  const attestations = text(field(field(dist, 'attestations'), 'url'));
  const gitHead = text(field(metadata, 'gitHead'));
  const distTagVersion = document['dist-tags']?.[distTag];

  if (metadata === undefined) errors.push(`${version} is missing from the packument`);
  if (distTagVersion !== version) {
    errors.push(
      `dist-tag ${distTag} points at ${distTagVersion ?? 'nothing'}, expected ${version}`,
    );
  }
  if (integrity === undefined) errors.push(`${version} has no dist.integrity`);
  if (attestations === undefined) {
    warnings.push(`no provenance attestation is attached to ${version}`);
  }
  if (gitHead === undefined) {
    warnings.push(`${version} carries no gitHead, so the release target falls back to this commit`);
  }
  return { version, distTag, distTagVersion, integrity, attestations, gitHead, errors, warnings };
}

async function main(): Promise<void> {
  const manifest = await readManifest();
  const version = process.argv[2] ?? manifest.version;
  const distTag = process.argv[3] ?? (version.includes('-') ? 'next' : 'latest');
  const result = await waitForVersion({
    version,
    load: (attempt) => readPackage(manifest.registry, manifest.name, Date.now() + attempt),
  });
  const inspection = inspectRelease({ document: result.document, version, distTag });
  const lines = [
    `${manifest.name}@${version} became readable after ${result.attempts} attempt(s) ` +
      `in ${Math.round(result.elapsedMs / 1000)}s`,
    `dist-tag ${distTag} -> ${inspection.distTagVersion ?? '(none)'}`,
    `integrity ${inspection.integrity ?? '(none)'}`,
    `provenance ${inspection.attestations ?? '(none)'}`,
  ];
  for (const line of lines) console.log(line);
  for (const warning of inspection.warnings) console.log(`::warning::${warning}`);
  for (const error of inspection.errors) console.error(`::error::${error}`);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined) {
    await appendFile(summary, `${lines.map((line) => `- ${line}`).join('\n')}\n`);
  }
  if (inspection.errors.length > 0) process.exitCode = 1;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::${message}`);
    process.exitCode = 1;
  }
}
