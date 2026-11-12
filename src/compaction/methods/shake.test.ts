import { afterEach, describe, expect, it } from 'vitest';
import { createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { countExternalizableOutputs, shake } from './shake.js';
import { resolveConfig } from '../../config.js';
import { createHarness } from '../../../tests/fixtures/harness.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('recoverable local tool-output externalization', () => {
  it('counts only tool messages above the threshold for status explanations', () => {
    const callId = ToolCallId('count-call');
    const large = createMessage({
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text: 'x'.repeat(9_000) }],
    });
    const small = createMessage({
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text: 'short output' }],
    });
    const user = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'y'.repeat(9_000) }],
    });
    expect(countExternalizableOutputs([large, small, user], 8_192)).toBe(1);
  });

  it('retains exact user constraints, truncates large outputs and never calls the model or splits emoji', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    const callId = ToolCallId('test-call');
    const fullOutput = '😀'.repeat(12_000) + '\nExact trailing error: E_SOURCE_42';
    const messages = [
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Do not deploy without approval.' }],
      }),
      createMessage({
        role: 'tool',
        source: { kind: 'tool', callId },
        toolCallId: callId,
        isError: true,
        content: [{ type: 'text', text: fullOutput }],
      }),
    ];
    const never = async (): Promise<never> => {
      throw new Error('Local shake must not invoke remote/render callbacks');
    };
    const result = await shake({
      input: { messages },
      sourceMessages: messages,
      sourceTokens: 1_000,
      checkpointTargetTokens: 500,
      meter: fixture.ctx.tokenMeter,
      config: resolveConfig({}),
      route: { provider: 'test', model: 'vision' },
      llm: fixture.ctx.llm,
      attachments: fixture.ctx.attachments,
      imageSlots: 12,
      signal: undefined,
      soft: never,
      render: never,
    });
    if (result.kind !== 'candidate') throw new Error('Large tool output was not externalized');
    const text = result.result.summary[0];
    if (text?.type !== 'text') throw new Error('Expected a text checkpoint');
    expect(text.text).toContain('Do not deploy without approval.');
    expect(text.text).toContain('E_SOURCE_42');
    expect(text.text).not.toContain('snapcompact_recall');
    expect(text.text.isWellFormed()).toBe(true);
    expect(text.text.length).toBeLessThan(fullOutput.length);
    expect(fixture.adapter.calls).toHaveLength(0);
    const skipped = await shake({
      input: { messages: messages.slice(0, 1) },
      sourceMessages: messages.slice(0, 1),
      sourceTokens: 1_000,
      checkpointTargetTokens: 500,
      meter: fixture.ctx.tokenMeter,
      config: resolveConfig({}),
      route: { provider: 'test', model: 'vision' },
      llm: fixture.ctx.llm,
      attachments: fixture.ctx.attachments,
      imageSlots: 12,
      signal: undefined,
      soft: never,
      render: never,
    });
    expect(skipped.kind).toBe('skipped');
  });
});
