import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { archiveProjection } from './archive-projection.js';

const hex = 'a'.repeat(64);
const reference = {
  attachmentId: `sha256:${hex}`,
  name: `snapcompact-archive-v1-${hex}.json`,
  bytes: 128,
};

/** Minimal events: `apply` reads only the type, compactionId, summary and error fields. */
function summaryEvent(method: string): SessionEvent {
  return {
    type: 'compaction/summary',
    seq: 1,
    data: {
      compactionId: 'compaction-1',
      summary: [
        { type: 'text', text: `Snapcompact v2; method=${method}` },
        { type: 'file', attachment: reference },
      ],
    },
  } as unknown as SessionEvent;
}

const endEvent = {
  type: 'compaction/end',
  seq: 2,
  data: { compactionId: 'compaction-1' },
} as unknown as SessionEvent;

describe('archive projection history compatibility', () => {
  it('indexes an archive written by the removed handoff method', () => {
    let state = archiveProjection.apply(archiveProjection.init(), summaryEvent('handoff'));
    state = archiveProjection.apply(state, endEvent);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ method: 'handoff', reference });
  });

  it('accepts a persisted projection state that names handoff', () => {
    const persisted = {
      entries: [
        { reference, compactionId: 'compaction-1', summarySeq: 1, method: 'handoff' as const },
      ],
      pending: {},
    };
    expect(archiveProjection.stateSchema.parse(persisted)).toMatchObject({
      entries: [{ method: 'handoff' }],
    });
  });

  it('still ignores a checkpoint whose method was never shipped', () => {
    const state = archiveProjection.apply(archiveProjection.init(), summaryEvent('remote'));
    expect(state.entries).toHaveLength(0);
    expect(state.pending).toEqual({});
  });
});
