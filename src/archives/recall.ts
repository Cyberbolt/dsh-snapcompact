import { z } from 'zod';
import type { ToolSchema } from '@deepseek-ai/dsh-llm';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ArchiveService } from './service.js';

/** Upper bound on independent literals in one batched search call. */
export const MAX_RECALL_QUERIES = 20;

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
    'Pages return physical line numbers, a match count for searches and paging cursors. ' +
    'Prefer one search call with a queries array for independent facts: every tool round ' +
    're-sends the checkpoint. Use it before relying on image OCR for commands, paths, code ' +
    'or precise constraints.',
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
          'Independent literal substrings to search in one call. Batch lookups instead of ' +
          'one call per fact; every tool round re-sends the checkpoint.',
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
export const MAX_BATCH_PAGE_CHARACTERS = 60_000;

async function readSearchBatch(
  archives: ArchiveService,
  reference: FileAttachmentRef,
  args: RecallArguments,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const seen = new Set<string>();
  const queries = (args.queries ?? []).filter((query) => {
    if (seen.has(query)) return false;
    seen.add(query);
    return true;
  });
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
        remainingQueries: queries.slice(index),
      };
    }
    characters += size;
    results.push(entry);
  }
  return { totalLines, results, truncated: false };
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
  if (args.action !== 'search' && (args.query !== undefined || args.queries !== undefined))
    throw new Error('query and queries are only valid for search.');
  if (args.archiveId !== undefined && args.archiveId !== reference.attachmentId)
    throw new Error('This archive is not available in the current evaluation.');
  if (args.queries !== undefined) {
    if (args.action !== 'search') throw new Error('queries is only valid for search.');
    if (args.query !== undefined) throw new Error('Provide query or queries, not both.');
    return readSearchBatch(archives, reference, args, signal);
  }
  if (args.action === 'search' && args.query === undefined)
    throw new Error('query or queries is required for searching.');
  const page = await archives.read(
    reference,
    {
      offset: args.offset,
      column: args.column,
      limit: args.limit,
      ...(args.action === 'search' && args.query !== undefined ? { query: args.query } : {}),
    },
    signal,
  );
  // The caller already knows the archive ID; echoing it on every page wastes tokens.
  return { ...page };
}
