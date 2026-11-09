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

export const shake: CompactionMethod = async (context) => {
  let changed = false;
  const chunks = context.sourceMessages.map((message) => {
    const text = messageText(message);
    if (message.role !== 'tool' || text.length <= context.config.shakeThresholdChars) return text;
    changed = true;
    return (
      `${text.slice(0, characterBoundary(text, 4096))}\n\n[Large tool output archived; exact content is available through ` +
      `snapcompact_recall, archive ${context.archive.reference.attachmentId}, message ${message.id}.]\n\n` +
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
