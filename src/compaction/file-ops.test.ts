import { describe, expect, it } from 'vitest';
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction';
import {
  FILE_LIST_HEADER,
  FILE_LIST_LEGEND,
  FILE_LIST_LIMIT,
  collectFileOperations,
  isFileListBlock,
  parseFileListBlock,
  renderFileList,
} from './file-ops.js';
import type { FileOperations } from './file-ops.js';

let nextCall = 0;

function toolCall(name: string, args: unknown): Extract<ContentBlock, { type: 'tool-call' }> {
  nextCall += 1;
  return {
    type: 'tool-call',
    id: `call-${nextCall}` as never,
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
  };
}

function assistant(...calls: ContentBlock[]): Message {
  return createMessage({
    role: 'assistant',
    source: { kind: 'model', provider: 'test', model: 'vision' },
    content: calls,
  });
}

function checkpoint(text: string): Message {
  return createMessage({
    role: 'user',
    source: compactCheckpointSource(CompactionId(`compaction-${nextCall}`)),
    content: [{ type: 'text', text }],
  });
}

function operations(read: readonly string[], modified: readonly string[]): FileOperations {
  return { read: new Set(read), modified: new Set(modified) };
}

describe('checkpoint FILES extraction', () => {
  it('maps read, write and edit calls to Read, Write and RW markers', () => {
    const messages = [
      assistant(
        toolCall('read', { file_path: 'src/a.ts' }),
        toolCall('write', { path: 'src/b.ts' }),
        toolCall('edit', { file_path: 'src/a.ts' }),
      ),
    ];
    const collected = collectFileOperations(messages);
    expect([...collected.read]).toEqual(['src/a.ts']);
    expect([...collected.modified].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    const rendered = renderFileList(collected);
    expect(rendered).toContain('a.ts (RW)');
    expect(rendered).toContain('b.ts (Write)');
  });

  it('ignores malformed, non-file, unsafe and unknown tool calls', () => {
    const longPath = `src/${'x'.repeat(600)}.ts`;
    const messages = [
      assistant(
        toolCall('glob', { pattern: 'src/**/*.ts' }),
        toolCall('read', '{'),
        toolCall('read', { file_path: 42 }),
        toolCall('read', { file_path: 'https://example.com/a.ts' }),
        toolCall('read', { file_path: 'src/bad\nname.ts' }),
        toolCall('read', { file_path: longPath }),
        toolCall('write', { file_path: '' }),
        toolCall('edit', { file_path: 'src/./normalized.ts' }),
      ),
    ];
    const collected = collectFileOperations(messages);
    expect([...collected.read]).toEqual([]);
    expect([...collected.modified]).toEqual(['src/normalized.ts']);
  });

  it('normalizes separators and deduplicates aliases', () => {
    const messages = [
      assistant(
        toolCall('read', { file_path: './src\\a.ts' }),
        toolCall('read', { path: 'src/a.ts' }),
        toolCall('read', { file_path: 'src/dir/' }),
      ),
    ];
    const collected = collectFileOperations(messages);
    expect([...collected.read].sort()).toEqual(['src/a.ts', 'src/dir']);
  });

  it('falls back to path when file_path is missing or invalid', () => {
    const messages = [
      assistant(
        toolCall('read', { file_path: 1, path: 'src/fallback.ts' }),
        toolCall('write', { file_path: '', path: 'src/empty.ts' }),
      ),
    ];
    const collected = collectFileOperations(messages);
    expect([...collected.read]).toEqual(['src/fallback.ts']);
    expect([...collected.modified]).toEqual(['src/empty.ts']);
  });
});

describe('checkpoint FILES rendering', () => {
  it('renders a strict header, legend and prefix-folded tree', () => {
    const rendered = renderFileList(
      operations(
        ['src/compaction/visual-source.ts'],
        ['src/compaction/methods/snapcompact.ts', 'src/compaction/visual-source.ts'],
      ),
    );
    expect(rendered).toBe(
      [
        FILE_LIST_HEADER,
        FILE_LIST_LEGEND,
        '='.repeat(60),
        '# src/compaction/',
        'visual-source.ts (RW)',
        '## methods/',
        'snapcompact.ts (Write)',
      ].join('\n'),
    );
    expect(isFileListBlock(rendered)).toBe(true);
  });

  it('returns no block when there are no file operations', () => {
    expect(renderFileList(operations([], []))).toBe('');
  });

  it('caps the list, sorts paths and reports elided entries', () => {
    const read = Array.from(
      { length: FILE_LIST_LIMIT + 1 },
      (_, index) => `src/file-${String(index).padStart(2, '0')}.ts`,
    );
    const rendered = renderFileList(operations(read, []));
    const lines = rendered.split('\n');
    expect(lines.filter((line) => line.endsWith('(Read)'))).toHaveLength(FILE_LIST_LIMIT);
    expect(rendered).toContain('[…1 files elided…]');
    expect(rendered.indexOf('file-00.ts')).toBeLessThan(rendered.indexOf('file-19.ts'));
    expect(rendered).not.toContain('file-20.ts');
  });

  it('round-trips read and modified sets through parse', () => {
    const original = operations(['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts']);
    expect(parseFileListBlock(renderFileList(original))).toEqual(original);
  });

  it('rejects text that merely resembles a FILES heading', () => {
    expect(isFileListBlock(`${FILE_LIST_HEADER}\nnot a real block`)).toBe(false);
    expect(parseFileListBlock(`${FILE_LIST_HEADER}\nnot a real block`)).toBeUndefined();
  });
});

describe('cumulative FILES across checkpoints', () => {
  it('merges an earlier checkpoint list with new tool calls', () => {
    const previous = renderFileList(operations(['src/a.ts'], ['src/b.ts']));
    const messages = [
      checkpoint(previous),
      assistant(
        toolCall('read', { file_path: 'src/b.ts' }),
        toolCall('write', { file_path: 'src/c.ts' }),
      ),
    ];
    const collected = collectFileOperations(messages);
    expect([...collected.read].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...collected.modified].sort()).toEqual(['src/b.ts', 'src/c.ts']);
    const rendered = renderFileList(collected);
    expect(rendered).toContain('a.ts (Read)');
    expect(rendered).toContain('b.ts (RW)');
    expect(rendered).toContain('c.ts (Write)');
  });

  it('does not parse a FILES-shaped block from an ordinary user message', () => {
    const text = renderFileList(operations(['src/a.ts'], []));
    const messages = [
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    ];
    expect(collectFileOperations(messages)).toEqual(operations([], []));
  });
});
