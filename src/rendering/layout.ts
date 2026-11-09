import type { BitmapFont, BitmapGlyph } from './font.js';
import { validateOptions, validateSource } from './options.js';
import { RenderError } from './types.js';
import type { RenderOptions } from './types.js';

export const GRID = Object.freeze({ margin: 16, header: 24, footer: 24, lineHeight: 20 });

export interface PositionedGlyph {
  readonly glyph: BitmapGlyph;
  readonly character: string;
  readonly x: number;
}

export interface GridRow {
  readonly sourceLine: number;
  readonly continuation: boolean;
  readonly glyphs: readonly PositionedGlyph[];
}

export interface GridPage {
  readonly rows: readonly GridRow[];
  readonly firstLine: number;
  readonly lastLine: number;
}

export interface GridLayout {
  readonly pages: readonly GridPage[];
  readonly lineCount: number;
  readonly columns: number;
  readonly rowsPerPage: number;
}

// Deliberately conservative: no bidi reordering, ligation, contextual joining,
// combining-mark placement, grapheme composition, or emoji sequence shaping.
const SIMPLE_SCRIPT =
  /^(?:\p{Script=Common}|\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Bopomofo}|\p{Script=Armenian}|\p{Script=Georgian}|\p{Script=Ethiopic}|\p{Script=Cherokee}|\p{Script=Yi}|\p{Script=Canadian_Aboriginal}|\p{Script=Ogham}|\p{Script=Runic})$/u;
const MARK = /\p{Mark}/u;
const UNASSIGNED = /\p{Unassigned}/u;
const FORMAT = /\p{Format}/u;

function label(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Visible, literal ASCII escapes; nothing interprets terminal escape sequences. */
export function escapeCharacter(character: string): string {
  const code = character.codePointAt(0);
  if (code === undefined) return '';
  if (character === '\n') return '\n';
  if (character === '\t') return '\\t';
  if (character === '\r') return '\\r';
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
    return `\\x${code.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  if (
    MARK.test(character) ||
    code === 0x200c ||
    code === 0x200d ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xd7b0 && code <= 0xd7ff) ||
    (code >= 0x1f1e6 && code <= 0x1f1ff) ||
    (code >= 0x1f3fb && code <= 0x1f3ff) ||
    (code >= 0xe0020 && code <= 0xe007f)
  ) {
    throw new RenderError('UNSUPPORTED_CHARACTER', `${label(code)} requires unsupported shaping.`);
  }
  if (FORMAT.test(character) || code === 0x2028 || code === 0x2029) {
    return `\\u{${code.toString(16).toUpperCase()}}`;
  }
  if (
    (code >= 0xd800 && code <= 0xdfff) ||
    (code >= 0xfdd0 && code <= 0xfdef) ||
    (code & 0xffff) >= 0xfffe ||
    UNASSIGNED.test(character)
  ) {
    throw new RenderError(
      'MISSING_GLYPH',
      `${label(code)} is not an assigned printable character.`,
    );
  }
  if (!SIMPLE_SCRIPT.test(character)) {
    throw new RenderError(
      'UNSUPPORTED_CHARACTER',
      `${label(code)} is outside supported simple scripts.`,
    );
  }
  return character;
}

/** Preserves every space, source newline and wrapped code point; never clips a tail. */
export function layoutText(
  text: string,
  suppliedOptions: RenderOptions,
  font: BitmapFont,
): GridLayout {
  const options = validateOptions(suppliedOptions);
  validateSource(text, options);
  const contentWidth = Math.floor((options.width - GRID.margin * 2) / 8) * 8;
  const rowsPerPage = Math.floor(
    (options.height - GRID.margin * 2 - GRID.header - GRID.footer) / GRID.lineHeight,
  );
  if (rowsPerPage < 1 || contentWidth < 32) {
    throw new RenderError('INVALID_OPTIONS', 'Frame cannot hold a bitmap text row.');
  }
  const rows: GridRow[] = [];
  let glyphs: PositionedGlyph[] = [];
  let x = 0;
  let sourceLine = 1;
  let continuation = false;
  const flush = (): void => {
    if (rows.length >= rowsPerPage * options.maxFrames) {
      throw new RenderError('FRAME_LIMIT', 'Complete source cannot fit within the frame budget.');
    }
    rows.push({ sourceLine, continuation, glyphs });
    glyphs = [];
    x = 0;
  };
  for (const original of text) {
    if (original === '\n') {
      flush();
      sourceLine += 1;
      continuation = false;
      continue;
    }
    for (const character of escapeCharacter(original)) {
      const code = character.codePointAt(0);
      const glyph = code === undefined ? undefined : font.get(code);
      if (glyph === undefined) {
        throw new RenderError('MISSING_GLYPH', `No bitmap glyph for ${label(code ?? 0)}.`);
      }
      if (glyph.width > contentWidth) {
        throw new RenderError('INVALID_OPTIONS', 'Frame is narrower than a source glyph.');
      }
      if (x + glyph.width > contentWidth) {
        flush();
        continuation = true;
      }
      glyphs.push({ glyph, character, x });
      x += glyph.width;
    }
  }
  flush();
  const pages: GridPage[] = [];
  for (let start = 0; start < rows.length; start += rowsPerPage) {
    const pageRows = rows.slice(start, start + rowsPerPage);
    const first = pageRows[0];
    const last = pageRows.at(-1);
    if (first === undefined || last === undefined) throw new Error('Empty internal grid page.');
    pages.push({ rows: pageRows, firstLine: first.sourceLine, lastLine: last.sourceLine });
  }
  return { pages, lineCount: sourceLine, columns: contentWidth / 8, rowsPerPage };
}
