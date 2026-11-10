import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-session-projection';
import { resolveConfig } from './config.js';
import { applyUserSettings, SETTINGS_SERVICE, type UserSettings } from './settings/metadata.js';
import { ArchiveRepository } from './archives/repository.js';
import { ArchiveService } from './archives/service.js';
import { SnapcompactEngine } from './compaction/engine.js';
import { registerArchiveIndex } from './integrations/dsh/archive-projection.js';
import { missingHostCapabilities } from './integrations/dsh/host-contract.js';
import { registerRecallTool } from './integrations/dsh/recall-tool.js';
import { registerCommands } from './integrations/dsh/commands.js';
import { createRenderer } from './rendering/worker-client.js';

/**
 * Read the live overrides published by the profile-plane settings row.
 *
 * An absent service means the bundle is mounted without its settings entry
 * (an older composition, or a hand-written patch): the preset's own config
 * then stands unchanged.
 */
function userOverrides(ctx: Context): UserSettings | undefined {
  const service = ctx.get(SETTINGS_SERVICE) as { current?: () => UserSettings } | undefined;
  if (service === undefined || typeof service.current !== 'function') return undefined;
  try {
    return service.current();
  } catch {
    return undefined;
  }
}

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
  const settings = resolveConfig(applyUserSettings(input, userOverrides(ctx)));
  // The profile-plane carrier row only exposes the browser half to the module
  // scanner (which requires a bare package-name entry); it must not mount a
  // second compaction backend, tools or commands.
  if (settings.role === 'ui') return;
  if (ctx.get('compaction')) {
    throw new Error(
      'Snapcompact replaces compaction-basic. Mount it in an isolated compaction group with the native backend removed.',
    );
  }
  // A range still admits host releases that rework a service. Fail before any
  // registration so an incompatible host cannot produce a half-mounted backend.
  const missing = missingHostCapabilities(ctx);
  if (missing.length > 0) {
    throw new Error(
      `Snapcompact cannot start on this DSH build: required host capabilities are missing ` +
        `(${missing.join(', ')}). Nothing was mounted; install a DSH release this plugin ` +
        `declares compatible, or a newer Snapcompact release.`,
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
