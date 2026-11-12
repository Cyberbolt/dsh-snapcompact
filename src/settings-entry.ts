import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import {
  DEFAULT_USER_CHAIN,
  MIN_RETAIN_TOKENS,
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

// `handoff` is accepted only so a settings document saved before the method was
// removed still validates; `readUserSettings` drops it from the effective chain.
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
    // Four entries only to keep a legacy document (which may still name handoff)
    // valid; the runtime parser and the card both cap the chain at three.
    .max(4)
    .default([...DEFAULT_USER_CHAIN])
    .description(descriptionOf('methodOrder'))
    .volatile(),
  // Accepts the old 0.2 card minimum so a profile that already saved it still
  // loads and can be repaired. `readUserSettings` drops sub-0.5 values and the
  // card never writes one, so the effective minimum is the card's 0.5.
  thresholdRatio: schema
    .number()
    .step(0.01)
    .min(0.2)
    .max(0.95)
    .description(descriptionOf('thresholdRatio'))
    .volatile(),
  retainRatio: schema
    .number()
    .step(0.01)
    .min(0.01)
    .max(0.5)
    .description(descriptionOf('retainRatio'))
    .volatile(),
  retainTokens: schema
    .number()
    .step(MIN_RETAIN_TOKENS)
    .min(MIN_RETAIN_TOKENS)
    .description(descriptionOf('retainTokens'))
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
    .default(40)
    .description(descriptionOf('maxFrames'))
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
