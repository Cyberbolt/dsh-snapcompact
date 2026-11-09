import { describe, expect, it } from 'vitest';
import { createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { resolveConfig } from '../config.js';
import {
  buildVisualSource,
  clipText,
  safeSlice,
  serializeConversation,
  trimMiddle,
} from './visual-source.js';

const config = resolveConfig({}).serialization;

function image(id: string): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${id.repeat(64).slice(0, 64)}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 100,
    width: 100,
    height: 100,
  };
}

describe('visual source projection', () => {
  it('caps tool results, arguments and reasoning while keeping exact markers', () => {
    const callId = ToolCallId('call-1');
    const messages = [
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'goal' }],
      }),
      createMessage({
        role: 'assistant',
        source: { kind: 'model', provider: 'test', model: 'vision' },
        content: [
          { type: 'reasoning', text: 'secret reasoning' },
          {
            type: 'tool-call',
            id: 'call-1' as never,
            name: 'bash',
            arguments: JSON.stringify({ command: 'x'.repeat(5_000) }),
          },
        ],
      }),
      createMessage({
        role: 'tool',
        source: { kind: 'tool', callId },
        toolCallId: callId,
        content: [{ type: 'text', text: 'y'.repeat(20_000) }],
      }),
    ];
    const serialized = serializeConversation(messages, config);
    expect(serialized).toContain('goal');
    expect(serialized).not.toContain('secret reasoning');
    expect(serialized).toContain('chars omitted');
    expect(serialized).toContain('[tool-call');
    expect(serialized.length).toBeLessThan(20_000);
  });

  it('keeps exact head and tail while reserving only the middle for frames', () => {
    const text = `${'H'.repeat(3_000)}${'M'.repeat(5_000)}${'T'.repeat(3_000)}`;
    const source = buildVisualSource(
      [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })],
      { ...config, messageTextMaxChars: 20_000 },
    );
    expect(source.head).toHaveLength(2_000);
    expect(source.tail).toHaveLength(2_000);
    expect(source.middle.length).toBe(source.totalChars - 4_000);
    expect(source.head).toContain('H'.repeat(100));
    expect(source.tail.endsWith('T')).toBe(true);
  });

  it('does not split surrogate pairs and marks trimmed middle text', () => {
    expect(safeSlice('a😀b', 1, 3)).toBe('😀');
    expect(safeSlice('a😀b', 1, 2)).toBe('');
    expect(safeSlice('a😀b', 1, 2).isWellFormed()).toBe(true);
    const source = buildVisualSource(
      [
        createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: '😀'.repeat(10) }],
        }),
      ],
      { ...config, headChars: 2, tailChars: 2, messageTextMaxChars: 100 },
    );
    const trimmed = trimMiddle(source, 4);
    expect(trimmed.middle).toHaveLength(4);
    expect(trimmed.truncatedChars).toBeGreaterThan(0);
    expect(trimmed.middle.isWellFormed()).toBe(true);
  });

  it('carries the newest existing images without duplicating attachment IDs', () => {
    const first = image('a');
    const second = image('b');
    const messages = [
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'image', attachment: first }],
      }),
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'image', attachment: second }],
      }),
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'image', attachment: second }],
      }),
    ];
    const source = buildVisualSource(messages, config);
    expect(source.carriedImages.map((ref) => ref.attachmentId)).toEqual([
      first.attachmentId,
      second.attachmentId,
    ]);
  });

  it('clips long text with a visible omission marker', () => {
    const clipped = clipText('a'.repeat(100), 20);
    expect(clipped.startsWith('a'.repeat(12))).toBe(true);
    expect(clipped).toContain('80 chars omitted');
    expect(clipped.length).toBeLessThan(120);
  });
});
