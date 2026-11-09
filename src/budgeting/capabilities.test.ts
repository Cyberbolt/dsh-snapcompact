import { afterEach, describe, expect, it } from 'vitest';
import { probeFrameShape, resolveImageRoute } from './capabilities.js';
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
  it('uses a labelled conservative DeepSeek estimate when a gateway exposes no price', async () => {
    const fixture = await createHarness('deepseek-v4.1-flash');
    cleanups.push(fixture.dispose);
    fixture.adapter.pricingAvailable = false;
    const route = await resolveImageRoute(
      fixture.ctx.llm,
      { provider: 'test', model: 'deepseek-v4.1-flash' },
      [],
    );
    expect(route?.pricingSource).toBe('deepseek-estimate');
    expect(
      route?.pricing.priceImages([
        {
          type: 'image',
          attachment: {
            attachmentId: `sha256:${'a'.repeat(64)}` as never,
            mediaType: 'image/png',
            bytes: 1,
            width: 2048,
            height: 2048,
          },
        },
      ])[0]?.visualTokens,
    ).toBe(1024);
  });
  it('probes the largest frame that survives route downscaling', async () => {
    const fixture = await createHarness();
    cleanups.push(fixture.dispose);
    fixture.adapter.targetScale = 0.8;
    const shape = probeFrameShape(
      fixture.ctx.llm,
      { provider: 'test', model: 'vision' },
      [{ width: 2048, height: 2048 }],
      12,
    );
    expect(shape).toMatchObject({ width: 2048, height: 2048, projectedWidth: 1638 });
    fixture.adapter.targetScale = 0.5;
    expect(
      probeFrameShape(
        fixture.ctx.llm,
        { provider: 'test', model: 'vision' },
        [{ width: 2048, height: 2048 }],
        12,
      ),
    ).toBeNull();
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
