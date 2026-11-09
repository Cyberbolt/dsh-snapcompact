import { PNG } from 'pngjs';
import type { BitmapFont, BitmapGlyph } from './font.js';
import { GRID, layoutText } from './layout.js';
import { RenderError } from './types.js';
import type { RenderedArchive, RenderedFrame, RenderOptions } from './types.js';

function assertDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw new RenderError('TIMEOUT', 'Rendering deadline exceeded.');
}

function drawGlyph(
  pixels: Buffer,
  width: number,
  glyph: BitmapGlyph,
  x: number,
  y: number,
  shade: number,
): void {
  const stride = glyph.width / 8;
  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < glyph.width; column += 1) {
      const byte = glyph.bitmap[row * stride + Math.floor(column / 8)] ?? 0;
      if ((byte & (0x80 >> column % 8)) === 0) continue;
      const offset = ((y + row) * width + x + column) * 4;
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
    }
  }
}

function drawLabel(pixels: Buffer, width: number, font: BitmapFont, text: string, y: number): void {
  let x = GRID.margin;
  for (const character of text) {
    const glyph = font.get(character.codePointAt(0) ?? 0);
    if (glyph === undefined)
      throw new RenderError('FONT_INVALID', 'Font lacks an ASCII label glyph.');
    if (x + glyph.width > width - GRID.margin) break;
    drawGlyph(pixels, width, glyph, x, y, 88);
    x += glyph.width;
  }
}

/** Layout, bitmap rasterization and PNG encoding are all executed by the worker. */
export function renderArchive(
  text: string,
  options: RenderOptions,
  font: BitmapFont,
  deadline = Date.now() + options.timeoutMs,
): RenderedArchive {
  assertDeadline(deadline);
  const layout = layoutText(text, options, font);
  const frames: RenderedFrame[] = [];
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
    const image = new PNG({ width: options.width, height });
    const pixels = image.data;
    pixels.fill(255);
    for (const [rowIndex, row] of page.rows.entries()) {
      assertDeadline(deadline);
      const y = GRID.margin + GRID.header + rowIndex * options.lineHeight;
      // Subtle row rules retain visible blank rows without changing source data.
      if (rowIndex % 2 === 1) {
        for (let dy = 0; dy < options.lineHeight; dy += 1) {
          for (let x = GRID.margin; x < options.width - GRID.margin; x += 1) {
            const offset = ((y + dy) * options.width + x) * 4;
            pixels[offset] = 246;
            pixels[offset + 1] = 246;
            pixels[offset + 2] = 246;
          }
        }
      }
      for (const placed of row.glyphs) {
        drawGlyph(pixels, options.width, placed.glyph, GRID.margin + placed.x, y + 2, 20);
      }
    }
    drawLabel(pixels, options.width, font, `#${pageIndex + 1}/${layout.pages.length}`, GRID.margin);
    drawLabel(
      pixels,
      options.width,
      font,
      `L${page.firstLine}-${page.lastLine}`,
      height - GRID.margin - 16,
    );
    const encoded = PNG.sync.write(image, {
      colorType: 0,
      inputColorType: 6,
      bitDepth: 8,
      deflateLevel: 6,
    });
    assertDeadline(deadline);
    totalBytes += encoded.byteLength;
    if (totalBytes > options.maxTotalBytes) {
      throw new RenderError('BYTE_LIMIT', 'Complete PNG archive exceeds the byte budget.');
    }
    // A dedicated ArrayBuffer can be transferred without retaining Node's pool.
    frames.push({
      data: Uint8Array.from(encoded),
      width: options.width,
      height,
      firstLine: page.firstLine,
      lastLine: page.lastLine,
      chars: page.chars,
    });
  }
  return { frames, lineCount: layout.lineCount, unrenderableChars: layout.unrenderableChars };
}
