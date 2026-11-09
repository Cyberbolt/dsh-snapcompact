import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ResolvedConfig } from '@deepseek-ai/dsh-compaction-basic';
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { resolveImageRoute } from '../../budgeting/capabilities.js';
import type { ImageRoute } from '../../budgeting/capabilities.js';
import { describeChain } from '../../compaction/chain.js';
import { countExternalizableOutputs } from '../../compaction/methods/shake.js';
import type { MethodName, SnapcompactConfig } from '../../config.js';
import type { ArchiveIndex } from './archive-projection.js';

/** Policy view merged exactly like the native backend before capacity scaling. */
export interface DisplayPolicy {
  readonly thresholdRatio: number;
  readonly headroomTokens: number;
  readonly retainRatio?: number;
  readonly retainTokens?: number;
}

export type PressureBudget =
  | {
      readonly kind: 'ok';
      readonly thresholdTokens: number;
      readonly retainTokens: number;
      readonly retainTooLarge: boolean;
      readonly messageBudgetTokens: number;
    }
  | { readonly kind: 'error'; readonly reason: string };

const TOKEN_FORMAT = new Intl.NumberFormat('en-US');

/** Avoid locale-dependent separators in command output and tests. */
export function formatTokens(value: number): string {
  return TOKEN_FORMAT.format(value);
}

function share(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** Exact-target override first, then global defaults; retention fields stay mutually exclusive. */
export function resolveDisplayPolicy(
  config: ResolvedConfig,
  provider: string,
  model: string,
): DisplayPolicy {
  const override = config.modelPolicies.find(
    (policy) => policy.provider === provider && policy.model === model,
  );
  const thresholdRatio = override?.thresholdRatio ?? config.thresholdRatio;
  const headroomTokens = override?.headroomTokens ?? config.headroomTokens;
  if (override?.retainTokens !== undefined) {
    return { thresholdRatio, headroomTokens, retainTokens: override.retainTokens };
  }
  if (override?.retainRatio !== undefined) {
    return { thresholdRatio, headroomTokens, retainRatio: override.retainRatio };
  }
  if (config.retainTokens !== undefined) {
    return { thresholdRatio, headroomTokens, retainTokens: config.retainTokens };
  }
  return { thresholdRatio, headroomTokens, retainRatio: config.retainRatio };
}

/**
 * Display-only mirror of the pinned backend's trigger formula:
 * `floor(min(W × ratio, W − O − headroom))`, with the retained tail below it.
 * The native engine remains the sole authority; this never gates a compaction.
 */
export function resolvePressureBudget(
  policy: DisplayPolicy,
  contextWindow: number,
  reservedCompletionTokens: number,
): PressureBudget {
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
    return { kind: 'error', reason: `模型声明了无效的上下文窗口（${contextWindow}）` };
  }
  if (!Number.isInteger(reservedCompletionTokens) || reservedCompletionTokens < 0) {
    return { kind: 'error', reason: `输出预留不是有效的非负整数（${reservedCompletionTokens}）` };
  }
  const messageBudgetTokens = contextWindow - reservedCompletionTokens;
  if (messageBudgetTokens <= 0) {
    return {
      kind: 'error',
      reason: `窗口 ${formatTokens(contextWindow)} 扣除输出预留 ${formatTokens(reservedCompletionTokens)} 后没有剩余消息预算`,
    };
  }
  const pressureBudgetTokens = messageBudgetTokens - policy.headroomTokens;
  if (pressureBudgetTokens <= 0) {
    return {
      kind: 'error',
      reason:
        `窗口 ${formatTokens(contextWindow)} 扣除输出预留 ${formatTokens(reservedCompletionTokens)} ` +
        `与 headroom ${formatTokens(policy.headroomTokens)} 后没有触发预算；` +
        '请降低 headroomTokens 或换用更大窗口的模型',
    };
  }
  const thresholdTokens = Math.floor(
    Math.min(contextWindow * policy.thresholdRatio, pressureBudgetTokens),
  );
  const retainTokens =
    policy.retainTokens ?? Math.floor(messageBudgetTokens * (policy.retainRatio ?? 0));
  return {
    kind: 'ok',
    thresholdTokens,
    retainTokens,
    retainTooLarge: retainTokens >= thresholdTokens,
    messageBudgetTokens,
  };
}

function pricingLabel(imageRoute: ImageRoute): string {
  switch (imageRoute.pricingSource) {
    case 'adapter':
      return '适配器声明计价';
    case 'configured-ceiling':
      return '配置上限，非账单';
    case 'deepseek-estimate':
      return 'DeepSeek 保守估算 1024 token/帧，非账单';
  }
}

function methodDetails(
  settings: SnapcompactConfig,
  imageRoute: ImageRoute | null,
  freeSlots: number,
  retainedImages: number,
  shakeCount: number,
): Record<MethodName, string> {
  const maxNewFrames = Math.min(settings.rendering.maxFrames, freeSlots);
  return {
    snapcompact:
      imageRoute === null
        ? '会跳过；当前路由没有声明视觉能力或图片计价'
        : freeSlots < 1
          ? `可能跳过；当前可见历史已有 ${retainedImages} 张图片，空余槽位可能不足`
          : `会尝试；本地渲染，不调用模型（最多 ${maxNewFrames} 帧）`,
    handoff: '会尝试；1 次模型调用，需通过结构校验',
    shake:
      shakeCount > 0
        ? `可能尝试；当前可见历史有 ${shakeCount} 个超大工具输出`
        : `会跳过；当前可见历史没有超过 ${formatTokens(settings.shakeThresholdChars)} 字符的工具输出`,
    soft: '兜底；1 次原生摘要调用',
  };
}

/** Read-only explanation of the configured chain, the effective trigger and the current route. */
export async function formatStatus(
  ctx: Context,
  settings: SnapcompactConfig,
  config: ResolvedConfig,
  index: ArchiveIndex,
  agent: Agent,
  signal: AbortSignal,
): Promise<string> {
  const session = agent.session;
  const header = session.requestHeader();
  const route = header?.config ?? agent.options;
  const provider = route.provider ?? '';
  const model = route.model ?? '';
  const lines: string[] = [
    `方法链：${settings.methodOrder.join(' → ')}`,
    `链预设：${describeChain(settings.methodOrder).label}`,
    `自动压缩：${config.auto ? '开启' : '关闭；可用 /compact 手动触发'}`,
    `路由：${provider || '未选择'}/${model || '未选择'}`,
  ];

  if (!provider || !model) {
    lines.push('上下文：无法计算（未选择路由）');
    lines.push('方法可用性：无法解析（未选择路由）');
    lines.push(`已完成归档：${index.entries(session).length}`);
    lines.push('提示：精确字符串请用 snapcompact_recall 回查原文。');
    return lines.join('\n');
  }

  signal.throwIfAborted();
  let info: LlmResolvedModelInfo | undefined;
  try {
    info = await ctx.llm.resolveModelInfo(provider, model, signal);
  } catch {
    info = undefined;
  }
  signal.throwIfAborted();

  const contextWindow = info?.context?.contextWindow;
  const reservedCompletionTokens = header?.config.maxTokens ?? info?.defaultMaxTokens ?? 0;
  const measurement =
    header === undefined
      ? ctx.tokenMeter.measure(session)
      : ctx.tokenMeter.measure(session, header);
  const currentTokens = measurement.totalTokens;

  if (contextWindow === undefined || contextWindow <= 0) {
    lines.push(
      `上下文：${formatTokens(currentTokens)} tokens；该路由未声明上下文窗口，无法计算触发阈值`,
    );
  } else {
    lines.push(
      `上下文：${formatTokens(currentTokens)} / ${formatTokens(contextWindow)} tokens（${share(currentTokens, contextWindow)}）`,
    );
    const policy = resolveDisplayPolicy(config, provider, model);
    const budget = resolvePressureBudget(policy, contextWindow, reservedCompletionTokens);
    if (budget.kind === 'error') {
      lines.push(`触发阈值：无法计算（${budget.reason}）`);
    } else {
      const configuredPercent = Math.round(policy.thresholdRatio * 100);
      const effectivePercent = Math.round((budget.thresholdTokens / contextWindow) * 100);
      const capNote =
        effectivePercent < configuredPercent - 1
          ? `配置 ${configuredPercent}%；受输出预留/headroom 限制后占窗口 ${effectivePercent}%`
          : `配置 ${configuredPercent}%`;
      lines.push(`触发阈值：${formatTokens(budget.thresholdTokens)} tokens（${capNote}）`);
      lines.push(`保留尾部：${formatTokens(budget.retainTokens)} tokens`);
      const crossed = currentTokens >= budget.thresholdTokens;
      if (!config.auto) {
        lines.push(`状态：${crossed ? '已越过阈值' : '未越过阈值'}；自动压缩已关闭`);
      } else {
        lines.push(
          crossed
            ? '状态：已越过阈值，下一次自动压缩会触发。'
            : `状态：距阈值还差 ${formatTokens(budget.thresholdTokens - currentTokens)} tokens。`,
        );
      }
      if (budget.retainTooLarge) {
        lines.push('警告：保留尾部不小于触发阈值，原生会拒绝该路由的自动压缩。');
      }
    }
  }

  signal.throwIfAborted();
  let imageRoute: ImageRoute | null = null;
  try {
    imageRoute = await resolveImageRoute(
      ctx.llm,
      { provider, model },
      settings.routePolicies,
      signal,
    );
  } catch {
    imageRoute = null;
  }
  signal.throwIfAborted();

  const visible = session.deriveMessages();
  const retainedImages = visible.reduce(
    (total, message) =>
      total + message.content.filter((block) => block.type === 'image' && !block.offloaded).length,
    0,
  );
  const freeSlots = Math.max(0, ctx.attachments.imageLimits.maxImagesPerMessage - retainedImages);
  const shakeCount = countExternalizableOutputs(visible, settings.shakeThresholdChars);
  const details = methodDetails(settings, imageRoute, freeSlots, retainedImages, shakeCount);
  lines.push('方法可用性（按顺序尝试，第一个成功即停止）：');
  settings.methodOrder.forEach((name, position) => {
    lines.push(`  ${position + 1}. ${name}：${details[name]}`);
  });
  lines.push(
    imageRoute === null
      ? '图片路径：使用文本回退（图片能力或计价未明确）'
      : `图片路径：可尝试（${pricingLabel(imageRoute)}；仍需收益/预算校验）`,
  );
  lines.push(
    `渲染：${settings.rendering.width}×${settings.rendering.height}，最多 ${settings.rendering.maxFrames} 帧；` +
      `压缩比 ≥ ${settings.minCompressionRatio}×；最小字高 ${settings.rendering.minGlyphPx}px`,
  );
  lines.push(`已完成归档：${index.entries(session).length}`);
  lines.push('提示：阈值和节省量都是估算，不是计费测量；精确字符串请用 snapcompact_recall 回查。');
  return lines.join('\n');
}
