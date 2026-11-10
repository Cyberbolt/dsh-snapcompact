import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { Config, DEFAULT_METHOD_ORDER, resolveConfig } from './config.js';

describe('plugin configuration', () => {
  it('keeps the shipped plan-mode section non-empty', () => {
    const preset = parse(
      readFileSync(new URL('../presets/snapcompact.yml', import.meta.url), 'utf8'),
      { logLevel: 'silent' },
    ) as { id: string; config?: { id: string; config?: { section?: string } }[] }[];
    const planning = preset.find((entry) => entry.id === 'planning');
    const planMode = planning?.config?.find((entry) => entry.id === 'plan-mode');
    expect(planMode?.config?.section?.trim().length).toBeGreaterThan(0);
  });
  it('mounts /compact without the native compaction backend', () => {
    const preset = parse(
      readFileSync(new URL('../presets/snapcompact.yml', import.meta.url), 'utf8'),
      { logLevel: 'silent' },
    ) as { id: string; config?: { id: string }[] }[];
    const compaction = preset.find((entry) => entry.id === 'compaction');
    const ids = (compaction?.config ?? []).map((entry) => entry.id);
    expect(ids).toContain('snapcompact');
    expect(ids).toContain('command-compact');
    expect(ids).not.toContain('compaction-basic');
  });
  it('defaults to the compaction role and accepts the UI carrier role', () => {
    expect(resolveConfig({}).role).toBe('plugin');
    expect(resolveConfig({ role: 'ui' }).role).toBe('ui');
    expect(Config({}).role).toBe('plugin');
    expect(() => resolveConfig({ role: 'ui-carrier' })).toThrow();
  });
  it('supplies conservative detached defaults', () => {
    const config = resolveConfig({});
    expect(config.methodOrder).toEqual(['snapcompact', 'handoff', 'shake', 'soft']);
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
    config.methodOrder.pop();
    expect(resolveConfig({}).methodOrder).toHaveLength(4);
  });
  it('keeps the loader schema default aligned with the strict parser', () => {
    expect(Config({}).methodOrder).toEqual([...DEFAULT_METHOD_ORDER]);
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
    { methodOrder: ['handoff'] },
    { methodOrder: ['remote', 'soft'] },
    { typo: true },
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
