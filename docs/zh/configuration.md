# 配置

插件配置属于 **Snapcompact preset 内隔离 compaction 组中的 dsh-snapcompact 行**，不是宿主全局第二个 compaction 服务。通过 DSH 的 preset/config 编辑能力管理，不手工改活动 profile 文件。

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
policy:
  auto: true
  thresholdRatio: 0.8
  retainRatio: 0.16
  # Smaller model windows need less headroom; native validation applies.
  headroomTokens: 65536
rendering:
  width: 1536
  height: 1024
  maxFrames: 12
  maxTotalBytes: 16777216
  maxSourceBytes: 67108864
  timeoutMs: 15000
minCompressionRatio: 2
archiveMaxBytes: 67108864
handoffMaxTokens: 4096
shakeThresholdChars: 8192
routePolicies: []
```

## 原生策略

`policy` 传入 `BasicCompactionEngine`。支持 thresholdRatio、headroomTokens、retainRatio/retainTokens（互斥）、summarizationProvider/summarizationModel（成对）、maxTokens、compactionRetries、maxOverflowRetries、auto、modelPolicies。空对象使用宿主原生默认。

不要为小窗口模型盲目沿用 65,536 token headroom。原生后端会按目标模型的容量、输出预留和尾部保留预算验证。

## 图片启用条件

必须同时满足：模型明确声明 image 输入；适配器有图片计价或存在精确路由上界；渲染和请求变体不缩小字形；帧/字节/像素符合附件预算；完整 checkpoint 预计达到至少 `minCompressionRatio` 倍压缩。

若适配器没有价格，只能在确认实际规则后显式设置保守上界，例如：

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # Example only, not a recommended price. Calibrate for the actual model and frame size.
```

provider/model 精确匹配，不做模糊别名、跨模型沿用或自动猜测。上界不代表真实 token；价格声明不会绕过 image 输入能力检查。尺寸改变后必须重新校准。

## 上限和失败行为

配置允许缩小但不能超过首版安全边界：12帧为默认、最多20帧，总图片最多16MiB，源与归档各最多64MiB，渲染最多15秒。还会受宿主实际限制以及当前保留图片数量约束。归档保存的是消息/转录 JSON，包含格式开销；源接近64MiB时可能因归档大小超限而拒绝。

方法链不能重复或为空，最后必须是 soft。图片失败、未知价格、无收益会回退；所有候选失败则保留原会话区间并返回原生压缩错误。取消不触发下一方法。

支持的 DSH 版本目前只声明 `0.2.2-rc.1`；升级应先运行类型、集成、包内容与实际挂载检查，不通过版本豁免强装。
