import { Buffer } from 'node:buffer';
import { RenderError } from './types.js';
import type { RenderOptions } from './types.js';

export const MAX_TIMEOUT_MS = 15_000;
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_PENDING_REQUESTS = 4;

/** Hard safety limits apply even when the caller supplies larger budgets. */
export function validateOptions(options: RenderOptions): RenderOptions {
  if (typeof options !== 'object' || options === null) {
    throw new RenderError('INVALID_OPTIONS', 'Render options must be an object.');
  }
  const bounds: readonly [keyof RenderOptions, number, number][] = [
    ['width', 128, 4096],
    ['height', 100, 4096],
    ['maxFrames', 1, 64],
    ['maxTotalBytes', 1, 256 * 1024 * 1024],
    ['maxSourceBytes', 1, MAX_SOURCE_BYTES],
    ['timeoutMs', 1, MAX_TIMEOUT_MS],
    ['lineHeight', 16, 32],
  ];
  for (const [key, minimum, maximum] of bounds) {
    const value = options[key];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new RenderError(
        'INVALID_OPTIONS',
        `${key} must be an integer in [${minimum}, ${maximum}].`,
      );
    }
  }
  // Copy, rather than retaining a mutable caller-owned object in the queue.
  return {
    width: options.width,
    height: options.height,
    maxFrames: options.maxFrames,
    maxTotalBytes: options.maxTotalBytes,
    maxSourceBytes: options.maxSourceBytes,
    timeoutMs: options.timeoutMs,
    lineHeight: options.lineHeight,
  };
}

export function validateSource(text: string, options: RenderOptions): void {
  if (typeof text !== 'string') {
    throw new RenderError('UNSUPPORTED_CHARACTER', 'Render source must be a string.');
  }
  if (Buffer.byteLength(text, 'utf8') > options.maxSourceBytes) {
    throw new RenderError('SOURCE_LIMIT', 'Source exceeds the UTF-8 byte budget.');
  }
}
