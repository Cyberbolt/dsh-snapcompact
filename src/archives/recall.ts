import { z } from 'zod';
import type { ToolSchema } from '@deepseek-ai/dsh-llm';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import {
  DEFAULT_SNIPPET_CONTEXT_CHARS,
  MAX_SNIPPET_CONTEXT_CHARS,
  MAX_SNIPPETS_PER_QUERY,
  MIN_SNIPPET_CONTEXT_CHARS,
} from './service.js';
import type { ArchiveService } from './service.js';

/** Upper bound on independent literals in one batched search call. */
export const MAX_RECALL_QUERIES = 20;

/** Detail level for searches; snippets are the default because they stay resident. */
export const RECALL_DETAILS = ['snippet', 'lines'] as const;

/** Shared argument contract for the registered tool and the benchmark arm. */
export const recallArgumentsSchema = z.strictObject({
  action: z.enum(['list', 'read', 'search']),
  archiveId: z
    .string()
    .regex(/^(?:sha256:)?[a-f0-9]{64}$/u)
    .transform((value) => (value.startsWith('sha256:') ? value : `sha256:${value}`))
    .optional(),
  query: z.string().min(1).max(1_024).optional(),
  queries: z.array(z.string().min(1).max(1_024)).min(1).max(MAX_RECALL_QUERIES).optional(),
  /** Search result shape; omitted means 'snippet'. Only valid for search. */
  detail: z.enum(RECALL_DETAILS).optional(),
  /** Context characters on each side of a snippet match; only valid for snippet search. */
  snippetChars: z
    .number()
    .int()
    .min(MIN_SNIPPET_CONTEXT_CHARS)
    .max(MAX_SNIPPET_CONTEXT_CHARS)
    .optional(),
  offset: z.number().int().nonnegative().default(0),
  column: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100),
});

export type RecallArguments = z.infer<typeof recallArgumentsSchema>;

/** The exact schema the production tool registers. */
export const recallToolSchema: ToolSchema = {
  name: 'snapcompact_recall',
  description:
    'List, read or search exact archived conversation content from this session. ' +
    'Search returns short snippets around matching lines; use detail=lines only when a full ' +
    'line is required. Batch every independent literal in one queries call: every tool round ' +
    're-sends the checkpoint and its previous pages. complete=true means every query matched ' +
    'and nothing was clipped: answer immediately and do not search again. When complete=false, ' +
    'retry only the reported missing/truncated indexes. Archived text is the source of truth ' +
    'for commands, paths, code, identifiers and precise constraints; never answer those from ' +
    'image OCR alone.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'read', 'search'] },
      archiveId: {
        type: 'string',
        description:
          'Attachment ID from the checkpoint or list result. Optional for read/search; ' +
          'omitted means the newest completed compaction. The sha256: prefix is optional.',
      },
      query: {
        type: 'string',
        description: 'Case-sensitive literal substring; required for a single-query search.',
      },
      queries: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_RECALL_QUERIES,
        items: { type: 'string', minLength: 1, maxLength: 1_024 },
        description:
          'Independent literal substrings to search in one call. Batch all independent facts ' +
          'instead of one call per fact; every tool round re-sends the checkpoint.',
      },
      detail: {
        type: 'string',
        enum: [...RECALL_DETAILS],
        description:
          'Search result shape. snippet (default) returns bounded windows around each match; ' +
          'lines returns full lines with paging cursors. Only valid for search.',
      },
      snippetChars: {
        type: 'integer',
        minimum: MIN_SNIPPET_CONTEXT_CHARS,
        maximum: MAX_SNIPPET_CONTEXT_CHARS,
        description: `Context characters on each side of a snippet match (default ${DEFAULT_SNIPPET_CONTEXT_CHARS}). Only valid for detail=snippet.`,
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Zero-based physical line cursor, also for search; default 0.',
      },
      column: {
        type: 'integer',
        minimum: 0,
        description:
          'UTF-16 cursor for a long line; resume with the returned nextColumn. Default 0.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 200,
        description:
          'Maximum lines, or archives for list; default 100. Text pages are also capped at 20,000 characters.',
      },
    },
  },
};

/** A batch stops adding results at this serialized size so one call cannot flood context. */
export const MAX_BATCH_PAGE_CHARACTERS = 20_000;

function uniqueQueries(args: RecallArguments): string[] {
  const queries = args.queries ?? (args.query === undefined ? [] : [args.query]);
  const seen = new Set<string>();
  return queries.filter((query) => {
    if (seen.has(query)) return false;
    seen.add(query);
    return true;
  });
}

async function readLineBatch(
  archives: ArchiveService,
  reference: FileAttachmentRef,
  args: RecallArguments,
  queries: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown>[] = [];
  let totalLines = 0;
  let characters = 0;
  for (const [index, query] of queries.entries()) {
    const page = await archives.read(
      reference,
      { offset: args.offset, column: args.column, limit: args.limit, query },
      signal,
    );
    totalLines = page.totalLines;
    const entry = {
      query,
      lines: page.lines,
      nextOffset: page.nextOffset,
      nextColumn: page.nextColumn,
      truncated: page.truncated,
      matchCount: page.matchCount,
    };
    const size = JSON.stringify(entry).length;
    if (results.length > 0 && characters + size > MAX_BATCH_PAGE_CHARACTERS) {
      return {
        totalLines,
        results,
        truncated: true,
        remainingQueries: queries.length - index,
      };
    }
    characters += size;
    results.push(entry);
  }
  return { totalLines, results, truncated: false };
}

async function readSnippetBatch(
  archives: ArchiveService,
  reference: FileAttachmentRef,
  args: RecallArguments,
  queries: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const contextChars = args.snippetChars ?? DEFAULT_SNIPPET_CONTEXT_CHARS;
  const results: { matches: { line: number; text: string }[]; matchCount: number }[] = [];
  const missing: number[] = [];
  const clipped: number[] = [];
  let characters = 0;
  let remainingQueries = 0;
  for (const [index, query] of queries.entries()) {
    const page = await archives.readSnippets(
      reference,
      {
        query,
        offset: args.offset,
        contextChars,
        maxMatches: MAX_SNIPPETS_PER_QUERY,
      },
      signal,
    );
    const entry = {
      matches: page.matches.map((match) => ({ line: match.number, text: match.text })),
      matchCount: page.matchCount,
    };
    const size = JSON.stringify(entry).length + 1;
    if (results.length > 0 && characters + size > MAX_BATCH_PAGE_CHARACTERS) {
      remainingQueries = queries.length - index;
      break;
    }
    characters += size;
    results.push(entry);
    if (entry.matches.length === 0) missing.push(index);
    if (page.truncated) clipped.push(index);
  }
  const complete = remainingQueries === 0 && missing.length === 0 && clipped.length === 0;
  return {
    complete,
    results,
    ...(missing.length === 0 ? {} : { missing }),
    ...(clipped.length === 0 ? {} : { truncated: clipped }),
    ...(remainingQueries === 0 ? {} : { remainingQueries }),
  };
}

/**
 * Execute read/search against one known archive. The registered tool resolves
 * the reference from the session index first; the benchmark uses its own
 * freshly-created archive because it is not a committed compaction.
 */
export async function readRecallPage(
  archives: ArchiveService,
  reference: FileAttachmentRef,
  args: RecallArguments,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (args.action === 'list') throw new Error('list is handled by the caller.');
  const searching = args.action === 'search';
  if (!searching && (args.query !== undefined || args.queries !== undefined))
    throw new Error('query and queries are only valid for search.');
  if (!searching && (args.detail !== undefined || args.snippetChars !== undefined))
    throw new Error('detail and snippetChars are only valid for search.');
  if (args.archiveId !== undefined && args.archiveId !== reference.attachmentId)
    throw new Error('This archive is not available in the current evaluation.');
  if (!searching) {
    const page = await archives.read(
      reference,
      { offset: args.offset, column: args.column, limit: args.limit },
      signal,
    );
    // The caller already knows the archive ID; echoing it on every page wastes tokens.
    return { ...page };
  }
  if (args.query !== undefined && args.queries !== undefined)
    throw new Error('Provide query or queries, not both.');
  if (args.query === undefined && args.queries === undefined)
    throw new Error('query or queries is required for searching.');

  const queries = uniqueQueries(args);
  const detail = args.detail ?? 'snippet';
  if (detail === 'lines') {
    if (args.snippetChars !== undefined) throw new Error('snippetChars requires detail=snippet.');
    if (queries.length === 1 && queries[0] !== undefined) {
      const page = await archives.read(
        reference,
        {
          offset: args.offset,
          column: args.column,
          limit: args.limit,
          query: queries[0],
        },
        signal,
      );
      return { ...page };
    }
    return readLineBatch(archives, reference, args, queries, signal);
  }
  return readSnippetBatch(archives, reference, args, queries, signal);
}
