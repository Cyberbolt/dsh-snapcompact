# 配置

[English](configuration.md)

配置**所选 Snapcompact preset 的隔离 compaction group 内的 dsh-snapcompact row**，而不是第二个全局 compaction service。standard、PTC、Cordis 三个变体挂载同一个 row id 和配置键，所以同一组设置对任一变体生效。插件页的设置卡管理常用键；preset/config 编辑器和下面的 YAML 覆盖其余项。两者都通过活动 profile 的 configuration patch 持久化；不要手改 profile 文件。

手动压缩是 `/compact`；它解析到 preset 挂载的后端。`/snapcompact status` 是只读诊断，不是压缩入口。

```yaml
methodOrder: [snapcompact, shake, soft]
budget:
  # 一个 checkpoint 可花掉触发余量的比例；0.5 恢复旧规则。
  checkpointShare: 0.4
policy:
  auto: true
  thresholdRatio: 0.8
  retainRatio: 0.16
  headroomTokens: 65536
guard:
  # thresholdRatio - retainRatio 低于此值时拒绝挂载；0 关闭。
  minCompactableRatio: 0.1
  # 源历史低于 max(1024, window x this) 时跳过本次压缩；0 关闭。
  minSourceRatio: 0.01
rendering:
  width: 1568
  height: 1568
  maxFrames: 40
  lineHeight: 20
  letterSpacing: 2
  minGlyphPx: 12
  maxTotalBytes: 16777216
  maxSourceBytes: 67108864
  timeoutMs: 15000
serialization:
  toolResultMaxChars: 1200
  toolArgumentMaxChars: 500
  toolCallMaxChars: 2000
  messageTextMaxChars: 1500
  headChars: 2000
  tailChars: 2000
  includeReasoning: false
  maxCarriedImages: 4
shakeThresholdChars: 8192
routePolicies: []
```

## 应用内设置

**Plugins → Snapcompact** 页为当前 profile 的 `snapcompact-settings` row 渲染设置卡。该 row 刻意与 preset 分离：DSH 只把 profile 平面条目的 volatile Config 字段投影到 settings document，而 compaction 插件必须留在 opt-in preset 内。row 通过 `snapcompactSettings` service 发布实时值；每个会话的 preset 实例在挂载时读取，所以一个卡片配置所有 Snapcompact 变体。

| 控件             | 配置路径                               | 默认                                      |
| ---------------- | -------------------------------------- | ----------------------------------------- |
| 方法链           | `methodOrder`                          | `[snapcompact, shake, soft]`              |
| 自定义触发阈值   | `policy.thresholdRatio`                | 未设置（原生默认 0.8）                    |
| 保留尾部（隐藏） | `policy.retainRatio`（YAML only）      | 派生：`thresholdRatio ÷ 5`（0.8 时 0.16） |
| 帧尺寸           | `rendering.width` / `rendering.height` | 1568                                      |
| 最大帧数         | `rendering.maxFrames`                  | 40（最大 64；host cap 优先）              |
| 外置阈值         | `shakeThresholdChars`                  | 8192                                      |

持久化与优先级：

- 写入通过 DSH settings service 到 profile 的 configuration patch；重启后保留，"Restore default" 可逐字段或整卡移除。
- 保存的卡片值覆盖 preset YAML 的同名键。`thresholdRatio` 例外：自定义阈值启用前该键不存在，所以 preset 级 `policy.thresholdRatio` 仍生效。
- 保留尾部自动：`retainRatio = thresholdRatio ÷ 5`。卡片隐藏它，也从不写入。只有旧版本保存的值会显示为只读 "Custom" 行，可用 "Restore automatic" 取消。`retainRatio` 和 `retainTokens` 仍互斥：strict parser 拒绝同时设置的 YAML。
- 引擎在会话挂载 preset 时构造，所以改动对**新会话**生效；已有会话的 `/snapcompact status` 继续报告启动时配置。
- settings schema 无法表达链顺序，所以空、重复或不以 `soft` 结尾的已存链会被插件忽略；strict parser 是最终门槛。

bundle 还声明 profile 平面的 carrier row（`snapcompact-ui`，module `dsh-snapcompact`），config 为 `role: ui`。DSH 的浏览器模块扫描器只从裸包名 Loader 条目读取 `dsh.client`，所以该 row 只为让卡片可加载；它不注册 compaction、工具或命令。保持启用：禁用会从插件页移除设置卡（preset 仍工作）。

上述键之外都是 YAML-only：其余 `policy`、`guard`、`serialization`、`routePolicies`、`rendering.maxTotalBytes`、`rendering.maxSourceBytes`、`rendering.timeoutMs`、`rendering.lineHeight`、`rendering.letterSpacing` 和 `rendering.minGlyphPx`。

## 原生 policy

`policy` 由 `BasicCompactionEngine` 校验。支持 thresholdRatio、headroomTokens、retainRatio/retainTokens（互斥）、summarizationProvider/summarizationModel（成对）、maxTokens、compactionRetries、maxOverflowRetries、auto 和 modelPolicies。空对象使用原生默认。

不要把小窗口模型直接套上 65,536-token headroom。原生后端校验容量、输出预留和保留尾部预算。插件额外在挂载时校验 threshold 与 retain 的间隙（见[保留尾部与收益门槛](#保留尾部与收益门槛)）。

## 方法链与回退顺序

`methodOrder` 是候选方法的有序优先级列表。引擎依次尝试，在**第一个成功候选**停止；顺序是回退顺序，不是流水线阶段。链必须非空、不重复、以 `soft` 结尾。任何符合该形状的子集都合法：

| Preset               | `methodOrder`                | 行为                                 |
| -------------------- | ---------------------------- | ------------------------------------ |
| Visual-first（默认） | `[snapcompact, shake, soft]` | 本地视觉，然后摘录，最后原生摘要     |
| Visual + native      | `[snapcompact, soft]`        | 跳过 shake；视觉失败用原生摘要       |
| Native-only          | `[soft]`                     | 回到 DSH 原生摘要；无视觉 checkpoint |

`handoff` 方法移除前保存的链在读取时规范化：丢弃该名，保留其余顺序。手写 YAML 仍写 `handoff` 会被 strict parser 拒绝，删除该名即可。

容易忽略的语义：

- 任何工具输出超过 `shakeThresholdChars` 时 `shake` 成功；放在 `snapcompact` 前会抢占视觉路径。
- checkpoint 预算（触发余量的配置份额）只约束 `snapcompact`；其他方法只需产生比源更小的 checkpoint。
- 取消会中止事务；绝不落到下一个方法。
- 0.7.0 没有归档，也没有 recall 工具。`[soft]` 链不会保留隐藏搜索路径。

## 触发阈值

自动压缩在测量到的请求压力达到路由模型阈值时开始：

```text
threshold   = floor(min(W × thresholdRatio, W − O − headroomTokens))
retainRatio = thresholdRatio ÷ 5                 # 未显式设置时
retain      = retainTokens ?? floor((W − O) × retainRatio)
```

`W` 是 adapter 声明的 context window，`O` 是有效输出预留，`headroomTokens` 是容量安全余量。`thresholdRatio` 是窗口比例，不是绝对 token 数；小窗口模型通常需要更低比例和更小 headroom。`retainRatio`/`retainTokens` 必须低于 threshold，否则原生后端拒绝该路由。

派生尾部跟随触发比例，而不是有效 token 数：headroom 压低 threshold 时，`retain` 仍按 `thresholdRatio` 缩放，所以其 token 占比可能超过 1/5。`/snapcompact status` 打印当前路由的解析尾部。

`/snapcompact status` 解析确切路由，打印当前 tokens、`W`、threshold tokens、retained tokens、两者之间的可压空间、guard 下限以及压力是否越线。该显示只是解释公式；原生引擎仍是权威。阈值是配置时设置（需 reload），且绝不关闭 host 的 overflow recovery。

### 保留尾部与收益门槛

触发阈值只有相对保留尾部才有意义：

```text
compactable = threshold - retain
```

因为尾部派生为 `thresholdRatio ÷ 5`，自动卡片路径总留下 `4/5 × thresholdRatio` 可压（0.5 卡片下限时至少 0.4），所以不会触发 0.1 guard。显式保留才可能踩旧陷阱：1M 窗口、`thresholdRatio: 0.2`、`retainRatio: 0.16` 只留下约 4% 窗口；checkpoint 加保留文本很容易超过。

`guard` 补充检查：

| Key                   | 默认   | 含义                                                                     |
| --------------------- | ------ | ------------------------------------------------------------------------ |
| `minCompactableRatio` | `0.1`  | `thresholdRatio - retainRatio` 低于此值时拒绝挂载。`0` 关闭。            |
| `minSourceRatio`      | `0.01` | 源历史低于 `max(1024, window × ratio)` tokens 时跳过本次压缩。`0` 关闭。 |

挂载检查在引擎构造函数、原生默认解析后运行，覆盖全局 policy 和每个精确 `modelPolicies` 条目。错误列出每个不可行 scope 的实际比例和修复方法。绝对 `retainTokens` 形式依赖窗口，所以不在挂载时拒绝；`/snapcompact status` 打印真实可压空间，并在低于 `max(1024, window × minCompactableRatio)` 时警告。

源下限在源历史测量后、任何方法前运行：太小的源立即失败，不调用模型。手动 `/compact` 同样受 guard 约束；降低 `guard.minSourceRatio` 允许小手动运行。

### Checkpoint 预算

`snapcompact` 最多花掉 threshold 下余量的 `budget.checkpointShare`（0.25–0.5，默认 0.4）：

```text
fixed  = max(0, surface - source)
room   = threshold - fixed
budget = floor(min(room, source) × checkpointShare)   # 无窗口：floor(source × share)
```

`surface` 是压缩前整个请求压力，`source` 是 checkpoint 替换的历史；两者来自原生引擎提交后重新测量的 token meter。checkpoint 无法替换的一切——system prompt、tool schema、输出预留、保留尾部——留在 `fixed`。

留下 `1 - share` 的余量意味着压缩后总量以真实 margin 低于 threshold。历史规则是 0.5；0.4 给 checkpoint 和下一个回答留更多空间。自动压力触发时 `room ≈ source`，所以阈值基准等于 `source × share`；只会因会话超过触发点而收紧。手动 `/compact` 低于阈值时也正确。无声明窗口或模型查找失败时回退 `source × share`；`room ≤ 0` 跳过视觉路径。

预算每次压缩从实时路由重算，所以跟随 `thresholdRatio`、`headroomTokens` 和 per-model override，无需另一个设置。设 `budget.checkpointShare: 0.5` 恢复旧行为。旧 row 可能仍有 `minCompressionRatio`；为升级兼容接受并忽略。

## 序列化

checkpoint 是面向帧的投影，不是逐字节 transcript：

| Key                    | 默认  | 含义                                                |
| ---------------------- | ----- | --------------------------------------------------- |
| `messageTextMaxChars`  | 1500  | 单个 user/assistant 文本块的头尾上限。              |
| `toolResultMaxChars`   | 1200  | 单个工具结果的头尾上限。                            |
| `toolArgumentMaxChars` | 500   | 单个工具调用参数值的上限。                          |
| `toolCallMaxChars`     | 2000  | 单个工具调用参数列表的总上限。                      |
| `headChars`            | 2000  | 帧外保留的精确头部文本。                            |
| `tailChars`            | 2000  | 帧外保留的精确尾部文本。                            |
| `includeReasoning`     | false | 把 assistant reasoning 序列化为 `»think:` section。 |
| `maxCarriedImages`     | 4     | 带入 checkpoint 的已有图片。                        |

在 cap 之外，序列化器：

- 把工具调用与结果合并到一个 `»call:` section；
- 丢弃常规 `INFO`/`PASS`/stack frame/文件列表/metric/paragraph 行，并用一个 `routine log lines elided` 标记计数；
- 把结构相同的长行段折叠为前两行和后两行；
- 给通用 exact-token 行加 `* ` 前缀；
- 构建最多 80 行带标签文本的去重 exact-token 索引。

过滤器是通用的：不知道 benchmark 或问题。埋在常规 `INFO` 行里的唯一精确串可能被丢弃；错误和带标签事实保留。

## 渲染

| Key              | 默认   | 含义                                                  |
| ---------------- | ------ | ----------------------------------------------------- |
| `width`/`height` | 1568   | 帧边缘像素。host 图片策略和 max-edge 可能降低它。     |
| `maxFrames`      | 40     | 帧数上限；host per-message image cap 仍会 clamp。     |
| `lineHeight`     | 20     | 位图基线间距。                                        |
| `letterSpacing`  | 2      | 每个 glyph 的额外水平像素；更宽 tracking 有助于 OCR。 |
| `minGlyphPx`     | 12     | 请求会把 glyph 降采样到低于此值时跳过视觉路径。       |
| `maxTotalBytes`  | 16 MiB | 每个 checkpoint 生成的 PNG 字节。                     |
| `maxSourceBytes` | 64 MiB | 序列化源字节上限。                                    |
| `timeoutMs`      | 15000  | 渲染 deadline，含排队和冷启动。                       |

帧是一比特灰度 PNG。bundled Unifont 覆盖拉丁、CJK、假名、谚文和常见符号。布局是连续流；`¶` 标记一个源换行。中段超出帧预算时，保留时间轴两端，丢弃最旧的密集中心。

## 视觉资格

路由必须显式声明图片输入，并提供图片计价、配置上限或带标签的模型族估算。保存/请求图片必须保持可读位图尺寸；否则跳过视觉方法。帧、字节和像素必须符合 host 策略，完整 checkpoint 必须符合触发相关预算。

adapter 无计价时，已识别模型族使用带标签的保守每帧估算（DeepSeek 1024、Gemini 1120、Claude/GPT/Kimi/GLM 1568）。未知模型 fail closed 到文本链。其他模型可用显式保守路由上限：

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # 仅示例，不是推荐价格。按实际模型和帧尺寸校准。
```

Provider/model 精确匹配，无 alias、模糊匹配或跨模型复用。上限不是实际 usage，也不能授予缺失的 image modality。改尺寸后重新校准。

## 边界与失败

默认 1568×1568 帧、每个 checkpoint 40 帧（最大 64）、16 MiB 生成图片、64 MiB 序列化源、15 秒渲染 deadline。帧数在触发相关 checkpoint 预算下动态选择；host 更小限制和 retained-image 数量也适用。

未知计价、视觉失败或节省不足会选择另一个方法。所有候选失败时，原生失败日志保留所选历史。取消绝不落到下一个方法。threshold/retention 低于可压下限会拒绝挂载；源低于收益下限会在任何方法前失败。

Snapcompact 声明 `^0.2.2-rc.1`（0.2.x），在 `0.2.2-rc.1` 验证。只在该 host release 上完成安装和激活检查后再提高下限，并保持有限上限。不要绕过 host 检查。
