import type { RenderedArchive, RenderErrorCode, RenderOptions } from './types.js';

export interface RenderRequest {
  readonly id: number;
  readonly text: string;
  readonly options: RenderOptions;
  readonly deadline: number;
}

export type RenderResponse =
  | { readonly id: number; readonly ok: true; readonly archive: RenderedArchive }
  | {
      readonly id: number;
      readonly ok: false;
      readonly code: RenderErrorCode;
      readonly message: string;
    };
