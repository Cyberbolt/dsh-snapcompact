# 评测审计：v4 与 recall 时代的 benchmark

[English](evaluation-audit.md)

状态：**Phase A1 审计**，在 v5 任何实现或调优之前写成。本文刻意不依赖新 benchmark 的结果：它评判的是产生 0.6.x 数字的测量工具，而不是产品方向。

## 测了什么

v4 harness 有两个调用模型的套件。

- **准确率压力测试**：一个请求携带 `engineering-recall-v3` 固定 fixture 的全部 40 题。fixture 有 7 个 head 事实、13 个 tail 事实、20 个 middle 事实、40 个不计分 decoy，以及合成 padding 行。四个臂：`original`、`native-text`、`snapcompact`、`snapcompact-recall`。
- **长会话成本套件**：一条持久的 5,000 行合成历史（约 337,000 字符），六轮，schedule 为 `plain, plain, light, plain, heavy, plain`，8 道计分题。同样四个臂。

已发布的 v4 数字在 [evaluation-results.md](evaluation-results.md)。关键数字：recall 三次 39.7/40，纯视觉 28–31/40，长会话 recall 8/8、加权 0.78×，长会话纯视觉 4/8、加权 0.70×。

## 发现

### 1. 单请求 40 题不代表多轮会话

准确率套件把 40 题拼进一条 user message。视觉臂回答全部问题会输出 13,000–17,000 output tokens；recall 臂只输出 1,500–1,900，因为它在工具结果后就能停。这是阅读压力测试，harness 也这么写。它不是稳态使用：真实会话每轮只问几题，每轮重发 checkpoint，并累积之前的回答。

session 套件确实有轮次，但只有六轮、8 道计分题，而且 `plain` 轮只问一个 head/tail 事实。因此它没有测量纯视觉可用性的关键交互：长 checkpoint、多轮、每轮四题以上、且没有工具可以修复误读的帧。

**结论：替换为主要准确率工具。压力测试最多作为廉价诊断保留。**

### 2. 合成 padding 与固定行号容易被过拟合

每条 padding 行形状相同：`Observation <n>: routine build log entry; no user-visible change.` middle probe 放在固定比例或固定物理行。问题和 recall 臂都把字面标签 `Observation <n>:` 当作搜索键。渲染器、序列化器和 recall 查询生成器都可以针对这种规律调优，却学不到真实历史的任何东西。

没有 held-out 划分。fixture 提交在仓库里，每次运行都用它，迭代和验收用同一个 fixture。decoys 不计分、从不提问，因此只弱弱地测试“选择”；模型可以忽略它们而不受惩罚。

**结论：替换。需要生成的 task-level 语料，dev/test 分离。test 不得入库，冻结前不得查看。**

### 3. 精确串评分过度代表回查、低估理解

40 题都有短 canonical answer 和精确 accepted-match 规则。`kind` 标签包含 `constraint`、`negation`、`next-action`、`ordered-step`，但评分仍比较一个字符串。正确的改写、正确的因果解释、正确的“不要用 X，因为 Y”答案，只要不逐字复现 fixture token，就得零分。

region 标签（`head`、`middle`、`tail`）来自源字符串在序列化投影中的位置。它是**渲染**区域，不是语义区域。把事实叫“middle”并不说明它是时序、因果、否定还是跨引用。

**结论：替换为预注册的混合 rubric。保留至少 40% 的精确串题（命令、路径、校验和、标识符），因为它们最难、也最贴近产品；为语义、时序、因果、否定题增加确定性 token/约束 rubric。不得让模型自评。**

### 4. 缺失的对照恰恰能否定结论

v4 没有 **gold-text 上限**臂。没有它，低视觉分无法区分是渲染还是理解。v4 没有 **degraded-renderer 负控**。没有它，高视觉分可能来自语言模型先验或帧外文本，而不是帧。v4 除单个视觉臂外没有多轮无工具对照，也没有把 checkpoint 成本与问题成本分开的臂。

recall 臂是有用的**离线参照**，但不是视觉可用性的对照：它通过给模型搜索工具和归档改变了任务。它还制造了目标要移除的生产依赖。

**结论：增加 gold-text、degraded-renderer、多轮无工具视觉臂。recall 仅在 Phase A/B 作为离线参照臂；生产绝不注册。**

### 5. 单路由、少次数、无区间

已发布结果来自单一路由 `opencode-go/deepseek-v4.1-flash`，准确率两到三次，session 一次。准确率表报告 mean/min/max，但 session 表是单次运行，没有置信区间。live adapter 把每帧图像价格硬编码为 1,343 tokens，路由的真实 image tokenization 未经验证。不同 provider、不同图像降采样策略或不同模型线，都可能让一两题的差异反转。

**结论：保留 usage audit 和加权成本公式；把单次 headline 换成预注册的多次报告，包含方差和区间。路由特定结论只对路由成立。**

## 审计没有否定什么

- usage audit 是可靠的，应保留。它把每个测量请求与 provider 总数对账，unreported prompt 会让该次运行失败。
- 持久历史 session 机制是成本测量的正确形状。应扩展，而不是丢弃。
- 架构（精确 head/tail 文本 + 位图中段、确定性本地渲染、无 summary 调用）没有被 benchmark 缺陷否定。
- v4 结果**作为 v4 工具的测量**仍然有效。它们作为历史回归数据保留，不删除。

## 保留、替换、退役

| 部分                                       | 决定                             | 理由                                               |
| ------------------------------------------ | -------------------------------- | -------------------------------------------------- |
| 从种子确定性生成 fixture                   | **保留**                         | 可复现；扩展为 task-level 生成器。                 |
| Usage audit 与加权成本                     | **保留**                         | v4 最强的部分；能发现不可见的 cache 记账。         |
| 持久多轮历史                               | **保留并扩展**                   | 成本的正确形状；v4 轮次和题量都不足。              |
| 精确 head/tail 文本 + 位图中段             | **保留**                         | 产品架构；审计没有直接否定它。                     |
| 单请求 40 题准确率套件                     | **替换**                         | 非多轮；迫使长回答；扭曲成本。                     |
| 固定行号合成事实                           | **替换**                         | 可过拟合；无 held-out；decoys 太弱。               |
| 仅精确串评分                               | **替换**                         | 奖励归档回查，惩罚理解。                           |
| 把渲染区域当作唯一区域标签                 | **保留为渲染诊断；替换为语义轴** | 增加 task/字符类标签。                             |
| 无 gold-text 臂                            | **增加**                         | 分离理解与渲染。                                   |
| 无 degraded-renderer 臂                    | **增加**                         | 帧阅读的负控。                                     |
| 无 held-out test                           | **增加**                         | 防止在验收集上调参。                               |
| `snapcompact-recall` 生产臂                | **从生产退役**                   | 目标移除 recall 工具；Phase B4 前只保留离线。      |
| Archive coverage 指标                      | **随 recall 退役**               | 它测归档，不测模型。                               |
| v4 准确率 fixture `engineering-recall-v3`  | **作为门槛退役；保留结果**       | 可过拟合且单请求。                                 |
| v4 session fixture `engineering-long-5000` | **保留为历史成本回归**           | 有用的规模参照；不是主要门槛。                     |
| “recall 是精确的”作为产品结论              | **撤回**                         | 那是对 recall 臂的陈述，不是对纯视觉使用的陈述。   |
| “纯视觉只有 28–31/40”作为能力上限          | **撤回**                         | 它既是 OCR 限制，也是 v4 fixture 的覆盖/预算假象。 |

## 对 Phase A 门槛的影响

旧的 39.5/40 目标不能原样沿用，因为产生它的工具正在被替换。替代品在关键维度上必须至少同样严格：

- 至少 40 题、至少 10 轮、长历史，不能靠小 checkpoint 偶然装下；
- 至少 40% 精确串题（命令、路径、校验和、标识符），加上跨区域、时序/因果、否定、约束题；
- 由提交种子生成的 held-out test 划分，调参期间不使用；
- gold-text 上限、degraded-renderer 负控、纯视觉无工具臂；
- recall 仅作为同一 test 集上的离线非劣效参照；
- 预注册阈值、均值、方差/区间、逐区域与逐字符类错误、固定多轮 schedule。

详细设计与阈值冻结在 [evaluation-v5-prereg.md](zh/evaluation-v5-prereg.md)。如果新 benchmark 与旧 benchmark 冲突，两者都报告；不静默删除任何一方。

## 保留用于对照的历史数字

| 工具                     | 臂          | 结果                                          | 状态               |
| ------------------------ | ----------- | --------------------------------------------- | ------------------ |
| v4 accuracy（3 次，0.4） | recall      | 39.7/40；head 21/21、middle 60/60、tail 38/39 | 历史；生产臂退役   |
| v4 accuracy（3 次，0.4） | pure visual | 28–31/40                                      | 历史；不是能力上限 |
| v4 accuracy（3 次，0.4） | original    | 39–40/40（一次失败）                          | 历史               |
| v4 session（1 次）       | recall      | 8/8，加权 0.78×，峰值 0.28×                   | 历史               |
| v4 session（1 次）       | pure visual | 4/8，加权 0.70×，峰值 0.28×                   | 历史；受覆盖限制   |

这些数字不能与 v5 直接比较，因为任务、轮次 schedule、评分 rubric 和历史都不同。v5 报告必须并排打印两个工具的结果，且不得把 v5 对 v4 数字的“提升”当作同一测量。
