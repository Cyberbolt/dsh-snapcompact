import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { parseDocument } from 'yaml';
import {
  DSH_BASELINE_VERSION,
  DSH_COMPAT_RANGE,
  compatibilityProblems,
  documentationProblems,
} from './compat.ts';
import { PRESET_VARIANTS } from './preset-variants.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = z
  .object({
    name: z.literal('dsh-snapcompact'),
    version: z.string(),
    engines: z.object({ node: z.literal('>=24'), dsh: z.string() }),
    peerDependencies: z.record(z.string(), z.string()),
    devDependencies: z.record(z.string(), z.string()),
    dsh: z.object({ bundle: z.object({ patch: z.string() }) }),
    files: z.array(z.string()),
  })
  .passthrough()
  .parse(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')));

// package.json cannot import the claim, so the manifest is checked against the
// single source instead of both drifting. A passing claim is a bounded caret
// range whose floor is exactly the baseline host release.
const problems = compatibilityProblems({
  range: DSH_COMPAT_RANGE,
  baseline: DSH_BASELINE_VERSION,
  enginesDsh: manifest.engines.dsh,
  peerDependencies: manifest.peerDependencies,
  devDependencies: manifest.devDependencies,
});
assert(
  problems.length === 0,
  `DSH compatibility claim is inconsistent:\n  - ${problems.join('\n  - ')}`,
);

// Install instructions pin the release version, so a stable release must keep
// both READMEs in step with package.json. Prereleases are not announced there.
if (!manifest.version.includes('-')) {
  for (const readme of ['README.md', 'README.zh.md']) {
    const text = await readFile(resolve(root, readme), 'utf8');
    assert(
      text.includes(`dsh-snapcompact@${manifest.version}`),
      `${readme} must reference dsh-snapcompact@${manifest.version}`,
    );
  }
}

const required = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/settings-entry.js',
  'dist/settings-entry.d.ts',
  'dist/rendering/worker.js',
  manifest.dsh.bundle.patch,
  ...PRESET_VARIANTS.map((variant) => `presets/${variant.source}`),
  'client/client.js',
  'locale/en.json',
  'locale/zh.json',
  'icon.svg',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'THIRD_PARTY_NOTICES.zh.md',
  'README.md',
  'README.zh.md',
  'assets/fonts/unifont_all-18.0.01.hex.gz',
  'assets/fonts/OFL-1.1.txt',
  'assets/fonts/UPSTREAM-COPYRIGHT.txt',
  'assets/benchmarks/engineering-v3.json',
  'docs/architecture.md',
  'docs/configuration.md',
  'docs/evaluation.md',
  'docs/zh/architecture.md',
  'docs/zh/configuration.md',
  'docs/zh/evaluation.md',
];
for (const path of required) {
  const absolute = resolve(root, path);
  const local = relative(root, absolute);
  assert(!local.startsWith('..') && !isAbsolute(local), `Resource escapes package: ${path}`);
  assert((await stat(absolute)).isFile(), `Missing regular package resource: ${path}`);
  const packagePath = local.replaceAll('\\', '/');
  assert(
    manifest.files.some((entry) => packagePath === entry || packagePath.startsWith(`${entry}/`)),
    `Resource omitted from files: ${path}`,
  );
}
// The prose cannot import the claim either, so both languages must name the
// supported line and must not pin the bare baseline. A pinned host version
// would age with every DSH patch; the line alone lets a 0.2.x release install
// without a documentation edit.
for (const path of [
  'README.md',
  'README.zh.md',
  'docs/configuration.md',
  'docs/zh/configuration.md',
]) {
  const text = await readFile(resolve(root, path), 'utf8');
  const prose = documentationProblems(text);
  assert(prose.length === 0, `${path}: ${prose.join('; ')}`);
  if (path.startsWith('README')) {
    assert(
      !text.includes(DSH_COMPAT_RANGE),
      `${path} must name the supported line, not the release range ${DSH_COMPAT_RANGE}; ` +
        'keep the range in docs/configuration.md and engines.dsh',
    );
  }
}
const metadata = z.object({
  meta: z.object({ title: z.string().min(1), description: z.string().min(1) }),
});
for (const locale of ['en', 'zh']) {
  metadata.parse(JSON.parse(await readFile(resolve(root, `locale/${locale}.json`), 'utf8')));
}
const svg = await readFile(resolve(root, 'icon.svg'), 'utf8');
assert(
  Buffer.byteLength(svg) <= 256 * 1024 && svg.includes('<svg') && svg.includes('viewBox='),
  'Invalid SVG icon',
);
const clientBundle = await readFile(resolve(root, 'client/client.js'), 'utf8');
assert(
  !clientBundle.includes('__SNAPCOMPACT_SETTINGS_FIELDS__'),
  'client/client.js still contains the generated-field marker; run pnpm build',
);
assert(
  clientBundle.includes('plugins.bundle.config') && clientBundle.includes("'snapcompact-settings'"),
  'client/client.js must register the plugin-page settings card',
);

const font = await readFile(resolve(root, 'assets/fonts/unifont_all-18.0.01.hex.gz'));
assert.equal(
  createHash('sha256').update(font).digest('hex'),
  '14c96e497466a82e46cf20032ce510e186bdc8658c9158e2290f452cda9bc498',
);
for (const path of [
  manifest.dsh.bundle.patch,
  ...PRESET_VARIANTS.map((variant) => `presets/${variant.source}`),
]) {
  const document = parseDocument(await readFile(resolve(root, path), 'utf8'), {
    customTags: [
      { tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) },
    ],
  });
  assert.equal(document.errors.length, 0, `Invalid Loader YAML: ${path}`);
  assert(Array.isArray(document.toJS()), `Expected entry/patch list: ${path}`);
}
console.log(
  `Package ${manifest.name}@${manifest.version}: resources, metadata, YAML and font integrity verified.`,
);
