import type { ContentBlock, Message, TokenUsage } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ImageRoute } from './capabilities.js';

export interface MessageEstimator {
  estimateMessage(message: Message): number;
}

/** Reserve more than the pinned native checkpoint preamble/tags, without importing private helpers. */
export const CHECKPOINT_WRAPPER_ALLOWANCE = 256;

export function estimateCheckpoint(
  blocks: readonly ContentBlock[],
  meter: MessageEstimator,
  imageRoute?: ImageRoute,
): number {
  const images = blocks.filter((block) => block.type === 'image');
  const textOnly = blocks.filter((block) => block.type !== 'image');
  let tokens = meter.estimateMessage(
    createUserMessage({ source: { kind: 'user' }, content: textOnly }),
  );
  if (images.length > 0) {
    if (!imageRoute) throw new Error('Image checkpoint has no trustworthy image pricing.');
    const prices = imageRoute.pricing.priceImages(images);
    if (prices.length !== images.length)
      throw new Error('Image pricing returned an incomplete batch.');
    for (const price of prices) {
      if (!Number.isFinite(price.visualTokens) || price.visualTokens < 0) {
        throw new Error('Image pricing returned an invalid token count.');
      }
      tokens += Math.ceil(price.visualTokens);
      tokens += meter.estimateMessage(
        createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: price.text }],
        }),
      );
    }
  }
  return tokens + CHECKPOINT_WRAPPER_ALLOWANCE;
}

/** InputTokens means uncached input in the pinned DSH TokenUsage contract. */
export function billedPromptTokens(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
