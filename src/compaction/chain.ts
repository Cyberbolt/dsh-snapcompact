import { DEFAULT_METHOD_ORDER } from '../config.js';
import type { MethodName } from '../config.js';

/** One documented method-order recipe; presets never change engine behavior by themselves. */
export interface ChainPreset {
  readonly id: 'visual-first' | 'visual-native' | 'native-only';
  readonly label: string;
  readonly order: readonly MethodName[];
  readonly note: string;
}

/**
 * Built-in recipes surfaced by `/snapcompact status` and the configuration docs.
 * `methodOrder` remains the only source of truth; a matching array just gets a label.
 */
export const CHAIN_PRESETS: readonly ChainPreset[] = Object.freeze([
  {
    id: 'visual-first',
    label: '视觉优先（默认）',
    order: DEFAULT_METHOD_ORDER,
    note: '先试本地视觉；失败后退到工具输出摘录，最后由原生摘要兜底。',
  },
  {
    id: 'visual-native',
    label: '视觉 + 原生',
    order: ['snapcompact', 'soft'],
    note: '跳过工具输出摘录；视觉失败直接回到原生摘要。',
  },
  {
    id: 'native-only',
    label: '仅原生摘要',
    order: ['soft'],
    note: '完全使用 DSH 原生摘要；不保留视觉 checkpoint，也没有回查工具。',
  },
]);

function sameOrder(left: readonly MethodName[], right: readonly MethodName[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/** Exact array match; no fuzzy or subset matching. */
export function matchChainPreset(order: readonly MethodName[]): ChainPreset | undefined {
  return CHAIN_PRESETS.find((preset) => sameOrder(preset.order, order));
}

/** Human label plus the preset id, when the configured order is one of the recipes. */
export function describeChain(order: readonly MethodName[]): {
  readonly label: string;
  readonly presetId?: ChainPreset['id'];
} {
  const preset = matchChainPreset(order);
  return preset === undefined ? { label: '自定义' } : { label: preset.label, presetId: preset.id };
}
