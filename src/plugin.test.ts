import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { apply } from './plugin.js';

describe('plugin activation', () => {
  it('fails before mounting anything when the host contract is missing', async () => {
    const effect = vi.fn();
    const ctx = { get: () => undefined, effect } as unknown as Context;
    await expect(apply(ctx, {})).rejects.toThrow(/required host capabilities are missing/u);
    expect(effect).not.toHaveBeenCalled();
  });
});
