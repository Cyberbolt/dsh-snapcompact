/**
 * Shipped opt-in presets, one per official DSH mode we support.
 *
 * Each variant is a complete copy of the official preset it mirrors; only the
 * compaction backend is replaced. The build script emits these declarations
 * into the bundle patch, and the tests compare them with the vendored official
 * snapshots.
 */
export interface PresetVariant {
  /** Official DSH preset this variant mirrors. */
  readonly mode: 'standard' | 'ptc' | 'cordis';
  /** Stable preset identity saved by sessions. */
  readonly id: string;
  /** Human-edited plugin list beside this module. */
  readonly source: string;
  /** Display name; third-party presets are rendered verbatim. */
  readonly name: string;
  /** Display description; third-party presets are rendered verbatim. */
  readonly description: string;
  /** Roster position, placed right after the official preset it mirrors. */
  readonly order: number;
}

export const PRESET_VARIANTS: readonly PresetVariant[] = [
  {
    mode: 'standard',
    id: 'snapcompact',
    source: 'snapcompact.yml',
    name: 'Snapcompact (Standard)',
    description:
      'Standard mode plus bitmap-frame compaction with exact head/tail, an exact-token index and text fallbacks.',
    order: 1.5,
  },
  {
    mode: 'ptc',
    id: 'snapcompact-ptc',
    source: 'snapcompact-ptc.yml',
    name: 'Snapcompact (PTC)',
    description:
      'PTC mode plus bitmap-frame compaction with exact head/tail, an exact-token index and text fallbacks.',
    order: 2.5,
  },
  {
    mode: 'cordis',
    id: 'snapcompact-cordis',
    source: 'snapcompact-cordis.yml',
    name: 'Snapcompact (Cordis)',
    description:
      'Cordis mode plus bitmap-frame compaction with exact head/tail, an exact-token index and text fallbacks.',
    order: 4.5,
  },
];
