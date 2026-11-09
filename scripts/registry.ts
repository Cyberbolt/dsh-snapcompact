/**
 * Registry access shared by the release gate and the post-publish check.
 *
 * Both scripts run before or right after `npm publish`, without `node_modules`,
 * so this module stays dependency-free. The registry address comes from
 * `publishConfig` and every read goes through `fetch`, which ignores the npm
 * client configuration a developer may have pointed at a mirror. The publish
 * step itself is pinned the same way in the workflow.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Registry used when `package.json` does not pin one in `publishConfig`. */
export const defaultRegistry = 'https://registry.npmjs.org';

/** Repository root, so callers do not each rebuild the same URL dance. */
export const root = fileURLToPath(new URL('../', import.meta.url));

export interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly registry: string;
}

/** The subset of a packument this project reads; other fields stay opaque. */
export interface RegistryDocument {
  readonly versions?: Record<string, unknown>;
  readonly 'dist-tags'?: Record<string, string>;
}

export function parseManifest(text: string): PackageManifest {
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

export async function readManifest(): Promise<PackageManifest> {
  return parseManifest(await readFile(resolve(root, 'package.json'), 'utf8'));
}

export function registryBase(registry: string): string {
  return registry.replace(/\/+$/, '');
}

/**
 * Reads a packument. A 404 means the package or version is not public yet,
 * which is a normal state right after `npm publish` returns, so it resolves to
 * `undefined` and lets the caller retry instead of aborting.
 */
export async function readPackage(
  registry: string,
  name: string,
  nonce?: number,
): Promise<RegistryDocument | undefined> {
  const base = registryBase(registry);
  // Cache busting: a negative response cached by the CDN must not hide a
  // version that has just been published.
  const query = nonce === undefined ? '' : `?t=${String(nonce)}`;
  const url = `${base}/${encodeURIComponent(name)}${query}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`registry answered ${response.status} ${response.statusText} for ${url}`);
  }
  const document: unknown = await response.json();
  if (typeof document !== 'object' || document === null) {
    throw new Error(`registry document for ${name} is not an object`);
  }
  const record = document as Record<string, unknown>;
  const versions = record['versions'];
  if (typeof versions !== 'object' || versions === null) {
    throw new Error(`registry document for ${name} has no versions map`);
  }
  const tags = record['dist-tags'];
  const distTags =
    typeof tags === 'object' && tags !== null ? (tags as Record<string, string>) : undefined;
  const result: RegistryDocument = { versions: versions as Record<string, unknown> };
  return distTags === undefined ? result : { ...result, 'dist-tags': distTags };
}

/** Published versions come from the registry, never from git: manual releases leave no trace in history. */
export async function publishedVersions(registry: string, name: string): Promise<string[]> {
  const document = await readPackage(registry, name);
  return document === undefined ? [] : Object.keys(document.versions ?? {});
}
