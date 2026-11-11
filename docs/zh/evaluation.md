# 评测

[English](../evaluation.md)

执行 `/snapcompact benchmark` 是**显式发起模型调用**。单次运行包含一次原生摘要生成和四个 QA 臂：三个单次臂（原始历史、原生摘要、视觉 OCR），以及一个 recall 臂——最多五轮工具、四十次实际调用，超过后 runner 会在无工具的情况下强制一次最终作答。OCR 臂会明确告知本回合没有工具，因此不会因为“模型请求了不存在的 recall”而扣分。无法安全生成图片时跳过视觉臂，不用文本调用冒充视觉成绩。

## 评测 v3

默认语料是 `engineering-recall-v3`：40 题分布在三个区域，20 个中段 probe、40 个 decoy。7 个头段事实留在精确 head 文本里，13 个尾段事实留在精确 tail 文本里，20 个中段事实落在位图中。decoy 是合理但不计分的事实，让摘要必须做取舍，而不是照抄一条 fact message。

报告拆成四个臂：

| 臂                   | 测什么                                                               |
| -------------------- | -------------------------------------------------------------------- |
| `original`           | 对照组：完整 fixture 原文，不压缩。                                  |
| `native-text`        | 宿主原生摘要生成 + 一次 QA 读取。                                    |
| `snapcompact`        | 生产视觉 checkpoint（有界头尾文本 + 位图帧），不带工具。             |
| `snapcompact-recall` | 同一 checkpoint，带真实 `snapcompact_recall` schema 和有界工具循环。 |

### 评分

- **接受匹配**是主分。只裁掉答案外层空白，然后与 canonical answer 及 fixture 声明的等价写法比较，消除“引文带标签前缀”这类评分噪声；同时忽略一个结尾的 `.`/`。`，因为引用整句原文会把这个标点带出来。
- **严格匹配**是副分。只与 canonical answer 比较，仍然只裁外层空白；内部空白和代码缩进保持有效。
- 每题按 exact source 在序列化投影中的实际位置归入 `head`、`middle` 或 `tail`，不只依赖 fixture 的声明。找不到 source 的题标为 `unknown` 并报告。
- 每次运行都记录 raw answer、解析模式（`raw`、`extracted`、`failed`）、分区/题型计数和 token usage。
- `benchmark` 运行一次；`benchmark 3` 把四个 QA 臂重复三次，报告均值/最小/最大。原生摘要和视觉 checkpoint 只生成一次并复用，所以范围测的是读取稳定性，不是摘要生成稳定性；报告 warning 会写明这一点。

### Recall 臂

recall 臂收到同一 checkpoint，外加生产的 `snapcompact_recall` schema。工具调用打到 benchmark 自己的归档，页面读取逻辑与注册工具一致；页面只带行号、游标和命中数，provenance 留在归档文档里，不会随每次调用重复发送；一次 search 最多可批量查询 20 条独立字面量。报告记录工具调用数、模型轮次和工具结果序列化字节数，因此轮数变化时页面载荷的变化仍然可见；最多五轮工具、四十次实际工具调用；超过时 runner 会在无工具的情况下强制一次最终回答。这个上限对齐生产 agent：真实 agent 本身没有每回合 recall 次数限制。benchmark 归档是直接创建的，不是已提交的 compaction，所以该臂绕过 session index，但页面/查询语义相同。路由不支持工具时只有该臂失败，OCR 臂照常运行。

### 归档完整性

任何 QA 调用之前，报告检查每题的 exact source 是否出现在归档 transcript 中。这是 recall 路径的确定性覆盖检查，不是模型召回分。

## 报告指标

- 接受匹配和严格匹配的计数、跨运行均值/最小/最大，以及合并后的 head/middle/tail 计数。
- 分区、题型计数，以及每个未命中 key 的 expected 和 given。
- 原生摘要生成 usage 与耗时；视觉帧数、checkpoint token、半源预算、是否超预算、准备耗时。
- Provider 报告的 input/output/cacheRead/cacheWrite usage；缺失字段不编造。
- prompt 总量遵循 DSH 合同：input + cacheRead + cacheWrite，不是可能包含 output 的 totalTokens。
- recall 工具调用次数、额外 token，以及 OCR 臂与 recall 臂的 accepted 差值。
- 本地密度检查（`src/rendering/density.test.ts`）固定帧数、每帧字符数和 PNG 字节数，不发起模型调用，也不测 recall。

## 成本口径

Token 经济性有两个轴：一次性生成和稳态读取。视觉路径没有生成调用，但 checkpoint 更大；原生摘要付一次生成调用，之后读取更小。报告展示生成 token、每轮读取 token、单次运行总 token 和 3 轮上下文投影。图片计价是估算，不是账单。只比较摘要的每轮读取和视觉 checkpoint 的每轮读取，会漏掉摘要生成调用。recall 成本由轮次决定：每个模型轮都会重发 checkpoint，所以读取总量更多跟随轮数而非页面大小；归因页面瘦身前，应同时看 recall 载荷字节和轮次。

## 解释边界

固定语料可复现，但不代表所有语言、provider 或长期项目。单次运行可能让一两道题顺序反转；发布范围请用 `benchmark 3`。独立 fixture 请求与完整会话的 system/tool envelope 不同。接受匹配刻意比严格匹配宽松；比较时两个都引用。

视觉臂走生产本地渲染路径：有界头尾文本 + 位图帧，不调用摘要。v3 把事实分散到 head、middle、tail 并分区报告，中段帧的分数才单独可见。checkpoint 即使满足 benchmark 的“源历史一半”预算，真实会话也可能因触发阈值剩余空间更小而拒绝它；报告会标出超预算。

视觉臂可以因缺少视觉元数据、未声明计价、请求缩放不可读或帧预算不足而跳过。这是安全兜底，不是图片理解成功的证据。没有 provider usage 的响应标记为未测量，不用于编造省 token 的结论。

## 复现

```text
/snapcompact benchmark      # 单次
/snapcompact benchmark 3    # 三次 QA，用于发布范围
```

真实项目评测需要同时获得历史和目标 provider 的许可，并准备脱敏 fixture。不要把私密会话日志提交为公开 benchmark 资产。
