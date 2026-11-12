import type { BitmapFont, BitmapGlyph } from './font.js';
import { validateOptions, validateSource } from './options.js';
import { RenderError } from './types.js';
import type { RenderOptions } from './types.js';

export const GRID = Object.freeze({ margin: 16, header: 24, footer: 24 });

/**
 * Printed in place of one source newline: the marker costs a single cell and
 * keeps line structure readable while the rest of the text flows continuously.
 * Consecutive markers are consecutive blank lines.
 */
export const NEWLINE_MARKER = '\u00b6';

export interface PositionedGlyph {
  readonly glyph: BitmapGlyph;
  readonly character: string;
  readonly x: number;
}

export interface GridRow {
  readonly firstLine: number;
  readonly lastLine: number;
  /** Content glyphs on this row, excluding newline markers. */
  readonly chars: number;
  readonly glyphs: readonly PositionedGlyph[];
}

export interface GridPage {
  readonly rows: readonly GridRow[];
  readonly firstLine: number;
  readonly lastLine: number;
  /** Number of source characters represented by this page (markers excluded). */
  readonly chars: number;
}

export interface GridLayout {
  readonly pages: readonly GridPage[];
  readonly lineCount: number;
  readonly columns: number;
  readonly rowsPerPage: number;
  readonly unrenderableChars: number;
}

// Deliberately conservative: no bidi reordering, ligation, contextual joining,
// combining-mark placement, grapheme composition, or emoji sequence shaping.
const SIMPLE_SCRIPT =
  /^(?:\p{Script=Common}|\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Bopomofo}|\p{Script=Armenian}|\p{Script=Georgian}|\p{Script=Ethiopic}|\p{Script=Cherokee}|\p{Script=Yi}|\p{Script=Canadian_Aboriginal}|\p{Script=Ogham}|\p{Script=Runic})$/u;
const MARK = /\p{Mark}/u;
const UNASSIGNED = /\p{Unassigned}/u;
const FORMAT = /\p{Format}/u;
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'gu');
const TRAILING_SPACES = / +$/u;
const LEADING_SPACES = /^ +/u;
const INNER_SPACES = / {2,}/gu;

function label(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Canonical text projection: CRLF, ANSI and tabs become deterministic ASCII. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/gu, '\n').replace(ANSI_ESCAPE, '').replace(/\t/gu, '    ');
}

/**
 * Visible, literal ASCII escapes; nothing interprets terminal escape sequences.
 * Characters the bitmap grid cannot represent are replaced with `?` so one
 * exotic code point cannot discard an otherwise readable checkpoint.
 */
export function escapeCharacter(character: string): string {
  const code = character.codePointAt(0);
  if (code === undefined) return '';
  if (character === '\n') return '\n';
  if (character === '\t') return '\\t';
  if (character === '\r') return '\\r';
  // A literal paragraph mark must not be mistaken for the newline marker.
  if (character === NEWLINE_MARKER) return '\\u{00B6}';
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
    return '?';
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
    return '?';
  }
  if (!SIMPLE_SCRIPT.test(character)) {
    return '?';
  }
  return character;
}

/**
 * Continuous text flow: a full row wraps at the frame edge, one `¶` marks each
 * source newline, and leading indentation is preserved verbatim. No source line
 * reserves the remainder of its row, which is where most of the density gain
 * comes from. The exact head/tail and index, not this projection, remain the source of truth.
 */
export function layoutText(
  text: string,
  suppliedOptions: RenderOptions,
  font: BitmapFont,
): GridLayout {
  const options = validateOptions(suppliedOptions);
  const normalized = normalizeText(text);
  validateSource(normalized, options);
  const contentWidth = Math.floor((options.width - GRID.margin * 2) / 8) * 8;
  const rowsPerPage = Math.floor(
    (options.height - GRID.margin * 2 - GRID.header - GRID.footer) / options.lineHeight,
  );
  if (rowsPerPage < 1 || contentWidth < 32) {
    throw new RenderError('INVALID_OPTIONS', 'Frame cannot hold a bitmap text row.');
  }
  const question = font.get(0x3f);
  if (question === undefined) {
    throw new RenderError('FONT_INVALID', 'Font lacks the fallback glyph.');
  }
  const marker = font.get(NEWLINE_MARKER.codePointAt(0) ?? 0);
  if (marker === undefined) {
    throw new RenderError('FONT_INVALID', 'Font lacks the newline marker glyph.');
  }

  const rows: GridRow[] = [];
  let glyphs: PositionedGlyph[] = [];
  let x = 0;
  let rowChars = 0;
  let rowFirstLine = 1;
  let rowLastLine = 1;
  let unrenderableChars = 0;

  const flush = (): void => {
    if (rows.length >= rowsPerPage * options.maxFrames) {
      throw new RenderError('FRAME_LIMIT', 'Complete source cannot fit within the frame budget.');
    }
    rows.push({
      firstLine: rowFirstLine,
      lastLine: rowLastLine,
      chars: rowChars,
      glyphs,
    });
    glyphs = [];
    x = 0;
    rowChars = 0;
  };

  const place = (
    glyph: BitmapGlyph,
    character: string,
    sourceLine: number,
    isMarker: boolean,
  ): void => {
    if (glyph.width > contentWidth) {
      throw new RenderError('INVALID_OPTIONS', 'Frame is narrower than a source glyph.');
    }
    if (x + glyph.width > contentWidth && glyphs.length > 0) {
      flush();
    }
    if (glyphs.length === 0) {
      rowFirstLine = sourceLine;
    }
    rowLastLine = sourceLine;
    glyphs.push({ glyph, character, x });
    x += glyph.width + options.letterSpacing;
    if (!isMarker) rowChars += 1;
  };

  const lines = normalized.split('\n');
  for (const [index, original] of lines.entries()) {
    const sourceLine = index + 1;
    const trimmed = original.replace(TRAILING_SPACES, '');
    const indent = LEADING_SPACES.exec(trimmed)?.[0] ?? '';
    // Preserve indentation, collapse long internal runs: log padding costs
    // frame cells but carries no meaning. Exact strings live in the text edges.
    const line = indent + trimmed.slice(indent.length).replace(INNER_SPACES, ' ');
    for (const character of line) {
      const escaped = escapeCharacter(character);
      if (escaped === '?' && character !== '?') unrenderableChars += 1;
      for (const renderedCharacter of escaped) {
        const code = renderedCharacter.codePointAt(0);
        let glyph = code === undefined ? undefined : font.get(code);
        let rendered = renderedCharacter;
        if (glyph === undefined) {
          glyph = question;
          rendered = '?';
          unrenderableChars += 1;
        }
        if (glyph === undefined) {
          throw new RenderError('MISSING_GLYPH', `No bitmap glyph for ${label(code ?? 0)}.`);
        }
        place(glyph, rendered, sourceLine, false);
      }
    }
    if (index < lines.length - 1) {
      place(marker, NEWLINE_MARKER, sourceLine, true);
    }
  }
  flush();

  const pages: GridPage[] = [];
  for (let start = 0; start < rows.length; start += rowsPerPage) {
    const pageRows = rows.slice(start, start + rowsPerPage);
    const first = pageRows[0];
    const last = pageRows.at(-1);
    if (first === undefined || last === undefined) throw new Error('Empty internal grid page.');
    pages.push({
      rows: pageRows,
      firstLine: first.firstLine,
      lastLine: last.lastLine,
      chars: pageRows.reduce((total, row) => total + row.chars, 0),
    });
  }
  return {
    pages,
    lineCount: lines.length,
    columns: contentWidth / 8,
    rowsPerPage,
    unrenderableChars,
  };
}
