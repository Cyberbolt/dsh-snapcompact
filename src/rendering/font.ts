import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { RenderError } from './types.js';

export const FONT_SHA256 = '14c96e497466a82e46cf20032ce510e186bdc8658c9158e2290f452cda9bc498';
export const FONT_URL = new URL('../../assets/fonts/unifont_all-18.0.01.hex.gz', import.meta.url);

export interface BitmapGlyph {
  readonly width: number;
  /** Row-major, most significant bit first, sixteen rows. */
  readonly bitmap: Uint8Array;
}

export type BitmapFont = ReadonlyMap<number, BitmapGlyph>;

/** Original reader for the documented Unifont hexadecimal bitmap format. */
export function parseHexFont(source: string): BitmapFont {
  const glyphs = new Map<number, BitmapGlyph>();
  for (const line of source.split('\n')) {
    if (line === '') continue;
    const match = /^([0-9A-Fa-f]{4,6}):([0-9A-Fa-f]+)\r?$/.exec(line);
    const code = match?.[1];
    const hex = match?.[2];
    if (code === undefined || hex === undefined || ![32, 64, 96, 128].includes(hex.length)) {
      throw new RenderError('FONT_INVALID', 'Invalid Unifont bitmap record.');
    }
    const codePoint = Number.parseInt(code, 16);
    if (codePoint > 0x10ffff || glyphs.has(codePoint)) {
      throw new RenderError('FONT_INVALID', 'Invalid or duplicate font code point.');
    }
    const bitmap = Uint8Array.from(Buffer.from(hex, 'hex'));
    glyphs.set(codePoint, { width: (bitmap.length / 16) * 8, bitmap });
  }
  if (glyphs.size === 0) throw new RenderError('FONT_INVALID', 'Empty bitmap font.');
  return glyphs;
}

let cachedFont: Promise<BitmapFont> | undefined;

/** Called only inside the renderer worker in production. No network access. */
export function loadFont(): Promise<BitmapFont> {
  cachedFont ??= readFile(FONT_URL).then((data) => {
    if (createHash('sha256').update(data).digest('hex') !== FONT_SHA256) {
      throw new RenderError('FONT_INVALID', 'Bundled Unifont SHA-256 does not match.');
    }
    try {
      return parseHexFont(gunzipSync(data, { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8'));
    } catch (error) {
      if (error instanceof RenderError) throw error;
      throw new RenderError('FONT_INVALID', 'Cannot decompress the bundled font.');
    }
  });
  return cachedFont;
}
