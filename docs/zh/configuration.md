# 配置

插件配置属于**所选 Snapcompact preset 内隔离 compaction 组中的 dsh-snapcompact 行**，不是宿主全局第二个 compaction 服务。standard、PTC、Cordis 三个变体挂载相同的行 id 与配置键，因此会话选中哪个变体都使用同一份设置。插件页的设置卡管理常用项，其余项用 preset/配置编辑器或下面的 YAML。两者都通过当前 profile 的配置补丁持久化，不要手工重写 profile 文件。

手动压缩统一用 `/compact`，它解析到 preset 挂载的后端；`/snapcompact status` 只是只读诊断，不是压缩入口。

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
policy:
  auto: true
  thresholdRatio: 0.8
  retainRatio: 0.16
  # Smaller model windows need less headroom; native validation applies.
  headroomTokens: 65536
guard:
  # thresholdRatio − retainRatio 低于该值时拒绝挂载；0 关闭。
  minCompactableRatio: 0.1
  # 源历史低于 max(1024, 窗口 × 该比例) 时跳过本次压缩；0 关闭。
  minSourceRatio: 0.01
rendering:
  width: 1568
  height: 1568
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
archiveMaxBytes: 67108864
handoffMaxTokens: 4096
shakeThresholdChars: 8192
routePolicies: []
```

## 在应用内配置

**插件 → Snapcompact** 页面会为当前 profile 的 `snapcompact-settings` 行渲染设置卡。这一行与 preset 分开是有意的：DSH 只把 profile 平面里带 volatile 字段的入口投影到设置文档，而压缩插件本身必须留在可选 preset 内。该行把实时值作为 `snapcompactSettings` 服务发布，每个会话挂载 preset 时读取一次，因此一张卡配置所有 Snapcompact 变体。

卡片管理 9 个键：

| 界面项         | 配置路径                                | 默认                                  |
| -------------- | --------------------------------------- | ------------------------------------- |
| 方法链         | `methodOrder`                           | `[snapcompact, handoff, shake, soft]` |
| 自定义触发阈值 | `policy.thresholdRatio`                 | 不设置（原生默认 0.8）                |
| 保留尾部       | `policy.retainRatio` 或 `retainTokens`  | 不设置（原生默认 0.16）               |
| 帧尺寸         | `rendering.width` 与 `rendering.height` | 1568                                  |
| 最多帧数       | `rendering.maxFrames`                   | 20（上限 64）                         |
| 归档上限       | `archiveMaxBytes`                       | 64 MiB                                |
| 交接预算       | `handoffMaxTokens`                      | 4096                                  |
| 外置阈值       | `shakeThresholdChars`                   | 8192                                  |

持久化与优先级：

- 写入走 DSH 的设置服务，落到 profile 的配置补丁；重启后仍在，“恢复默认”（单字段或整卡）会移除覆盖。
- 卡片保存的值覆盖 preset YAML 里的同名键。`thresholdRatio` 是例外：未开启自定义阈值时该键不存在，所以 preset 里的 `policy.thresholdRatio` 仍然生效。
- 保留尾部只有一个三态控件（继承 0.16 / 按比例 / 按绝对 tokens）。`retainRatio` 与 `retainTokens` 互斥：保存其中一种会从合并结果里移除另一种，手写 YAML 同时给出两者会被严格解析器拒绝。
- 引擎在会话挂载 preset 时构造，因此改动对**新会话**生效；已有会话里 `/snapcompact status` 仍显示它启动时的配置。
- 设置 schema 无法表达方法链顺序，所以为空、重复或不以 `soft` 结尾的已存值会被插件忽略；严格解析器仍是最后一道校验。

bundle 还会在 profile 平面声明一行 UI 载体（`snapcompact-ui`，模块 `dsh-snapcompact`），配置是 `role: ui`。DSH 的浏览器模块扫描只读取「裸包名」Loader 行的 `dsh.client`，这一行就是让配置卡能被加载的入口；它不注册压缩、工具或命令。请保持启用：禁用后插件页不再显示设置卡（preset 本身仍然可用）。

9 个键之外的内容仍然只走 YAML：`policy` 的其余字段、`guard`、`serialization`、`routePolicies`、`rendering.maxTotalBytes`、`rendering.maxSourceBytes`、`rendering.timeoutMs`、`rendering.lineHeight` 与 `rendering.minGlyphPx`。

## 原生策略

`policy` 传入 `BasicCompactionEngine`。支持 thresholdRatio、headroomTokens、retainRatio/retainTokens（互斥）、summarizationProvider/summarizationModel（成对）、maxTokens、compactionRetries、maxOverflowRetries、auto、modelPolicies。空对象使用宿主原生默认。

不要为小窗口模型盲目沿用 65,536 token headroom。原生后端会按目标模型的容量、输出预留和尾部保留预算验证。插件还会在挂载时额外校验阈值与保留尾部之间的差值（见[保留尾部与收益守卫](#保留尾部与收益守卫)）。

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
- checkpoint 预算（触发阈值下剩余空间的一半）只约束 `snapcompact`；其它方法只要求 checkpoint 比源历史小。
- 归档在方法链之前创建，所以配置成 `[soft]` 仍然保留 `snapcompact_recall`。
- 取消会终止事务，不会触发下一方法。

## 触发阈值

自动压缩在测得的请求压力达到当前路由阈值时触发：

```text
threshold = floor(min(W × thresholdRatio, W − O − headroomTokens))
retain    = retainTokens ?? floor((W − O) × retainRatio)
```

`W` 是适配器声明的上下文窗口，`O` 是本次请求的输出预留，`headroomTokens` 是容量安全余量。`thresholdRatio` 是窗口比例，不是绝对 token 数；小窗口模型通常需要更低的阈值和更小的 headroom。`retainRatio`/`retainTokens` 必须小于阈值，否则原生后端会拒绝该路由。

`/snapcompact status` 会解析精确路由，打印当前 tokens、`W`、阈值 tokens、保留 tokens、两者之间的可压空间、守卫下限以及是否已越过阈值。这个展示只是对上述公式的解释，实际触发仍由原生引擎决定。阈值是配置期设置（修改后需重载），且不会关闭宿主的上下文溢出恢复。没有绝对 token 数阈值；请使用 `thresholdRatio`，并用 `/snapcompact status` 查看换算后的 token 数。

### 保留尾部与收益守卫

触发阈值只有和保留尾部放在一起才有意义：

```text
可压空间 = 触发阈值 − 保留尾部
```

在 1M 窗口下，原生 `retainRatio: 0.16` 会预留约 158,720 token，因此 `thresholdRatio: 0.2` 只剩约 4% 的窗口（约 41K token）。checkpoint 加上保留文本很容易超过这个空间——这就是“占用 20%”在完整压缩后四舍五入成“19%”的原因。原生后端只拒绝 `retainRatio >= thresholdRatio`，无法判断这个差值是否小到不值得压缩。

`guard` 补上了这项检查：

| 键                    | 默认   | 含义                                                                         |
| --------------------- | ------ | ---------------------------------------------------------------------------- |
| `minCompactableRatio` | `0.1`  | `thresholdRatio - retainRatio` 低于该值时拒绝挂载；`0` 关闭该校验。          |
| `minSourceRatio`      | `0.01` | 单次压缩的源历史低于 `max(1024, 窗口 × 比例)` token 时跳过；`0` 关闭该检查。 |

挂载校验在引擎构造函数里、原生默认值解析之后运行，因此同时覆盖全局 policy 和每个精确 `modelPolicies` 条目（沿用同一套继承规则）；错误会列出所有不可行的 scope、实际比例和修复方法。绝对 `retainTokens` 形式依赖具体窗口，不在挂载期判定；`/snapcompact status` 会打印真实可压空间，并在低于 `max(1024, 窗口 × minCompactableRatio)` 时警告。

收益门槛在测量完源历史之后、创建归档和调用任何方法之前运行：源太小会立即失败，不产生模型调用。手动 `/compact` 同样受该守卫约束；需要小规模手动压缩时调低 `guard.minSourceRatio`。

因此，升级后同时带有 `thresholdRatio: 0.2` 和默认尾部的 profile 会在挂载时失败。修复方式：提高触发阈值（卡片下限为 `0.5`，宿主默认为 `0.8`）、降低尾部（`retainRatio: 0.03` 在 1M 窗口下约 30K），或显式设置 `guard.minCompactableRatio: 0`。

### checkpoint 预算

`snapcompact` 最多可以用掉阈值下剩余空间的一半：

```text
fixed  = max(0, surface - source)
room   = threshold - fixed
budget = floor(min(room, source) / 2)    # 路由未声明窗口时：floor(source / 2)
```

`surface` 是压缩前的整段请求压力，`source` 是 checkpoint 要替换的历史；两者都来自原生引擎提交后会重新测量的那个 token meter。checkpoint 无法替代的部分——系统提示、工具 schema、输出预留、保留尾部——都留在 `fixed` 里。

只用掉一半剩余空间，可以让压缩后的总量回到阈值以下并留下同样多的余量；这也正是原生引擎在采纳 checkpoint 前会复核的条件。自动压力触发时 `room ≈ source`，所以它等价于旧的「源历史的一半」，只会按越界量收紧；对阈值以下的手动 `/compact` 同样成立，因为那时剩余空间大于源历史，仍然由源历史那一半来约束。路由未声明上下文窗口、或模型信息解析失败时回退到 `floor(source / 2)`；`room ≤ 0` 时直接跳过视觉路径，因为没有帧能把会话拉回阈值以下。

预算在每次压缩时按当前路由现算，所以它会自动跟随 `thresholdRatio`、`headroomTokens` 和按模型覆盖，不需要额外设置项。旧配置里可能仍带着 `minCompressionRatio`；它只为升级兼容而被接受，实际会被忽略。

## 图片启用条件

必须同时满足：模型明确声明 image 输入；适配器有图片计价、精确路由上界或带标签的 DeepSeek 估算；渲染和请求变体不缩小字形到可读阈值以下；帧/字节/像素符合附件预算；完整 checkpoint 能放进下面的触发阈值相对预算。

若适配器没有价格，插件会对 DeepSeek 模型使用 1024 token/帧的保守估算；其他模型只能在确认实际规则后显式设置上界，例如：

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # Example only, not a recommended price. Calibrate for the actual model and frame size.
```

provider/model 精确匹配，不做模糊别名或跨模型沿用。估算/上界不代表真实 token；价格声明不会绕过 image 输入能力检查。尺寸改变后必须重新校准。

## 上限和失败行为

配置允许缩小但不能超过首版安全边界：2048×2048 帧、每次 checkpoint 默认 20 帧且上限 64；宿主对单条消息的图片上限（默认 20 张）仍会钳制实际帧数，要真正用满需同时调高宿主的 `maxImagesPerMessage`。总图片最多16MiB，源与归档各最多64MiB，渲染最多15秒。还会受宿主实际限制以及当前保留图片数量约束。归档保存的是消息/转录 JSON，包含格式开销；源接近64MiB时可能因归档大小超限而拒绝。

图片失败、未知价格、无收益会回退；所有候选失败则保留原会话区间并返回原生压缩错误。取消不触发下一方法。阈值与保留尾部低于可压下限时拒绝挂载；源历史低于收益门槛时在创建归档和调用方法之前失败。

Snapcompact 声明 `^0.2.2-rc.1`（0.2.x），并在 `0.2.2-rc.1` 上验证。只有在新宿主上通过安装与激活检查后，才移动下界；上界始终保留：放宽前需验证类型、集成、包内容与真实预设挂载。不要用版本豁免强装。
