import type { Message } from '@deepseek-ai/dsh-llm';
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction';
import { formatGroupedPaths, isUrlLikePath } from './path-tree.js';

/** Maximum files shown in one checkpoint FILES section. */
export const FILE_LIST_LIMIT = 20;

/** First line of a generated FILES block; also the parser's identity marker. */
export const FILE_LIST_HEADER =
  'FILES (touched by read/write/edit tools; not a current disk-state guarantee)';

/** Second line of a generated FILES block; keeps the markers self-explanatory. */
export const FILE_LIST_LEGEND =
  '(Read) read-only; (Write) written without a read; (RW) read and written';

const FILE_LIST_RULE = '='.repeat(60);
const MAX_PATH_CHARACTERS = 512;

/** Cumulative tool-observed file activity for one checkpoint. */
export interface FileOperations {
  /** Paths touched by `read` only, or by both a read and a mutation. */
  readonly read: ReadonlySet<string>;
  /** Paths written or edited by `write` / `edit`. */
  readonly modified: ReadonlySet<string>;
}

interface MutableFileOperations {
  readonly read: Set<string>;
  readonly modified: Set<string>;
}

function emptyOperations(): MutableFileOperations {
  return { read: new Set<string>(), modified: new Set<string>() };
}

function mergeOperations(target: MutableFileOperations, source: FileOperations): void {
  for (const path of source.read) target.read.add(path);
  for (const path of source.modified) target.modified.add(path);
}

function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x2028 || code === 0x2029) return true;
    if (/\p{Cf}/u.test(character)) return true;
  }
  return false;
}

/**
 * Keep the tool-observed path readable and safe inside a plain text block.
 * Relative paths are not resolved against a cwd; only cosmetic separators are
 * normalized so repeated calls deduplicate.
 */
function normalizePath(raw: string): string | undefined {
  if (raw.length === 0 || raw.length > MAX_PATH_CHARACTERS) return undefined;
  if (!raw.isWellFormed() || hasUnsafeCharacters(raw)) return undefined;
  if (isUrlLikePath(raw)) return undefined;
  let path = raw.replace(/\\/g, '/');
  while (path.startsWith('./')) path = path.slice(2);
  while (path.includes('/./')) path = path.replace('/./', '/');
  while (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
  if (path.endsWith('/.')) path = path.slice(0, -2);
  if (path.length === 0 || path === '/' || path === '.' || path.trim().length === 0)
    return undefined;
  return path;
}

/** Read `file_path` first, then the compatible `path` shape used by other tools. */
function toolCallPath(argumentsText: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  for (const candidate of [record['file_path'], record['path']]) {
    if (typeof candidate !== 'string') continue;
    const path = normalizePath(candidate);
    if (path !== undefined) return path;
  }
  return undefined;
}

function addToolCall(operations: MutableFileOperations, name: string, argumentsText: string): void {
  if (name !== 'read' && name !== 'write' && name !== 'edit') return;
  const path = toolCallPath(argumentsText);
  if (path === undefined) return;
  if (name === 'read') operations.read.add(path);
  else operations.modified.add(path);
}

/**
 * True only for the exact generated block shape. The strict header, legend and
 * rule check prevents ordinary user text from being treated as metadata.
 */
export function isFileListBlock(text: string): boolean {
  const lines = text.split('\n');
  return (
    lines[0] === FILE_LIST_HEADER && lines[1] === FILE_LIST_LEGEND && lines[2] === FILE_LIST_RULE
  );
}

/** Parse a FILES block back into cumulative sets, or return undefined when malformed. */
export function parseFileListBlock(text: string): FileOperations | undefined {
  if (!isFileListBlock(text)) return undefined;
  const operations = emptyOperations();
  const directories: string[] = [];
  for (const line of text.split('\n').slice(3)) {
    const heading = /^(#+) (.+)\/$/.exec(line);
    if (heading !== null) {
      const depth = heading[1]?.length ?? 0;
      const name = heading[2];
      if (depth < 1 || name === undefined) continue;
      directories.length = depth - 1;
      while (directories.length < depth - 1) directories.push('');
      directories[depth - 1] = name;
      continue;
    }
    const file = /^(.*) \((Read|Write|RW)\)$/.exec(line);
    if (file === null) continue;
    const name = file[1];
    const mode = file[2];
    if (name === undefined || mode === undefined || name.length === 0) continue;
    const prefix = directories.filter((part) => part.length > 0).join('/');
    const path = normalizePath(prefix.length > 0 ? `${prefix}/${name}` : name);
    if (path === undefined) continue;
    if (mode === 'Read') operations.read.add(path);
    else if (mode === 'Write') operations.modified.add(path);
    else {
      operations.read.add(path);
      operations.modified.add(path);
    }
  }
  return operations.read.size === 0 && operations.modified.size === 0 ? undefined : operations;
}

/**
 * Collect cumulative file activity from the compacted range and from earlier
 * snapcompact checkpoints replayed inside it.
 */
export function collectFileOperations(messages: readonly Message[]): FileOperations {
  const operations = emptyOperations();
  for (const message of messages) {
    if (isCompactCheckpointSource(message.source)) {
      for (const block of message.content) {
        if (block.type !== 'text') continue;
        const previous = parseFileListBlock(block.text);
        if (previous !== undefined) mergeOperations(operations, previous);
      }
    }
    for (const block of message.content) {
      if (block.type === 'tool-call') addToolCall(operations, block.name, block.arguments);
    }
  }
  return operations;
}

/**
 * Render one bounded, exact FILES text block. No file entries yields an empty
 * string so the caller can omit the block entirely.
 */
export function renderFileList(operations: FileOperations): string {
  const all = new Set<string>([...operations.read, ...operations.modified]);
  if (all.size === 0) return '';
  const sorted = [...all].sort();
  const shown = sorted.slice(0, FILE_LIST_LIMIT);
  const tree = formatGroupedPaths(shown, (path) => {
    const read = operations.read.has(path);
    const modified = operations.modified.has(path);
    if (modified) return read ? ' (RW)' : ' (Write)';
    return ' (Read)';
  });
  if (tree.length === 0) return '';
  const lines = [FILE_LIST_HEADER, FILE_LIST_LEGEND, FILE_LIST_RULE, tree];
  if (sorted.length > FILE_LIST_LIMIT) {
    lines.push(`[…${sorted.length - FILE_LIST_LIMIT} files elided…]`);
  }
  return lines.join('\n');
}
