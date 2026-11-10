import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface Check {
  readonly label: string;
  readonly args: readonly string[];
  readonly fullOnly?: boolean;
}

const testOnly = process.argv.includes('--test-only');
const testArgs = process.argv.slice(2).filter((arg) => arg !== '--test-only');
const root = fileURLToPath(new URL('../', import.meta.url));
const checks: readonly Check[] = [
  { label: 'Strict types', args: ['node_modules/typescript/bin/tsc', '--noEmit'], fullOnly: true },
  { label: 'Lint', args: ['node_modules/eslint/bin/eslint.js', '.'], fullOnly: true },
  {
    label: 'Formatting',
    args: ['node_modules/prettier/bin/prettier.cjs', '--check', '.'],
    fullOnly: true,
  },
  {
    label: 'ESM and portable declarations',
    args: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  },
  {
    label: 'Preset declaration up to date',
    args: ['--experimental-strip-types', 'scripts/build-preset.ts', '--check'],
  },
  {
    label: 'Client bundle up to date',
    args: ['--experimental-strip-types', 'scripts/build-client.ts', '--check'],
  },
  {
    label: 'Unit and native-integration tests',
    args: ['node_modules/vitest/vitest.mjs', 'run', ...testArgs],
  },
  {
    label: 'Distribution resources',
    args: ['--experimental-strip-types', 'scripts/check-package.ts'],
    fullOnly: true,
  },
];

// Reuse the caller's Node and local entries. No recursive package-manager invocations,
// alternate global tool versions, install scripts, or network access are needed here.
for (const check of checks) {
  if (testOnly && check.fullOnly) continue;
  console.log(`\n== ${check.label} ==`);
  const result = spawnSync(process.execPath, [...check.args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
