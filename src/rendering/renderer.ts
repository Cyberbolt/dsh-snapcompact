import type { BitmapFont, BitmapGlyph } from './font.js';
import { GRID, layoutText } from './layout.js';
import { encodeOneBitPng } from './png.js';
import { RenderError } from './types.js';
import type { RenderedArchive, RenderedFrame, RenderOptions } from './types.js';

const GLYPH_HEIGHT = 16;

function assertDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw new RenderError('TIMEOUT', 'Rendering deadline exceeded.');
}

/**
 * Clear the glyph ink bits in a one-bit canvas. A set bit is white, so ink is a
 * bitwise clear; glyphs are 8 or 16 pixels wide, but the per-pixel loop keeps the
 * rasterizer independent of that assumption.
 */
function drawGlyph(
  bitmap: Uint8Array,
  rowBytes: number,
  width: number,
  height: number,
  glyph: BitmapGlyph,
  x: number,
  y: number,
): void {
  const stride = glyph.width / 8;
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    const targetY = y + row;
    if (targetY < 0 || targetY >= height) continue;
    for (let column = 0; column < glyph.width; column += 1) {
      const targetX = x + column;
      if (targetX < 0 || targetX >= width) continue;
      const byte = glyph.bitmap[row * stride + Math.floor(column / 8)] ?? 0;
      if ((byte & (0x80 >> column % 8)) === 0) continue;
      const offset = targetY * rowBytes + (targetX >> 3);
      bitmap[offset] = (bitmap[offset] ?? 0) & (~(0x80 >> (targetX & 7)) & 0xff);
    }
  }
}

function drawLabel(
  bitmap: Uint8Array,
  rowBytes: number,
  width: number,
  height: number,
  font: BitmapFont,
  text: string,
  y: number,
): void {
  let x = GRID.margin;
  for (const character of text) {
    const glyph = font.get(character.codePointAt(0) ?? 0);
    if (glyph === undefined)
      throw new RenderError('FONT_INVALID', 'Font lacks an ASCII label glyph.');
    if (x + glyph.width > width - GRID.margin) break;
    drawGlyph(bitmap, rowBytes, width, height, glyph, x, y);
    x += glyph.width;
  }
}

/**
 * Layout, bitmap rasterization and PNG encoding are all executed by the worker.
 * Frames are one-bit grayscale: dense text compresses well, the bundled font is
 * already two-tone, and no intermediate RGBA buffer is allocated.
 */
export function renderArchive(
  text: string,
  options: RenderOptions,
  font: BitmapFont,
  deadline = Date.now() + options.timeoutMs,
): RenderedArchive {
  assertDeadline(deadline);
  const layout = layoutText(text, options, font);
  const frames: RenderedFrame[] = [];
  const rowBytes = Math.ceil(options.width / 8);
  // Center the 16-row glyph inside a taller line; at lineHeight 16 it fills the row.
  const glyphOffset = Math.max(0, Math.floor((options.lineHeight - GLYPH_HEIGHT) / 2));
  let totalBytes = 0;
  for (const [pageIndex, page] of layout.pages.entries()) {
    assertDeadline(deadline);
    // Hug the rows actually printed; a sparse final page must not be priced and
    // transmitted as a full-height frame.
    const height = Math.max(
      64,
      Math.min(
        options.height,
        GRID.margin * 2 + GRID.header + GRID.footer + page.rows.length * options.lineHeight,
      ),
    );
    const bitmap = new Uint8Array(rowBytes * height).fill(0xff);
    for (const [rowIndex, row] of page.rows.entries()) {
      assertDeadline(deadline);
      const y = GRID.margin + GRID.header + rowIndex * options.lineHeight + glyphOffset;
      for (const placed of row.glyphs) {
        drawGlyph(bitmap, rowBytes, options.width, height, placed.glyph, GRID.margin + placed.x, y);
      }
    }
    drawLabel(
      bitmap,
      rowBytes,
      options.width,
      height,
      font,
      `#${pageIndex + 1}/${layout.pages.length}`,
      GRID.margin,
    );
    drawLabel(
      bitmap,
      rowBytes,
      options.width,
      height,
      font,
      `L${page.firstLine}-${page.lastLine}`,
      height - GRID.margin - 16,
    );
    const encoded = encodeOneBitPng(options.width, height, bitmap);
    assertDeadline(deadline);
    totalBytes += encoded.byteLength;
    if (totalBytes > options.maxTotalBytes) {
      throw new RenderError('BYTE_LIMIT', 'Complete PNG archive exceeds the byte budget.');
    }
    frames.push({
      data: encoded,
      width: options.width,
      height,
      firstLine: page.firstLine,
      lastLine: page.lastLine,
      chars: page.chars,
    });
  }
  return { frames, lineCount: layout.lineCount, unrenderableChars: layout.unrenderableChars };
}
