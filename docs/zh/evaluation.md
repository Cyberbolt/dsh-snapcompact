# 评测

[English](../evaluation.md)

Snapcompact 有两套调用模型的套件。**准确性套件**用一条固定历史回答 40 道题，衡量读取质量；**会话套件**在同一条长历史上连续跑 6 轮，衡量成本，包括 checkpoint 重发和留在历史里的 recall 页面。两套都不是账单测量，也不会上传私密会话内容。

两个命令都会显式发起模型请求：

```text
/snapcompact benchmark [1-5]          # 准确性套件
/snapcompact benchmark session [1-5]  # 长会话语义成本套件
```

独立脚本 [`scripts/benchmark-live.ts`](../scripts/benchmark-live.ts) 对配置好的 OpenAI 兼容端点运行同样的套件，并把 JSON 和 Markdown 写到 `--out`。

## 准确性套件

语料是 `engineering-recall-v3`：40 道题分布在三个区域，20 个中段 probe、40 个 decoy。7 个头段事实留在精确 head 文本里，13 个尾段事实留在精确 tail 文本里，20 个中段事实落在位图中。decoy 是合理但不计分的事实，让摘要必须做取舍，而不是照抄一条 fact message。

| 方案                 | 衡量什么                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `original`           | 对照组：完整语料，不压缩。                                               |
| `native-text`        | 宿主原生摘要生成 + 一次 QA 读取。                                        |
| `snapcompact`        | 生产视觉 checkpoint（有界头尾文本 + 位图帧），不带工具。                 |
| `snapcompact-recall` | 同一 checkpoint + 真实 `snapcompact_recall` 工具 schema 和有界工具循环。 |

一次请求携带全部 40 题。这使它成为读取压力测试，而不是稳态会话成本；报告不会用它宣称长会话节省。`benchmark 3` 把四个 QA 臂各跑三次；原生摘要和视觉 checkpoint 只生成一次并复用，所以区间衡量的是读取稳定性，不是摘要生成稳定性。

### 计分

- **接受匹配**是主分数。答案去掉首尾空白后，与规范答案及 fixture 声明的等价写法比较；它容忍引用整句时多出的句号，但内部空白和代码缩进仍然有效。
- **严格匹配**是次分数：只接受规范答案，同样去掉首尾空白。
- 每道题按它的精确 source 在序列化投影中的位置归为 `head` / `middle` / `tail`，而不是只信 fixture 标签；找不到的记为 `unknown` 并报告。
- 每次运行记录原始答案、解析模式（`raw` / `extracted` / `failed`）、分区/分类计数、usage 和审计结果。

### Recall 臂

recall 臂使用同一 checkpoint 加生产 `snapcompact_recall` schema。工具调用打到 benchmark 自己的归档，走注册工具同一个 reader。搜索默认 `detail: "snippet"`：每条查询最多 3 个有界窗口，命中行数完整。`complete: true` 表示每条查询都命中且没有被裁剪；`missing` / `truncated` 报告查询下标，重试时不回显整批查询。

一次批量最多 20 条字面量，整个批次上限 20,000 个序列化字符。报告记录工具调用数、模型请求数和工具载荷字节，因此页面和轮次变化都可见。该臂最多 5 个工具轮、40 次执行调用；超过后强制一次不带工具的最终回答。benchmark 归档是直接创建的，不是已提交的 compaction，所以该臂绕过 session index；页面/查询语义与生产一致。路由拒绝工具时只有该臂失败，无工具臂仍会运行。

### 归档完整性

任何 QA 调用之前，报告会检查每道题的精确 source 是否在归档 transcript 里。这是 recall 路径的确定性覆盖检查，不是模型 recall 分数。

## 会话套件

长语料由固定规则生成，默认 5,000 行 padding（约 337,000 字符，用 benchmark 计量约 84,000 token）。它有精确 head/tail 事实和 6 条分布在 8%–82% 的中段事实，recall 不可能从一个区域拿全。消息按 `messageTextMaxChars` 以下切块；否则序列化会先裁掉历史，模型根本看不到。

schedule 是 `plain, plain, light, plain, heavy, plain`：

| 轮次类型 | 问题数              | 对模型说的话                          |
| -------- | ------------------- | ------------------------------------- |
| `plain`  | 1 条 head/tail 事实 | 从 checkpoint 回答，不要调用 recall。 |
| `light`  | 1 条中段事实        | 最多一次批量 recall，然后回答。       |
| `heavy`  | 3 条中段事实        | 最多一次批量 recall，然后回答。       |

六轮里 `light` 和 `heavy` 各占一轮，两轮检索合计三分之一。`plain` 轮若调用 recall、或检索轮调用超过一次，会记为 `offSchedule`。

每个臂使用**同一条持久消息历史**：

1. 源历史（original）或 checkpoint 放在开头，只放一次。
2. 每轮追加问题、assistant 回答和 recall 工具流量。
3. recall 页面不删除。后续轮会再次发送它们，这就是真实的页面常驻成本。

四个臂与准确性套件相同。原生摘要只生成一次，其 usage 摊入 native 臂；视觉 checkpoint 只在本地渲染一次，渲染时间不计入模型成本。每轮记录：prompt、output、cache read/write、加权成本、模型请求数、recall 调用数、工具字节、正确率和耗时。

### 成本口径

```text
prompt    = input + cacheRead + cacheWrite
weighted  = input + 0.1·cacheRead + 1.25·cacheWrite + 4·output
```

加权成本是**相对单位**，不是账单。系数是透明假设，不是 provider 价目表。

0% 和 33% 是实测臂：视觉臂没有检索轮，recall 臂跑上面的 schedule。100% 由实测 heavy/plain 轮次线性外推：

```text
modeled100 = recallCost + plainTurnCount × (meanHeavyCost − meanPlainVisualCost)
```

报告里标为 `modeled`，不能当作一次真实运行。归因表把 recall 臂的 prompt 拆成 checkpoint 重发（`checkpointTokens × requests`）、工具页（序列化字节 ÷ 4）和其余部分。

容量表是确定性的，不调用模型：在 25 万、50 万、100 万 source 字符下按 `chars / 4` 估算 token，和路由窗口的触发阈值比较，并展示实测 checkpoint 大小。它展示“原文已经装不下”的区间，不宣称这些规模下的节省。

## 用量审计

DSH 的 `TokenUsage` 计数是互斥的：`inputTokens` 是未缓存输入，缓存输入单独放在 `cacheReadTokens` / `cacheWriteTokens`。benchmark 的 provider adapter 必须把 provider 字段映射到这三个桶，并保留 `total_tokens`。

每个 measured 请求都要审计：

```text
computed = input + cacheRead + cacheWrite + output
unreportedPrompt = max(0, reportedTotal − computed)
```

任何正的 `unreportedPrompt` 都会让该运行失败。这正是 v3 的缺陷：adapter 只读 `prompt_tokens_details.cached_tokens`，独立的 `prompt_cache_hit_tokens` 被漏掉，某次 recall 运行的 `total_tokens` 比映射后的 input+output 多 18,688。现在报告会打印审计，脚本在审计不完整时以非零退出。

## 报告指标

- 接受/严格匹配数、多次运行的均值/最小/最大、合并后的 head/middle/tail 计数。
- 分区和分类计数，以及每个未命中 key 的 expected/given。
- 原生摘要生成 usage 和耗时；视觉帧数、checkpoint token、配置份额预算、是否超预算、准备耗时。
- input / cacheRead / cacheWrite / output 和审计，以及相对加权成本。
- recall 工具调用、模型请求、序列化载荷字节。
- 会话峰值 prompt、累计 prompt、output、加权成本、请求数、调用数、正确率和归因。
- 本地密度检查（`src/rendering/density.test.ts`）固定帧数、每帧字符数和 PNG 字节；不调用模型，也不衡量 recall。

## 解释边界

固定语料可复现，但不代表所有语言、provider 或长期项目。单次运行可能反转一两道题；`benchmark 3` 用于发布区间。独立 fixture 请求与完整路由会话的 system/tool 包络不同。接受分数故意比严格匹配宽松；比较时两个都引用。

视觉臂走生产本地渲染路径：有界头尾文本 + 位图帧，不调用摘要。checkpoint 即使满足 benchmark 的配置份额预算，真实会话也可能因触发阈值剩余空间更小而拒绝它；报告会标出超预算。视觉臂可能因缺少视觉元数据、未声明计价、请求缩放不可读或帧预算不足而跳过；这是安全回退，不是图像理解成功的证据。

没有 provider usage 的响应会标为未测量，而不是拿来编造节省。会话套件的 100% 点是显式 modeled，容量表是显式估算。只有实测臂、审计过的 usage 和 fixture 相对准确率是可引用的结论。

## 复现

```text
/snapcompact benchmark            # 一次准确性运行
/snapcompact benchmark 3          # 三次准确性运行；用于发布区间
/snapcompact benchmark session    # 一次六轮会话运行
```

可追踪的非交互运行：

```sh
node --experimental-strip-types scripts/benchmark-live.ts --preflight --lines=5000
node --experimental-strip-types scripts/benchmark-live.ts --suite=all --runs=1 --share=0.4
```

脚本读取 `OPENCODE_GO_API_KEY`（或 `SNAPCOMPACT_BENCH_API_KEY`），并接受 `--provider`、`--model`、`--api-url` 指向 OpenAI 兼容 chat-completions 端点。`--preflight` 只渲染一次长语料，不调用模型。

真实项目评测要先取得历史和目标 provider 的许可，再准备脱敏语料。不要把私密会话日志提交成公开 benchmark 资产。
