import { afterEach, describe, expect, it } from 'vitest';
import { resolveImageRoute } from './capabilities.js';
import { createHarness } from '../../tests/fixtures/harness.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await dispose();
});

describe('route capability and pricing policy', () => {
  it('does not let a price override invent image support', async () => {
    const fixture = await createHarness('text');
    cleanups.push(fixture.dispose);
    const route = await resolveImageRoute(fixture.ctx.llm, { provider: 'test', model: 'text' }, [
      { provider: 'test', model: 'text', visualTokensPerFrame: 1234 },
    ]);
    expect(route).toBeNull();
  });
  it('uses the exact adapter price when available', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    const route = await resolveImageRoute(
      fixture.ctx.llm,
      { provider: 'test', model: 'vision' },
      [],
    );
    expect(route?.pricingSource).toBe('adapter');
  });
  it('fails closed without pricing and requires an exact route match for an override', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    fixture.adapter.pricingAvailable = false;
    const target = { provider: 'test', model: 'vision' };
    expect(await resolveImageRoute(fixture.ctx.llm, target, [])).toBeNull();
    expect(
      await resolveImageRoute(fixture.ctx.llm, target, [
        { provider: 'test', model: 'other', visualTokensPerFrame: 1234 },
      ]),
    ).toBeNull();
    expect(
      (
        await resolveImageRoute(fixture.ctx.llm, target, [
          { ...target, visualTokensPerFrame: 1234 },
        ])
      )?.pricingSource,
    ).toBe('configured-ceiling');
  });
});
