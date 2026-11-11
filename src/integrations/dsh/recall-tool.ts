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
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (input, exec) => {
      const args = recallArgumentsSchema.parse(input);
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
      if (args.action === 'search' && args.query === undefined)
        throw new Error('query is required for searching.');
      const reference = index.find(agent.session, args.archiveId);
      if (!reference)
        throw new Error(
          'This archive is not referenced by a completed compaction in this session.',
        );
      return readRecallPage(archives, reference, args, exec.signal);
    },
    isConcurrencySafe: () => true,
  });
}
