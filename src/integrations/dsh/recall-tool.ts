import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { ArchiveService } from '../../archives/service.js';
import type { ArchiveIndex } from './archive-projection.js';

const argsSchema = z.strictObject({
  action: z.enum(['list', 'read', 'search']),
  archiveId: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  query: z.string().min(1).max(1024).optional(),
  offset: z.number().int().nonnegative().default(0),
  column: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200).default(100),
});

export function registerRecallTool(
  ctx: Context,
  archives: ArchiveService,
  index: ArchiveIndex,
): void {
  ctx.tools.register({
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
            'Attachment ID from the checkpoint or list result; required for read/search.',
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
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (input, exec) => {
      const args = argsSchema.parse(input);
      const agent = exec.agent;
      if (!agent) throw new Error('Archive recall requires an owning session.');
      exec.signal.throwIfAborted();
      if (args.action === 'list') {
        const entries = index.entries(agent.session);
        const selected = entries.slice(args.offset, args.offset + Math.min(args.limit, 100));
        return {
          archives: selected.map((entry) => ({
            archiveId: entry.reference.attachmentId,
            bytes: entry.reference.bytes,
            compactionId: entry.compactionId,
            method: entry.method,
            summarySeq: entry.summarySeq,
          })),
          nextOffset:
            args.offset + selected.length < entries.length ? args.offset + selected.length : null,
          total: entries.length,
        };
      }
      if (!args.archiveId) throw new Error('archiveId is required for reading or searching.');
      if (args.action === 'search' && !args.query)
        throw new Error('query is required for searching.');
      const reference = index.find(agent.session, args.archiveId);
      if (!reference)
        throw new Error(
          'This archive is not referenced by a completed compaction in this session.',
        );
      const page = await archives.read(
        reference,
        {
          offset: args.offset,
          column: args.column,
          limit: args.limit,
          ...(args.action === 'search' && args.query !== undefined ? { query: args.query } : {}),
        },
        exec.signal,
      );
      return { archiveId: reference.attachmentId, ...page };
    },
    isConcurrencySafe: () => true,
  });
}
