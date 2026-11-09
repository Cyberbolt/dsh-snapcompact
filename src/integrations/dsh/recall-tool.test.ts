import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { z } from 'zod';
import { ArchiveRepository } from '../../archives/repository.js';
import { ArchiveService } from '../../archives/service.js';
import type { ArchiveIndex } from './archive-projection.js';
import { registerRecallTool } from './recall-tool.js';
import { createHarness } from '../../../tests/fixtures/harness.js';

type Definition = Parameters<Context['tools']['register']>[0];
type Execution = Parameters<Definition['execute']>[1];
const cleanups: (() => Promise<void>)[] = [];

/** Minimal test-only authority object: the callback uses only agent and signal. */
function execution(agent?: Execution['agent']): Execution {
  return {
    ...(agent === undefined ? {} : { agent }),
    signal: new AbortController().signal,
  } as Execution;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const owner = await createHarness();
  const foreign = await createHarness();
  cleanups.push(owner.dispose, foreign.dispose);
  const archives = new ArchiveService(new ArchiveRepository(owner.attachments));
  const archive = await archives.create({
    sessionId: owner.session.id,
    messages: [
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'exact command\n[.*] is literal\n  indentation' }],
      }),
    ],
  });
  const entry = {
    reference: archive.reference,
    compactionId: 'test-compaction',
    summarySeq: 1,
    method: 'soft' as const,
  };
  const index: ArchiveIndex = {
    entries: (session) => (session === owner.session ? [entry] : []),
    find: (session, id) =>
      session === owner.session && id === archive.reference.attachmentId
        ? archive.reference
        : undefined,
  };
  let definition: Definition | undefined;
  owner.ctx.reflect.provide('tools', {
    register: (next: Definition) => {
      definition = next;
      return () => undefined;
    },
  });
  registerRecallTool(owner.ctx, archives, index);
  const tool = definition;
  if (!tool) throw new Error('Recall tool was not registered');
  return {
    owner,
    foreign,
    archives,
    reference: archive.reference,
    invoke: (input: unknown, agent = owner.agent) => tool.execute(input, execution(agent)),
    withoutAgent: () => tool.execute({ action: 'list' }, execution()),
  };
}

describe('archive recall authorization', () => {
  it('lists and searches only the receiving session references', async () => {
    const test = await setup();
    const list = z
      .object({ archives: z.array(z.object({ archiveId: z.string() })), total: z.number() })
      .parse(await test.invoke({ action: 'list' }));
    expect(list.total).toBe(1);
    expect(list.archives[0]?.archiveId).toBe(test.reference.attachmentId);
    const page = z.object({ lines: z.array(z.object({ text: z.string() })) }).parse(
      await test.invoke({
        action: 'search',
        archiveId: test.reference.attachmentId,
        query: '[.*]',
      }),
    );
    expect(page.lines.some((line) => line.text === '[.*] is literal')).toBe(true);
    const foreign = z
      .object({ total: z.number() })
      .parse(await test.invoke({ action: 'list' }, test.foreign.agent));
    expect(foreign.total).toBe(0);
  });

  it('refuses foreign IDs before reading attachment bytes', async () => {
    const test = await setup();
    const read = vi.spyOn(test.archives, 'read');
    await expect(
      test.invoke({ action: 'read', archiveId: test.reference.attachmentId }, test.foreign.agent),
    ).rejects.toThrow('not referenced');
    expect(read).not.toHaveBeenCalled();
    await expect(test.withoutAgent()).rejects.toThrow('owning session');
  });

  it('rejects path substitution, arbitrary sessions and invalid search/pagination arguments', async () => {
    const test = await setup();
    const read = vi.spyOn(test.archives, 'read');
    for (const input of [
      { action: 'read', archiveId: '../../secrets' },
      {
        action: 'read',
        archiveId: test.reference.attachmentId,
        sessionId: test.foreign.session.id,
      },
      { action: 'search', archiveId: test.reference.attachmentId },
      { action: 'read', archiveId: test.reference.attachmentId, limit: 201 },
      { action: 'read', archiveId: test.reference.attachmentId, offset: -1 },
    ])
      await expect(test.invoke(input)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
