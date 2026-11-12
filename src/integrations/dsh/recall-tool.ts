import type { Context } from '@deepseek-ai/cordis';
import type { ArchiveService } from '../../archives/service.js';
import { readRecallPage, recallArgumentsSchema, recallToolSchema } from '../../archives/recall.js';
import type { ArchiveIndex } from './archive-projection.js';

export function registerRecallTool(
  ctx: Context,
  archives: ArchiveService,
  index: ArchiveIndex,
): void {
  ctx.tools.register({
    name: recallToolSchema.name,
    description: recallToolSchema.description,
    parameters: recallToolSchema.parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      // Compact JSON keeps recall pages cheap; the model parses it, humans do not read raw.
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (input, exec) => {
      const args = recallArgumentsSchema.parse(input);
      const agent = exec.agent;
      if (!agent) throw new Error('Archive recall requires an owning session.');
      exec.signal.throwIfAborted();
      if (
        args.action === 'list' &&
        (args.query !== undefined ||
          args.queries !== undefined ||
          args.detail !== undefined ||
          args.snippetChars !== undefined)
      )
        throw new Error('query, queries, detail and snippetChars are only valid for search.');
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
      if (args.action === 'search' && args.query === undefined && args.queries === undefined)
        throw new Error('query or queries is required for searching.');
      const reference =
        args.archiveId === undefined
          ? index.entries(agent.session).at(-1)?.reference
          : index.find(agent.session, args.archiveId);
      if (!reference)
        throw new Error(
          args.archiveId === undefined
            ? 'No completed compaction archive is available in this session yet.'
            : 'This archive is not referenced by a completed compaction in this session.',
        );
      return readRecallPage(archives, reference, args, exec.signal);
    },
    isConcurrencySafe: () => true,
  });
}
