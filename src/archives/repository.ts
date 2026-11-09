import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import {
  ARCHIVE_FILE_PREFIX,
  MAX_ARCHIVE_BYTES,
  archiveDocumentSchema,
  fileAttachmentReferenceSchema,
  isArchiveReference,
  sha256,
} from './format.js';
import type { ArchiveDocument } from './format.js';

export interface FileStore {
  saveFile(input: { data: Uint8Array; name?: string }): Promise<FileAttachmentRef>;
  readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

/** Race even stores that do not themselves observe cancellation; late rejections remain handled. */
async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    void operation.catch(() => undefined);
    throw signal.reason;
  }
  if (signal === undefined) return operation;
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error);
      },
    );
  });
}

export class ArchiveRepository {
  constructor(
    private readonly store: FileStore,
    private readonly maxBytes: number = MAX_ARCHIVE_BYTES,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ARCHIVE_BYTES) {
      throw new RangeError(`Archive byte limit must be between 1 and ${MAX_ARCHIVE_BYTES}`);
    }
  }

  async put(document: ArchiveDocument, signal?: AbortSignal): Promise<FileAttachmentRef> {
    signal?.throwIfAborted();
    const validated = archiveDocumentSchema.parse(document);
    const data = new TextEncoder().encode(JSON.stringify(validated));
    if (data.byteLength > this.maxBytes) throw new RangeError('Archive exceeds byte limit');
    signal?.throwIfAborted();
    const name = `${ARCHIVE_FILE_PREFIX}${validated.transcriptSha256}.json`;
    const attachmentId = `sha256:${sha256(data)}`;
    const reference = fileAttachmentReferenceSchema.parse(
      await abortable(this.store.saveFile({ data, name }), signal),
    );
    signal?.throwIfAborted();
    if (
      reference.bytes !== data.byteLength ||
      reference.attachmentId !== attachmentId ||
      reference.name !== name
    ) {
      throw new Error('Saved archive reference does not match stored bytes or name');
    }
    return reference;
  }

  async get(reference: FileAttachmentRef, signal?: AbortSignal): Promise<ArchiveDocument> {
    signal?.throwIfAborted();
    const ref = fileAttachmentReferenceSchema.parse(reference);
    if (!isArchiveReference(ref)) throw new Error('Not a snapcompact archive reference');
    if (ref.bytes > this.maxBytes) throw new RangeError('Archive exceeds byte limit');
    const iterator = this.store.readFileStream(ref, signal)[Symbol.asyncIterator]();
    // A fixed bounded buffer also resists millions of tiny/empty chunks from an untrusted store.
    const data = new Uint8Array(ref.bytes);
    let total = 0;
    let completed = false;
    try {
      while (true) {
        signal?.throwIfAborted();
        const result = await abortable(iterator.next(), signal);
        if (result.done) {
          completed = true;
          break;
        }
        const chunk = result.value;
        if (!(chunk instanceof Uint8Array)) throw new TypeError('Invalid archive stream chunk');
        if (chunk.byteLength > this.maxBytes - total || chunk.byteLength > ref.bytes - total) {
          throw new RangeError('Archive exceeds declared size or byte limit');
        }
        data.set(chunk, total);
        total += chunk.byteLength;
      }
    } finally {
      if (!completed && iterator.return !== undefined) {
        // A hostile or stuck iterator must not delay abort/error delivery during cleanup.
        try {
          void Promise.resolve(iterator.return()).catch(() => undefined);
        } catch {
          // Preserve the original read, validation or cancellation error.
        }
      }
    }
    signal?.throwIfAborted();
    if (total !== ref.bytes) throw new Error('Archive byte length mismatch');
    if (`sha256:${sha256(data)}` !== ref.attachmentId) {
      throw new Error('Archive file SHA256 mismatch');
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    const value: unknown = JSON.parse(text);
    signal?.throwIfAborted();
    const document = archiveDocumentSchema.parse(value);
    if (ref.name !== `${ARCHIVE_FILE_PREFIX}${document.transcriptSha256}.json`) {
      throw new Error('Archive filename does not match its transcript checksum');
    }
    signal?.throwIfAborted();
    return document;
  }
}
