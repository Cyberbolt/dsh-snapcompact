import schema from '@deepseek-ai/schemastery';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
} from '@deepseek-ai/dsh-compaction-basic';
import { z } from 'zod';

export const methodNameSchema = z.enum(['snapcompact', 'handoff', 'shake', 'soft']);
export type MethodName = z.infer<typeof methodNameSchema>;

const policyFields = {
  thresholdRatio: z.number().gt(0).lte(1).optional(),
  headroomTokens: z.number().int().nonnegative().optional(),
  retainRatio: z.number().gt(0).lte(1).optional(),
  retainTokens: z.number().int().nonnegative().optional(),
  summarizationProvider: z.string().optional(),
  summarizationModel: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  compactionRetries: z.number().int().nonnegative().optional(),
  maxOverflowRetries: z.number().int().nonnegative().optional(),
};

const configSchema = z
  .strictObject({
    policy: z
      .strictObject({
        ...policyFields,
        auto: z.boolean().optional(),
        modelPolicies: z
          .array(
            z.strictObject({
              provider: z.string().min(1),
              model: z.string().min(1),
              ...policyFields,
            }),
          )
          .optional(),
      })
      .default({}),
    methodOrder: z
      .array(methodNameSchema)
      .min(1)
      .default(['snapcompact', 'handoff', 'shake', 'soft']),
    rendering: z
      .strictObject({
        width: z.number().int().min(256).max(2048).default(1536),
        height: z.number().int().min(256).max(2048).default(1024),
        maxFrames: z.number().int().min(1).max(20).default(12),
        maxTotalBytes: z
          .number()
          .int()
          .positive()
          .max(16 * 1024 * 1024)
          .default(16 * 1024 * 1024),
        maxSourceBytes: z
          .number()
          .int()
          .positive()
          .max(64 * 1024 * 1024)
          .default(64 * 1024 * 1024),
        timeoutMs: z.number().int().positive().max(15_000).default(15_000),
      })
      .prefault({}),
    routePolicies: z
      .array(
        z.strictObject({
          provider: z.string().min(1),
          model: z.string().min(1),
          visualTokensPerFrame: z.number().int().positive(),
        }),
      )
      .default([]),
    minCompressionRatio: z.number().min(1.1).default(2),
    archiveMaxBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024)
      .default(64 * 1024 * 1024),
    handoffMaxTokens: z.number().int().min(256).max(16_384).default(4096),
    shakeThresholdChars: z.number().int().min(1024).default(8192),
  })
  .superRefine((config, context) => {
    if (new Set(config.methodOrder).size !== config.methodOrder.length) {
      context.addIssue({
        code: 'custom',
        path: ['methodOrder'],
        message: 'Methods must not repeat.',
      });
    }
    if (config.methodOrder.at(-1) !== 'soft') {
      context.addIssue({
        code: 'custom',
        path: ['methodOrder'],
        message: 'The final fallback must be soft.',
      });
    }
    const routes = config.routePolicies.map(({ provider, model }) => `${provider}\0${model}`);
    if (new Set(routes).size !== routes.length) {
      context.addIssue({
        code: 'custom',
        path: ['routePolicies'],
        message: 'Route policies must be unique.',
      });
    }
  });

export type SnapcompactConfig = z.infer<typeof configSchema>;

/** Semantic checks happen once, before any plugin registration or side effect. */
export function resolveConfig(input: unknown): SnapcompactConfig {
  return configSchema.parse(input ?? {});
}

const numericPolicyKeys = [
  'thresholdRatio',
  'headroomTokens',
  'retainRatio',
  'retainTokens',
  'maxTokens',
  'compactionRetries',
  'maxOverflowRetries',
] as const;
const stringPolicyKeys = ['summarizationProvider', 'summarizationModel'] as const;

function copyPolicyFields(input: SnapcompactConfig['policy']): CompactionPolicyConfig {
  const result: CompactionPolicyConfig = {};
  for (const key of numericPolicyKeys) {
    const value = input[key];
    if (value !== undefined) result[key] = value;
  }
  for (const key of stringPolicyKeys) {
    const value = input[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** Convert validated optional values to the native API's exact-optional object contract. */
export function toNativePolicy(input: SnapcompactConfig['policy']): BasicCompactionConfig {
  const result: BasicCompactionConfig = copyPolicyFields(input);
  if (input.auto !== undefined) result.auto = input.auto;
  if (input.modelPolicies !== undefined) {
    result.modelPolicies = input.modelPolicies.map((policy) => ({
      ...copyPolicyFields(policy),
      provider: policy.provider,
      model: policy.model,
    }));
  }
  return result;
}

/** Loader-facing form; the strict parser above supplies defaults and cross-field validation. */
export const Config: ReturnType<typeof schema.object> = schema.object({
  policy: BasicCompactionEngine.Config,
  methodOrder: schema.array(schema.string()).default(['snapcompact', 'handoff', 'shake', 'soft']),
  rendering: schema.object({
    width: schema.number().step(1).min(256).max(2048).default(1536),
    height: schema.number().step(1).min(256).max(2048).default(1024),
    maxFrames: schema.number().step(1).min(1).max(20).default(12),
    maxTotalBytes: schema
      .number()
      .step(1)
      .min(1)
      .max(16 * 1024 * 1024)
      .default(16 * 1024 * 1024),
    maxSourceBytes: schema
      .number()
      .step(1)
      .min(1)
      .max(64 * 1024 * 1024)
      .default(64 * 1024 * 1024),
    timeoutMs: schema.number().step(1).min(1).max(15_000).default(15_000),
  }),
  routePolicies: schema
    .array(
      schema.object({
        provider: schema.string().required(),
        model: schema.string().required(),
        visualTokensPerFrame: schema.number().step(1).min(1).required(),
      }),
    )
    .default([]),
  minCompressionRatio: schema.number().min(1.1).default(2),
  archiveMaxBytes: schema
    .number()
    .step(1)
    .min(1)
    .max(64 * 1024 * 1024)
    .default(64 * 1024 * 1024),
  handoffMaxTokens: schema.number().step(1).min(256).max(16_384).default(4096),
  shakeThresholdChars: schema.number().step(1).min(1024).default(8192),
});
