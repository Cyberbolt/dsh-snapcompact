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
    const page = z
      .object({
        complete: z.boolean(),
        results: z.array(
          z.object({
            matches: z.array(z.object({ line: z.number(), text: z.string() })),
            matchCount: z.number(),
          }),
        ),
      })
      .parse(
        await test.invoke({
          action: 'search',
          archiveId: test.reference.attachmentId,
          query: '[.*]',
        }),
      );
    expect(page.complete).toBe(true);
    expect(page.results[0]?.matchCount).toBe(1);
    expect(page.results[0]?.matches.some((match) => match.text.includes('[.*] is literal'))).toBe(
      true,
    );
    const foreign = z
      .object({ total: z.number() })
      .parse(await test.invoke({ action: 'list' }, test.foreign.agent));
    expect(foreign.total).toBe(0);
  });

  it('defaults read and search to the newest completed archive', async () => {
    const test = await setup();
    const page = z
      .object({
        complete: z.boolean(),
        results: z.array(
          z.object({
            matches: z.array(z.object({ text: z.string() })),
            matchCount: z.number(),
          }),
        ),
      })
      .parse(await test.invoke({ action: 'search', query: '[.*]' }));
    expect(page.complete).toBe(true);
    expect(page.results[0]?.matchCount).toBe(1);
    expect(page.results[0]?.matches.some((match) => match.text.includes('[.*] is literal'))).toBe(
      true,
    );
    const lines = z
      .object({
        lines: z.array(z.object({ text: z.string() })),
        matchCount: z.number(),
        totalLines: z.number(),
      })
      .parse(await test.invoke({ action: 'search', query: '[.*]', detail: 'lines' }));
    expect(lines.matchCount).toBe(1);
    expect(lines.lines.some((line) => line.text === '[.*] is literal')).toBe(true);
    await expect(
      test.invoke({ action: 'search', query: 'anything' }, test.foreign.agent),
    ).rejects.toThrow('No completed compaction archive');
  });

  it('searches a batch of literals in one call and rejects ambiguous arguments', async () => {
    const test = await setup();
    const batch = z
      .object({
        complete: z.boolean(),
        results: z.array(
          z.object({
            matches: z.array(z.object({ text: z.string() })),
            matchCount: z.number(),
          }),
        ),
      })
      .parse(await test.invoke({ action: 'search', queries: ['[.*]', 'exact', '[.*]'] }));
    expect(batch.results).toHaveLength(2);
    expect(batch.results[0]?.matchCount).toBe(1);
    expect(batch.results[0]?.matches.some((match) => match.text.includes('[.*] is literal'))).toBe(
      true,
    );
    expect(batch.results[1]?.matchCount).toBe(1);
    expect(batch.complete).toBe(true);
    const lines = z
      .object({
        truncated: z.boolean(),
        results: z.array(
          z.object({ query: z.string(), lines: z.array(z.object({ text: z.string() })) }),
        ),
      })
      .parse(
        await test.invoke({
          action: 'search',
          queries: ['[.*]', 'exact'],
          detail: 'lines',
        }),
      );
    expect(lines.results[0]?.query).toBe('[.*]');
    expect(lines.results[1]?.query).toBe('exact');
    await expect(
      test.invoke({ action: 'search', query: '[.*]', queries: ['exact'] }),
    ).rejects.toThrow('not both');
    await expect(test.invoke({ action: 'read', queries: ['exact'] })).rejects.toThrow(
      'only valid for search',
    );
    await expect(test.invoke({ action: 'list', query: 'exact' })).rejects.toThrow(
      'only valid for search',
    );
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
      { action: 'read', detail: 'snippet' },
      { action: 'list', snippetChars: 100 },
      { action: 'search', query: 'x', detail: 'lines', snippetChars: 100 },
      { action: 'search', query: 'x', snippetChars: 39 },
      { action: 'search', query: 'x', detail: 'full' },
    ])
      await expect(test.invoke(input)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
