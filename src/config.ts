import schema from '@deepseek-ai/schemastery';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
} from '@deepseek-ai/dsh-compaction-basic';
import { z } from 'zod';

export const methodNameSchema = z.enum(['snapcompact', 'handoff', 'shake', 'soft']);
export type MethodName = z.infer<typeof methodNameSchema>;

/** Single source of truth shared by the strict parser, the loader schema and chain presets. */
export const DEFAULT_METHOD_ORDER = Object.freeze([
  'snapcompact',
  'handoff',
  'shake',
  'soft',
] as const satisfies readonly MethodName[]);

/** Defaults shared by the strict runtime parser and the loader-facing schema. */
export const SERIALIZATION_DEFAULTS = Object.freeze({
  toolResultMaxChars: 2_000,
  toolArgumentMaxChars: 500,
  toolCallMaxChars: 2_000,
  messageTextMaxChars: 8_000,
  headChars: 2_000,
  tailChars: 2_000,
  includeReasoning: false,
  maxCarriedImages: 4,
});

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
    /**
     * How this row is hosted. `ui` marks the profile-plane carrier row that
     * makes the browser half discoverable; it renders the plugin page card and
     * must not register compaction, tools or commands.
     */
    role: z.enum(['plugin', 'ui']).default('plugin'),
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
      .default([...DEFAULT_METHOD_ORDER]),
    rendering: z
      .strictObject({
        width: z.number().int().min(256).max(2048).default(2048),
        height: z.number().int().min(256).max(2048).default(2048),
        maxFrames: z.number().int().min(1).max(20).default(20),
        lineHeight: z.number().int().min(16).max(32).default(20),
        minGlyphPx: z.number().int().min(8).max(16).default(12),
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
    serialization: z
      .strictObject({
        toolResultMaxChars: z
          .number()
          .int()
          .min(256)
          .max(64_000)
          .default(SERIALIZATION_DEFAULTS.toolResultMaxChars),
        toolArgumentMaxChars: z
          .number()
          .int()
          .min(64)
          .max(16_000)
          .default(SERIALIZATION_DEFAULTS.toolArgumentMaxChars),
        toolCallMaxChars: z
          .number()
          .int()
          .min(256)
          .max(64_000)
          .default(SERIALIZATION_DEFAULTS.toolCallMaxChars),
        messageTextMaxChars: z
          .number()
          .int()
          .min(512)
          .max(256_000)
          .default(SERIALIZATION_DEFAULTS.messageTextMaxChars),
        headChars: z.number().int().min(0).max(64_000).default(SERIALIZATION_DEFAULTS.headChars),
        tailChars: z.number().int().min(0).max(64_000).default(SERIALIZATION_DEFAULTS.tailChars),
        includeReasoning: z.boolean().default(SERIALIZATION_DEFAULTS.includeReasoning),
        maxCarriedImages: z
          .number()
          .int()
          .min(0)
          .max(8)
          .default(SERIALIZATION_DEFAULTS.maxCarriedImages),
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

const loaderMethodName = schema.union([
  schema.const('snapcompact'),
  schema.const('handoff'),
  schema.const('shake'),
  schema.const('soft'),
]);

/** Loader-facing form; the strict parser above supplies defaults and cross-field validation. */
export const Config: ReturnType<typeof schema.object> = schema.object({
  role: schema
    .union([schema.const('plugin'), schema.const('ui')])
    .default('plugin')
    .description(
      'plugin = 正常压缩插件；ui = profile 平面的 UI 载体行，只用于让插件页加载客户端配置卡，不注册压缩、工具或命令。',
    ),
  policy: BasicCompactionEngine.Config,
  methodOrder: schema
    .array(loaderMethodName)
    .min(1)
    .max(4)
    .default([...DEFAULT_METHOD_ORDER])
    .description(
      '按优先级排列的压缩方法：第一个成功的候选会被采用，因此顺序就是回退顺序；最后必须是 soft 兜底。可只列子集，例如 [snapcompact, soft] 或 [soft]。',
    ),
  rendering: schema.object({
    width: schema.number().step(1).min(256).max(2048).default(2048),
    height: schema.number().step(1).min(256).max(2048).default(2048),
    maxFrames: schema.number().step(1).min(1).max(20).default(20),
    lineHeight: schema.number().step(1).min(16).max(32).default(20),
    minGlyphPx: schema.number().step(1).min(8).max(16).default(12),
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
  serialization: schema.object({
    toolResultMaxChars: schema
      .number()
      .step(1)
      .min(256)
      .max(64_000)
      .default(SERIALIZATION_DEFAULTS.toolResultMaxChars),
    toolArgumentMaxChars: schema
      .number()
      .step(1)
      .min(64)
      .max(16_000)
      .default(SERIALIZATION_DEFAULTS.toolArgumentMaxChars),
    toolCallMaxChars: schema
      .number()
      .step(1)
      .min(256)
      .max(64_000)
      .default(SERIALIZATION_DEFAULTS.toolCallMaxChars),
    messageTextMaxChars: schema
      .number()
      .step(1)
      .min(512)
      .max(256_000)
      .default(SERIALIZATION_DEFAULTS.messageTextMaxChars),
    headChars: schema.number().step(1).min(0).max(64_000).default(SERIALIZATION_DEFAULTS.headChars),
    tailChars: schema.number().step(1).min(0).max(64_000).default(SERIALIZATION_DEFAULTS.tailChars),
    includeReasoning: schema.boolean().default(SERIALIZATION_DEFAULTS.includeReasoning),
    maxCarriedImages: schema
      .number()
      .step(1)
      .min(0)
      .max(8)
      .default(SERIALIZATION_DEFAULTS.maxCarriedImages),
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
