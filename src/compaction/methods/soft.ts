import type { CompactionMethod } from '../method.js';

/** Preserve the native summarizer's text projection, usage and replay-prefix behavior. */
export const soft: CompactionMethod = async (context) => ({
  kind: 'candidate',
  method: 'soft',
  result: await context.soft(),
});
