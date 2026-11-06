import type { Context } from '@deepseek-ai/cordis';
import type { ImageBlock, LlmImageRequestPricing } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { SnapcompactConfig } from '../config.js';

export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
}

export interface ImageRoute {
  readonly target: ModelRoute;
  readonly pricing: LlmImageRequestPricing;
  readonly pricingSource: 'adapter' | 'configured-ceiling';
}

/** Unknown modality or unknown pricing is not permission to gamble with conversation history. */
export async function resolveImageRoute(
  llm: Context['llm'],
  target: ModelRoute,
  overrides: SnapcompactConfig['routePolicies'],
  signal?: AbortSignal,
): Promise<ImageRoute | null> {
  const info = await llm.resolveModelInfo(target.provider, target.model, signal);
  signal?.throwIfAborted();
  if (!info.inputModalities?.includes('image')) return null;
  const adapterPricing = llm.imageRequestPricing(target.provider, target.model);
  if (adapterPricing) return { target, pricing: adapterPricing, pricingSource: 'adapter' };
  const override = overrides.find(
    (policy) => policy.provider === target.provider && policy.model === target.model,
  );
  if (!override) return null;
  return {
    target,
    pricingSource: 'configured-ceiling',
    pricing: {
      priceImages: (images: readonly ImageBlock[]) =>
        images.map(() => ({
          visualTokens: override.visualTokensPerFrame,
          // The real adapter adds an attachment descriptor; reserve a conservative allowance.
          text: 'Attachment reference and request-image dimensions. '.repeat(16),
        })),
    },
  };
}

export function assertReadableProjection(
  llm: Context['llm'],
  route: ModelRoute,
  reference: ImageAttachmentRef,
): void {
  const projected = llm.imageRequestTarget(route.provider, route.model, reference);
  if (projected.width < reference.width || projected.height < reference.height) {
    throw new Error('The model request would downscale bitmap text; using the text fallback.');
  }
}
