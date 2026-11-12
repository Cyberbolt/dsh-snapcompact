import { describe, expect, it } from 'vitest';
import { billedPromptTokens, estimateCheckpoint, CHECKPOINT_WRAPPER_ALLOWANCE } from './pricing.js';
import type { ImageRoute } from './capabilities.js';

const meter = { estimateMessage: () => 100 };
const image = {
  type: 'image' as const,
  attachment: {
    attachmentId: `sha256:${'a'.repeat(64)}` as never,
    mediaType: 'image/png' as const,
    bytes: 100,
    width: 1024,
    height: 1024,
  },
};

describe('checkpoint pricing', () => {
  it('reserves the complete native wrapper', () => {
    expect(estimateCheckpoint([{ type: 'text', text: 'handoff' }], meter)).toBe(
      100 + CHECKPOINT_WRAPPER_ALLOWANCE,
    );
  });
  it('never prices an image using its tiny reference metadata', () => {
    expect(() => estimateCheckpoint([image], meter)).toThrow('trustworthy');
    const route: ImageRoute = {
      target: { provider: 'test', model: 'vision' },
      pricingSource: 'adapter',
      pricing: { priceImages: () => [{ visualTokens: 2000, text: 'descriptor' }] },
    };
    expect(estimateCheckpoint([image], meter, route)).toBe(2200 + CHECKPOINT_WRAPPER_ALLOWANCE);
  });
  it('rejects invalid adapter prices and incomplete image batches', () => {
    const route: ImageRoute = {
      target: { provider: 'test', model: 'vision' },
      pricingSource: 'adapter',
      pricing: { priceImages: () => [] },
    };
    expect(() => estimateCheckpoint([image], meter, route)).toThrow('incomplete');
    route.pricing.priceImages = () => [{ visualTokens: Number.NaN, text: '' }];
    expect(() => estimateCheckpoint([image], meter, route)).toThrow('invalid');
  });
  it('adds cache buckets, never conflates total output with prompt cost', () => {
    expect(
      billedPromptTokens({
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 104,
        cacheReadTokens: 80,
        cacheWriteTokens: 10,
      }),
    ).toBe(100);
  });
});
