import type { Message } from '@deepseek-ai/dsh-llm';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import {
  archiveDocumentSchema,
  archiveMessage,
  fileAttachmentReferenceSchema,
  renderTranscript,
  sha256,
} from './format.js';
import type { ArchiveDocument } from './format.js';
import type { ArchiveRepository } from './repository.js';

export const MAX_ARCHIVE_PAGE_LINES = 200;
export const MAX_ARCHIVE_PAGE_CHARACTERS = 20_000;
export const MAX_ARCHIVE_PAGE_SOURCE_IDS = 50;
export const MAX_ARCHIVE_PAGE_SOURCE_ID_CHARACTERS = 4_096;
export const ARCHIVE_SEARCH_CONTEXT_LINES = 2;

export interface ArchiveReadOptions {
  /** Zero-based physical transcript line, also in search mode; never a match ordinal. */
  offset: number;
  /** Maximum returned line fragments, clamped to 200. Must be a positive safe integer. */
  limit: number;
  /** Case-sensitive literal substring. Empty string means no filter. */
  query?: string;
  /** Zero-based UTF-16 position on offset's line; a split surrogate pair rounds down. */
  column?: number;
}

export interface ArchiveLine {
  /** One-based physical transcript line, not a result ordinal. */
  number: number;
  text: string;
}

export interface ArchivePage {
  lines: ArchiveLine[];
  /** Resume with both cursors. null means no more selected text. */
  nextOffset: number | null;
  nextColumn: number | null;
  /** Physical line count of the complete transcript, not search result count. */
  totalLines: number;
  /** More text remains under the current filter; the archive itself is never truncated. */
  truncated: boolean;
  sourceSessionId: string;
  /** At most 50 complete IDs / 4096 characters; the full set remains in the archive. */
  sourceMessageIds: string[];
  sourceMessageCount: number;
  sourceMessageIdsTruncated: boolean;
}

export interface ArchiveRecord {
  reference: FileAttachmentRef;
  document: ArchiveDocument;
}

export interface CreateArchiveOptions {
  sessionId: string;
  messages: readonly Message[];
  parentArchives?: readonly FileAttachmentRef[];
}

/** Empty transcript has zero lines; a final newline produces a final empty physical line. */
function* physicalLines(transcript: string): Generator<ArchiveLine> {
  if (transcript.length === 0) return;
  let start = 0;
  let number = 1;
  while (start <= transcript.length) {
    const end = transcript.indexOf('\n', start);
    if (end < 0) {
      yield { number, text: transcript.slice(start) };
      return;
    }
    yield { number, text: transcript.slice(start, end) };
    number += 1;
    start = end + 1;
  }
}

/** A rolling context window avoids allocating arrays for all lines or all matches. */
function* selectedLines(transcript: string, query: string | undefined): Generator<ArchiveLine> {
  if (query === undefined || query === '') {
    yield* physicalLines(transcript);
    return;
  }
  const pending: { line: ArchiveLine; selected: boolean }[] = [];
  let following = 0;
  for (const line of physicalLines(transcript)) {
    const matches = line.text.includes(query);
    if (matches) {
      for (const entry of pending) entry.selected = true;
      following = ARCHIVE_SEARCH_CONTEXT_LINES;
    }
    pending.push({ line, selected: matches || following > 0 });
    if (!matches && following > 0) following -= 1;
    if (pending.length > ARCHIVE_SEARCH_CONTEXT_LINES) {
      const entry = pending.shift();
      if (entry?.selected) yield entry.line;
    }
  }
  for (const entry of pending) {
    if (entry.selected) yield entry.line;
  }
}

function countLines(transcript: string): number {
  if (transcript === '') return 0;
  let count = 1;
  let position = transcript.indexOf('\n');
  while (position !== -1) {
    count += 1;
    position = transcript.indexOf('\n', position + 1);
  }
  return count;
}

/** Normalize a UTF-16 boundary without splitting a well-formed surrogate pair. */
function codePointBoundary(text: string, position: number): number {
  const before = text.charCodeAt(position - 1);
  const after = text.charCodeAt(position);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
    ? position - 1
    : position;
}

export class ArchiveService {
  constructor(private readonly repository: ArchiveRepository) {}

  async create(input: CreateArchiveOptions, signal?: AbortSignal): Promise<ArchiveRecord> {
    signal?.throwIfAborted();
    const messages = input.messages.map((message) => {
      signal?.throwIfAborted();
      return archiveMessage(message);
    });
    const transcript = renderTranscript(messages);
    const document = archiveDocumentSchema.parse({
      version: 1,
      sourceSessionId: input.sessionId,
      sourceMessageIds: messages.map((message) => message.id),
      messages,
      parentArchives: (input.parentArchives ?? []).map((reference) =>
        fileAttachmentReferenceSchema.parse(reference),
      ),
      transcript,
      transcriptSha256: sha256(transcript),
    });
    signal?.throwIfAborted();
    const reference = await this.repository.put(document, signal);
    signal?.throwIfAborted();
    return { reference, document };
  }

  async read(
    reference: FileAttachmentRef,
    options: ArchiveReadOptions,
    signal?: AbortSignal,
  ): Promise<ArchivePage> {
    signal?.throwIfAborted();
    const column = options.column ?? 0;
    if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
      throw new RangeError('Archive offset must be a nonnegative safe integer');
    }
    if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
      throw new RangeError('Archive limit must be a positive safe integer');
    }
    if (!Number.isSafeInteger(column) || column < 0) {
      throw new RangeError('Archive column must be a nonnegative safe integer');
    }
    if (options.query !== undefined && typeof options.query !== 'string') {
      throw new TypeError('Archive query must be a literal string');
    }
    const document = await this.repository.get(reference, signal);
    signal?.throwIfAborted();
    const totalLines = countLines(document.transcript);
    const lines: ArchiveLine[] = [];
    const limit = Math.min(options.limit, MAX_ARCHIVE_PAGE_LINES);
    let remainingCharacters = MAX_ARCHIVE_PAGE_CHARACTERS;
    let nextOffset: number | null = null;
    let nextColumn: number | null = null;
    for (const line of selectedLines(document.transcript, options.query)) {
      signal?.throwIfAborted();
      const offset = line.number - 1;
      if (offset < options.offset) continue;
      const requestedColumn = offset === options.offset ? column : 0;
      if (requestedColumn > line.text.length) {
        throw new RangeError('Archive column exceeds line length');
      }
      const start = codePointBoundary(line.text, requestedColumn);
      if (lines.length >= limit || remainingCharacters === 0) {
        nextOffset = offset;
        nextColumn = start;
        break;
      }
      const end = codePointBoundary(
        line.text,
        Math.min(line.text.length, start + remainingCharacters),
      );
      // One remaining UTF-16 unit cannot hold an emoji. Resume instead of splitting it.
      if (end === start && start < line.text.length) {
        nextOffset = offset;
        nextColumn = start;
        break;
      }
      const text = line.text.slice(start, end);
      lines.push({ number: line.number, text });
      remainingCharacters -= text.length;
      if (end < line.text.length) {
        nextOffset = offset;
        nextColumn = end;
        break;
      }
    }
    signal?.throwIfAborted();
    const sourceMessageIds: string[] = [];
    let metadataCharacters = 0;
    for (const id of document.sourceMessageIds) {
      if (
        sourceMessageIds.length >= MAX_ARCHIVE_PAGE_SOURCE_IDS ||
        metadataCharacters + id.length > MAX_ARCHIVE_PAGE_SOURCE_ID_CHARACTERS
      )
        break;
      sourceMessageIds.push(id);
      metadataCharacters += id.length;
    }
    return {
      lines,
      nextOffset,
      nextColumn,
      totalLines,
      truncated: nextOffset !== null,
      sourceSessionId: document.sourceSessionId,
      sourceMessageIds,
      sourceMessageCount: document.sourceMessageIds.length,
      sourceMessageIdsTruncated: document.sourceMessageIds.length > sourceMessageIds.length,
    };
  }
}
