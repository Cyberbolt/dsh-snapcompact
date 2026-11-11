import { describe, expect, it } from 'vitest';
import { renderFileList } from '../file-ops.js';
import type { VisualSource } from '../visual-source.js';
import { summaryBlocks } from './snapcompact.js';

const source: VisualSource = {
  head: 'exact head',
  middle: 'middle',
  tail: 'exact tail',
  truncatedChars: 0,
  carriedImages: [],
  totalChars: 26,
};

const files = renderFileList({
  read: new Set(['src/a.ts']),
  modified: new Set(['src/b.ts']),
});

describe('visual checkpoint summary composition', () => {
  it('places the FILES block after the guide and before the exact head', () => {
    const blocks = summaryBlocks(source, files, [], [], 0, 0);
    expect(blocks[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Visual snapcompact checkpoint'),
    });
    const guide = blocks[0];
    const text = guide?.type === 'text' ? guide.text : '';
    expect(text).toContain('\u00b6');
    expect(text).toContain('source newline');
    expect(text).toContain('leading spaces are indentation');
    expect(text).toContain('#n/m');
    expect(text).toContain('source-line range');
    expect(text).toContain('snapcompact_recall');
    expect(blocks[1]).toEqual({ type: 'text', text: files });
    expect(blocks[2]).toEqual({ type: 'text', text: 'exact head' });
    expect(blocks.at(-1)).toEqual({ type: 'text', text: 'exact tail' });
  });

  it('does not emit an empty FILES block', () => {
    const blocks = summaryBlocks(source, '', [], [], 0, 0);
    expect(blocks.every((block) => block.type !== 'text' || block.text !== '')).toBe(true);
    expect(blocks[1]).toEqual({ type: 'text', text: 'exact head' });
  });
});
