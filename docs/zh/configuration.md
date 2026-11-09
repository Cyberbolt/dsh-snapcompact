# 配置

插件配置属于 **Snapcompact preset 内隔离 compaction 组中的 dsh-snapcompact 行**，不是宿主全局第二个 compaction 服务。插件页的设置卡管理常用项，其余项用 preset/配置编辑器或下面的 YAML。两者都通过当前 profile 的配置补丁持久化，不要手工重写 profile 文件。

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
policy:
  auto: true
  thresholdRatio: 0.8
  retainRatio: 0.16
  # Smaller model windows need less headroom; native validation applies.
  headroomTokens: 65536
rendering:
  width: 2048
  height: 2048
  maxFrames: 20
  lineHeight: 20
  minGlyphPx: 12
  maxTotalBytes: 16777216
  maxSourceBytes: 67108864
  timeoutMs: 15000
serialization:
  toolResultMaxChars: 2000
  toolArgumentMaxChars: 500
  toolCallMaxChars: 2000
  messageTextMaxChars: 8000
  headChars: 2000
  tailChars: 2000
  includeReasoning: false
  maxCarriedImages: 4
minCompressionRatio: 2
archiveMaxBytes: 67108864
handoffMaxTokens: 4096
shakeThresholdChars: 8192
routePolicies: []
```

## 在应用内配置

**插件 → Snapcompact** 页面会为当前 profile 的 `snapcompact-settings` 行渲染设置卡。这一行与 preset 分开是有意的：DSH 只把 profile 平面里带 volatile 字段的入口投影到设置文档，而压缩插件本身必须留在可选 preset 内。该行把实时值作为 `snapcompactSettings` 服务发布，每个会话挂载 preset 时读取一次。

卡片管理 8 个键：

| 界面项         | 配置路径                                | 默认                                  |
| -------------- | --------------------------------------- | ------------------------------------- |
| 方法链         | `methodOrder`                           | `[snapcompact, handoff, shake, soft]` |
| 自定义触发阈值 | `policy.thresholdRatio`                 | 不设置（原生默认 0.8）                |
| 帧尺寸         | `rendering.width` 与 `rendering.height` | 2048                                  |
| 最多帧数       | `rendering.maxFrames`                   | 20                                    |
| 最小压缩比     | `minCompressionRatio`                   | 2                                     |
| 归档上限       | `archiveMaxBytes`                       | 64 MiB                                |
| 交接预算       | `handoffMaxTokens`                      | 4096                                  |
| 外置阈值       | `shakeThresholdChars`                   | 8192                                  |

持久化与优先级：

- 写入走 DSH 的设置服务，落到 profile 的配置补丁；重启后仍在，“恢复默认”（单字段或整卡）会移除覆盖。
- 卡片保存的值覆盖 preset YAML 里的同名键。`thresholdRatio` 是例外：未开启自定义阈值时该键不存在，所以 preset 里的 `policy.thresholdRatio` 仍然生效。
- 引擎在会话挂载 preset 时构造，因此改动对**新会话**生效；已有会话里 `/snapcompact status` 仍显示它启动时的配置。
- 设置 schema 无法表达方法链顺序，所以为空、重复或不以 `soft` 结尾的已存值会被插件忽略；严格解析器仍是最后一道校验。

bundle 还会在 profile 平面声明一行 UI 载体（`snapcompact-ui`，模块 `dsh-snapcompact`），配置是 `role: ui`。DSH 的浏览器模块扫描只读取「裸包名」Loader 行的 `dsh.client`，这一行就是让配置卡能被加载的入口；它不注册压缩、工具或命令。请保持启用：禁用后插件页不再显示设置卡（preset 本身仍然可用）。

8 个键之外的内容仍然只走 YAML：`policy` 的其余字段、`serialization`、`routePolicies`、`rendering.maxTotalBytes`、`rendering.maxSourceBytes`、`rendering.timeoutMs`、`rendering.lineHeight` 与 `rendering.minGlyphPx`。

## 原生策略

`policy` 传入 `BasicCompactionEngine`。支持 thresholdRatio、headroomTokens、retainRatio/retainTokens（互斥）、summarizationProvider/summarizationModel（成对）、maxTokens、compactionRetries、maxOverflowRetries、auto、modelPolicies。空对象使用宿主原生默认。

不要为小窗口模型盲目沿用 65,536 token headroom。原生后端会按目标模型的容量、输出预留和尾部保留预算验证。

## 方法链与回退顺序

`methodOrder` 是候选方法的优先级列表。引擎按顺序尝试，在**第一个成功的候选**处停止；顺序就是回退顺序，不是多阶段流水线。方法链必须非空、不重复，并以 `soft` 结尾。以下子集都合法：

| 预设             | `methodOrder`                         | 行为                                     |
| ---------------- | ------------------------------------- | ---------------------------------------- |
| 视觉优先（默认） | `[snapcompact, handoff, shake, soft]` | 先试本地视觉，再交接、摘录，最后原生摘要 |
| 视觉 + 原生      | `[snapcompact, soft]`                 | 跳过 handoff/shake；视觉失败直接原生摘要 |
| 本地优先         | `[snapcompact, shake, soft]`          | 两个本地路径都失败才调用原生摘要         |
| 文本优先         | `[handoff, shake, soft]`              | 先花一次模型调用生成结构化交接           |
| 仅原生摘要       | `[soft]`                              | 回到 DSH 原生摘要；归档与回查仍然可用    |

容易误解的语义：

- `shake` 只要存在超过 `shakeThresholdChars` 的工具输出就成功，放在 `snapcompact` 前面会抢先于视觉路径。
- `minCompressionRatio` 只约束 `snapcompact`；其它方法只要求 checkpoint 比源历史小。
- 归档在方法链之前创建，所以配置成 `[soft]` 仍然保留 `snapcompact_recall`。
- 取消会终止事务，不会触发下一方法。

## 触发阈值

自动压缩在测得的请求压力达到当前路由阈值时触发：

```text
threshold = floor(min(W × thresholdRatio, W − O − headroomTokens))
retain    = retainTokens ?? floor((W − O) × retainRatio)
```

`W` 是适配器声明的上下文窗口，`O` 是本次请求的输出预留，`headroomTokens` 是容量安全余量。`thresholdRatio` 是窗口比例，不是绝对 token 数；小窗口模型通常需要更低的阈值和更小的 headroom。`retainRatio`/`retainTokens` 必须小于阈值，否则原生后端会拒绝该路由。

`/snapcompact status` 会解析精确路由，打印当前 tokens、`W`、阈值 tokens、保留 tokens 以及是否已越过阈值。这个展示只是对上述公式的解释，实际触发仍由原生引擎决定。阈值是配置期设置（修改后需重载），且不会关闭宿主的上下文溢出恢复。没有绝对 token 数阈值；请使用 `thresholdRatio`，并用 `/snapcompact status` 查看换算后的 token 数。

## 图片启用条件

必须同时满足：模型明确声明 image 输入；适配器有图片计价、精确路由上界或带标签的 DeepSeek 估算；渲染和请求变体不缩小字形到可读阈值以下；帧/字节/像素符合附件预算；完整 checkpoint 预计达到至少 `minCompressionRatio` 倍压缩。

若适配器没有价格，插件会对 DeepSeek 模型使用 1024 token/帧的保守估算；其他模型只能在确认实际规则后显式设置上界，例如：

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # Example only, not a recommended price. Calibrate for the actual model and frame size.
```

provider/model 精确匹配，不做模糊别名或跨模型沿用。估算/上界不代表真实 token；价格声明不会绕过 image 输入能力检查。尺寸改变后必须重新校准。

## 上限和失败行为

配置允许缩小但不能超过首版安全边界：2048×2048 帧、默认最多20帧（宿主默认图片上限），总图片最多16MiB，源与归档各最多64MiB，渲染最多15秒。还会受宿主实际限制以及当前保留图片数量约束。归档保存的是消息/转录 JSON，包含格式开销；源接近64MiB时可能因归档大小超限而拒绝。

图片失败、未知价格、无收益会回退；所有候选失败则保留原会话区间并返回原生压缩错误。取消不触发下一方法。

支持的 DSH 版本目前只声明 `0.2.2-rc.1`；升级应先运行类型、集成、包内容与实际挂载检查，不通过版本豁免强装。
