import { describe, expect, it } from 'vitest';
import { formatGroupedPaths, isUrlLikePath } from './path-tree.js';

describe('grouped path rendering', () => {
  it('matches the upstream grouped-tree shape', () => {
    const paths = [
      'packages/agent/src/compaction/compaction.ts',
      'packages/agent/src/compaction/utils.ts',
      'packages/agent/src/compaction/prompts/file-operations.md',
    ];
    const markers = new Map([
      ['packages/agent/src/compaction/compaction.ts', 'Read'],
      ['packages/agent/src/compaction/utils.ts', 'RW'],
      ['packages/agent/src/compaction/prompts/file-operations.md', 'Write'],
    ]);
    expect(formatGroupedPaths(paths, (path) => ` (${markers.get(path) ?? 'Read'})`)).toBe(
      [
        '# packages/agent/src/compaction/',
        'compaction.ts (Read)',
        'utils.ts (RW)',
        '## prompts/',
        'file-operations.md (Write)',
      ].join('\n'),
    );
  });

  it('folds leading chains for absolute paths', () => {
    expect(
      formatGroupedPaths(
        ['/Users/x/project/src/a.ts', '/Users/x/project/src/b/c.ts', '/Users/x/project/README.md'],
        () => ' (Read)',
      ),
    ).toBe(
      [
        '# /Users/x/project/',
        'README.md (Read)',
        '## src/',
        'a.ts (Read)',
        '### b/',
        'c.ts (Read)',
      ].join('\n'),
    );
  });

  it('normalizes Windows separators', () => {
    expect(formatGroupedPaths(['C:\\src\\a.ts', 'C:\\src\\lib\\b.ts'], () => ' (RW)')).toBe(
      ['# C:/src/', 'a.ts (RW)', '## lib/', 'b.ts (RW)'].join('\n'),
    );
  });

  it('prints root-level files before directory headings', () => {
    expect(formatGroupedPaths(['a.ts', 'dir/b.ts'], () => ' (Write)')).toBe(
      ['a.ts (Write)', '# dir/', 'b.ts (Write)'].join('\n'),
    );
  });

  it('keeps URL-like paths as root-level leaves', () => {
    expect(formatGroupedPaths(['https://example.com/a.ts'], () => ' (Read)')).toBe(
      'https://example.com/a.ts (Read)',
    );
    expect(isUrlLikePath('https://example.com/a.ts')).toBe(true);
    expect(isUrlLikePath('C:/src/a.ts')).toBe(false);
  });

  it('returns an empty string for no paths', () => {
    expect(formatGroupedPaths([])).toBe('');
  });
});
