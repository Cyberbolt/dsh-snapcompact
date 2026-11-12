# 评测

[English](evaluation.md)

Snapcompact 当前评测是 **v5**：生成的、task-level、多轮 benchmark，带冻结的 dev/test 划分、预注册 rubric 和显式对照。它替代 v4 的单请求 40 题压力测试和六轮 session 成本套件作为验收入口。v4 数字作为历史数据保留在 [evaluation-results.md](zh/evaluation-results.md)。

v5 设计与阈值在调优前冻结于 [evaluation-v5-prereg.md](zh/evaluation-v5-prereg.md)。退役 v4 的审计是 [evaluation-audit.md](zh/evaluation-audit.md)。

## 测什么

一个生成的项目场景，固定 10 轮，每轮 4 题，共 40 题。历史是一条长工程会话（约 81,000 估计源 tokens），含 user 消息、assistant 消息、工具调用、工具结果、构建/测试日志、文件列表、stack trace、事故笔记和 20 个合理 decoy。问题覆盖：

| 类别       | 数量 |
| ---------- | ---: |
| 精确命令   |    4 |
| 精确路径   |    4 |
| 精确校验和 |    4 |
| 精确标识符 |    4 |
| 数值       |    3 |
| 跨区域语义 |    6 |
| 时序/因果  |    6 |
| 否定/约束  |    5 |
| CJK        |    4 |

精确串题 16/40 = 40%，不降权。rubric 是确定性、源文本派生的：

- `exact`：去外层空白，剥掉一对外层反引号/引号，允许一个结尾 `.`/`。`；除此之外逐字符。
- `all`：所有 required 字面出现，且没有 forbidden decoy 字面。
- `any`：至少一个 accepted 字面出现，且没有 forbidden 字面。

没有模型自评。prompt 只含问题文本和 JSON key；答案、rubric 和源行留在 fixture。

## 臂

| 臂                | 输入                                                                 | 工具 | 目的                                    |
| ----------------- | -------------------------------------------------------------------- | ---- | --------------------------------------- |
| `original`        | 完整 fixture 历史                                                    | 无   | 对照；不压缩                            |
| `native-text`     | 生成一次的 native summary                                            | 无   | Host 基线                               |
| `pure-visual`     | 生产 checkpoint：精确 head/tail + 位图帧 + 有界 exact-token 文本索引 | 无   | 目标                                    |
| `gold-text`       | 与 pure visual 相同的 head/middle/tail 选择，文本形式                | 无   | 理解上限                                |
| `degraded-visual` | 帧降采样 50%、隔帧保留、去掉索引                                     | 无   | 负控                                    |

冻结 test 还跑了离线 `recall-ref` 臂（生产 checkpoint + 归档 recall）检查非劣效。该臂从未注册到生产，冻结 test 后删除；发布的 harness 没有归档或 recall 代码。

exact-token 索引是 checkpoint 的一部分，不是 recall 工具：由与帧相同的序列化历史生成，最多 80 行带标签文本，不含模型生成的答案。它存在是因为 64 字符摘要无法从像素可靠读出。帧仍承载周围历史。

## Schedule 与成本

10 轮 schedule 固定。每轮在一条 user message 里问 4 题，期望一个 JSON object。持久历史追加问题和 assistant 回答（仅离线 recall 参照追加工具流量）。成本按轮记录：

```text
prompt    = input + cacheRead + cacheWrite
weighted  = input + 0.1·cacheRead + 1.25·cacheWrite + 4·output
```

加权成本是相对单位，不是账单。报告包含单请求峰值 prompt、总加权成本、相对 `original` 的比值、模型请求数和 usage audit 对账。

benchmark 每个请求设置 `reasoning_effort: low`，限制隐藏推理，让 schedule 可行。模型仍收到完整 checkpoint 和同一组问题。run log 记录该设置。

## Dev 与 test

| 划分 |     种子 | 提交？                         | 用途                                |
| ---- | -------: | ------------------------------ | ----------------------------------- |
| dev  | 20261112 | 只提交种子和生成器             | 迭代、渲染/序列化调优、测量工具验收 |
| test | 20261113 | 种子、生成器和 fixture SHA-256 | 冻结后的最终验收，只跑一次          |

test fixture 生成到 `.artifacts/bench-v5/test/`，不入库。生成器只打印 SHA-256 和计数。仓库只含生成器、种子和 hash；最终运行前不查看 test 内容。

## 命令

tracked harness 对 OpenAI-compatible endpoint 运行同一套件：

```sh
# 生成 dev fixture 并打印 hash/计数；不调用模型。
node --experimental-strip-types scripts/benchmark-v5.ts --split=dev --generate-only

# 一次 dev 全生产臂运行。
SNAPCOMPACT_BENCH_REASONING=low node --experimental-strip-types scripts/benchmark-v5.ts \
  --split=dev --runs=1 --out=.artifacts/bench-v5/dev

# 最终 test：冻结后三次运行。
SNAPCOMPACT_BENCH_REASONING=low node --experimental-strip-types scripts/benchmark-v5.ts \
  --split=test --runs=3 --out=.artifacts/bench-v5/test
```

会话内 `/snapcompact benchmark [1-5]` 只跑 **dev** 划分。test 划分刻意放在仓库外，由 tracked harness 运行。

脚本从环境或 DSH credential store 读取 `OPENCODE_GO_API_KEY`（或 `SNAPCOMPACT_BENCH_API_KEY`）。接受 `--provider`、`--model`、`--api-url`、`--share`、`--runs` 和 `--out`。

## 读报告

报告包含 fixture id/seed/hash、固定 schedule、逐臂/逐次/逐轮/逐类别/逐区域/逐字符类结果、mean/min/max/95% 区间、usage audit、加权成本、测量工具表和产品门槛表。v4 历史数字单独打印。

预注册门槛：

| 门槛                      | 阈值                            |
| ------------------------- | ------------------------------- |
| Pure visual overall       | 3 次 test 运行 mean ≥ 38/40     |
| 精确串子集                | ≥ 15/16                         |
| 跨区域                    | ≥ 5/6                           |
| 时序/因果                 | ≥ 5/6                           |
| 否定/约束                 | ≥ 4/5                           |
| CJK                       | ≥ 3/4                           |
| 数值                      | ≥ 2/3                           |
| Head / tail / middle 区域 | ≥ 6/7 / 5/6 / 25/27             |
| 单请求峰值 prompt         | ≤ 0.40× original                |
| 总加权成本                | ≤ 0.78× original                |

测量工具验收（gold 上限 ≥38、degraded ≤32 且至少差 4 题、排序、无泄漏、可复现、test 未参与调参）必须先通过，产品门槛才作数。

## 解释边界

生成场景可复现，但不代表所有语言、provider 或项目。路由是一条模型线；不同视觉编码器会改变帧可读性。test split 对调参 held out，但仍是合成语料。exact-token 索引是产品特性，不是 benchmark 技巧；负控去掉它，所以帧路径仍被测试。加权成本是相对值，不是账单。报告必须与预注册一起读，不能当作普遍节省承诺。
