import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { PRESET_VARIANTS } from '../scripts/preset-variants.ts';
import { Config, DEFAULT_METHOD_ORDER, resolveConfig } from './config.js';

interface PresetEntry {
  readonly id: string;
  readonly config?: readonly PresetEntry[] | { readonly section?: string };
}

function readPreset(source: string): readonly PresetEntry[] {
  return parse(readFileSync(new URL(`../presets/${source}`, import.meta.url), 'utf8'), {
    logLevel: 'silent',
  }) as readonly PresetEntry[];
}

describe('plugin configuration', () => {
  for (const variant of PRESET_VARIANTS) {
    it(`keeps the ${variant.mode} plan-mode section non-empty`, () => {
      const preset = readPreset(variant.source);
      const planning = preset.find((entry) => entry.id === 'planning');
      const planMode = (planning?.config as readonly PresetEntry[] | undefined)?.find(
        (entry) => entry.id === 'plan-mode',
      );
      expect(
        (planMode?.config as { section?: string } | undefined)?.section?.trim().length,
      ).toBeGreaterThan(0);
    });
    it(`mounts /compact without the native compaction backend in ${variant.mode}`, () => {
      const preset = readPreset(variant.source);
      const compaction = preset.find((entry) => entry.id === 'compaction');
      const ids = ((compaction?.config as readonly PresetEntry[] | undefined) ?? []).map(
        (entry) => entry.id,
      );
      expect(ids).toContain('snapcompact');
      expect(ids).toContain('command-compact');
      expect(ids).not.toContain('compaction-basic');
      expect(ids).not.toContain('tool-result-pruner');
    });
  }
  it('defaults to the compaction role and accepts the UI carrier role', () => {
    expect(resolveConfig({}).role).toBe('plugin');
    expect(resolveConfig({ role: 'ui' }).role).toBe('ui');
    expect(Config({}).role).toBe('plugin');
    expect(() => resolveConfig({ role: 'ui-carrier' })).toThrow();
  });
  it('supplies conservative detached defaults', () => {
    const config = resolveConfig({});
    expect(config.methodOrder).toEqual(['snapcompact', 'shake', 'soft']);
    expect(config.rendering).toMatchObject({
      width: 1568,
      height: 1568,
      maxFrames: 20,
      lineHeight: 20,
      minGlyphPx: 12,
    });
    expect(config.serialization).toMatchObject({
      toolResultMaxChars: 2_000,
      headChars: 2_000,
      tailChars: 2_000,
      maxCarriedImages: 4,
    });
    expect(config.routePolicies).toEqual([]);
    expect(config.budget).toEqual({ checkpointShare: 0.4 });
    config.methodOrder.pop();
    expect(resolveConfig({}).methodOrder).toHaveLength(3);
  });
  it('keeps the loader schema default aligned with the strict parser', () => {
    expect(Config({}).methodOrder).toEqual([...DEFAULT_METHOD_ORDER]);
    expect(Config({}).guard).toEqual(resolveConfig({}).guard);
  });
  it('supplies usefulness guard defaults and accepts overrides', () => {
    expect(resolveConfig({}).guard).toEqual({
      minCompactableRatio: 0.1,
      minSourceRatio: 0.01,
    });
    expect(
      resolveConfig({ guard: { minCompactableRatio: 0, minSourceRatio: 0.05 } }).guard,
    ).toEqual({ minCompactableRatio: 0, minSourceRatio: 0.05 });
  });
  it('rejects retention carried in both forms within one scope', () => {
    expect(() => resolveConfig({ policy: { retainRatio: 0.1, retainTokens: 1_024 } })).toThrow(
      /mutually exclusive/,
    );
    expect(() =>
      resolveConfig({
        policy: {
          modelPolicies: [{ provider: 'a', model: 'b', retainRatio: 0.1, retainTokens: 1_024 }],
        },
      }),
    ).toThrow(/mutually exclusive/);
  });
  it('accepts frame counts up to the renderer ceiling', () => {
    expect(resolveConfig({ rendering: { maxFrames: 64 } }).rendering.maxFrames).toBe(64);
  });
  it('accepts explicit subsets that still end with soft', () => {
    expect(resolveConfig({ methodOrder: ['snapcompact', 'soft'] }).methodOrder).toEqual([
      'snapcompact',
      'soft',
    ]);
    expect(resolveConfig({ methodOrder: ['soft'] }).methodOrder).toEqual(['soft']);
  });
  it('keeps the retired compression ratio parseable but unused', () => {
    const resolved = resolveConfig({ minCompressionRatio: 3 });
    expect(resolved.minCompressionRatio).toBe(3);
    // Nothing consumes it any more: the checkpoint budget is trigger-relative.
    expect(resolveConfig({}).minCompressionRatio).toBeUndefined();
  });
  it.each([
    { methodOrder: [] },
    { methodOrder: ['soft', 'soft'] },
    { methodOrder: ['shake'] },
    { methodOrder: ['handoff', 'soft'] },
    { methodOrder: ['remote', 'soft'] },
    { typo: true },
    { guard: { minCompactableRatio: -0.1 } },
    { guard: { minSourceRatio: 1 } },
    { guard: { unknown: 1 } },
    { budget: { checkpointShare: 0.2 } },
    { budget: { checkpointShare: 0.51 } },
    { budget: { checkpointShare: 'half' } },
    { budget: { unknown: 1 } },
    { rendering: { maxFrames: 65 } },
    { rendering: { timeoutMs: 15_001 } },
    { rendering: { maxSourceBytes: 65 * 1024 * 1024 } },
    { routePolicies: [{ provider: 'a', model: 'b', visualTokensPerFrame: -1 }] },
    {
      routePolicies: [
        { provider: 'a', model: 'b', visualTokensPerFrame: 1 },
        { provider: 'a', model: 'b', visualTokensPerFrame: 2 },
      ],
    },
  ])('rejects invalid configuration %j', (config) => {
    expect(() => resolveConfig(config)).toThrow();
  });
});
