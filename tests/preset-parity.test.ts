import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PRESET_VARIANTS } from '../scripts/preset-variants.ts';

// The vendored snapshots are the pinned official compositions for engines.dsh.
// This test fails row-by-row when a manual copy drifts, and it also documents
// the only differences a Snapcompact variant may introduce.
const customTags = [
  { tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) },
];

interface Row {
  readonly id: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

interface PresetDeclaration {
  readonly config: { readonly id: string; readonly plugins: readonly Row[] };
}

/** The only compaction backend a Snapcompact variant mounts. */
const SNAPCOMPACT_COMPACTION: readonly Row[] = [
  {
    id: 'snapcompact',
    name: 'dsh-snapcompact',
    config: { methodOrder: ['snapcompact', 'handoff', 'shake', 'soft'] },
  },
  { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
];

function parseYaml(path: string): unknown {
  return parse(readFileSync(new URL(path, import.meta.url), 'utf8'), { customTags });
}

function officialPlugins(mode: string): readonly Row[] {
  const document = parseYaml(`../tests/fixtures/official-presets/${mode}.patch.yml`) as
    | readonly { readonly insert: readonly PresetDeclaration[] }[]
    | undefined;
  const declaration = document?.[0]?.insert[0];
  expect(declaration, `fixture ${mode} declares no preset`).toBeDefined();
  return declaration?.config.plugins ?? [];
}

function variantPlugins(source: string): readonly Row[] {
  const plugins = parseYaml(`../presets/${source}`);
  expect(Array.isArray(plugins), `${source} is not an entry list`).toBe(true);
  return plugins as readonly Row[];
}

/**
 * Apply the documented, intentional differences to an official plugin list.
 *
 * - `tool-plugin-market` is disabled in every official roster and contributes
 *   nothing; leaving it out avoids resolving a plugin that not every host ships.
 * - The native summary backend and the destructive tool-result pruner are
 *   replaced by Snapcompact; shake archives before externalizing.
 */
function expectedPlugins(mode: string): readonly Row[] {
  return officialPlugins(mode)
    .filter((row) => row.id !== 'tool-plugin-market')
    .map((row) => (row.id === 'compaction' ? { ...row, config: SNAPCOMPACT_COMPACTION } : row));
}

describe('preset parity with shipped DSH compositions', () => {
  for (const variant of PRESET_VARIANTS) {
    it(`matches the official ${variant.mode} preset except for compaction`, () => {
      expect(variantPlugins(variant.source)).toEqual(expectedPlugins(variant.mode));
    });

    it(`declares the ${variant.mode} fixture under preset-${variant.mode}`, () => {
      const document = parseYaml(`../tests/fixtures/official-presets/${variant.mode}.patch.yml`) as
        | readonly { readonly insert: readonly { readonly id: string }[] }[]
        | undefined;
      expect(document?.[0]?.insert[0]?.id).toBe(`preset-${variant.mode}`);
    });
  }

  it('ships one unique preset id per supported mode', () => {
    const ids = PRESET_VARIANTS.map((variant) => variant.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(PRESET_VARIANTS.map((variant) => variant.mode)).size).toBe(
      PRESET_VARIANTS.length,
    );
  });

  it('emits every source list verbatim into the bundle patch', () => {
    const document = parseYaml('../cordis.patch.yml') as
      | readonly { readonly insert?: readonly Row[] }[]
      | undefined;
    const rows = (document ?? []).flatMap((layer) => layer.insert ?? []);
    for (const variant of PRESET_VARIANTS) {
      const declaration = rows.find((row) => row.id === `preset-${variant.id}`);
      expect(declaration, `bundle patch has no preset-${variant.id}`).toBeDefined();
      expect(declaration?.config).toMatchObject({
        id: variant.id,
        name: variant.name,
        description: variant.description,
        order: variant.order,
        plugins: variantPlugins(variant.source),
      });
    }
  });
});
