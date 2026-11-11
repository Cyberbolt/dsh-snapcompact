import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { resolveConfig } from './config.js';
import { Config, apply, type SnapcompactSettingsService } from './settings-entry.js';
import { applyUserSettings, readUserSettings, SETTINGS_KEYS } from './settings/metadata.js';

type Volatile<T> = { get(): T };

/** Resolve the schema with volatile references unwrapped into plain values. */
function resolve(config: unknown): Record<string, unknown> {
  const parsed = Config(config as never) as Record<string, Volatile<unknown>>;
  return Object.fromEntries(
    SETTINGS_KEYS.map((key) => {
      const value = parsed[key];
      return [
        key,
        value !== null && typeof value === 'object' && 'get' in value ? value.get() : value,
      ];
    }),
  );
}

describe('settings entry', () => {
  it('declares exactly the metadata keys as volatile fields', () => {
    const parsed = Config({}) as Record<string, Volatile<unknown>>;
    expect(Object.keys(parsed).sort()).toEqual([...SETTINGS_KEYS].sort());
    for (const key of SETTINGS_KEYS) {
      expect(typeof parsed[key]?.get, key).toBe('function');
    }
  });

  it('applies the schema defaults and leaves the threshold unset', () => {
    const current = resolve({});
    expect(current['methodOrder']).toEqual(['snapcompact', 'shake', 'soft']);
    expect(current['maxFrames']).toBe(20);
    expect(current['frameSize']).toBe(1568);
    expect(current['archiveMaxBytes']).toBe(64 * 1024 * 1024);
    expect(current['thresholdRatio']).toBeUndefined();
    expect(current['retainRatio']).toBeUndefined();
    expect(current['retainTokens']).toBeUndefined();
  });

  it('accepts every legal value shape', () => {
    expect(
      resolve({
        methodOrder: ['snapcompact', 'soft'],
        thresholdRatio: 0.72,
        frameSize: 1024,
        maxFrames: 3,
        archiveMaxBytes: 1024 * 1024,
        shakeThresholdChars: 2048,
      }),
    ).toMatchObject({
      methodOrder: ['snapcompact', 'soft'],
      thresholdRatio: 0.72,
      frameSize: 1024,
      maxFrames: 3,
      shakeThresholdChars: 2048,
    });
    expect(resolve({ thresholdRatio: 0.5 }).thresholdRatio).toBe(0.5);
    expect(resolve({ maxFrames: 64 }).maxFrames).toBe(64);
    expect(resolve({ retainRatio: 0.16 }).retainRatio).toBe(0.16);
    expect(resolve({ retainRatio: 0.01 }).retainRatio).toBe(0.01);
    expect(resolve({ retainTokens: 32768 }).retainTokens).toBe(32768);
  });

  it('still parses a legacy 0.2 threshold so an old row can be repaired', () => {
    // The carrier stays permissive on purpose; `readUserSettings` drops the
    // value and the card floor is 0.5.
    expect(resolve({ thresholdRatio: 0.2 }).thresholdRatio).toBe(0.2);
  });

  it('still parses a chain that names the removed handoff method', () => {
    // A settings document saved before the method was removed must not fail
    // validation; the reader drops the name and keeps the surviving order.
    const legacy = { methodOrder: ['snapcompact', 'handoff', 'shake', 'soft'] };
    expect(resolve(legacy)['methodOrder']).toEqual(legacy.methodOrder);
    expect(readUserSettings(legacy)).toEqual({ methodOrder: ['snapcompact', 'shake', 'soft'] });
  });

  it.each([
    { methodOrder: [] },
    { methodOrder: ['remote', 'soft'] },
    { thresholdRatio: 1.2 },
    { thresholdRatio: 0.19 },
    { frameSize: 4096 },
    { maxFrames: 65 },
    { archiveMaxBytes: 0 },
    { shakeThresholdChars: 128 },
    { retainRatio: 0.005 },
    { retainRatio: 0.51 },
    { retainTokens: 512 },
  ])('rejects %#', (config) => {
    expect(() => Config(config as never)).toThrow();
  });

  it('publishes the live overrides through the provided service', () => {
    const provide = vi.fn();
    const ctx = { provide } as unknown as Context;
    const config = {
      methodOrder: ['snapcompact', 'soft'],
      maxFrames: 12,
      thresholdRatio: 0.6,
    };

    apply(ctx, config);

    expect(provide).toHaveBeenCalledTimes(1);
    const [name, service] = provide.mock.calls[0] as [string, SnapcompactSettingsService];
    expect(name).toBe('snapcompactSettings');
    expect(service.current()).toEqual(readUserSettings(config));
    expect(service.current()).toMatchObject({
      methodOrder: ['snapcompact', 'soft'],
      maxFrames: 12,
    });
    expect(resolveConfig(applyUserSettings({}, service.current())).rendering.maxFrames).toBe(12);
  });
});
