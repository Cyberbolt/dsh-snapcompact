import { describe, expect, it } from 'vitest';
import { parseHexFont } from './font.js';
import type { BitmapFont, BitmapGlyph } from './font.js';
import { NEWLINE_MARKER, escapeCharacter, layoutText } from './layout.js';
import { validateOptions, validateSource } from './options.js';
import { renderArchive } from './renderer.js';
import type { RenderOptions } from './types.js';
import { PNG } from 'pngjs';

const options: RenderOptions = {
  width: 128,
  height: 128,
  maxFrames: 12,
  maxTotalBytes: 16 * 1024 * 1024,
  maxSourceBytes: 64 * 1024 * 1024,
  timeoutMs: 15_000,
  lineHeight: 20,
  letterSpacing: 0,
};
const ascii: BitmapGlyph = { width: 8, bitmap: new Uint8Array(16).fill(0x7e) };
const wide: BitmapGlyph = { width: 16, bitmap: new Uint8Array(32).fill(0x7e) };
const font: BitmapFont = new Map([
  ...Array.from({ length: 95 }, (_, index): [number, BitmapGlyph] => [index + 32, ascii]),
  [0xb6, ascii],
  [0x4e2d, wide],
  [0x1f600, wide],
]);

function characters(text: string): string[] {
  return layoutText(text, options, font).pages.flatMap((page) =>
    page.rows.map((row) => row.glyphs.map((glyph) => glyph.character).join('')),
  );
}

describe('original bitmap font reader', () => {
  it('parses narrow and wide row-major bitmaps', () => {
    const parsed = parseHexFont(`0041:${'FF'.repeat(16)}\n4E2D:${'8001'.repeat(16)}\n`);
    expect(parsed.get(0x41)?.width).toBe(8);
    expect(parsed.get(0x4e2d)?.width).toBe(16);
    expect(parsed.get(0x4e2d)?.bitmap[1]).toBe(1);
  });
  it.each([
    '',
    '0041:XX',
    `0041:${'00'.repeat(16)}\n0041:${'00'.repeat(16)}`,
    `110000:${'00'.repeat(16)}`,
  ])('rejects malformed or duplicate records', (source) =>
    expect(() => parseHexFont(source)).toThrow(),
  );
});

describe('continuous source flow', () => {
  it('keeps indentation, trims trailing spaces and marks each source newline', () => {
    expect(characters('  a  \n\n b\n')).toEqual(['  a¶¶ b¶']);
    expect(layoutText('  a  \n\n b\n', options, font).lineCount).toBe(4);
    expect(characters('')).toEqual(['']);
    expect(characters('a  ')).toEqual(['a']);
  });
  it('packs short lines and blank lines into one continuous row', () => {
    expect(characters('aa\nbb\ncc')).toEqual(['aa¶bb¶cc']);
    expect(characters('aa\n\n\ncc')).toEqual(['aa¶¶¶cc']);
    expect(characters('a\nb\nc').length).toBe(1);
  });
  it('explicitly escapes tabs, ANSI, CR, C1, bidi, invisible separators and literal markers', () => {
    expect(escapeCharacter('\t')).toBe('\\t');
    expect(escapeCharacter('\x1b')).toBe('\\x1B');
    expect(escapeCharacter('\r')).toBe('\\r');
    expect(escapeCharacter('\u009b')).toBe('\\x9B');
    expect(escapeCharacter('\u202e')).toBe('\\u{202E}');
    expect(escapeCharacter('\u2028')).toBe('\\u{2028}');
    expect(escapeCharacter(NEWLINE_MARKER)).toBe('\\u{00B6}');
    expect(characters('\t')).toEqual(['']);
    expect(characters('a\tb').join('')).toBe('a b');
    expect(characters('\x1b[31m')).toEqual(['']);
    expect(characters(`a${NEWLINE_MARKER}b`)).toEqual(['a\\u{00B6}b']);
  });
  it('wraps at bitmap width without splitting astral characters', () => {
    const result = layoutText(`${'a'.repeat(11)}中😀`, options, font);
    expect(result.pages[0]?.rows[0]?.glyphs.length).toBe(11);
    expect(result.pages[0]?.rows[1]?.glyphs.map((item) => item.character)).toEqual(['中', '😀']);
    expect(result.lineCount).toBe(1);
  });
  it('keeps exact page boundaries and one-based source line ranges', () => {
    const result = layoutText(`${'x'.repeat(1)}\n`.repeat(20).trimEnd(), options, font);
    expect(result.pages.map((page) => [page.firstLine, page.lastLine])).toEqual([
      [1, 12],
      [13, 20],
    ]);
    expect(result.pages.map((page) => page.chars)).toEqual([12, 8]);
    expect(layoutText('a\nb\nc', { ...options, maxFrames: 1 }, font).pages).toHaveLength(1);
    expect(() => layoutText('a'.repeat(25), { ...options, maxFrames: 1 }, font)).toThrow(
      /frame budget/,
    );
  });
  it.each([
    'e\u0301',
    'العربية',
    'עברית',
    'क',
    'ก',
    '👩\u200d💻',
    '❤️',
    '🇨🇳',
    '👍🏽',
    '\u1100',
    '\ud800',
    '\u0378',
  ])('replaces unrenderable glyphs and shaping with a visible fallback: %s', (text) => {
    const result = layoutText(text, options, font);
    const rendered = result.pages
      .flatMap((page) => page.rows)
      .flatMap((row) => row.glyphs.map((glyph) => glyph.character))
      .join('');
    expect(rendered).toContain('?');
    expect(result.unrenderableChars).toBeGreaterThan(0);
  });
  it('does not abort the whole frame for one unsupported glyph', () => {
    const result = layoutText('é', options, font);
    expect(result.unrenderableChars).toBe(1);
    expect(result.pages[0]?.rows[0]?.glyphs.map((glyph) => glyph.character)).toEqual(['?']);
  });
});

describe('budgets and PNG output', () => {
  it('validates all options and UTF-8 source byte limits', () => {
    expect(() => validateOptions({ ...options, timeoutMs: 15_001 })).toThrow();
    expect(() => validateOptions({ ...options, width: Number.NaN })).toThrow();
    expect(() => validateOptions({ ...options, maxFrames: 1.5 })).toThrow();
    expect(() => validateSource('中', { ...options, maxSourceBytes: 2 })).toThrow(/UTF-8/);
    expect(validateOptions(options)).toEqual(options);
    expect(validateOptions(options)).not.toBe(options);
  });
  it('produces deterministic one-bit PNG pages and rejects partial byte-limited archives', () => {
    const archive = renderArchive('a\nb\nc', options, font);
    expect(archive.frames).toHaveLength(1);
    const first = archive.frames[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error('Missing first PNG');
    expect([first.firstLine, first.lastLine, first.chars]).toEqual([1, 3, 3]);
    const decoded = PNG.sync.read(Buffer.from(first.data));
    expect([decoded.width, decoded.height]).toEqual([128, 100]);
    expect([decoded.depth, decoded.colorType]).toEqual([1, 0]);
    expect(decoded.data.some((byte, index) => index % 4 !== 3 && byte === 0)).toBe(true);
    expect(first.data).toEqual(renderArchive('a\nb\nc', options, font).frames[0]?.data);
    expect(() => renderArchive('a', { ...options, maxTotalBytes: 1 }, font)).toThrow(/byte budget/);
    expect(() => renderArchive('a', options, font, Date.now() - 1)).toThrow(/deadline/);
  });
  it('fits glyphs inside the minimum line height without row overlap', () => {
    const tight = renderArchive('a'.repeat(20), { ...options, lineHeight: 16 }, font);
    expect(tight.frames).toHaveLength(1);
    const frame = tight.frames[0];
    if (frame === undefined) throw new Error('Missing tight frame');
    const decoded = PNG.sync.read(Buffer.from(frame.data));
    expect(decoded.height).toBe(112);
    expect([decoded.depth, decoded.colorType]).toEqual([1, 0]);
  });
});
