import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic';
import { resolveConfig } from '../../config.js';
import { createHarness } from '../../../tests/fixtures/harness.js';
import type { ArchiveIndex } from './archive-projection.js';
import {
  formatStatus,
  formatTokens,
  resolveTargetPolicy,
  resolvePressureBudget,
} from './status.js';

const BASE_CONFIG: ResolvedConfig = {
  thresholdRatio: 0.8,
  headroomTokens: 65_536,
  retainRatio: 0.16,
  summarizationProvider: '',
  summarizationModel: '',
  maxTokens: 65_536,
  compactionRetries: 1,
  maxOverflowRetries: 1,
  modelPolicies: [],
  auto: true,
};

const NO_ARCHIVES: ArchiveIndex = {
  entries: () => [],
  find: () => undefined,
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('trigger budget display', () => {
  it('mirrors the native window fraction and headroom cap', () => {
    expect(resolvePressureBudget(BASE_CONFIG, 200_000, 0)).toEqual({
      kind: 'ok',
      thresholdTokens: 134_464,
      retainTokens: 32_000,
      compactableTokens: 102_464,
      retainTooLarge: false,
      messageBudgetTokens: 200_000,
    });
    expect(resolvePressureBudget(BASE_CONFIG, 1_000_000, 8_000)).toEqual({
      kind: 'ok',
      thresholdTokens: 800_000,
      retainTokens: 158_720,
      compactableTokens: 641_280,
      retainTooLarge: false,
      messageBudgetTokens: 992_000,
    });
    expect(resolvePressureBudget(BASE_CONFIG, 100_000, 8_192)).toEqual({
      kind: 'ok',
      thresholdTokens: 26_272,
      retainTokens: 14_689,
      compactableTokens: 11_583,
      retainTooLarge: false,
      messageBudgetTokens: 91_808,
    });
  });

  it('explains configurations the native backend would reject', () => {
    const noBudget = resolvePressureBudget(BASE_CONFIG, 50_000, 8_192);
    expect(noBudget.kind).toBe('error');
    if (noBudget.kind === 'error') expect(noBudget.reason).toContain('没有触发预算');

    const retainTooLarge = resolvePressureBudget(
      { thresholdRatio: 0.8, headroomTokens: 65_536, retainTokens: 150_000 },
      200_000,
      0,
    );
    expect(retainTooLarge).toMatchObject({ retainTooLarge: true, retainTokens: 150_000 });
  });

  it('merges exact-target retention overrides before global retention', () => {
    expect(resolveTargetPolicy(BASE_CONFIG, 'test', 'vision')).toEqual({
      thresholdRatio: 0.8,
      headroomTokens: 65_536,
      retainRatio: 0.16,
    });
    const overridden: ResolvedConfig = {
      ...BASE_CONFIG,
      modelPolicies: [
        {
          provider: 'test',
          model: 'vision',
          thresholdRatio: 0.5,
          headroomTokens: 4_096,
          retainTokens: 1_024,
        },
      ],
    };
    expect(resolveTargetPolicy(overridden, 'test', 'vision')).toEqual({
      thresholdRatio: 0.5,
      headroomTokens: 4_096,
      retainTokens: 1_024,
    });
    expect(resolveTargetPolicy(overridden, 'test', 'other')).toEqual({
      thresholdRatio: 0.8,
      headroomTokens: 65_536,
      retainRatio: 0.16,
    });
  });

  it('formats token counts without locale surprises', () => {
    expect(formatTokens(134_464)).toBe('134,464');
  });
});

describe('status command text', () => {
  it('explains the effective threshold and per-method availability', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    const text = await formatStatus(
      fixture.ctx,
      resolveConfig({}),
      BASE_CONFIG,
      NO_ARCHIVES,
      fixture.agent,
      new AbortController().signal,
    );
    expect(text).toContain('方法链：snapcompact → handoff → shake → soft');
    expect(text).toContain('链预设：视觉优先（默认）');
    expect(text).toContain('200,000');
    expect(text).toContain('134,464');
    expect(text).toContain('保留尾部：32,000 tokens（retainRatio 0.16；占窗口 16%）');
    expect(text).toContain('可压空间：102,464 tokens（窗口 51%；阈值 − 保留尾部；下限 20,000）');
    expect(text).toContain(
      '收益门槛：源历史少于 2,000 tokens 时跳过压缩（guard.minSourceRatio 0.01）',
    );
    expect(text).toContain('snapcompact：会尝试');
    expect(text).toContain('handoff：会尝试');
    expect(text).toContain('shake：会跳过');
    expect(text).toContain('soft：兜底');
    expect(text).not.toContain('警告：');
  });

  it('labels the tail derived from a custom trigger', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    const text = await formatStatus(
      fixture.ctx,
      resolveConfig({ policy: { thresholdRatio: 0.6 } }),
      { ...BASE_CONFIG, thresholdRatio: 0.6, retainRatio: 0.12 },
      NO_ARCHIVES,
      fixture.agent,
      new AbortController().signal,
    );
    expect(text).toContain('触发阈值：120,000 tokens（配置 60%）');
    expect(text).toContain(
      '保留尾部：24,000 tokens（自动 = 阈值 ÷ 5；retainRatio 0.12；占窗口 12%）',
    );
    expect(text).toContain('可压空间：96,000 tokens（窗口 48%；阈值 − 保留尾部；下限 20,000）');
  });

  it('warns when the threshold leaves less room than the guard minimum', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    const text = await formatStatus(
      fixture.ctx,
      resolveConfig({}),
      { ...BASE_CONFIG, thresholdRatio: 0.2, headroomTokens: 0 },
      NO_ARCHIVES,
      fixture.agent,
      new AbortController().signal,
    );
    expect(text).toContain('触发阈值：40,000');
    expect(text).toContain('可压空间：8,000 tokens（窗口 4%；阈值 − 保留尾部；下限 20,000）');
    expect(text).toContain('警告：可压空间低于下限');
  });

  it('reports a disabled source floor and an absolute retained tail', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    const absoluteRetention: ResolvedConfig = {
      thresholdRatio: 0.8,
      headroomTokens: 65_536,
      retainTokens: 16_000,
      summarizationProvider: '',
      summarizationModel: '',
      maxTokens: 65_536,
      compactionRetries: 1,
      maxOverflowRetries: 1,
      modelPolicies: [],
      auto: true,
    };
    const text = await formatStatus(
      fixture.ctx,
      resolveConfig({ guard: { minSourceRatio: 0, minCompactableRatio: 0 } }),
      absoluteRetention,
      NO_ARCHIVES,
      fixture.agent,
      new AbortController().signal,
    );
    expect(text).toContain('保留尾部：16,000 tokens（retainTokens 指定；占窗口 8%）');
    expect(text).toContain('可压空间：118,464 tokens（窗口 59%；阈值 − 保留尾部）');
    expect(text).toContain('收益门槛：已关闭（guard.minSourceRatio 0）');
  });

  it('reports text fallback when the route cannot read images', async () => {
    const fixture = await createHarness('text');
    cleanups.push(fixture.dispose);
    const text = await formatStatus(
      fixture.ctx,
      resolveConfig({}),
      BASE_CONFIG,
      NO_ARCHIVES,
      fixture.agent,
      new AbortController().signal,
    );
    expect(text).toContain('snapcompact：会跳过');
    expect(text).toContain('图片路径：使用文本回退');
    expect(text).not.toContain('图片路径：可尝试');
  });

  it('marks automatic compaction as off while keeping /compact available', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    const text = await formatStatus(
      fixture.ctx,
      resolveConfig({}),
      { ...BASE_CONFIG, auto: false },
      NO_ARCHIVES,
      fixture.agent,
      new AbortController().signal,
    );
    expect(text).toContain('自动压缩：关闭；可用 /compact 手动触发');
    expect(text).toContain('状态：未越过阈值；自动压缩已关闭');
  });
});
