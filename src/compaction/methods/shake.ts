import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm';
import type { CompactionMethod } from '../method.js';

function blockText(block: ContentBlock): string {
  return block.type === 'text' || block.type === 'reasoning' ? block.text : JSON.stringify(block);
}

function messageText(message: Message): string {
  const correlation =
    message.role === 'tool' ? ` call=${message.toolCallId} error=${!!message.isError}` : '';
  return `[${message.role} id=${message.id}${correlation}]\n${message.content.map(blockText).join('\n')}`;
}

/** Excerpts must not introduce lone surrogates into otherwise-valid tool output. */
function characterBoundary(text: string, index: number): number {
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
    ? index - 1
    : index;
}

/** One serialized message that shake would externalize at this threshold. */
function isExternalizable(message: Message, text: string, thresholdChars: number): boolean {
  return message.role === 'tool' && text.length > thresholdChars;
}

/** Count the tool outputs that a shake attempt would externalize, using the same serialization. */
export function countExternalizableOutputs(
  messages: readonly Message[],
  thresholdChars: number,
): number {
  let count = 0;
  for (const message of messages) {
    if (isExternalizable(message, messageText(message), thresholdChars)) count += 1;
  }
  return count;
}

export const shake: CompactionMethod = async (context) => {
  let changed = false;
  const chunks = context.sourceMessages.map((message) => {
    const text = messageText(message);
    if (!isExternalizable(message, text, context.config.shakeThresholdChars)) return text;
    changed = true;
    return (
      `${text.slice(0, characterBoundary(text, 4096))}\n\n[Large tool output omitted from this excerpt; ` +
      `message ${message.id} is not available through a search tool.]\n\n` +
      text.slice(characterBoundary(text, Math.max(0, text.length - 1024)))
    );
  });
  if (!changed) return { kind: 'skipped', reason: 'No large tool outputs can be externalized.' };
  return {
    kind: 'candidate',
    method: 'shake',
    result: {
      provider: context.route.provider,
      model: context.route.model,
      summary: [{ type: 'text', text: chunks.join('\n\n') }],
    },
  };
};
