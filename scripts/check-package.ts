import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { parseDocument } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = z
  .object({
    name: z.literal('dsh-snapcompact'),
    version: z.string(),
    engines: z.object({ node: z.literal('>=24'), dsh: z.literal('0.2.2-rc.1') }),
    dsh: z.object({ bundle: z.object({ patch: z.string() }) }),
    files: z.array(z.string()),
  })
  .passthrough()
  .parse(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')));

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
  'presets/snapcompact.yml',
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
  'assets/benchmarks/engineering.json',
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
for (const path of [manifest.dsh.bundle.patch, 'presets/snapcompact.yml']) {
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
