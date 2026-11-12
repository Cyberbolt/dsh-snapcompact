import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ArchiveService } from '../../archives/service.js';
import type { SnapcompactEngine } from '../../compaction/engine.js';
import type { ArchiveIndex } from './archive-projection.js';
import { parseBenchmarkRequest, registerCommands } from './commands.js';

interface CapturedCommand {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint?: string };
  readonly handler: (invocation: {
    readonly agent: never;
    readonly rawInput: string;
    readonly signal: AbortSignal;
    readonly commandId: string;
  }) => Promise<{ readonly kind: string; readonly text: string }>;
}

function captureCommand(): { ctx: Context; command: () => CapturedCommand } {
  let captured: CapturedCommand | undefined;
  const ctx = {
    commands: {
      register(definition: CapturedCommand) {
        captured = definition;
        return () => {};
      },
    },
  } as unknown as Context;
  return {
    ctx,
    command: () => {
      if (captured === undefined) throw new Error('command was not registered');
      return captured;
    },
  };
}

function register(ctx: Context): void {
  registerCommands(
    ctx,
    {} as unknown as SnapcompactEngine,
    {} as unknown as ArchiveService,
    {} as unknown as ArchiveIndex,
    new AbortController().signal,
  );
}

describe('snapcompact command', () => {
  it('advertises the run-count syntax and /compact as the manual entry point', () => {
    const { ctx, command } = captureCommand();
    register(ctx);
    expect(command().description).toContain('/compact');
    expect(command().input?.hint).toBe('status | benchmark [1-5] | benchmark session [1-5]');
    expect(command().input?.hint).not.toContain(' run');
  });

  it('parses accuracy and session benchmark runs', () => {
    expect(parseBenchmarkRequest('benchmark')).toEqual({ kind: 'accuracy', runs: 1 });
    expect(parseBenchmarkRequest('benchmark 3')).toEqual({ kind: 'accuracy', runs: 3 });
    expect(parseBenchmarkRequest('benchmark session')).toEqual({ kind: 'session', runs: 1 });
    expect(parseBenchmarkRequest('benchmark session 2')).toEqual({
      kind: 'session',
      runs: 2,
    });
    expect(parseBenchmarkRequest('status')).toBeNull();
    for (const invalid of [
      'benchmark 0',
      'benchmark 6',
      'benchmark abc',
      'benchmark 1 2',
      'benchmark session 0',
      'benchmark session 6',
      'benchmark session abc',
    ]) {
      expect(parseBenchmarkRequest(invalid), invalid).toHaveProperty('error');
    }
  });

  it('rejects run with a pointer to /compact instead of compacting', async () => {
    const { ctx, command } = captureCommand();
    register(ctx);
    const result = await command().handler({
      agent: {} as never,
      rawInput: 'run',
      signal: new AbortController().signal,
      commandId: 'test-command',
    });
    expect(result.kind).toBe('error');
    expect(result.text).toContain('/compact');
    expect(result.text).toContain('status 和 benchmark');
  });

  it('reports the supported actions for an unknown action', async () => {
    const { ctx, command } = captureCommand();
    register(ctx);
    const result = await command().handler({
      agent: {} as never,
      rawInput: 'unknown',
      signal: new AbortController().signal,
      commandId: 'test-command',
    });
    expect(result.kind).toBe('error');
    expect(result.text).toContain('用法：/snapcompact status | benchmark [1-5]');
    expect(result.text).toContain('/compact');
  });
});
