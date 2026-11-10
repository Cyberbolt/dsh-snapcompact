import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction';
import type { SnapcompactConfig } from '../config.js';
import { isFileListBlock } from './file-ops.js';

/**
 * A bounded, deterministic projection of the selected history for bitmap
 * rendering. The full transcript remains in the archive; this projection may
 * omit text, but marks every omission visibly.
 */
export interface VisualSource {
  /** Exact leading text kept outside the frames. */
  readonly head: string;
  /** Text rendered into frames. */
  readonly middle: string;
  /** Exact trailing text kept outside the frames. */
  readonly tail: string;
  /** Characters omitted from the middle before rendering. */
  readonly truncatedChars: number;
  /** Existing images carried into the checkpoint, oldest first. */
  readonly carriedImages: readonly ImageAttachmentRef[];
  /** Total characters in the compact projection. */
  readonly totalChars: number;
}

/** Avoid splitting a surrogate pair when clipping at a UTF-16 boundary. */
export function safeSlice(text: string, start: number, end: number): string {
  let from = Math.max(0, Math.min(text.length, start));
  let to = Math.max(from, Math.min(text.length, end));
  if (from > 0 && from < text.length) {
    const before = text.charCodeAt(from - 1);
    const after = text.charCodeAt(from);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) from -= 1;
  }
  if (to > from && to < text.length) {
    const before = text.charCodeAt(to - 1);
    const after = text.charCodeAt(to);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) to -= 1;
  }
  return text.slice(from, to);
}

/** Head-biased clipping; the marker is part of the bounded output. */
export function clipText(text: string, maxChars: number, headRatio = 0.6): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * headRatio);
  const tail = maxChars - head;
  const omitted = text.length - maxChars;
  return `${safeSlice(text, 0, head)}\n[… ${omitted} chars omitted; exact content in archive …]\n${safeSlice(text, text.length - tail, text.length)}`;
}

function attachmentLine(block: Extract<ContentBlock, { type: 'image' | 'file' }>): string {
  if (block.type === 'image') {
    const ref = block.attachment;
    return `[image attachment=${ref.attachmentId} ${ref.width}x${ref.height}${block.offloaded === true ? ' offloaded' : ''}]`;
  }
  return `[file attachment=${block.attachment.attachmentId} name=${JSON.stringify(block.attachment.name)} bytes=${block.attachment.bytes}]`;
}

function blockText(block: ContentBlock, config: SnapcompactConfig['serialization']): string {
  switch (block.type) {
    case 'text':
      return clipText(block.text, config.messageTextMaxChars);
    case 'reasoning':
      return config.includeReasoning ? clipText(block.text, config.messageTextMaxChars) : '';
    case 'tool-call':
      return `[tool-call name=${JSON.stringify(block.name)} id=${JSON.stringify(block.id)}]\n${clipText(block.arguments, Math.min(config.toolArgumentMaxChars, config.toolCallMaxChars))}`;
    case 'tool-addition':
    case 'tool-removal':
      return `[${block.type} name=${JSON.stringify(block.toolName)}]`;
    case 'image':
    case 'file':
      return attachmentLine(block);
    default:
      return '';
  }
}

function messageText(message: Message, config: SnapcompactConfig['serialization']): string {
  const checkpoint = isCompactCheckpointSource(message.source);
  const blocks = message.content
    .filter((block) => !(checkpoint && block.type === 'text' && isFileListBlock(block.text)))
    .map((block) => blockText(block, config))
    .filter((text) => text.length > 0);
  if (blocks.length === 0) return '';
  const status =
    message.role === 'tool'
      ? ` toolCallId=${JSON.stringify(message.toolCallId)} status=${message.isError === true ? 'error' : 'success'}`
      : '';
  const header = `[${message.role} id=${JSON.stringify(message.id)}${status}]`;
  return `${header}\n${blocks.join('\n')}`;
}

/** The serialized body is intentionally denser than the exact archive transcript. */
export function serializeConversation(
  messages: readonly Message[],
  config: SnapcompactConfig['serialization'],
): string {
  return messages
    .map((message) => {
      if (message.role === 'tool') {
        const text = message.content
          .filter(
            (block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text',
          )
          .map((block) => block.text)
          .join('\n');
        const clipped = clipText(text, config.toolResultMaxChars);
        const status = `toolCallId=${JSON.stringify(message.toolCallId)} status=${message.isError === true ? 'error' : 'success'}`;
        return `[tool id=${JSON.stringify(message.id)} ${status}]\n${clipped}`;
      }
      return messageText(message, config);
    })
    .filter((text) => text.length > 0)
    .join('\n\n');
}

function collectCarriedImages(
  messages: readonly Message[],
  max: number,
): readonly ImageAttachmentRef[] {
  if (max < 1) return [];
  const seen = new Set<string>();
  const selected: ImageAttachmentRef[] = [];
  for (let index = messages.length - 1; index >= 0 && selected.length < max; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.content[blockIndex];
      if (block?.type !== 'image' || block.offloaded === true) continue;
      const id = block.attachment.attachmentId;
      if (seen.has(id)) continue;
      seen.add(id);
      selected.push(block.attachment);
      if (selected.length >= max) break;
    }
  }
  return selected.reverse();
}

/**
 * Build the compact visual projection: a bounded head and tail remain exact
 * text, while the middle is reserved for frames. Existing images are carried
 * separately so a later compaction does not silently discard them.
 */
export function buildVisualSource(
  messages: readonly Message[],
  config: SnapcompactConfig['serialization'],
): VisualSource {
  const serialized = serializeConversation(messages, config);
  const headChars = Math.max(0, config.headChars);
  const tailChars = Math.max(0, config.tailChars);
  if (serialized.length <= headChars + tailChars) {
    return {
      head: serialized,
      middle: '',
      tail: '',
      truncatedChars: 0,
      carriedImages: collectCarriedImages(messages, config.maxCarriedImages),
      totalChars: serialized.length,
    };
  }
  const head = safeSlice(serialized, 0, headChars);
  const tail = safeSlice(serialized, serialized.length - tailChars, serialized.length);
  const middle = safeSlice(serialized, head.length, serialized.length - tail.length);
  return {
    head,
    middle,
    tail,
    truncatedChars: 0,
    carriedImages: collectCarriedImages(messages, config.maxCarriedImages),
    totalChars: serialized.length,
  };
}

/** Trim the oldest middle text while retaining a visible omission marker. */
export function trimMiddle(source: VisualSource, maxMiddleChars: number): VisualSource {
  if (source.middle.length <= maxMiddleChars) return source;
  const omitted = source.middle.length - maxMiddleChars;
  // Keep the newest part of the middle; the exact head and tail remain outside.
  const kept = safeSlice(
    source.middle,
    source.middle.length - maxMiddleChars,
    source.middle.length,
  );
  return {
    ...source,
    middle: kept,
    truncatedChars: source.truncatedChars + omitted,
    totalChars: source.head.length + kept.length + source.tail.length,
  };
}
