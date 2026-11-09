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
  it('supplies conservative detached defaults', () => {
    const config = resolveConfig({});
    expect(config.methodOrder).toEqual(['snapcompact', 'handoff', 'shake', 'soft']);
    expect(config.rendering).toMatchObject({
      width: 2048,
      height: 2048,
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
  it('accepts explicit subsets that still end with soft', () => {
    expect(resolveConfig({ methodOrder: ['snapcompact', 'soft'] }).methodOrder).toEqual([
      'snapcompact',
      'soft',
    ]);
    expect(resolveConfig({ methodOrder: ['soft'] }).methodOrder).toEqual(['soft']);
  });
  it.each([
    { methodOrder: [] },
    { methodOrder: ['soft', 'soft'] },
    { methodOrder: ['handoff'] },
    { methodOrder: ['remote', 'soft'] },
    { typo: true },
    { rendering: { maxFrames: 21 } },
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
