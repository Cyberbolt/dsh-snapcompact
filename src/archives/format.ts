import { createHash } from 'node:crypto';
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { z } from 'zod';

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const ARCHIVE_FILE_PREFIX = 'snapcompact-archive-v1-';
/** Only session/message identifiers are capped; message text and raw tool arguments are not. */
export const MAX_ARCHIVE_IDENTIFIER_CHARACTERS = 512;

/** A portable record, not a provider-native message that can be replayed. */
export interface ArchiveMessage {
  id: string;
  role: Message['role'];
  content: ContentBlock[];
  source: { kind: string; provider?: string; model?: string; form?: string };
  toolCallId?: string;
  isError?: boolean;
}

export interface ArchiveDocument {
  version: 1;
  sourceSessionId: string;
  sourceMessageIds: string[];
  messages: ArchiveMessage[];
  parentArchives: FileAttachmentRef[];
  transcript: string;
  transcriptSha256: string;
}

const attachmentIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const bytesSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifierSchema = z.string().min(1).max(MAX_ARCHIVE_IDENTIFIER_CHARACTERS);

export const fileAttachmentReferenceSchema = z
  .strictObject({
    attachmentId: attachmentIdSchema,
    name: z.string(),
    bytes: bytesSchema,
  })
  .transform(
    (value): FileAttachmentRef => ({
      ...value,
      attachmentId: value.attachmentId as FileAttachmentRef['attachmentId'],
    }),
  );

const imageAttachmentReferenceSchema = z
  .strictObject({
    attachmentId: attachmentIdSchema,
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    bytes: bytesSchema,
    width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    name: z.string().optional(),
    originalDimensions: z
      .strictObject({
        width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .optional(),
  })
  .transform(
    (value): ImageAttachmentRef => ({
      attachmentId: value.attachmentId as ImageAttachmentRef['attachmentId'],
      mediaType: value.mediaType,
      bytes: value.bytes,
      width: value.width,
      height: value.height,
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.originalDimensions === undefined
        ? {}
        : { originalDimensions: value.originalDimensions }),
    }),
  );

const contentBlockSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('text'), text: z.string() }),
    z.strictObject({ type: z.literal('reasoning'), text: z.string() }),
    z.strictObject({
      type: z.literal('image'),
      attachment: imageAttachmentReferenceSchema,
      offloaded: z.literal(true).optional(),
    }),
    z.strictObject({ type: z.literal('file'), attachment: fileAttachmentReferenceSchema }),
    z.strictObject({
      type: z.literal('tool-call'),
      id: z.string().min(1),
      name: z.string(),
      arguments: z.string(),
    }),
    z.strictObject({ type: z.literal('tool-addition'), toolName: z.string() }),
    z.strictObject({ type: z.literal('tool-removal'), toolName: z.string() }),
  ])
  .transform((block): ContentBlock => {
    switch (block.type) {
      case 'tool-call':
        return { ...block, id: block.id as Extract<ContentBlock, { type: 'tool-call' }>['id'] };
      case 'image':
        return {
          type: block.type,
          attachment: block.attachment,
          ...(block.offloaded === undefined ? {} : { offloaded: block.offloaded }),
        };
      default:
        return block;
    }
  });

export const archiveMessageSchema = z
  .strictObject({
    id: identifierSchema,
    role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
    content: z.array(contentBlockSchema),
    source: z.strictObject({
      kind: z.string().min(1).max(128),
      provider: z.string().max(512).optional(),
      model: z.string().max(512).optional(),
      form: z.string().max(128).optional(),
    }),
    toolCallId: z.string().min(1).optional(),
    isError: z.boolean().optional(),
  })
  .superRefine((message, context) => {
    if (message.role === 'tool' && message.toolCallId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['toolCallId'],
        message: 'Tool result requires call ID',
      });
    }
    if (
      message.role !== 'tool' &&
      (message.toolCallId !== undefined || message.isError !== undefined)
    ) {
      context.addIssue({ code: 'custom', message: 'Tool status is only valid on tool messages' });
    }
  })
  .transform(
    (message): ArchiveMessage => ({
      id: message.id,
      role: message.role,
      content: message.content,
      source: {
        kind: message.source.kind,
        ...(message.source.provider === undefined ? {} : { provider: message.source.provider }),
        ...(message.source.model === undefined ? {} : { model: message.source.model }),
        ...(message.source.form === undefined ? {} : { form: message.source.form }),
      },
      ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
      ...(message.isError === undefined ? {} : { isError: message.isError }),
    }),
  );

export const archiveDocumentSchema = z
  .strictObject({
    version: z.literal(1),
    sourceSessionId: identifierSchema,
    sourceMessageIds: z.array(identifierSchema),
    messages: z.array(archiveMessageSchema),
    parentArchives: z.array(fileAttachmentReferenceSchema),
    transcript: z.string(),
    transcriptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((document, context) => {
    if (
      document.sourceMessageIds.length !== document.messages.length ||
      document.messages.some((message, index) => message.id !== document.sourceMessageIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceMessageIds'],
        message: 'Message IDs disagree',
      });
    }
    if (sha256(document.transcript) !== document.transcriptSha256) {
      context.addIssue({
        code: 'custom',
        path: ['transcriptSha256'],
        message: 'Transcript SHA256 mismatch',
      });
    }
    if (renderTranscript(document.messages) !== document.transcript) {
      context.addIssue({
        code: 'custom',
        path: ['transcript'],
        message: 'Transcript differs from messages',
      });
    }
  });

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Recognizes only our canonical filenames; it does not authorize access or validate file bytes. */
export function isArchiveReference(ref: FileAttachmentRef): boolean {
  return (
    fileAttachmentReferenceSchema.safeParse(ref).success &&
    /^snapcompact-archive-v1-[a-f0-9]{64}\.json$/.test(ref.name)
  );
}

/** Allowlist every stored field, including nested blocks, to exclude replay/native/signature blobs. */
export function archiveMessage(message: Message): ArchiveMessage {
  const content = message.content.map((block): ContentBlock => {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        return { type: block.type, text: block.text };
      case 'tool-call':
        return { type: block.type, id: block.id, name: block.name, arguments: block.arguments };
      case 'tool-addition':
      case 'tool-removal':
        return { type: block.type, toolName: block.toolName };
      case 'file':
        return {
          type: block.type,
          attachment: {
            attachmentId: block.attachment.attachmentId,
            bytes: block.attachment.bytes,
            name: block.attachment.name,
          },
        };
      case 'image': {
        const attachment = block.attachment;
        return {
          type: block.type,
          attachment: {
            attachmentId: attachment.attachmentId,
            mediaType: attachment.mediaType,
            bytes: attachment.bytes,
            width: attachment.width,
            height: attachment.height,
            ...(attachment.name === undefined ? {} : { name: attachment.name }),
            ...(attachment.originalDimensions === undefined
              ? {}
              : {
                  originalDimensions: {
                    width: attachment.originalDimensions.width,
                    height: attachment.originalDimensions.height,
                  },
                }),
          },
          ...(block.offloaded === undefined ? {} : { offloaded: block.offloaded }),
        };
      }
      default:
        throw new Error('Unsupported archive content block');
    }
  });
  return archiveMessageSchema.parse({
    id: message.id,
    role: message.role,
    content,
    source: {
      kind: message.source.kind,
      ...(message.source.kind === 'model'
        ? { provider: message.source.provider, model: message.source.model }
        : {}),
      ...('form' in message.source && typeof message.source.form === 'string'
        ? { form: message.source.form }
        : {}),
    },
    ...(message.role === 'tool'
      ? {
          toolCallId: message.toolCallId,
          ...(message.isError === undefined ? {} : { isError: message.isError }),
        }
      : {}),
  });
}

/** Labels are metadata; text, indentation, newlines and tool argument strings remain verbatim. */
export function renderTranscript(messages: readonly ArchiveMessage[]): string {
  return messages
    .map((message) => {
      const status =
        message.role === 'tool'
          ? ` toolCallId=${JSON.stringify(message.toolCallId)} status=${message.isError ? 'error' : 'success'}`
          : '';
      const header = `[message role=${message.role} id=${JSON.stringify(message.id)} source=${JSON.stringify(message.source)}${status}]`;
      const blocks = message.content.map((block) => {
        switch (block.type) {
          case 'text':
          case 'reasoning':
            return `[${block.type}]\n${block.text}`;
          case 'tool-call':
            return `[tool-call id=${JSON.stringify(block.id)} name=${JSON.stringify(block.name)} status=request]\n[arguments]\n${block.arguments}`;
          case 'image':
          case 'file':
            return `[${block.type} attachment${block.type === 'image' && block.offloaded ? ' offloaded=true' : ''}]\n${JSON.stringify(block.attachment, null, 2)}`;
          case 'tool-addition':
          case 'tool-removal':
            return `[${block.type} name=${JSON.stringify(block.toolName)}]`;
          default:
            throw new Error('Unsupported archive content block');
        }
      });
      return [header, ...blocks, '[/message]'].join('\n');
    })
    .join('\n\n');
}
