import { describe, expect, it } from 'vitest';
import { CHAIN_PRESETS, describeChain, matchChainPreset } from './chain.js';
import { DEFAULT_METHOD_ORDER } from '../config.js';

describe('method-chain presets', () => {
  it('labels the shipped default as visual-first', () => {
    expect(describeChain(DEFAULT_METHOD_ORDER)).toEqual({
      label: '视觉优先（默认）',
      presetId: 'visual-first',
    });
  });

  it('matches every documented preset exactly', () => {
    for (const preset of CHAIN_PRESETS) {
      expect(matchChainPreset(preset.order)?.id).toBe(preset.id);
      expect(describeChain(preset.order)).toEqual({
        label: preset.label,
        presetId: preset.id,
      });
    }
  });

  it('falls back to a custom label without guessing', () => {
    expect(matchChainPreset(['handoff', 'soft'])).toBeUndefined();
    expect(describeChain(['handoff', 'soft'])).toEqual({ label: '自定义' });
  });
});
