import { Buffer } from 'node:buffer';
import { crc32, deflateSync } from 'node:zlib';
import { RenderError } from './types.js';

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.from(data);
  const output = Buffer.allocUnsafe(12 + body.length);
  output.writeUInt32BE(body.length, 0);
  typeBytes.copy(output, 4);
  body.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])), 8 + body.length);
  return output;
}

/**
 * Encode a one-bit grayscale PNG directly from a row-major bitmap.
 *
 * A set bit is white and a clear bit is black, matching PNG grayscale sample
 * values (`0` is black, the one-bit maximum is white). Padding bits at the end
 * of each row must stay set so a decoder never paints them black. The encoder
 * is intentionally self-contained: the bitmap font is already two-tone, so an
 * eight-bit RGBA intermediate and a general-purpose image encoder would only
 * inflate the request body.
 */
export function encodeOneBitPng(width: number, height: number, bitmap: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RenderError('INVALID_OPTIONS', 'PNG dimensions must be positive integers.');
  }
  const rowBytes = Math.ceil(width / 8);
  if (bitmap.length !== rowBytes * height) {
    throw new RenderError('INVALID_OPTIONS', 'Bitmap size does not match the PNG dimensions.');
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // bit depth
  header[9] = 0; // grayscale
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline starts with filter type 0 (None); the bitmap rows follow.
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * rowBytes;
    raw.set(bitmap.subarray(start, start + rowBytes), y * (rowBytes + 1) + 1);
  }

  const png = Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
  // Copy into a dedicated ArrayBuffer so the worker can transfer it safely.
  return Uint8Array.from(png);
}
