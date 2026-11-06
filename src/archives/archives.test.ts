import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_FILE_PREFIX,
  MAX_ARCHIVE_BYTES,
  archiveDocumentSchema,
  isArchiveReference,
  sha256,
} from './format.js';
import type { ArchiveDocument } from './format.js';
import { ArchiveRepository } from './repository.js';
import type { FileStore } from './repository.js';
import { ArchiveService } from './service.js';
import type { ArchiveReadOptions } from './service.js';

const encoder = new TextEncoder();
const defaultName = `${ARCHIVE_FILE_PREFIX}${'0'.repeat(64)}.json`;

class MemoryStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();
  reads = 0;
  saves = 0;
  chunkBytes = 13;

  add(data: Uint8Array, name = defaultName): FileAttachmentRef {
    const reference: FileAttachmentRef = {
      attachmentId: `sha256:${sha256(data)}` as FileAttachmentRef['attachmentId'],
      name,
      bytes: data.byteLength,
    };
    this.files.set(reference.attachmentId, data.slice());
    return reference;
  }

  async saveFile(input: { data: Uint8Array; name?: string }): Promise<FileAttachmentRef> {
    this.saves += 1;
    return this.add(input.data, input.name);
  }

  async *readFileStream(
    reference: FileAttachmentRef,
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    this.reads += 1;
    const data = this.files.get(reference.attachmentId);
    if (data === undefined) throw new Error('Missing fixture file');
    for (let offset = 0; offset < data.byteLength; offset += this.chunkBytes) {
      signal?.throwIfAborted();
      yield data.slice(offset, offset + this.chunkBytes);
    }
  }
}

function userMessage(text: string, id = 'message-1'): Message {
  return {
    id: id as Message['id'],
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  };
}

function fixture(): { store: MemoryStore; repo: ArchiveRepository; service: ArchiveService } {
  const store = new MemoryStore();
  const repo = new ArchiveRepository(store);
  return { store, repo, service: new ArchiveService(repo) };
}

function serialized(store: MemoryStore, value: unknown): FileAttachmentRef {
  const digest =
    value &&
    typeof value === 'object' &&
    'transcriptSha256' in value &&
    typeof value.transcriptSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.transcriptSha256)
      ? value.transcriptSha256
      : '0'.repeat(64);
  return store.add(encoder.encode(JSON.stringify(value)), `${ARCHIVE_FILE_PREFIX}${digest}.json`);
}

async function simpleDocument(): Promise<ArchiveDocument> {
  const { service } = fixture();
  return (await service.create({ sessionId: 'session-1', messages: [userMessage('hello')] }))
    .document;
}

describe('archive format and fidelity', () => {
  it('preserves text, indentation, raw arguments, tool status and complete attachment references', async () => {
    const { service, repo } = fixture();
    const file: FileAttachmentRef = {
      attachmentId: `sha256:${'a'.repeat(64)}` as FileAttachmentRef['attachmentId'],
      name: 'long name\n原文.txt',
      bytes: 8192,
    };
    const callId = 'tool-call-1' as Extract<ContentBlock, { type: 'tool-call' }>['id'];
    const argumentsText = '{\n  "unaltered": [1,  2],\n  "regex": "[.*]"\n}\n';
    const text = '\n    indentation\r\n\t中文👩🏽‍💻\n' + 'x'.repeat(25_000);
    const block = { type: 'text' as const, text };
    Object.assign(block, {
      native: { signature: 'secret-signature' },
      replayState: 'secret-replay',
    });
    const assistant: Message = {
      id: 'assistant-1' as Message['id'],
      role: 'assistant',
      source: {
        kind: 'model',
        provider: 'test',
        model: 'test',
        replayState: { blob: 'secret-blob' },
      },
      content: [
        block,
        { type: 'reasoning', text: 'reason\n  keep' },
        { type: 'tool-call', id: callId, name: 'tool/name', arguments: argumentsText },
        { type: 'file', attachment: file },
        {
          type: 'image',
          attachment: {
            attachmentId: file.attachmentId,
            mediaType: 'image/png',
            bytes: 123,
            width: 100,
            height: 200,
            name: '原图.png',
            originalDimensions: { width: 200, height: 400 },
          },
          offloaded: true,
        },
        { type: 'tool-addition', toolName: 'new-tool' },
        { type: 'tool-removal', toolName: 'old-tool' },
      ],
    };
    Object.assign(assistant, { native: 'secret-native', signature: 'secret-signature' });
    const result: Message = {
      id: 'tool-result-1' as Message['id'],
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      isError: true,
      content: [{ type: 'text', text: '  exact failure\n' }],
    };
    const created = await service.create({
      sessionId: 'session-original',
      messages: [assistant, result],
      parentArchives: [file],
    });
    expect(created.document.messages[0]?.source).toEqual({
      kind: 'model',
      provider: 'test',
      model: 'test',
    });
    expect(created.document.messages[1]?.source).toEqual({ kind: 'tool' });
    expect(created.document.messages[0]?.content[0]).toEqual({ type: 'text', text });
    expect(created.document.messages[0]?.content[2]).toEqual({
      type: 'tool-call',
      id: callId,
      name: 'tool/name',
      arguments: argumentsText,
    });
    expect(created.document.messages[0]?.content[3]).toEqual({ type: 'file', attachment: file });
    expect(created.document.messages[0]?.content[4]).toEqual(assistant.content[4]);
    expect(created.document.messages[1]).toMatchObject({ toolCallId: callId, isError: true });
    expect(created.document.sourceMessageIds).toEqual(['assistant-1', 'tool-result-1']);
    expect(created.document.parentArchives).toEqual([file]);
    expect(created.document.transcript).toContain(text);
    expect(created.document.transcript).toContain(argumentsText);
    expect(created.document.transcript).toContain('role=assistant id="assistant-1"');
    expect(created.document.transcript).toContain('role=tool id="tool-result-1"');
    expect(created.document.transcript).toContain('toolCallId="tool-call-1" status=error');
    expect(created.document.transcript).toContain('status=request');
    expect(created.document.transcriptSha256).toBe(sha256(created.document.transcript));
    expect(JSON.stringify(created.document)).not.toMatch(
      /secret-|replayState|"native"|"signature"/,
    );
    expect(isArchiveReference(created.reference)).toBe(true);
    expect(await repo.get(created.reference)).toEqual(created.document);
  });

  it('makes portable snapshots without mutating or aliasing the input', async () => {
    const { service } = fixture();
    const message = userMessage('before');
    const before = structuredClone(message);
    const { document } = await service.create({ sessionId: 's', messages: [message] });
    expect(message).toEqual(before);
    const first = message.content[0];
    if (first?.type === 'text') first.text = 'after';
    expect(document.transcript).toContain('before');
    expect(document.messages[0]?.content[0]).toEqual({ type: 'text', text: 'before' });
  });

  it('recognizes canonical archive names without treating arbitrary file names as archives', () => {
    const store = new MemoryStore();
    const ref = store.add(new Uint8Array());
    expect(isArchiveReference(ref)).toBe(true);
    expect(isArchiveReference({ ...ref, name: 'notes.json' })).toBe(false);
    expect(isArchiveReference({ ...ref, name: '../' + defaultName })).toBe(false);
    expect(isArchiveReference({ ...ref, bytes: -1 })).toBe(false);
  });
});

describe('untrusted archive repository', () => {
  it('rejects malformed JSON and schema violations', async () => {
    const { store, repo } = fixture();
    await expect(repo.get(store.add(encoder.encode('{broken')))).rejects.toThrow();
    for (const invalid of [
      null,
      [],
      {},
      { version: 2 },
      { ...(await simpleDocument()), extra: true },
    ]) {
      await expect(repo.get(serialized(store, invalid))).rejects.toThrow();
    }
  });

  it('rejects transcript checksums, generated transcript mismatches and inconsistent source IDs', async () => {
    const { store, repo } = fixture();
    const document = await simpleDocument();
    await expect(
      repo.get(serialized(store, { ...document, transcriptSha256: '0'.repeat(64) })),
    ).rejects.toThrow(/SHA256/);
    const transcript = 'forged, but with a matching checksum';
    await expect(
      repo.get(
        serialized(store, { ...document, transcript, transcriptSha256: sha256(transcript) }),
      ),
    ).rejects.toThrow(/differs from messages/);
    await expect(
      repo.get(serialized(store, { ...document, sourceMessageIds: ['forged-id'] })),
    ).rejects.toThrow(/Message IDs disagree/);
    expect(
      archiveDocumentSchema.safeParse({
        ...document,
        messages: [{ ...document.messages[0], replayState: {} }],
      }).success,
    ).toBe(false);
  });

  it('verifies raw attachment SHA256 and declared byte length independently of the store', async () => {
    const { store, repo } = fixture();
    const reference = serialized(store, await simpleDocument());
    const data = store.files.get(reference.attachmentId);
    if (data === undefined) throw new Error('Missing fixture');
    const forgedId = `sha256:${'f'.repeat(64)}` as FileAttachmentRef['attachmentId'];
    store.files.set(forgedId, data);
    await expect(repo.get({ ...reference, attachmentId: forgedId })).rejects.toThrow(/file SHA256/);
    await expect(repo.get({ ...reference, bytes: reference.bytes + 1 })).rejects.toThrow(
      /length mismatch/,
    );
    await expect(repo.get({ ...reference, bytes: reference.bytes - 1 })).rejects.toThrow(
      /declared size/,
    );
  });

  it('rejects malformed UTF8 and accepts emoji split over individual-byte chunks', async () => {
    const { store, repo, service } = fixture();
    await expect(repo.get(store.add(new Uint8Array([0x7b, 0xff, 0x7d])))).rejects.toThrow();
    await expect(repo.get(store.add(new Uint8Array([0xed, 0xa0, 0x80])))).rejects.toThrow();
    const created = await service.create({ sessionId: 's', messages: [userMessage('中文😀')] });
    store.chunkBytes = 1;
    expect(await repo.get(created.reference)).toEqual(created.document);
  });

  it('enforces the hard cap and bounded reads before trusting claimed file sizes', async () => {
    const { store } = fixture();
    const document = await simpleDocument();
    const repo = new ArchiveRepository(store, 100);
    await expect(repo.put(document)).rejects.toThrow(/byte limit/);
    expect(store.saves).toBe(0);
    const large = store.add(new Uint8Array(101));
    await expect(repo.get(large)).rejects.toThrow(/byte limit/);
    expect(store.reads).toBe(0);
    await expect(repo.get({ ...large, bytes: 99 })).rejects.toThrow(/declared size/);
    expect(store.reads).toBe(1);
    expect(() => new ArchiveRepository(store, MAX_ARCHIVE_BYTES + 1)).toThrow(RangeError);
    expect(() => new ArchiveRepository(store, 0)).toThrow(RangeError);
  });

  it('rejects invalid refs and non-archive names before any read', async () => {
    const { store, repo } = fixture();
    const ref = store.add(encoder.encode('{}'), 'notes.json');
    await expect(repo.get(ref)).rejects.toThrow(/Not a snapcompact/);
    await expect(repo.get({ ...ref, bytes: Number.NaN })).rejects.toThrow();
    expect(store.reads).toBe(0);
  });

  it('rejects a canonical-looking filename with the wrong transcript digest', async () => {
    const { service, repo } = fixture();
    const { reference } = await service.create({
      sessionId: 'session',
      messages: [userMessage('exact')],
    });
    await expect(repo.get({ ...reference, name: defaultName })).rejects.toThrow('filename');
  });

  it('rejects a store that returns a false saved reference', async () => {
    const memory = new MemoryStore();
    const store: FileStore = {
      saveFile: async (input) => ({ ...memory.add(input.data, input.name), bytes: 0 }),
      readFileStream: (ref, signal) => memory.readFileStream(ref, signal),
    };
    await expect(new ArchiveRepository(store).put(await simpleDocument())).rejects.toThrow(
      /does not match/,
    );
  });

  it('propagates cancellation before any I/O and midway through a stream', async () => {
    const { store, repo, service } = fixture();
    const ref = serialized(store, await simpleDocument());
    const controller = new AbortController();
    const reason = new Error('cancel fixture');
    controller.abort(reason);
    await expect(repo.get(ref, controller.signal)).rejects.toBe(reason);
    await expect(repo.put(await simpleDocument(), controller.signal)).rejects.toBe(reason);
    await expect(service.create({ sessionId: 's', messages: [] }, controller.signal)).rejects.toBe(
      reason,
    );
    expect(store.reads).toBe(0);
    expect(store.saves).toBe(0);

    const during = new AbortController();
    let returned = false;
    const cancelStore: FileStore = {
      saveFile: (input) => store.saveFile(input),
      readFileStream: () => ({
        [Symbol.asyncIterator]: () => {
          let calls = 0;
          return {
            next: async () => {
              calls += 1;
              if (calls === 2) during.abort(reason);
              return { done: false, value: new Uint8Array([0x7b]) };
            },
            return: async () => {
              returned = true;
              return { done: true, value: undefined };
            },
          };
        },
      }),
    };
    await expect(new ArchiveRepository(cancelStore).get(ref, during.signal)).rejects.toBe(reason);
    expect(returned).toBe(true);
  });

  it('cancels a stuck save and handles a late rejection after synchronous cancellation', async () => {
    const document = await simpleDocument();
    const controller = new AbortController();
    const reason = new Error('cancel save');
    const store: FileStore = {
      saveFile: () => new Promise<FileAttachmentRef>(() => undefined),
      readFileStream: () => ({
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      }),
    };
    const pending = new ArchiveRepository(store).put(document, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);

    const synchronous = new AbortController();
    store.saveFile = () => {
      synchronous.abort(reason);
      return Promise.reject(new Error('late storage failure'));
    };
    await expect(new ArchiveRepository(store).put(document, synchronous.signal)).rejects.toBe(
      reason,
    );
  });

  it('copies reused stream buffers and accepts empty chunks without collecting them', async () => {
    const document = await simpleDocument();
    const bytes = encoder.encode(JSON.stringify(document));
    const reference = new MemoryStore().add(
      bytes,
      `${ARCHIVE_FILE_PREFIX}${document.transcriptSha256}.json`,
    );
    const store: FileStore = {
      saveFile: async () => reference,
      readFileStream: async function* () {
        const shared = new Uint8Array(1);
        for (const byte of bytes) {
          yield new Uint8Array();
          shared[0] = byte;
          yield shared;
        }
      },
    };
    expect(await new ArchiveRepository(store).get(reference)).toEqual(document);
  });

  it('cancels even a stuck next() and does not wait for stuck return()', async () => {
    const reference = new MemoryStore().add(encoder.encode('{}'));
    const controller = new AbortController();
    let returned = false;
    const store: FileStore = {
      saveFile: async () => reference,
      readFileStream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
          return: () => {
            returned = true;
            return new Promise<IteratorResult<Uint8Array>>(() => undefined);
          },
        }),
      }),
    };
    const pending = new ArchiveRepository(store).get(reference, controller.signal);
    const reason = new Error('cancel stuck stream');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(returned).toBe(true);
  });
});

describe('archive pages and literal search', () => {
  it('uses zero-based physical offsets and one-based line numbers, clamping pages to 200 lines', async () => {
    const { service } = fixture();
    const text = Array.from({ length: 450 }, (_, index) => `line-${index}`).join('\n');
    const { reference, document } = await service.create({
      sessionId: 'origin',
      messages: [userMessage(text)],
    });
    const expected = document.transcript.split('\n');
    const page = await service.read(reference, { offset: 0, limit: 999 });
    expect(page.lines).toHaveLength(200);
    expect(page.lines[0]).toEqual({ number: 1, text: expected[0] });
    expect(page.totalLines).toBe(expected.length);
    expect(page.nextOffset).toBe(200);
    expect(page.nextColumn).toBe(0);
    expect(page.truncated).toBe(true);
    expect(page.sourceSessionId).toBe('origin');
    expect(page.sourceMessageIds).toEqual(['message-1']);
    expect(page.sourceMessageCount).toBe(1);
    expect(page.sourceMessageIdsTruncated).toBe(false);
    const next = await service.read(reference, { offset: page.nextOffset ?? 0, limit: 200 });
    expect(next.lines[0]).toEqual({ number: 201, text: expected[200] });
    const beyond = await service.read(reference, { offset: expected.length + 99, limit: 200 });
    expect(beyond).toMatchObject({
      lines: [],
      nextOffset: null,
      nextColumn: null,
      truncated: false,
    });
  });

  it('resumes long lines at code point boundaries until every original character is readable', async () => {
    const { service } = fixture();
    const text = 'a'.repeat(19_999) + '😀' + '尾'.repeat(25_000) + '😎';
    const { reference, document } = await service.create({
      sessionId: 's',
      messages: [userMessage(text)],
    });
    let offset = 2;
    let column = 0;
    let recovered = '';
    let pages = 0;
    while (offset === 2) {
      const page = await service.read(reference, { offset, column, limit: 1 });
      pages += 1;
      expect(page.lines).toHaveLength(1);
      const fragment = page.lines[0]?.text ?? '';
      expect(fragment.length).toBeLessThanOrEqual(20_000);
      expect(fragment.isWellFormed()).toBe(true);
      recovered += fragment;
      offset = page.nextOffset ?? -1;
      column = page.nextColumn ?? 0;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBeGreaterThan(2);
    expect(recovered).toBe(text);
    expect(document.transcript).toContain(recovered);
    const aligned = await service.read(reference, { offset: 2, column: 20_000, limit: 1 });
    expect(aligned.lines[0]?.text.startsWith('😀')).toBe(true);
  });

  it('never exceeds the total character budget across lines and handles a one-unit emoji remainder', async () => {
    const { service } = fixture();
    const { reference } = await service.create({
      sessionId: 's',
      messages: [userMessage('a'.repeat(19_999) + '\n😀last')],
    });
    const first = await service.read(reference, { offset: 2, limit: 200 });
    expect(first.lines.map((line) => line.text).join('').length).toBe(19_999);
    expect(first.nextOffset).toBe(3);
    expect(first.nextColumn).toBe(0);
    const second = await service.read(reference, { offset: 3, column: 0, limit: 200 });
    expect(second.lines[0]?.text).toBe('😀last');
  });

  it('searches literal case-sensitive strings with two physical context lines and deduplicated windows', async () => {
    const { service } = fixture();
    const text = ['zero', 'one', 'two', '[.*]', 'four', '[.*]', 'six', 'seven', 'eight', 'NOMATCH'];
    const { reference, document } = await service.create({
      sessionId: 's',
      messages: [userMessage(text.join('\n'))],
    });
    const raw = document.transcript.split('\n');
    const page = await service.read(reference, { offset: 0, limit: 200, query: '[.*]' });
    const selected = Array.from({ length: 7 }, (_, index) => index + 3);
    expect(page.lines).toEqual(selected.map((index) => ({ number: index + 1, text: raw[index] })));
    expect(page.totalLines).toBe(raw.length);
    expect(page.nextOffset).toBeNull();
    const partial = await service.read(reference, { offset: 0, limit: 2, query: '[.*]' });
    expect(partial.nextOffset).toBe(5);
    const next = await service.read(reference, {
      offset: partial.nextOffset ?? 0,
      limit: 200,
      query: '[.*]',
    });
    expect(next.lines[0]?.number).toBe(6);
    expect(
      (await service.read(reference, { offset: 0, limit: 200, query: 'nomatch' })).lines,
    ).toEqual([]);
    expect(
      (await service.read(reference, { offset: 0, limit: 200, query: '' })).lines,
    ).toHaveLength(raw.length);
  });

  it('bounds metadata for large message sets without truncating original IDs', async () => {
    const { service, store, repo } = fixture();
    store.chunkBytes = 64 * 1024;
    const messages = Array.from({ length: 2_000 }, (_, index) =>
      userMessage(`content-${index}`, `source-message-${index}`),
    );
    const { reference, document } = await service.create({ sessionId: 'large-session', messages });
    const page = await service.read(reference, { offset: 0, limit: 1 });
    expect(page.sourceMessageCount).toBe(2_000);
    expect(page.sourceMessageIdsTruncated).toBe(true);
    expect(page.sourceMessageIds).toEqual(messages.slice(0, 50).map((message) => message.id));
    expect(page.sourceMessageIds).toHaveLength(50);
    expect(JSON.stringify(page).length).toBeLessThan(2_000);
    expect(document.sourceMessageIds).toHaveLength(2_000);
    expect(document.sourceMessageIds.at(-1)).toBe('source-message-1999');
    expect((await repo.get(reference)).sourceMessageIds).toEqual(document.sourceMessageIds);
    expect(document.transcript).toContain('id="source-message-1999"');
  });

  it('bounds metadata characters without cutting a source identifier', async () => {
    const { service } = fixture();
    const messages = Array.from({ length: 20 }, (_, index) =>
      userMessage('text', `${'a'.repeat(500)}-${index}`),
    );
    const { reference, document } = await service.create({
      sessionId: 'session-bounded',
      messages,
    });
    const page = await service.read(reference, { offset: 0, limit: 1 });
    expect(page.sourceMessageIds.join('').length).toBeLessThanOrEqual(4096);
    expect(page.sourceMessageIds.length).toBeLessThan(20);
    expect(page.sourceMessageIdsTruncated).toBe(true);
    expect(page.sourceMessageIds).toEqual(
      document.sourceMessageIds.slice(0, page.sourceMessageIds.length),
    );
    await expect(service.create({ sessionId: 's'.repeat(513), messages: [] })).rejects.toThrow();
  });

  it('represents an empty archive with zero lines and no continuation', async () => {
    const { service } = fixture();
    const { reference } = await service.create({ sessionId: 's', messages: [] });
    expect(await service.read(reference, { offset: 0, limit: 20 })).toMatchObject({
      lines: [],
      totalLines: 0,
      nextOffset: null,
      nextColumn: null,
      truncated: false,
    });
  });

  it('rejects invalid pagination inputs and propagates read cancellation', async () => {
    const { service } = fixture();
    const { reference } = await service.create({ sessionId: 's', messages: [userMessage('x')] });
    const invalid: ArchiveReadOptions[] = [
      { offset: -1, limit: 1 },
      { offset: 0.5, limit: 1 },
      { offset: 0, limit: 0 },
      { offset: 0, limit: Infinity },
      { offset: 0, limit: 1, column: -1 },
      { offset: 0, limit: 1, column: 0.5 },
    ];
    for (const options of invalid)
      await expect(service.read(reference, options)).rejects.toThrow(RangeError);
    await expect(service.read(reference, { offset: 2, column: 99, limit: 1 })).rejects.toThrow(
      /line length/,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.read(reference, { offset: 0, limit: 1 }, controller.signal),
    ).rejects.toThrow();
  });
});
