import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { chmod, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESET_VARIANTS } from './preset-variants.ts';

/**
 * Installability contract check for the packaged plugin.
 *
 * The check packs the working tree, installs the tarball into a throwaway
 * profile under `.artifacts/` (never `~/.dsh`), and asserts the contract the
 * DSH boot gate enforces in `dsh-app-boot#loadProfileDirectory`: the bundle is
 * resolvable, declares `dsh.bundle`, is compatible with the running DSH, its
 * patch list loads, and its runtime imports are installed dependencies or
 * host-provided peers. A final control proves the assertions can fail.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.artifacts', 'install-check');
const shimDir = join(work, 'bin');
const homeDir = join(work, 'home');
const profileName = 'install-check';
const buildTimeoutMs = 3 * 60_000;
const packTimeoutMs = 3 * 60_000;
const installTimeoutMs = 5 * 60_000;
const dumpTimeoutMs = 2 * 60_000;

interface Command {
  readonly file: string;
  readonly args: readonly string[];
}

interface Outcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

interface PackageManager {
  readonly file: string;
  readonly args: readonly string[];
  readonly display: string;
}

/** A failure caused by the package or its environment, reported without a stack trace. */
class CheckFailure extends Error {}

const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const wantsHelp = argv.includes('--help') || argv.includes('-h');

function option(name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new CheckFailure(`${name} needs a value`);
  }
  return value;
}

function execute(
  command: Command,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Outcome {
  const result = spawnSync(command.file, [...command.args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 0,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    status: result.status,
    stdout,
    stderr,
    timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
  };
}

function succeed(outcome: Outcome, label: string): Outcome {
  if (outcome.timedOut) throw new CheckFailure(`${label} timed out`);
  if (outcome.status !== 0) {
    throw new CheckFailure(
      `${label} failed with exit code ${String(outcome.status)}\n${tail(outcome)}`,
    );
  }
  return outcome;
}

function tail(outcome: Outcome): string {
  const text = `${outcome.stdout}\n${outcome.stderr}`.trim();
  return text === '' ? '(no output)' : text.split(/\r?\n/u).slice(-20).join('\n');
}

function node(args: readonly string[]): Command {
  return { file: process.execPath, args };
}

function firstLine(text: string): string | undefined {
  const line = text.split(/\r?\n/u)[0]?.trim();
  return line === undefined || line === '' ? undefined : line;
}

function pathLookup(name: string): string | undefined {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  return firstLine(String(result.stdout ?? ''));
}

/** Resolve the DSH CLI used for the installation; the desktop app ships one. */
function resolveDsh(): { readonly path: string; readonly version: string } {
  const explicit = option('--dsh') ?? process.env.DSH_BIN;
  const desktop = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
  const candidates = [explicit, pathLookup('dsh'), desktop].filter(
    (value): value is string => value !== undefined && existsSync(value),
  );
  for (const candidate of candidates) {
    const probe = execute({ file: candidate, args: ['--version'] }, { timeoutMs: 60_000 });
    const version = firstLine(probe.stdout);
    if (probe.status === 0 && version !== undefined && /\d+\.\d+\.\d+/u.test(version)) {
      return { path: candidate, version };
    }
  }
  throw new CheckFailure(
    'No working DSH CLI found. Pass --dsh <path> or set DSH_BIN, or install DSH Desktop.',
  );
}

/** pnpm installations DSH itself prepared; newer DSH releases ship one. */
async function runtimePnpmCandidates(): Promise<readonly Command[]> {
  const runtimes = join(homedir(), '.dsh', 'dsh-runtimes');
  if (!existsSync(runtimes)) return [];
  const names = (await readdir(runtimes)).sort();
  return names
    .map((name) => join(runtimes, name, 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))
    .filter((path) => existsSync(path))
    .map((path) => ({ file: process.execPath, args: [path] }));
}

/**
 * Resolve a pnpm that can run here. DSH forwards plugin management to pnpm on
 * PATH, so a package-manager shim that cannot resolve its own version is not
 * usable; fall back to the runtime pnpm DSH prepared.
 */
async function resolvePnpm(): Promise<PackageManager> {
  const explicit = option('--pnpm') ?? process.env.DSH_PNPM;
  const candidates: Command[] = [];
  if (explicit !== undefined) candidates.push({ file: explicit, args: [] });
  const execpath = process.env.npm_execpath;
  if (execpath !== undefined && /\.(?:c?js|mjs)$/u.test(execpath)) {
    candidates.push({ file: process.execPath, args: [execpath] });
  }
  candidates.push(...(await runtimePnpmCandidates()));
  candidates.push({ file: 'pnpm', args: [] });
  for (const candidate of candidates) {
    const probe = execute(
      { file: candidate.file, args: [...candidate.args, '--version'] },
      { timeoutMs: 60_000 },
    );
    if (probe.status === 0 && /\d+\.\d+\.\d+/u.test(probe.stdout)) {
      return {
        file: candidate.file,
        args: candidate.args,
        display: [candidate.file, ...candidate.args].join(' '),
      };
    }
  }
  throw new CheckFailure(
    'No working pnpm found. Pass --pnpm <path>, set DSH_PNPM, or let DSH prepare its runtime.',
  );
}

/** Put a `pnpm` executable on the child PATH that forwards to the resolved one. */
async function installPnpmShim(pnpm: PackageManager): Promise<string | undefined> {
  if (pnpm.file === 'pnpm' && pnpm.args.length === 0) return undefined;
  await mkdir(shimDir, { recursive: true });
  const quote = (value: string): string => `"${value.replaceAll('"', '\\"')}"`;
  const forwarding = [pnpm.file, ...pnpm.args].map(quote).join(' ');
  if (process.platform === 'win32') {
    await writeFile(join(shimDir, 'pnpm.cmd'), `@echo off\r\n${forwarding} %*\r\n`);
    return shimDir;
  }
  const target = join(shimDir, 'pnpm');
  await writeFile(target, `#!/bin/sh\nexec ${forwarding} "$@"\n`);
  await chmod(target, 0o755);
  return shimDir;
}

function childEnvironment(shim: string | undefined): NodeJS.ProcessEnv {
  const path = process.env.PATH;
  return {
    ...process.env,
    DSH_HOME: homeDir,
    ...(shim === undefined
      ? {}
      : { PATH: path === undefined ? shim : `${shim}${delimiter}${path}` }),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    CI: '1',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/** Bare runtime specifiers in the shipped distribution; relative paths and builtins excluded. */
function bareSpecifiers(source: string): readonly string[] {
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\bimport\s*['"]([^'"]+)['"]/gu,
  ];
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      if (specifier.startsWith('.') || isAbsolute(specifier)) continue;
      if (specifier.startsWith('node:') || specifier.startsWith('file:')) continue;
      found.push(packageNameOf(specifier));
    }
  }
  return found;
}

/** Directory of the DSH installation that supplies host peers, plus an Electron binary when packed in app.asar. */
interface HostAnchor {
  readonly packageDir: string;
  readonly insideAsar: boolean;
  readonly electron?: string;
}

function resolveHostAnchor(dsh: string): HostAnchor {
  const explicit = process.env.DSH_HOST_PACKAGE_DIR;
  if (explicit !== undefined && existsSync(explicit)) {
    return { packageDir: explicit, insideAsar: explicit.includes('.asar') };
  }
  // A package-manager bin entry is usually a symlink; anchor on the real entry.
  let entry = dsh;
  try {
    entry = realpathSync(dsh);
  } catch {
    // Keep the given path when it cannot be resolved.
  }
  const match = /^(.*)[/\\]runtime[/\\]cli[/\\]bin[/\\]dsh(?:\.cmd)?$/u.exec(entry);
  if (match?.[1] !== undefined) {
    const resources = match[1];
    const packageDir = join(resources, 'app.asar', 'dsh');
    const electron = join(resolve(resources, '..'), 'MacOS', 'DeepSeek Harness');
    return { packageDir, insideAsar: true, ...(existsSync(electron) ? { electron } : {}) };
  }
  // A plain Node installation: walk up from the CLI entry to the owning package.
  let current = dirname(entry);
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, 'package.json'))) {
      return { packageDir: current, insideAsar: current.includes('.asar') };
    }
    current = dirname(current);
  }
  throw new CheckFailure(
    `Cannot locate the DSH installation that owns ${dsh}; set DSH_HOST_PACKAGE_DIR`,
  );
}

/** Peer packages the host must supply, checked through Electron when the host lives inside app.asar. */
function missingHostPackages(anchor: HostAnchor, names: readonly string[]): readonly string[] {
  if (names.length === 0) return [];
  if (!anchor.insideAsar) {
    const resolver = createRequire(join(anchor.packageDir, 'package.json'));
    return names.filter((name) => {
      try {
        resolver.resolve(name);
        return false;
      } catch {
        return true;
      }
    });
  }
  const electron = anchor.electron;
  assert(
    electron !== undefined && existsSync(electron),
    `Cannot inspect ${anchor.packageDir}: the Electron binary is unavailable`,
  );
  const script = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const input = JSON.parse(process.env.DSH_PEER_CHECK ?? '{}');",
    'const missing = (input.names ?? []).filter((name) =>',
    "  !fs.existsSync(path.join(input.root, 'node_modules', name, 'package.json')));",
    'process.stdout.write(JSON.stringify(missing));',
  ].join('\n');
  const outcome = execute(
    { file: electron, args: ['-e', script] },
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_PEER_CHECK: JSON.stringify({ root: anchor.packageDir, names }),
      },
      timeoutMs: 60_000,
    },
  );
  succeed(outcome, 'Host peer probe');
  const parsed: unknown = JSON.parse(outcome.stdout);
  assert(Array.isArray(parsed), 'Host peer probe returned an unexpected answer');
  return parsed.filter((name): name is string => typeof name === 'string');
}

function usage(): string {
  return `${[
    'Usage: check-install [--keep] [--dsh <path>] [--pnpm <path>]',
    '',
    'Pack the plugin, install it into a throwaway DSH profile, and assert the',
    'installed bundle satisfies the host boot contract. Everything lives under',
    '.artifacts/install-check; real profiles are never touched.',
    '',
    '  --keep        Keep the throwaway home and package manager caches',
    '  --dsh <path>  DSH CLI to use (default: DSH_BIN, dsh on PATH, then DSH Desktop)',
    '  --pnpm <path> pnpm to use (default: DSH_PNPM, npm_execpath, DSH runtime, then PATH)',
  ].join('\n')}\n`;
}

async function main(): Promise<void> {
  if (wantsHelp) {
    process.stdout.write(usage());
    return;
  }

  const dsh = resolveDsh();
  const pnpm = await resolvePnpm();
  process.stdout.write(`DSH CLI: ${dsh.path} (${dsh.version})\nPackage manager: ${pnpm.display}\n`);

  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  process.stdout.write('\n[1/5] Building and packing the plugin\n');
  succeed(
    execute(node(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']), {
      timeoutMs: buildTimeoutMs,
    }),
    'TypeScript build',
  );
  succeed(
    execute(node(['--experimental-strip-types', 'scripts/build-preset.ts']), {
      timeoutMs: buildTimeoutMs,
    }),
    'Preset build',
  );

  const manifest: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert(
    typeof manifest === 'object' &&
      manifest !== null &&
      'name' in manifest &&
      'version' in manifest,
    'package.json has no name or version',
  );
  const name = String((manifest as { name: unknown }).name);
  const version = String((manifest as { version: unknown }).version);
  const expectedTarball = `${name}-${version}.tgz`;
  await rm(join(root, expectedTarball), { force: true });
  const packed = succeed(
    execute(
      { file: pnpm.file, args: [...pnpm.args, 'pack'] },
      { cwd: root, timeoutMs: packTimeoutMs },
    ),
    'Package pack',
  );
  const printed = packed.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1);
  const tarballName =
    printed !== undefined && printed.endsWith('.tgz') ? basename(printed) : expectedTarball;
  const packedPath = join(root, tarballName);
  assert(existsSync(packedPath), `Package pack produced no ${tarballName}`);
  await rename(packedPath, join(work, tarballName));

  const shim = await installPnpmShim(pnpm);
  const env = childEnvironment(shim);
  const profileDir = join(homeDir, 'profiles', profileName);

  process.stdout.write('\n[2/5] Installing into a throwaway DSH profile\n');
  const installed = execute(
    {
      file: dsh.path,
      args: [
        'plugin',
        '--profile',
        profileName,
        'add',
        `file:${join(work, tarballName)}`,
        `--config.store-dir=${join(work, 'pnpm-store')}`,
        `--config.cache-dir=${join(work, 'pnpm-cache')}`,
      ],
    },
    { env, timeoutMs: installTimeoutMs },
  );
  succeed(installed, 'Plugin install');
  assert(
    !/incompatible-version/u.test(installed.stderr),
    `The host rejected the plugin as incompatible:\n${tail(installed)}`,
  );

  const profileManifest: unknown = JSON.parse(
    await readFile(join(profileDir, 'package.json'), 'utf8'),
  );
  assert(
    typeof profileManifest === 'object' && profileManifest !== null,
    'Profile manifest is invalid',
  );
  const dependencies =
    (profileManifest as { dependencies?: Record<string, string> }).dependencies ?? {};
  assert(
    typeof dependencies[name] === 'string',
    `Profile manifest does not record a dependency on ${name}`,
  );
  const bundles =
    (profileManifest as { dsh?: { profile?: { bundles?: readonly string[] } } }).dsh?.profile
      ?.bundles ?? [];
  assert(bundles.includes(name), `Profile manifest does not select ${name} as a bundle`);
  process.stdout.write(`      ${name}@${version} recorded and selected as a profile bundle\n`);

  process.stdout.write('\n[3/5] Composing the host configuration\n');
  const dump = succeed(
    execute(
      { file: dsh.path, args: ['--profile', profileName, '--dump-config'] },
      { env, timeoutMs: dumpTimeoutMs },
    ),
    'Config composition',
  );
  assert(
    !/skipping profile bundle/u.test(dump.stderr),
    `The host skipped the bundle:\n${dump.stderr}`,
  );
  for (const variant of PRESET_VARIANTS) {
    assert(
      dump.stdout.includes(`preset-${variant.id}`),
      `The composed configuration has no ${variant.name} preset:\n${tail(dump)}`,
    );
  }
  assert(
    dump.stdout.includes(`name: ${name}`),
    `The composed configuration does not mount ${name}:\n${tail(dump)}`,
  );
  process.stdout.write(
    `      ${String(PRESET_VARIANTS.length)} Snapcompact presets composed; the host skipped no bundle\n`,
  );

  process.stdout.write('\n[4/5] Checking runtime imports against the installation\n');
  const packageDir = join(profileDir, 'node_modules', name);
  const distDir = join(packageDir, 'dist');
  assert(existsSync(distDir), `The installed package has no dist directory: ${distDir}`);
  const files = (await readdir(distDir, { recursive: true })).filter((file) =>
    file.endsWith('.js'),
  );
  assert(files.length > 0, `The installed package ships no JavaScript: ${distDir}`);
  const specifiers = new Set<string>();
  for (const file of files) {
    const source = await readFile(join(distDir, file), 'utf8');
    for (const specifier of bareSpecifiers(source)) specifiers.add(specifier);
  }

  const declared = manifest as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const dependenciesOfPackage = Object.keys(declared.dependencies ?? {});
  const peersOfPackage = Object.keys(declared.peerDependencies ?? {});
  const undeclared = [...specifiers].filter(
    (specifier) =>
      !dependenciesOfPackage.includes(specifier) && !peersOfPackage.includes(specifier),
  );
  assert(
    undeclared.length === 0,
    `Runtime imports are not declared in package.json: ${undeclared.join(', ')}`,
  );
  const importedDependencies = [...specifiers].filter((specifier) =>
    dependenciesOfPackage.includes(specifier),
  );
  const missingDependencies = importedDependencies.filter(
    (dependency) => !existsSync(join(profileDir, 'node_modules', dependency, 'package.json')),
  );
  assert(
    missingDependencies.length === 0,
    `The installation is missing imported dependencies: ${missingDependencies.join(', ')}`,
  );
  const importedPeers = [...specifiers].filter((specifier) => peersOfPackage.includes(specifier));
  const missingPeers = missingHostPackages(resolveHostAnchor(dsh.path), importedPeers);
  assert(
    missingPeers.length === 0,
    `The host does not provide imported peers: ${missingPeers.join(', ')}`,
  );
  process.stdout.write(
    `      ${String(specifiers.size)} imported packages: ` +
      `${String(importedDependencies.length)} installed dependencies, ` +
      `${String(importedPeers.length)} host-provided peers\n`,
  );

  process.stdout.write('\n[5/5] Proving the check detects a broken bundle\n');
  const brokenName = `${name}-without-bundle`;
  const brokenDir = join(profileDir, 'node_modules', brokenName);
  await cp(packageDir, brokenDir, { recursive: true });
  const broken: unknown = JSON.parse(await readFile(join(brokenDir, 'package.json'), 'utf8'));
  assert(typeof broken === 'object' && broken !== null, 'Copied manifest is invalid');
  delete (broken as { dsh?: unknown }).dsh;
  (broken as { name?: string }).name = brokenName;
  await writeFile(join(brokenDir, 'package.json'), `${JSON.stringify(broken, undefined, 2)}\n`);
  const profileManifestPath = join(profileDir, 'package.json');
  const pristineManifest = await readFile(profileManifestPath, 'utf8');
  const controlManifest: unknown = JSON.parse(pristineManifest);
  assert(
    typeof controlManifest === 'object' && controlManifest !== null,
    'Profile manifest is invalid',
  );
  (controlManifest as { dsh: { profile: { bundles: string[] } } }).dsh.profile.bundles =
    bundles.map((bundle) => (bundle === name ? brokenName : bundle));
  await writeFile(profileManifestPath, `${JSON.stringify(controlManifest, undefined, 2)}\n`);
  const control = execute(
    { file: dsh.path, args: ['--profile', profileName, '--dump-config'] },
    { env, timeoutMs: dumpTimeoutMs },
  );
  assert(
    /skipping profile bundle/u.test(control.stderr),
    'A bundle without dsh.bundle was not reported as skipped; the check cannot detect regressions',
  );
  // Leave a kept profile in its installed state; the control bundle only existed for this probe.
  await writeFile(profileManifestPath, pristineManifest);
  await rm(brokenDir, { recursive: true, force: true });
  process.stdout.write('      A bundle without dsh.bundle is correctly reported as skipped\n');

  process.stdout.write(
    `\nInstallability contract verified for ${name}@${version} on DSH ${dsh.version}.\n`,
  );
  if (keep) {
    process.stdout.write(`Kept ${work}\n`);
    return;
  }
  await rm(work, { recursive: true, force: true });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nInstallability check failed: ${message}\n`);
  if (existsSync(work)) process.stderr.write(`Diagnostics kept in ${work}\n`);
  process.exitCode = 1;
}
