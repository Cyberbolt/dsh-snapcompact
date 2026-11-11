export interface RenderOptions {
  width: number;
  height: number;
  maxFrames: number;
  maxTotalBytes: number;
  maxSourceBytes: number;
  timeoutMs: number;
  /** Pixel distance between bitmap text baselines. */
  lineHeight: number;
}

export interface RenderedFrame {
  data: Uint8Array;
  width: number;
  height: number;
  /** Inclusive, one-based source line number; wrapped lines may span frames. */
  firstLine: number;
  /** Inclusive, one-based source line number. */
  lastLine: number;
  /** Number of source characters represented by this frame (newline markers excluded). */
  chars: number;
}

export interface RenderedArchive {
  frames: readonly RenderedFrame[];
  /** Source lines, including empty and trailing lines; empty input has one line. */
  lineCount: number;
  /** Characters replaced by a visible fallback because no bitmap glyph existed. */
  unrenderableChars: number;
}

export type RenderErrorCode =
  | 'INVALID_OPTIONS'
  | 'SOURCE_LIMIT'
  | 'FRAME_LIMIT'
  | 'BYTE_LIMIT'
  | 'UNSUPPORTED_CHARACTER'
  | 'MISSING_GLYPH'
  | 'FONT_INVALID'
  | 'QUEUE_FULL'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'DISPOSED'
  | 'WORKER_FAILED';

export class RenderError extends Error {
  constructor(
    public readonly code: RenderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code === 'ABORTED' ? 'AbortError' : 'RenderError';
  }
}
