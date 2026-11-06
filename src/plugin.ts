import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-session-projection';
import { resolveConfig } from './config.js';
import { ArchiveRepository } from './archives/repository.js';
import { ArchiveService } from './archives/service.js';
import { SnapcompactEngine } from './compaction/engine.js';
import { registerArchiveIndex } from './integrations/dsh/archive-projection.js';
import { registerRecallTool } from './integrations/dsh/recall-tool.js';
import { registerCommands } from './integrations/dsh/commands.js';
import { createRenderer } from './rendering/worker-client.js';

export const inject = [
  'llm',
  'tokenMeter',
  'sessions',
  'attachments',
  'sessionProjections',
  'tools',
  'commands',
];

/** Composition root: domain modules never reach into the active profile or its YAML. */
export async function apply(ctx: Context, input: unknown): Promise<void> {
  const settings = resolveConfig(input);
  if (ctx.get('compaction')) {
    throw new Error(
      'Snapcompact replaces compaction-basic. Mount it in an isolated compaction group with the native backend removed.',
    );
  }
  const archives = new ArchiveService(
    new ArchiveRepository(ctx.attachments, settings.archiveMaxBytes),
  );
  const index = await registerArchiveIndex(ctx);
  const lifetime = new AbortController();
  const renderer = createRenderer();
  ctx.effect(() => async () => {
    lifetime.abort(new Error('Snapcompact plugin was unloaded.'));
    await renderer.dispose();
  });
  const engine = new SnapcompactEngine(ctx, settings, archives, renderer, lifetime.signal);
  registerRecallTool(ctx, archives, index);
  registerCommands(ctx, engine, archives, index, lifetime.signal);
}
