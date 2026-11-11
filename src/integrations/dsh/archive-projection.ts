import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-compaction';
import type {} from '@deepseek-ai/dsh-session-projection';
import { z } from 'zod';
import { fileAttachmentReferenceSchema, isArchiveReference } from '../../archives/format.js';
import { recordedMethodNameSchema } from '../../config.js';

const entrySchema = z.object({
  reference: fileAttachmentReferenceSchema,
  compactionId: z.string(),
  summarySeq: z.number().int().nonnegative(),
  // Superset of the runtime methods: history may name a method this release
  // no longer ships, and its archive must stay recallable.
  method: recordedMethodNameSchema,
});
const stateSchema = z.object({
  entries: z.array(entrySchema),
  pending: z.record(z.string(), z.array(entrySchema)),
});
export type ArchiveIndexEntry = z.infer<typeof entrySchema>;
type ArchiveIndexState = z.infer<typeof stateSchema>;
export interface ArchiveIndex {
  entries(session: Session): readonly ArchiveIndexEntry[];
  find(session: Session, attachmentId: string): FileAttachmentRef | undefined;
}

/** One stable, pure definition shared by registrations in different preset revisions. */
export const archiveProjection = {
  key: 'snapcompact.archives' as const,
  stateVersion: 2,
  stateSchema,
  init: (): ArchiveIndexState => ({ entries: [], pending: {} }),
  apply: (state: ArchiveIndexState, event: SessionEvent): ArchiveIndexState => {
    if (event.type === 'session/end-seed') {
      return Object.keys(state.pending).length ? { ...state, pending: {} } : state;
    }
    if (event.type === 'compaction/summary') {
      const header = event.data.summary.find((block) => block.type === 'text');
      const parsed = recordedMethodNameSchema.safeParse(
        header?.type === 'text'
          ? /^Snapcompact v[12]; method=(\w+)/.exec(header.text)?.[1]
          : undefined,
      );
      if (!parsed.success) return state;
      const entries = event.data.summary.flatMap((block) =>
        block.type === 'file' && isArchiveReference(block.attachment)
          ? [
              {
                reference: block.attachment,
                compactionId: event.data.compactionId,
                summarySeq: event.seq,
                method: parsed.data,
              },
            ]
          : [],
      );
      return entries.length === 0
        ? state
        : {
            ...state,
            pending: { ...state.pending, [event.data.compactionId]: entries },
          };
    }
    if (event.type !== 'compaction/end') return state;
    const entries = state.pending[event.data.compactionId];
    if (!entries) return state;
    const pending = { ...state.pending };
    delete pending[event.data.compactionId];
    if (event.data.error !== undefined) return { ...state, pending };
    const seen = new Set(state.entries.map((entry) => entry.reference.attachmentId));
    return {
      pending,
      entries: [
        ...state.entries,
        ...entries.filter((entry) => !seen.has(entry.reference.attachmentId)),
      ],
    };
  },
};

/** Only a successfully closed native compaction grants access to an archive reference. */
export async function registerArchiveIndex(ctx: Context): Promise<ArchiveIndex> {
  const handle = await ctx.sessionProjections.register(archiveProjection);
  return {
    entries: (session) => handle.stateOf(session).entries,
    find: (session, attachmentId) =>
      handle.stateOf(session).entries.find((entry) => entry.reference.attachmentId === attachmentId)
        ?.reference,
  };
}
