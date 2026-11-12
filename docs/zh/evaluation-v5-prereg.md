# 评测 v5 预注册

[English](evaluation-v5-prereg.md)

状态：**冻结的设计与阈值**，在 v5 任何调优之前写成。之后唯一允许的编辑是冻结元数据（commit、fixture hash、report hash）和一条会强制重跑的明确 changelog。看到结果后再改任务、rubric、阈值、臂、schedule 或分析，视为失败运行，而不是新计划。

## 为什么 v5 替换 v4

Phase A1 审计（[evaluation-audit.md](zh/evaluation-audit.md)）发现 v4 准确率套件是单请求精确串压力测试，固定行号合成事实容易过拟合，没有 held-out 划分或 gold/degraded 对照，region 标签是渲染位置而非语义类别。v4 保留为历史回归工具；它不是 v5 的门槛。

## 任务集

**语料**：一个生成的、task-level 的虚构工程场景。每个场景包含一条长工作历史（目标 70,000–90,000 估计源 tokens），其中有用户请求、assistant 消息、工具调用、工具结果、构建/测试日志、文件列表、stack trace、事故笔记。事实嵌在真实会话会出现的消息里，而不是统一的 padding 模板。

**轮次**：固定 10 轮。每轮在一条 user message 里问 4 题，期望一个 JSON object。持久历史追加问题、assistant 回答，以及（仅离线 recall 参照）工具流量。schedule 固定，不按运行采样。

**问题**：共 40 题，每轮 4 题，顺序预先固定。覆盖：

| 类别       | 数量 | 测什么                                           |
| ---------- | ---: | ------------------------------------------------ |
| 精确命令   |    4 | Shell 命令行、flags、顺序                        |
| 精确路径   |    4 | 绝对或仓库相对路径                               |
| 精确校验和 |    4 | 大小写与分隔符                                   |
| 精确标识符 |    4 | 环境变量、feature flag、锁名、版本 token         |
| 数值       |    3 | 端口、超时、重试次数、版本号                     |
| 跨区域语义 |    6 | 结合 head 约束与 tail 决定，或两个相距很远的事实 |
| 时序/因果  |    6 | 失败之后发生了什么；哪个动作导致哪个状态         |
| 否定/约束  |    5 | 什么不能做、不能包含、不能使用                   |
| CJK        |    4 | 中文事故笔记、标识符或指令                       |

精确串题 16/40 = 40%。不降权。每题都有从源文本生成的确定性 rubric：

- `exact`：去掉外层空白，剥掉一对外层反引号/引号（Markdown 表现），允许一个结尾 `.`/`。`；除此之外逐字符，包括大小写和内部分隔符。
- `all`：所有 required 字面 token 都出现，且没有 forbidden decoy token。required token 来自源句子，不来自模型。
- `any`：至少一个 accepted 字面出现，且没有 forbidden token。

没有模型自评。rubric 由写场景的同一个生成器生成，并与源片段一起存储。

**Decoys**：历史中至少 20 个看似合理的假事实（错端口、错路径、过期校验和、废弃 flag）。decoy 不得包含正确答案的源文本，也不得被提问。生成器会断言。

**泄漏**：问题 prompt 只包含问题文本和 JSON key。不包含答案、rubric、源行或 region。test fixture 生成到 `.artifacts/bench-v5/test/`，不入库。仓库只包含生成器、种子和 hash。

**划分**：

| 划分 |     种子 | 提交？                        | 用途                                |
| ---- | -------: | ----------------------------- | ----------------------------------- |
| dev  | 20261112 | 只提交种子和生成器            | 迭代、渲染/序列化调优、测量工具验收 |
| test | 20261113 | 种子、生成器、fixture SHA-256 | 冻结后的最终验收，只跑一次          |

test fixture 由冻结 commit 上的生成器生成。生成器只打印 SHA-256 和计数；最终运行前不查看内容。dev fixture 可随时从种子重生成。

## 臂

| 臂                | 输入                                                                                                   | 工具 | 目的                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ---- | ----------------------------------------- |
| `original`        | 完整 fixture 历史                                                                                      | 无   | 对照；不压缩                              |
| `native-text`     | 从完整历史生成一次的 native summary                                                                    | 无   | Host 基线                                 |
| `pure-visual`     | 生产 checkpoint：有界精确 head/tail + 位图中段 + 有界、确定性的 exact-token 文本索引（无工具、无归档） | 无   | 目标                                      |
| `gold-text`       | 与 pure visual 相同的 head/middle/tail 选择和 exact-token 索引，中段为精确文本、无帧                   | 无   | 理解上限                                  |
| `degraded-visual` | 生产 checkpoint，每帧先降采样 50% 再最近邻放大，隔帧保留，并去掉 exact-token 索引                      | 无   | 渲染/checkpoint 负控                      |
| `recall-ref`      | 生产 checkpoint + 离线归档 recall                                                                      | 有界 | 仅非劣效参照；生产绝不注册；Phase B4 删除 |

exact-token 索引是 checkpoint 的一部分，不是 recall 工具：它由与帧相同的序列化历史生成，最多 80 行带标签文本，不含模型生成的问题或答案。它存在的原因是 64 字符摘要无法从像素可靠读出；帧仍然承载周围历史。报告沿用 `pure-visual` 这个臂名以对应 v4，但产品描述必须披露该索引。

所有臂使用同一持久 10 轮历史和同一组问题。每轮输出上限 32,768 tokens；触顶视为该次运行失败，而不是给截断答案计分。四个主臂无工具。`recall-ref` 每轮最多两次离线归档调用，总计最多 20 次；超过上限视为错误，该臂无工具作答。归档由 harness 创建，不是已提交的 compaction。

## 路由与解码

benchmark 使用配置的路由和模型。生产、native、degraded 臂设置 provider 兼容的 `reasoning_effort: low`，限制隐藏推理，让 10 轮 schedule 可行；gold-text 上限臂使用 provider 默认，避免上限被解码约束限制。每个臂仍收到完整 checkpoint 和同一组问题。忽略该字段的 provider 使用默认。路由、模型和逐臂 reasoning 设置记录在 run log。冻结后修改该设置需要重新冻结并完整重跑。

## 评分与分析

每个臂、每次运行：

- accepted / 40；精确串子集 / 16；逐类别与逐区域 tally；
- 逐题 outcome，含 expected、given、rubric、pass/fail；
- 逐轮 score、prompt tokens、单请求峰值 prompt、output tokens、cache read/write、加权成本、模型请求数、recall 调用/字节、耗时；
- 每个请求的 usage audit；任何正 `unreportedPrompt` 让该次运行失败；
- 错题按 expected 字符类（大写、小写、数字、标点、CJK、其他）拆分字符错误率；
- parse mode（raw JSON、extracted JSON、failed）。

成本：

```text
prompt    = input + cacheRead + cacheWrite
weighted  = input + 0.1·cacheRead + 1.25·cacheWrite + 4·output
```

加权成本是相对单位，不是账单。成本按轮和按臂报告，另报单请求峰值 prompt 及相对 `original` 的比值。native summary 生成成本摊入 native 臂。渲染时间不计入模型成本，单独报告。

统计：

- dev 和 test 每臂 3 次运行。报告 mean、min、max，以及 n−1 自由度 t 分布的 95% 置信区间（n=3，t=4.303）。区间是描述性的；验收决定用 mean。
- 报告逐次和合并的逐题通过率。某题 3 次中过 2 次不会被静默算作通过；分数用 mean。
- 若某次运行失败（provider 错误、usage audit、格式错误），报告为 failed。不得用合成重跑替换。最终 test 少于 3 次测量运行则测量门槛失败。

## 冻结阈值

主门槛是 **test 划分上的 pure visual**，3 次测量运行的 mean：

| 门槛                                   | 阈值                                                  |
| -------------------------------------- | ----------------------------------------------------- |
| Overall accepted                       | **≥ 38/40 (95%)**                                     |
| 精确串子集                             | **≥ 15/16 (93.75%)**                                  |
| 跨区域语义                             | **≥ 5/6**                                             |
| 时序/因果                              | **≥ 5/6**                                             |
| 否定/约束                              | **≥ 4/5**                                             |
| CJK                                    | **≥ 3/4**                                             |
| 数值                                   | **≥ 2/3**                                             |
| Head 区域（诊断）                      | **≥ 6/7**                                             |
| Tail 区域（诊断）                      | **≥ 5/6**                                             |
| Middle 区域（诊断）                    | **≥ 25/27**                                           |
| 与 `recall-ref` 在同一 test 上的非劣效 | **pure visual ≥ recall-ref − 1 题**（≤ 2.5 个百分点） |

当 recall 得 40/40 时，非劣效是约束性门槛：pure visual 至少 39/40。绝对门槛不会为了更容易通过而放宽；两者都必须成立。

test 上 pure visual 相对 original 的成本门槛：

| 门槛              | 阈值                 |
| ----------------- | -------------------- |
| 单请求峰值 prompt | **≤ 0.40× original** |
| 10 轮总加权成本   | **≤ 0.78× original** |

## 测量工具验收

在 test 被允许决定任何事之前，同一次 test 运行必须显示：

1. **上限**：`gold-text` mean ≥ 38/40 且 ≥ pure visual mean。gold-text 是理解上限；gold 低说明任务或 rubric 坏了，而不是渲染器好。
2. **负控**：`degraded-visual` mean ≤ 32/40，且在同一配对运行中至少比 pure visual 少 4 题。负控去掉 exact-token 索引，并在 50% 降采样之外隔帧保留，因此测的是帧路径而不是文本索引。如果降级不伤害，任务不依赖帧，结果不是证据。
3. **排序**：gold-text ≥ pure visual ≥ degraded-visual。gold 与 pure visual 可以相等；pure visual 必须严格高于 degraded。
4. **无泄漏**：生成器断言通过；问题 prompt 不含答案或 rubric；没有 decoy 含正确源；test fixture hash 与冻结 hash 一致。
5. **可复现**：同种子重生成 fixture 得到相同 SHA-256；同一 JSON 重跑分析得到相同 report hash。
6. **test 未参与调参**：冻结 commit 与 test hash 早于第一次 test 运行。冻结后任何代码改动都要记录，并强制重新冻结、重新生成 test、完整重跑。

任何测量工具验收项失败，即使产品门槛通过，test 结果也无效。报告它；不要只挑通过的子集。

## 报告

v5 报告必须包含：

- fixture id、种子、SHA-256、生成器版本、commit、report hash；
- 固定 schedule，以及每题的类别、区域、rubric、expected、given；
- 逐臂、逐次、逐轮、逐类别、逐区域、逐字符类结果；
- mean、min/max、95% 区间；
- usage audit 与加权成本，含峰值和总比值；
- 测量工具验收表和产品门槛表，各自 pass/fail；
- v4 历史数字单独一张表，明确标注是不同工具；
- 每条撤回或保留的 v4 结论及理由；
- failed 运行和任何偏离本计划的记录，包括授权它的 changelog。

test 报告写到 `.artifacts/bench-v5/test/`，不入库。提交的摘要只含聚合数字、hash 和预注册分析。

## 冻结元数据

| 字段                 | 值                                                                 |
| -------------------- | ------------------------------------------------------------------ |
| 生成器版本           | `v5.0.0`（首个冻结版本）                                           |
| Dev 种子             | `20261112`                                                         |
| Test 种子            | `20261113`                                                         |
| Dev fixture SHA-256  | `de70694e85fccb030ee67dcf987b022460112e7f42eeab4ec9f980e2ee1627b1` |
| Test fixture SHA-256 | `a7a169f31df57a3347e3efe0c1f65b0dd021b50ca604f491f5c0ea739fdea2ec` |
| 冻结 commit          | `decd08572c3960d5fdd25790ef6a2d0e3146ade4`                                                |
| 冻结日期             | `2026-11-12`                                                       |

hash 和 commit 在第一次完整 dev 运行前一次性填入。之后生成器任何改动都会改变 hash，并要求新的冻结。

## Changelog

- **2026-11-12**：gold-text 臂现在包含与 pure-visual checkpoint 相同的 exact-token 索引，因此是严格的信息超集，而不是另一种呈现的纯文本臂。任务、rubric、阈值未变。
- **2026-11-12**：生产/native/degraded 臂使用 `reasoning_effort: low`；gold 上限使用 provider 默认。run log 记录该设置。任务、rubric、阈值未变。
- **2026-11-12**：dev 探针显示 64 字符摘要无法从像素可靠读出后，生产 checkpoint 增加有界、确定性的 exact-token 文本索引。负控去掉该索引，并在 50% 降采样之外隔帧保留。任务、rubric、阈值、臂数量或 schedule 均未改变；在消歧问题/decoy 后重新生成了 dev 与 test fixture hash。
