import type { CompactionMethod } from '../method.js';
import { assertReadableProjection, resolveImageRoute } from '../../budgeting/capabilities.js';

export const snapcompact: CompactionMethod = async (context) => {
  if (context.imageSlots < 1) return { kind: 'skipped', reason: 'No request image slots remain.' };
  // A photograph or a previous visual checkpoint is not equivalent to its attachment descriptor.
  if (
    context.sourceMessages.some((message) =>
      message.content.some((block) => block.type === 'image'),
    )
  ) {
    return {
      kind: 'skipped',
      reason:
        'The selected history already contains images; retaining a text handoff and archive chain.',
    };
  }
  const imageRoute = await resolveImageRoute(
    context.llm,
    context.route,
    context.config.routePolicies,
    context.signal,
  );
  if (!imageRoute)
    return { kind: 'skipped', reason: 'The route lacks declared vision support or image pricing.' };
  const limits = context.attachments.imageLimits;
  const rendered = await context.render(
    context.archive.document.transcript,
    {
      ...context.config.rendering,
      maxFrames: Math.min(
        context.imageSlots,
        context.config.rendering.maxFrames,
        limits.maxImagesPerMessage,
      ),
      maxTotalBytes: Math.min(context.config.rendering.maxTotalBytes, limits.maxMessageImageBytes),
    },
    context.signal,
  );
  for (const frame of rendered.frames) {
    if (
      frame.data.byteLength > limits.maxImageBytes ||
      frame.width > limits.maxImageDimension ||
      frame.height > limits.maxImageDimension ||
      frame.width * frame.height > limits.maxImagePixels
    ) {
      throw new Error('Rendered frame exceeds the attachment policy.');
    }
  }
  context.signal?.throwIfAborted();
  const references = await context.attachments.saveImages(
    rendered.frames.map((frame, index) => ({
      data: frame.data,
      mediaType: 'image/png' as const,
      name: `snapcompact-frame-${index + 1}-of-${rendered.frames.length}.png`,
    })),
  );
  context.signal?.throwIfAborted();
  if (
    references.length === 0 ||
    references.length !== rendered.frames.length ||
    references.some(
      (reference) =>
        !Number.isSafeInteger(reference.bytes) ||
        reference.bytes <= 0 ||
        reference.bytes > limits.maxImageBytes,
    ) ||
    references.reduce((total, reference) => total + reference.bytes, 0) >
      Math.min(context.config.rendering.maxTotalBytes, limits.maxMessageImageBytes)
  ) {
    throw new Error('Stored image batch is incomplete or exceeds its byte budget.');
  }
  references.forEach((reference, index) => {
    const frame = rendered.frames[index];
    if (!frame || reference.width !== frame.width || reference.height !== frame.height) {
      throw new Error('Attachment normalization resized bitmap text.');
    }
    assertReadableProjection(context.llm, context.route, reference);
  });
  const baseline = await context.handoff();
  return {
    kind: 'candidate',
    method: 'snapcompact',
    imageRoute,
    result: {
      ...baseline,
      summary: [
        ...baseline.summary,
        {
          type: 'text',
          text: 'The following frames supplement the handoff. For exact commands, paths, indentation or uncertain glyphs, use snapcompact_recall instead of guessing from OCR.',
        },
        ...references.map((attachment) => ({ type: 'image' as const, attachment })),
      ],
    },
  };
};
