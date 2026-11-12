import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction';
import type { SnapcompactConfig } from '../config.js';
import { isFileListBlock } from './file-ops.js';

/**
 * A bounded, deterministic projection of the selected history for bitmap
 * rendering. This projection may omit text, but marks every omission visibly.
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

/**
 * Keep both ends of a bounded field. Errors and exact values usually live at
 * the tail, while the head carries the command and its scope.
 */
export function clipText(text: string, maxChars: number, headRatio = 0.6): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const ratio = Math.min(1, Math.max(0, headRatio));
  const headChars = Math.round(maxChars * ratio);
  const tailChars = maxChars - headChars;
  const omitted = text.length - maxChars;
  const tail = tailChars > 0 ? safeSlice(text, text.length - tailChars, text.length) : '';
  return safeSlice(text, 0, headChars) + ` […${omitted}ch elided…] ` + tail;
}

/** Routine log shapes that carry no durable fact for a visual reader. */
const LOW_VALUE_LINE = [
  /^\d{4}-\d{2}-\d{2}T.*\bINFO\b/u,
  /\b(?:PASS|FLAKE)\b.*duration=/u,
  /^\s+at .*\(node:/u,
  /^\{"ts":/u,
  /^Paragraph \d+:/u,
];

const HIGH_SIGNAL =
  /(sha256:|\bpnpm\b|--[a-z]|\/srv\/|\/var\/|\/etc\/|\bport \d+|\btimeout\b|\bretry\b|\block\b|\bflag\b|checksum|\bowner\b|\btarget\b|release tag|migrate|deploy|rollback|exclude|事故根因|事故负责人|第一步)/iu;

/** Mark exact-token lines so the reader knows where to slow down. */
export function extractHighSignalLines(text: string): string[] {
  return text.split('\n').filter((line) => HIGH_SIGNAL.test(line));
}

/**
 * A bounded, deterministic index of exact-token lines. This is not a search
 * tool: it is part of the checkpoint, generated from the same projection the
 * frames carry. It exists because 64-character digests are not reliably
 * readable from pixels, while a labeled text line is.
 */
const INDEX_LINE =
  /(?:sha256:| is | was | listens | uses | excludes | acquired|enabled|timeout|retry|release tag|Approved target|Owner:|Incident ticket|Pinned runtime|Never |Keep |Do not |Reply in|failed|restored|restarted|after|before|事故|第一步|最终验证|environment variable|checksum|migration lock|feature flag|rollback)/iu;

export function exactTokenIndex(text: string, maxLines = 80): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\* /u, '').trim();
    if (line.length === 0 || line.startsWith('»') || line.startsWith('[…')) continue;
    if (/^[dl-][rwx-]{9}\b/u.test(line) || /^\s+at /u.test(line)) continue;
    if (!INDEX_LINE.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

export function markHighSignalLines(text: string): string {
  return text
    .split('\n')
    .map((line) => (HIGH_SIGNAL.test(line) && !line.startsWith('* ') ? '* ' + line : line))
    .join('\n');
}

export function elideLowValueLines(text: string): string {
  let dropped = 0;
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (LOW_VALUE_LINE.some((pattern) => pattern.test(line))) {
      dropped += 1;
      continue;
    }
    kept.push(line);
  }
  if (dropped > 0) kept.push('[…' + String(dropped) + ' routine log lines elided…]');
  return kept.join('\n');
}

/**
 * Collapse long runs of structurally identical lines (build logs, test
 * listings, stack frames). Unique fact lines have distinct shapes and survive.
 */
function lineShape(line: string): string {
  return line.replace(/[0-9a-f]{6,}/giu, '#').replace(/\d+/gu, '#');
}

export function elideRepeatedLines(text: string, maxRun = 6): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const shape = lineShape(lines[index] ?? '');
    let end = index + 1;
    while (end < lines.length && lineShape(lines[end] ?? '') === shape) end += 1;
    const run = end - index;
    if (run > maxRun) {
      out.push(...lines.slice(index, index + 2));
      out.push('[…' + String(run - 4) + ' similar lines elided…]');
      out.push(...lines.slice(end - 2, end));
    } else {
      out.push(...lines.slice(index, end));
    }
    index = end;
  }
  return out.join('\n');
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
      return clipText(
        markHighSignalLines(elideRepeatedLines(elideLowValueLines(block.text))),
        config.messageTextMaxChars,
      );
    case 'reasoning':
      return config.includeReasoning
        ? clipText(
            markHighSignalLines(elideRepeatedLines(elideLowValueLines(block.text))),
            config.messageTextMaxChars,
          )
        : '';
    case 'tool-call':
      return `${block.name}(${clipText(block.arguments, Math.min(config.toolArgumentMaxChars, config.toolCallMaxChars))})`;
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

function resultBlock(text: string, config: SnapcompactConfig['serialization']): string {
  return `<out>\n${clipText(markHighSignalLines(elideRepeatedLines(elideLowValueLines(text))), config.toolResultMaxChars)}\n</out>`;
}

/** A section prefix is cheaper than a JSON-ish header and reads as a line start. */
const USER = '»user:';
const ASSISTANT = '»ai:';
const THINKING = '»think:';
const CALL = '»call:';

function messageText(message: Message, config: SnapcompactConfig['serialization']): string {
  const checkpoint = isCompactCheckpointSource(message.source);
  const blocks = message.content
    .filter((block) => !(checkpoint && block.type === 'text' && isFileListBlock(block.text)))
    .map((block) => blockText(block, config))
    .filter((text) => text.length > 0);
  if (blocks.length === 0) return '';
  return blocks.join('\n');
}

function toolResultText(message: Message, config: SnapcompactConfig['serialization']): string {
  const text = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return resultBlock(text, config);
}

/**
 * Serialize the selected history into a dense, frame-oriented projection.
 *
 * The exact archive is gone; this projection is the checkpoint. Tool calls and
 * their results merge into one `»call:` section so the model reads the command
 * next to its output. The source text is clipped head-and-tail, never silently.
 */
export function serializeConversation(
  messages: readonly Message[],
  config: SnapcompactConfig['serialization'],
): string {
  const resultTextByCallId = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const text = toolResultText(message, config);
    if (text.length > 0) resultTextByCallId.set(message.toolCallId, text);
  }
  const parts: string[] = [];
  let lastPrefix: string | null = null;
  const pushPart = (prefix: string, content: string): void => {
    if (content.length === 0) return;
    const lastIndex = parts.length - 1;
    if (lastIndex >= 0 && lastPrefix === prefix) {
      const separator = parts[lastIndex]?.endsWith('\n') || content.startsWith('\n') ? '' : '\n';
      parts[lastIndex] = (parts[lastIndex] ?? '') + separator + content;
    } else {
      parts.push(prefix + '\n' + content);
      lastPrefix = prefix;
    }
  };
  const mergedCalls = new Set<string>();

  for (const message of messages) {
    if (message.role === 'user') {
      pushPart(USER, messageText(message, config));
      continue;
    }
    if (message.role === 'assistant') {
      let pendingThinking: string[] = [];
      let pendingText: string[] = [];
      const flush = (): void => {
        if (pendingThinking.length > 0) pushPart(THINKING, pendingThinking.join('\n'));
        if (pendingText.length > 0) pushPart(ASSISTANT, pendingText.join('\n'));
        pendingThinking = [];
        pendingText = [];
      };
      for (const block of message.content) {
        if (block.type === 'text') {
          const text = clipText(
            markHighSignalLines(elideRepeatedLines(elideLowValueLines(block.text))),
            config.messageTextMaxChars,
          );
          if (text.trim().length > 0) pendingText.push(text);
        } else if (block.type === 'reasoning') {
          if (!config.includeReasoning) continue;
          const text = clipText(
            markHighSignalLines(elideRepeatedLines(elideLowValueLines(block.text))),
            config.messageTextMaxChars,
          );
          if (text.trim().length > 0) pendingThinking.push(text);
        } else if (block.type === 'tool-call') {
          flush();
          const args = clipText(
            block.arguments,
            Math.min(config.toolArgumentMaxChars, config.toolCallMaxChars),
          );
          const result = resultTextByCallId.get(block.id);
          if (result !== undefined) mergedCalls.add(block.id);
          pushPart(CALL, `${block.name}(${args})` + (result === undefined ? '' : '\n' + result));
        }
      }
      flush();
      continue;
    }
    if (message.role === 'tool') {
      if (mergedCalls.has(message.toolCallId)) continue;
      const result = resultTextByCallId.get(message.toolCallId);
      if (result !== undefined) pushPart(CALL, result);
    }
  }
  return parts.join('\n\n');
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

/**
 * Foveated trimming: keep both chronological edges of the middle and drop the
 * oldest dense center. The exact head and tail stay outside the frames, so the
 * session's oldest constraints and newest decisions survive a tight budget.
 */
export function foveateMiddle(
  source: VisualSource,
  maxMiddleChars: number,
  headRatio = 0.45,
): VisualSource {
  if (source.middle.length <= maxMiddleChars) return source;
  const ratio = Math.min(0.9, Math.max(0.1, headRatio));
  const marker = `\n[…${source.middle.length - maxMiddleChars}ch elided from dense center…]\n`;
  const usable = Math.max(2, maxMiddleChars - marker.length);
  const headChars = Math.max(1, Math.floor(usable * ratio));
  const tailChars = Math.max(1, usable - headChars);
  const head = safeSlice(source.middle, 0, headChars);
  const tail = safeSlice(source.middle, source.middle.length - tailChars, source.middle.length);
  const middle = head + marker + tail;
  return {
    ...source,
    middle,
    truncatedChars: source.truncatedChars + (source.middle.length - usable),
    totalChars: source.head.length + middle.length + source.tail.length,
  };
}
