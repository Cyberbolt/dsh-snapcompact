import { readFile, writeFile } from 'node:fs/promises';
import { SETTINGS_FIELDS } from '../src/settings/metadata.ts';

// The browser half is a single ModuleLoader file with no bundler, so the field
// table is inlined here. One TypeScript source keeps form defaults and the Host
// schema from drifting.

const MARKER = '/* __SNAPCOMPACT_SETTINGS_FIELDS__ */';
const checkOnly = process.argv.includes('--check');
const templateUrl = new URL('../client/client.template.js', import.meta.url);
const targetUrl = new URL('../client/client.js', import.meta.url);

const template = await readFile(templateUrl, 'utf8');
if (!template.includes(MARKER)) {
  throw new Error(`client template is missing ${MARKER}`);
}

interface ClientField {
  readonly key: string;
  readonly kind: 'chain' | 'number';
  readonly group: string;
  readonly defaultValue?: number | readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly scale?: number;
}

const fields: ClientField[] = SETTINGS_FIELDS.map((field) => ({
  key: field.key,
  kind: field.kind,
  group: field.group,
  ...(field.defaultValue === undefined
    ? {}
    : {
        defaultValue: Array.isArray(field.defaultValue)
          ? [...field.defaultValue]
          : field.defaultValue,
      }),
  ...(field.min === undefined ? {} : { min: field.min }),
  ...(field.max === undefined ? {} : { max: field.max }),
  ...(field.step === undefined ? {} : { step: field.step }),
  ...(field.scale === undefined ? {} : { scale: field.scale }),
}));

const placeholder = `[\n      ${MARKER}\n    ]`;
const body = JSON.stringify(fields, null, 2)
  .split('\n')
  .map((line, index) => (index === 0 ? line : `      ${line}`))
  .join('\n');

const output = template.replace(placeholder, body);
if (output.includes(MARKER)) {
  throw new Error('client build left the generated-field marker in place');
}
if (checkOnly) {
  const existing = await readFile(targetUrl, 'utf8').catch(() => undefined);
  if (existing !== output) {
    throw new Error('client/client.js is stale; run pnpm build');
  }
} else {
  await writeFile(targetUrl, output);
}
