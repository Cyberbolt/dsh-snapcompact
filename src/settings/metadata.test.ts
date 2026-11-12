import { describe, expect, it } from 'vitest';
import { DEFAULT_METHOD_ORDER, resolveConfig } from '../config.js';
import {
  applyUserSettings,
  DEFAULT_USER_CHAIN,
  defaultUserSettings,
  readUserSettings,
  SETTINGS_FIELDS,
  SETTINGS_KEYS,
  type UserSettings,
} from './metadata.js';

function resolvePath(input: unknown, path: readonly string[]): unknown {
  let current = input;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

describe('settings metadata', () => {
  it('mirrors the plugin default method chain', () => {
    expect(DEFAULT_USER_CHAIN).toEqual(DEFAULT_METHOD_ORDER);
  });

  it('publishes one unique key per field', () => {
    expect(new Set(SETTINGS_KEYS).size).toBe(SETTINGS_KEYS.length);
    expect(SETTINGS_KEYS).toEqual(SETTINGS_FIELDS.map((field) => field.key));
  });

  it('keeps every declared default identical to the plugin parser default', () => {
    const resolved = resolveConfig({});
    for (const field of SETTINGS_FIELDS) {
      if (field.defaultValue === undefined) continue;
      for (const path of field.paths) {
        expect(resolvePath(resolved, path), `${field.key} -> ${path.join('.')}`).toEqual(
          field.defaultValue,
        );
      }
    }
  });

  it('overrides configured paths without mutating the input', () => {
    const input = { methodOrder: ['soft'], rendering: { width: 1024, height: 1024, maxFrames: 4 } };
    const settings: UserSettings = {
      methodOrder: ['snapcompact', 'soft'],
      frameSize: 1536,
      maxFrames: 8,
    };
    const merged = applyUserSettings(input, settings) as typeof input;
    expect(merged.methodOrder).toEqual(['snapcompact', 'soft']);
    expect(merged.rendering).toEqual({ width: 1536, height: 1536, maxFrames: 8 });
    expect(input.rendering).toEqual({ width: 1024, height: 1024, maxFrames: 4 });
    expect(input.methodOrder).toEqual(['soft']);
    expect(resolveConfig(merged).rendering.maxFrames).toBe(8);
  });

  it('leaves the preset threshold in force until the user overrides it', () => {
    const input = { policy: { thresholdRatio: 0.7 } };
    const untouched = applyUserSettings(input, { maxFrames: 10 });
    expect(resolveConfig(untouched).policy.thresholdRatio).toBe(0.7);
    const overridden = applyUserSettings(input, { thresholdRatio: 0.55 });
    expect(resolveConfig(overridden).policy.thresholdRatio).toBe(0.55);
  });

  it('drops a legacy sub-0.5 trigger so the preset value can take over', () => {
    expect(readUserSettings({ thresholdRatio: 0.49 })).toEqual({});
    expect(readUserSettings({ thresholdRatio: 0.5 })).toEqual({ thresholdRatio: 0.5 });
    expect(
      resolveConfig(
        applyUserSettings(
          { policy: { thresholdRatio: 0.7 } },
          readUserSettings({ thresholdRatio: 0.2 }),
        ),
      ).policy.thresholdRatio,
    ).toBe(0.7);
  });

  it('copies the chain instead of sharing the settings array', () => {
    const settings: UserSettings = { methodOrder: ['snapcompact', 'soft'] };
    const merged = resolveConfig(applyUserSettings({}, settings));
    merged.methodOrder.pop();
    expect(settings.methodOrder).toEqual(['snapcompact', 'soft']);
  });

  it('reads plain values and volatile references alike', () => {
    expect(readUserSettings({ maxFrames: 6, frameSize: 1024 })).toEqual({
      maxFrames: 6,
      frameSize: 1024,
    });
    const volatile = {
      methodOrder: { get: () => ['soft'] },
      maxFrames: { get: () => 12 },
      shakeThresholdChars: { get: () => 4096 },
    };
    expect(readUserSettings(volatile)).toEqual({
      methodOrder: ['soft'],
      maxFrames: 12,
      shakeThresholdChars: 4096,
    });
  });

  it('drops chains the strict parser would reject', () => {
    expect(readUserSettings({ methodOrder: ['soft', 'snapcompact'] })).toEqual({});
    expect(readUserSettings({ methodOrder: ['soft', 'soft'] })).toEqual({});
    expect(readUserSettings({ methodOrder: ['handoff'] })).toEqual({});
    expect(readUserSettings({ methodOrder: [] })).toEqual({});
    expect(readUserSettings({ methodOrder: ['snapcompact', 'soft'] })).toEqual({
      methodOrder: ['snapcompact', 'soft'],
    });
  });

  it('drops the removed handoff name without discarding the saved order', () => {
    expect(readUserSettings({ methodOrder: ['snapcompact', 'handoff', 'shake', 'soft'] })).toEqual({
      methodOrder: ['snapcompact', 'shake', 'soft'],
    });
    expect(readUserSettings({ methodOrder: ['handoff', 'soft'] })).toEqual({
      methodOrder: ['soft'],
    });
    // An unknown name still invalidates the chain instead of being filtered out.
    expect(readUserSettings({ methodOrder: ['snapcompact', 'remote', 'soft'] })).toEqual({});
  });

  it('drops unknown, non-numeric and out-of-range values', () => {
    expect(
      readUserSettings({
        maxFrames: 65,
        frameSize: 'large',
        methodOrder: [42],
        unknown: 1,
      }),
    ).toEqual({});
    expect(readUserSettings(null)).toEqual({});
  });

  it('accepts frame counts up to the renderer ceiling', () => {
    expect(readUserSettings({ maxFrames: 64 })).toEqual({ maxFrames: 64 });
    expect(resolveConfig(applyUserSettings({}, { maxFrames: 64 })).rendering.maxFrames).toBe(64);
  });

  it('reports the schema defaults as a plain map', () => {
    expect(defaultUserSettings()).toEqual(
      Object.fromEntries(
        SETTINGS_FIELDS.filter((field) => field.defaultValue !== undefined).map((field) => [
          field.key,
          field.defaultValue,
        ]),
      ),
    );
    expect(defaultUserSettings()).not.toHaveProperty('thresholdRatio');
  });

  it('returns the input untouched without any overrides', () => {
    const input = { methodOrder: ['soft'] };
    expect(applyUserSettings(input, undefined)).toBe(input);
    expect(applyUserSettings(input, {})).toBe(input);
  });

  it('defaults to 0.16 retention while leaving both retention forms unset', () => {
    expect(defaultUserSettings()).not.toHaveProperty('retainRatio');
    expect(defaultUserSettings()).not.toHaveProperty('retainTokens');
    expect(resolveConfig({}).policy.retainRatio).toBeUndefined();
  });

  it('maps the retained tail onto mutually exclusive policy keys', () => {
    expect(SETTINGS_FIELDS.find((field) => field.key === 'retainRatio')?.paths).toEqual([
      ['policy', 'retainRatio'],
    ]);
    expect(SETTINGS_FIELDS.find((field) => field.key === 'retainTokens')?.paths).toEqual([
      ['policy', 'retainTokens'],
    ]);
    const ratio = resolveConfig(
      applyUserSettings({ policy: { retainTokens: 4_096 } }, { retainRatio: 0.03 }),
    );
    expect(ratio.policy.retainRatio).toBe(0.03);
    expect(ratio.policy.retainTokens).toBeUndefined();
    const tokens = resolveConfig(
      applyUserSettings({ policy: { retainRatio: 0.16 } }, { retainTokens: 8_192 }),
    );
    expect(tokens.policy.retainTokens).toBe(8_192);
    expect(tokens.policy.retainRatio).toBeUndefined();
  });

  it('keeps the retained-tail keys readable for legacy profiles', () => {
    // The card no longer edits them, but saved values must keep working and
    // stay visible until the user restores the automatic tail.
    expect(SETTINGS_KEYS).toContain('retainRatio');
    expect(SETTINGS_KEYS).toContain('retainTokens');
    expect(readUserSettings({ retainRatio: 0.03 })).toEqual({ retainRatio: 0.03 });
    expect(readUserSettings({ retainTokens: 4_096 })).toEqual({ retainTokens: 4_096 });
  });

  it('lets the absolute token form win when a document carries both', () => {
    const both = resolveConfig(applyUserSettings({}, { retainRatio: 0.03, retainTokens: 8_192 }));
    expect(both.policy.retainTokens).toBe(8_192);
    expect(both.policy.retainRatio).toBeUndefined();
  });

  it('drops retained-tail values outside the card bounds', () => {
    expect(readUserSettings({ retainRatio: 0.5, retainTokens: 2_048 })).toEqual({
      retainRatio: 0.5,
      retainTokens: 2_048,
    });
    expect(readUserSettings({ retainRatio: 0.51, retainTokens: 1_023 })).toEqual({});
  });

  it('produces a config the strict parser accepts for every default', () => {
    const resolved = resolveConfig(applyUserSettings({}, defaultUserSettings()));
    expect(resolved.methodOrder).toEqual([...DEFAULT_METHOD_ORDER]);
    expect(resolved.rendering).toMatchObject({ width: 1568, height: 1568, maxFrames: 40 });
    expect(resolved.shakeThresholdChars).toBe(8192);
    // Deprecated and no longer projected from the settings card.
    expect(resolved.minCompressionRatio).toBeUndefined();
  });
});
