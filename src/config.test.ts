import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.js';

describe('plugin configuration', () => {
  it('supplies conservative detached defaults', () => {
    const config = resolveConfig({});
    expect(config.methodOrder).toEqual(['snapcompact', 'handoff', 'shake', 'soft']);
    expect(config.rendering).toMatchObject({ width: 1536, height: 1024, maxFrames: 12 });
    expect(config.routePolicies).toEqual([]);
    config.methodOrder.pop();
    expect(resolveConfig({}).methodOrder).toHaveLength(4);
  });
  it.each([
    { methodOrder: [] },
    { methodOrder: ['soft', 'soft'] },
    { methodOrder: ['handoff'] },
    { methodOrder: ['remote', 'soft'] },
    { typo: true },
    { rendering: { maxFrames: 21 } },
    { rendering: { timeoutMs: 15_001 } },
    { rendering: { maxSourceBytes: 65 * 1024 * 1024 } },
    { routePolicies: [{ provider: 'a', model: 'b', visualTokensPerFrame: -1 }] },
    {
      routePolicies: [
        { provider: 'a', model: 'b', visualTokensPerFrame: 1 },
        { provider: 'a', model: 'b', visualTokensPerFrame: 2 },
      ],
    },
  ])('rejects invalid configuration %j', (config) => {
    expect(() => resolveConfig(config)).toThrow();
  });
});
