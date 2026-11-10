import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import {
  DEFAULT_USER_CHAIN,
  readUserSettings,
  SETTINGS_FIELDS,
  SETTINGS_SERVICE,
  type UserSettings,
} from './settings/metadata.js';

/**
 * The profile-plane settings row.
 *
 * DSH projects volatile fields of profile entries into its settings document
 * and renders them on the plugin page; the compaction plugin itself lives in
 * the opt-in preset, whose rows never reach that projection. This entry holds
 * no behavior beyond publishing the live values, so mounting it can never
 * compete with the preset's compaction service.
 */

const descriptions = new Map(SETTINGS_FIELDS.map((field) => [field.key, field.description]));

function descriptionOf(key: string): string {
  const value = descriptions.get(key);
  if (value === undefined) throw new Error(`Missing settings description for "${key}".`);
  return value;
}

const methodName = schema.union([
  schema.const('snapcompact'),
  schema.const('handoff'),
  schema.const('shake'),
  schema.const('soft'),
]);

export const Config = schema.object({
  methodOrder: schema
    .array(methodName)
    .min(1)
    .max(4)
    .default([...DEFAULT_USER_CHAIN])
    .description(descriptionOf('methodOrder'))
    .volatile(),
  thresholdRatio: schema
    .number()
    .step(0.01)
    .min(0.2)
    .max(0.95)
    .description(descriptionOf('thresholdRatio'))
    .volatile(),
  frameSize: schema
    .number()
    .step(1)
    .min(1024)
    .max(2048)
    .default(1568)
    .description(descriptionOf('frameSize'))
    .volatile(),
  maxFrames: schema
    .number()
    .step(1)
    .min(1)
    .max(64)
    .default(20)
    .description(descriptionOf('maxFrames'))
    .volatile(),
  archiveMaxBytes: schema
    .number()
    .step(1024 * 1024)
    .min(1024 * 1024)
    .max(64 * 1024 * 1024)
    .default(64 * 1024 * 1024)
    .description(descriptionOf('archiveMaxBytes'))
    .volatile(),
  handoffMaxTokens: schema
    .number()
    .step(256)
    .min(256)
    .max(16_384)
    .default(4096)
    .description(descriptionOf('handoffMaxTokens'))
    .volatile(),
  shakeThresholdChars: schema
    .number()
    .step(1024)
    .min(1024)
    .max(65_536)
    .default(8192)
    .description(descriptionOf('shakeThresholdChars'))
    .volatile(),
});

/** Live values handed to a preset instance while it is being mounted. */
export interface SnapcompactSettingsService {
  current(): UserSettings;
}

/** Publish the live override map; volatile fields update in place, so `current()` reads fresh values. */
export function apply(ctx: Context, config: unknown): void {
  const service: SnapcompactSettingsService = {
    current: () => readUserSettings(config),
  };
  ctx.provide(SETTINGS_SERVICE, service);
}
