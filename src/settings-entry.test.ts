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
    expect(current['methodOrder']).toEqual(['snapcompact', 'handoff', 'shake', 'soft']);
    expect(current['maxFrames']).toBe(20);
    expect(current['frameSize']).toBe(1568);
    expect(current['archiveMaxBytes']).toBe(64 * 1024 * 1024);
    expect(current['thresholdRatio']).toBeUndefined();
  });

  it('accepts every legal value shape', () => {
    expect(
      resolve({
        methodOrder: ['handoff', 'soft'],
        thresholdRatio: 0.72,
        frameSize: 1024,
        maxFrames: 3,
        minCompressionRatio: 1.5,
        archiveMaxBytes: 1024 * 1024,
        handoffMaxTokens: 1024,
        shakeThresholdChars: 2048,
      }),
    ).toMatchObject({
      methodOrder: ['handoff', 'soft'],
      thresholdRatio: 0.72,
      frameSize: 1024,
      maxFrames: 3,
      minCompressionRatio: 1.5,
      handoffMaxTokens: 1024,
      shakeThresholdChars: 2048,
    });
    expect(resolve({ thresholdRatio: 0.2 }).thresholdRatio).toBe(0.2);
  });

  it.each([
    { methodOrder: [] },
    { methodOrder: ['remote', 'soft'] },
    { thresholdRatio: 1.2 },
    { thresholdRatio: 0.19 },
    { frameSize: 4096 },
    { maxFrames: 21 },
    { minCompressionRatio: 1 },
    { archiveMaxBytes: 0 },
    { handoffMaxTokens: 128 },
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
