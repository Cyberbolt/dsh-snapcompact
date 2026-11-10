import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { missingHostCapabilities } from './host-contract.js';

/** A fake Cordis context exposing exactly the services the plugin calls. */
function hostContext(overrides: Record<string, unknown> = {}): Context {
  const table: Record<string, unknown> = {
    llm: { stream: () => undefined, resolveModelInfo: async () => undefined },
    tokenMeter: { measure: () => undefined, estimateMessage: () => 0 },
    attachments: {
      saveFile: async () => undefined,
      readFileStream: async function* () {},
      imageLimits: { maxImagesPerMessage: 20 },
    },
    sessionProjections: { register: async () => undefined },
    tools: { register: () => undefined },
    commands: { register: () => undefined },
    ...overrides,
  };
  return { get: (name: string) => table[name] } as unknown as Context;
}

describe('host contract probe', () => {
  it('accepts a host that provides every member', () => {
    expect(missingHostCapabilities(hostContext())).toEqual([]);
  });

  it('names a whole service when the host does not provide it', () => {
    expect(missingHostCapabilities(hostContext({ commands: undefined }))).toEqual(['commands']);
  });

  it('names the exact method that disappeared', () => {
    const context = hostContext({ llm: { stream: () => undefined } });
    expect(missingHostCapabilities(context)).toEqual(['llm.resolveModelInfo']);
  });

  it('requires the nested image limit to be a number', () => {
    const context = hostContext({
      attachments: {
        saveFile: async () => undefined,
        readFileStream: async function* () {},
        imageLimits: {},
      },
    });
    expect(missingHostCapabilities(context)).toEqual([
      'attachments.imageLimits.maxImagesPerMessage',
    ]);
  });
});
