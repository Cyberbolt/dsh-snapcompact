import schema from '@deepseek-ai/schemastery';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
} from '@deepseek-ai/dsh-compaction-basic';
import { z } from 'zod';
import { withDerivedRetention } from './compaction/retention.js';

export const methodNameSchema = z.enum(['snapcompact', 'shake', 'soft']);
export type MethodName = z.infer<typeof methodNameSchema>;

/**
 * Method names that may appear in durable records written by older releases.
 *
 * The runtime never produces `handoff` again, but checkpoints already committed
 * to a session log still carry `method=handoff` in their header. Parsing those
 * records with the strict schema would drop their archives from recall, so the
 * projection uses this superset instead. It must never be used for configuration.
 */
export const recordedMethodNameSchema = z.enum(['snapcompact', 'handoff', 'shake', 'soft']);

/** Single source of truth shared by the strict parser, the loader schema and chain presets. */
export const DEFAULT_METHOD_ORDER = Object.freeze([
  'snapcompact',
  'shake',
  'soft',
] as const satisfies readonly MethodName[]);

/**
 * Defaults for the usefulness guards.
 *
 * `minCompactableRatio` rejects a threshold/retention pair at mount time when
 * the window fraction left for a checkpoint is too small to pay for itself.
 * `minSourceRatio` skips a single compaction whose source history is below a
 * fraction of the window. Setting either to zero disables that guard.
 */
export const GUARD_DEFAULTS = Object.freeze({
  minCompactableRatio: 0.1,
  minSourceRatio: 0.01,
});

/**
 * Checkpoint budget defaults.
 *
 * `checkpointShare` is the fraction of the room left under the trigger (or of
 * the source when no window is declared) that one checkpoint may spend. The
 * historical rule was one half; a smaller share leaves more headroom, which
 * matters because a checkpoint, its recall pages and the next answer all share
 * the same window.
 */
export const BUDGET_DEFAULTS = Object.freeze({
  checkpointShare: 0.4,
});

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
        width: z.number().int().min(256).max(2048).default(1568),
        height: z.number().int().min(256).max(2048).default(1568),
        maxFrames: z.number().int().min(1).max(64).default(20),
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
    budget: z
      .strictObject({
        /** Fraction of the trigger room one checkpoint may spend (0.25–0.5). */
        checkpointShare: z.number().gte(0.25).lte(0.5).default(BUDGET_DEFAULTS.checkpointShare),
      })
      .prefault({}),
    guard: z
      .strictObject({
        minCompactableRatio: z.number().gte(0).lt(1).default(GUARD_DEFAULTS.minCompactableRatio),
        minSourceRatio: z.number().gte(0).lt(1).default(GUARD_DEFAULTS.minSourceRatio),
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
    /** Deprecated: accepted so older rows keep loading, but the checkpoint budget is trigger-relative now. */
    minCompressionRatio: z.number().min(1.1).optional(),
    archiveMaxBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024)
      .default(64 * 1024 * 1024),
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
    // Mirror the native backend's retention exclusivity earlier and with a
    // field path, so the loader rejects the conflict before any service mounts.
    const rejectRetentionConflict = (
      policy: { retainRatio?: number | undefined; retainTokens?: number | undefined },
      path: readonly (string | number)[],
    ): void => {
      if (policy.retainRatio !== undefined && policy.retainTokens !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'retainTokens'],
          message: 'retainRatio and retainTokens are mutually exclusive.',
        });
      }
    };
    rejectRetentionConflict(config.policy, ['policy']);
    config.policy.modelPolicies?.forEach((policy, index) => {
      rejectRetentionConflict(policy, ['policy', 'modelPolicies', index]);
    });
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

/**
 * Convert validated optional values to the native API's exact-optional object
 * contract. The retained tail is derived here (1/5 of the trigger ratio) so the
 * native tail selection, the plugin's budget math and status output all read
 * the same resolved policy. An explicit retention in a scope is never replaced.
 */
export function toNativePolicy(input: SnapcompactConfig['policy']): BasicCompactionConfig {
  const policy = withDerivedRetention(input);
  const result: BasicCompactionConfig = copyPolicyFields(policy);
  if (policy.auto !== undefined) result.auto = policy.auto;
  if (policy.modelPolicies !== undefined) {
    result.modelPolicies = policy.modelPolicies.map((route) => ({
      ...copyPolicyFields(route),
      provider: route.provider,
      model: route.model,
    }));
  }
  return result;
}

const loaderMethodName = schema.union([
  schema.const('snapcompact'),
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
    .max(3)
    .default([...DEFAULT_METHOD_ORDER])
    .description(
      '按优先级排列的压缩方法：第一个成功的候选会被采用，因此顺序就是回退顺序；最后必须是 soft 兜底。可只列子集，例如 [snapcompact, soft] 或 [soft]。',
    ),
  rendering: schema.object({
    width: schema.number().step(1).min(256).max(2048).default(1568),
    height: schema.number().step(1).min(256).max(2048).default(1568),
    maxFrames: schema.number().step(1).min(1).max(64).default(20),
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
  budget: schema.object({
    checkpointShare: schema
      .number()
      .step(0.05)
      .min(0.25)
      .max(0.5)
      .default(BUDGET_DEFAULTS.checkpointShare)
      .description(
        '单个 checkpoint 可花掉触发余量的比例（0.25–0.5，默认 0.4）。调低会给压缩后的会话留更多余量，但可能减少帧数/可读性；历史行为是 0.5。',
      ),
  }),
  guard: schema.object({
    minCompactableRatio: schema
      .number()
      .step(0.01)
      .min(0)
      .max(0.99)
      .default(GUARD_DEFAULTS.minCompactableRatio)
      .description(
        '挂载期校验：thresholdRatio 减去保留尾部比例后，若低于该值则拒绝启动；0 关闭该校验。',
      ),
    minSourceRatio: schema
      .number()
      .step(0.01)
      .min(0)
      .max(0.99)
      .default(GUARD_DEFAULTS.minSourceRatio)
      .description(
        '单次压缩的收益门槛：源历史低于 max(1024, 上下文窗口 × 该比例) 时跳过压缩；0 关闭。',
      ),
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
  archiveMaxBytes: schema
    .number()
    .step(1)
    .min(1)
    .max(64 * 1024 * 1024)
    .default(64 * 1024 * 1024),
  shakeThresholdChars: schema.number().step(1).min(1024).default(8192),
});
