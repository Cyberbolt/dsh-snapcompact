import { beforeAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { loadFont } from './font.js';
import type { BitmapFont } from './font.js';
import { NEWLINE_MARKER } from './layout.js';
import { renderArchive } from './renderer.js';
import type { RenderedArchive, RenderOptions } from './types.js';

const options: RenderOptions = {
  width: 1568,
  height: 1568,
  maxFrames: 64,
  maxTotalBytes: 16 * 1024 * 1024,
  maxSourceBytes: 64 * 1024 * 1024,
  timeoutMs: 15_000,
  lineHeight: 20,
  letterSpacing: 0,
};

const prose = Array.from(
  { length: 1000 },
  (_, index) => `Observation ${index}: historical build log; no change to user constraints.`,
).join('\n');

const code = Array.from({ length: 240 }, (_, index) =>
  [
    `function handler${index}(value) {`,
    `    const result${index} = value ?? default${index};`,
    `    if (result${index} === null) return fallback${index};`,
    `}`,
  ].join('\n'),
).join('\n');

function density(archive: RenderedArchive): { frames: number; chars: number; bytes: number } {
  return {
    frames: archive.frames.length,
    chars: archive.frames.reduce((total, frame) => total + frame.chars, 0),
    bytes: archive.frames.reduce((total, frame) => total + frame.data.byteLength, 0),
  };
}

describe('continuous layout density', () => {
  let font: BitmapFont;
  beforeAll(async () => {
    font = await loadFont();
  });

  it('packs the prose corpus into at most six 1568px frames', () => {
    const archive = renderArchive(prose, options, font);
    const result = density(archive);
    expect(archive.frames.length).toBeGreaterThanOrEqual(4);
    expect(archive.frames.length).toBeLessThanOrEqual(6);
    expect(result.chars).toBe(prose.length - (prose.split('\n').length - 1));
    expect(result.chars / result.frames).toBeGreaterThanOrEqual(11_000);
    expect(result.bytes).toBeLessThanOrEqual(70_000);
    expect(Math.max(...archive.frames.map((frame) => frame.height))).toBeLessThanOrEqual(1568);
  });

  it('keeps indented code above eight thousand characters per frame', () => {
    const archive = renderArchive(code, options, font);
    const result = density(archive);
    expect(archive.frames.length).toBeLessThanOrEqual(4);
    expect(result.chars / result.frames).toBeGreaterThanOrEqual(8_000);
    expect(result.bytes).toBeLessThanOrEqual(60_000);
  });

  it('encodes every frame as a decodable one-bit grayscale PNG', () => {
    const archive = renderArchive(`${prose}\n\n${code}`, options, font);
    expect(archive.frames.length).toBeGreaterThan(0);
    for (const frame of archive.frames) {
      const decoded = PNG.sync.read(Buffer.from(frame.data));
      expect([decoded.width, decoded.depth, decoded.colorType]).toEqual([1568, 1, 0]);
      expect(decoded.height).toBe(frame.height);
      const black = decoded.data.reduce(
        (total, byte, index) => (index % 4 === 0 && byte === 0 ? total + 1 : total),
        0,
      );
      expect(black / (decoded.width * decoded.height)).toBeGreaterThan(0.02);
    }
    expect(renderArchive(`${prose}\n\n${code}`, options, font).frames[0]?.data).toEqual(
      archive.frames[0]?.data,
    );
    expect(NEWLINE_MARKER).toBe('\u00b6');
  });
});
