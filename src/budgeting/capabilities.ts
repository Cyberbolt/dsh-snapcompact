import type { Context } from '@deepseek-ai/cordis';
import type { ImageBlock, LlmImageRequestPricing } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { SnapcompactConfig } from '../config.js';

export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
}

export type ImagePricingSource =
  | 'adapter'
  | 'configured-ceiling'
  | 'deepseek-estimate'
  | 'model-estimate';

export interface ImageRoute {
  readonly target: ModelRoute;
  readonly pricing: LlmImageRequestPricing;
  readonly pricingSource: ImagePricingSource;
}

export interface FrameShape {
  readonly width: number;
  readonly height: number;
  readonly projectedWidth: number;
  readonly projectedHeight: number;
}

/** Conservative DSH-native DeepSeek cap; it is an estimate, not a billing measurement. */
export const DEEPSEEK_VISUAL_TOKENS_PER_FRAME = 1024;

/**
 * Model-line fallback when the gateway exposes no image pricing. These are
 * conservative per-frame caps, not provider bills. Unknown lines stay
 * unpriced so the text fallback wins instead of gambling with history.
 */
export function fallbackVisualTokens(model: string): number | undefined {
  if (/claude|anthropic/iu.test(model)) return 1_568;
  if (/gemini/iu.test(model)) return 1_120;
  if (/gpt|openai|codex/iu.test(model)) return 1_568;
  if (/kimi/iu.test(model)) return 1_568;
  if (/glm/iu.test(model)) return 1_568;
  if (/deepseek/iu.test(model)) return DEEPSEEK_VISUAL_TOKENS_PER_FRAME;
  return undefined;
}
export const BITMAP_GLYPH_HEIGHT = 16;

/** A detached, storage-free image reference used only for projection/price probes. */
export function syntheticImageBlock(width: number, height: number, bytes = 256 * 1024): ImageBlock {
  const attachment: ImageAttachmentRef = {
    attachmentId: `sha256:${'0'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes,
    width,
    height,
  };
  return { type: 'image', attachment };
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
  if (adapterPricing) {
    return { target, pricing: adapterPricing, pricingSource: 'adapter' };
  }
  const override = overrides.find(
    (policy) => policy.provider === target.provider && policy.model === target.model,
  );
  if (override) {
    return {
      target,
      pricingSource: 'configured-ceiling',
      pricing: {
        priceImages: (images) =>
          images.map(() => ({
            visualTokens: override.visualTokensPerFrame,
            // The real adapter adds an attachment descriptor; reserve a conservative allowance.
            text: 'Attachment reference and request-image dimensions. '.repeat(16),
          })),
      },
    };
  }
  // DSH's pi-ai gateway routes do not expose image pricing. Use a
  // model-line cap when the id is recognized; otherwise fail closed.
  const fallback = fallbackVisualTokens(target.model);
  if (fallback !== undefined) {
    return {
      target,
      pricingSource: /deepseek/iu.test(target.model) ? 'deepseek-estimate' : 'model-estimate',
      pricing: {
        priceImages: (images) =>
          images.map(() => ({
            visualTokens: fallback,
            text: 'Attachment reference and request-image dimensions. '.repeat(16),
          })),
      },
    };
  }
  return null;
}

/**
 * Pick the largest candidate frame size the route does not downscale below the
 * configured glyph floor. No storage or rendering is involved.
 */
export function probeFrameShape(
  llm: Context['llm'],
  route: ModelRoute,
  candidates: readonly { width: number; height: number }[],
  minGlyphPx: number,
): FrameShape | null {
  for (const candidate of candidates) {
    let target;
    try {
      target = llm.imageRequestTarget(
        route.provider,
        route.model,
        syntheticImageBlock(candidate.width, candidate.height).attachment,
      );
    } catch {
      continue;
    }
    const scale = Math.min(target.width / candidate.width, target.height / candidate.height);
    if (scale * BITMAP_GLYPH_HEIGHT + 1e-9 >= minGlyphPx) {
      return {
        width: candidate.width,
        height: candidate.height,
        projectedWidth: target.width,
        projectedHeight: target.height,
      };
    }
  }
  return null;
}

export function assertReadableProjection(
  llm: Context['llm'],
  route: ModelRoute,
  reference: ImageAttachmentRef,
  minGlyphPx = 12,
): void {
  const projected = llm.imageRequestTarget(route.provider, route.model, reference);
  const scale = Math.min(projected.width / reference.width, projected.height / reference.height);
  if (scale * BITMAP_GLYPH_HEIGHT + 1e-9 < minGlyphPx) {
    throw new Error(
      `The model request would downscale bitmap text to ${(scale * BITMAP_GLYPH_HEIGHT).toFixed(1)}px per glyph; using the text fallback.`,
    );
  }
}
