import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { encodeOneBitPng } from './png.js';

describe('one-bit PNG encoder', () => {
  it('round-trips a row-major bitmap with PNG grayscale polarity', () => {
    const bitmap = Uint8Array.from([0xaa, 0xaa, 0xff, 0xff]);
    const encoded = encodeOneBitPng(16, 2, bitmap);
    const decoded = PNG.sync.read(Buffer.from(encoded));
    expect([decoded.width, decoded.height, decoded.depth, decoded.colorType]).toEqual([
      16, 2, 1, 0,
    ]);
    const pixel = (x: number, y: number): number => decoded.data[(y * 16 + x) * 4] ?? -1;
    expect(pixel(0, 0)).toBe(255);
    expect(pixel(1, 0)).toBe(0);
    expect(pixel(2, 0)).toBe(255);
    for (let x = 0; x < 16; x += 1) expect(pixel(x, 1)).toBe(255);
  });

  it('is deterministic and compresses an all-white page', () => {
    const first = encodeOneBitPng(8, 8, new Uint8Array(8).fill(0xff));
    const second = encodeOneBitPng(8, 8, new Uint8Array(8).fill(0xff));
    expect(first).toEqual(second);
    expect(first.byteLength).toBeLessThan(120);
    const decoded = PNG.sync.read(Buffer.from(first));
    expect(decoded.data.every((byte) => byte === 255)).toBe(true);
  });

  it('rejects a bitmap whose size does not match the dimensions', () => {
    expect(() => encodeOneBitPng(16, 2, new Uint8Array(3))).toThrow(/does not match/);
    expect(() => encodeOneBitPng(0, 2, new Uint8Array(0))).toThrow(/positive integers/);
  });
});
