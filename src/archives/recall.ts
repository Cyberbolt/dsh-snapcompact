import { z } from 'zod';
import type { ToolSchema } from '@deepseek-ai/dsh-llm';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ArchiveService } from './service.js';

/** Shared argument contract for the registered tool and the benchmark arm. */
export const recallArgumentsSchema = z.strictObject({
  action: z.enum(['list', 'read', 'search']),
  archiveId: z
    .string()
    .regex(/^(?:sha256:)?[a-f0-9]{64}$/u)
    .transform((value) => (value.startsWith('sha256:') ? value : `sha256:${value}`))
    .optional(),
  query: z.string().min(1).max(1_024).optional(),
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
    'Use it before relying on image OCR for commands, paths, code or precise constraints.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'read', 'search'] },
      archiveId: {
        type: 'string',
        description:
          'Attachment ID from the checkpoint or list result; required for read/search. ' +
          'The sha256: prefix is optional.',
      },
      query: {
        type: 'string',
        description: 'Case-sensitive literal substring; required for search.',
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
  if (args.action === 'search' && args.query === undefined)
    throw new Error('query is required for searching.');
  if (args.archiveId !== undefined && args.archiveId !== reference.attachmentId)
    throw new Error('This archive is not available in the current evaluation.');
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
  return { archiveId: reference.attachmentId, ...page };
}
