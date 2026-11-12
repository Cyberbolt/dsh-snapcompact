import type { CompactionMethod } from '../method.js';
import { buildVisualCheckpoint } from '../visual-checkpoint.js';

/**
 * Production snapcompact method. The checkpoint is a local render; the only
 * model call in the chain is the native summary fallback owned by the engine.
 */
export const snapcompact: CompactionMethod = async (context) => {
  const result = await buildVisualCheckpoint({
    messages: context.sourceMessages,
    sourceTokens: context.sourceTokens,
    checkpointTargetTokens: context.checkpointTargetTokens,
    meter: context.meter,
    config: context.config,
    route: context.route,
    llm: context.llm,
    attachments: context.attachments,
    imageSlots: context.imageSlots,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    render: context.render,
  });
  if (result.kind === 'skipped') return result;
  return {
    kind: 'candidate',
    method: 'snapcompact',
    imageRoute: result.imageRoute,
    result: {
      summary: [...result.blocks],
      provider: 'snapcompact',
      model: 'local-v3',
    },
  };
};
