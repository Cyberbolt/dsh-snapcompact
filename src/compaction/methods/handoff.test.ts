import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateHandoff } from './handoff.js';
import { resolveConfig } from '../../config.js';
import { createHarness } from '../../../tests/fixtures/harness.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('independent handoff validation', () => {
  it.each([
    ['missing', '## Goal\nContinue implementation.'],
    [
      'empty',
      '## Goal\n## Constraints\n## Decisions\n## Files and exact commands\n## Completed work\n## Unfinished work\n## Next action\n## Critical facts\n',
    ],
  ])('rejects %s sections before persisting a misleading handoff', async (reason, text) => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    fixture.adapter.text = text;
    const save = vi.spyOn(fixture.attachments, 'saveFile');
    await expect(
      generateHandoff(
        fixture.ctx,
        resolveConfig({}),
        { messages: [] },
        fixture.agent,
        new AbortController().signal,
      ),
    ).rejects.toThrow(reason);
    expect(save).not.toHaveBeenCalled();
  });
});
