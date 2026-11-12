# 评测结果

[English](evaluation-results.md)

## v5.1 test 与 v5 中止记录

### v5.1 冻结 test 结果

状态：v5.1 **有效**。这不是冻结 v5 的结果；见下面的 v5 中止记录。

- Fixture：`project-recall-v5-20261113`，种子 20261113，SHA-256 `087da65cd52a3087b622de8925eb1acf366abe6d15f7941b551aec4de9c5cb13`。
- 路由：`opencode-go/deepseek-v4.1-flash`。
- 每臂 3 次。生产/native/degraded 使用 `reasoning_effort: low`；gold 使用 provider 默认。
- 报告 SHA-256：`2e62ad36f99162a479bb46642b9bc10398c0fb9e449628513789fb58d3ec791b`。

| 臂                |  Accepted mean（逐次） | 精确串 mean |  帧 | 峰值 prompt |    加权 |
| ----------------- | ---------------------: | ----------: | --: | ----------: | ------: |
| `original`        |     39.33 (40, 38, 40) |       16.00 |   — |     128,092 | 140,860 |
| `native-text`     |     32.33 (34, 31, 32) |       13.67 |   — |       3,332 |  19,612 |
| `pure-visual`     | **39.67** (39, 40, 40) |   **15.67** |   3 |       7,178 |  26,604 |
| `gold-text`       |     39.67 (40, 40, 39) |       15.67 |   — |      15,782 |  52,718 |
| `degraded-visual` |     11.67 (11, 12, 12) |        1.67 |   3 |       5,096 |  66,653 |

Pure visual：mean 39.67/40、精确 15.67/16、head 21/21、middle 80/81、tail 18/18、CJK 12/12、跨区域 18/18、时序/因果 18/18、否定 15/15、数值 9/9。峰值 prompt 是 original 的 **0.056×**，加权成本 **0.189×**。usage audit 对账全部 150 个请求：reported 4,758,294、computed 4,758,294、unreported prompt 0。

**测量工具验收（全过）：**

| 检查                 | 结果                                                |
| -------------------- | --------------------------------------------------- |
| Gold 上限 ≥38        | 39.67 pass                                          |
| Gold ≥ pure visual   | 39.67 vs 39.67 pass（严格；授权的 v5.1 容差未用到） |
| Degraded ≤32         | 11.67 pass                                          |
| Degraded 至少差 4 题 | 28.00 pass                                          |
| 排序                 | gold 39.67 ≥ visual 39.67 ≥ degraded 11.67 pass     |
| 无泄漏 / 可复现      | pass                                                |

**产品门槛（全过）：** overall 39.67 ≥ 38；exact 15.67 ≥ 15；跨区域 18/18；时序/因果 18/18；否定 15/15；CJK 12/12；数值 9/9；head 21/21；middle 80/81；tail 18/18；峰值 0.056× ≤ 0.40×；加权 0.189× ≤ 0.78×。

### Recall 参照（离线，同一 test split）

离线 `recall-ref` 臂在**同一** test fixture（`087da…`）和同一视觉 checkpoint 上跑三次：

| 臂           | 逐次       |  Mean | 工具调用 |
| ------------ | ---------- | ----: | -------: |
| `recall-ref` | 39, 40, 40 | 39.67 |       29 |

非劣效：pure visual 39.67 ≥ recall 39.67 − 1；观测差异为 0。参照臂从未注册到生产，test 后删除。

### v5 中止记录（invalid）

冻结 v5 test 使用 SHA-256 `a7a169f31df57a3347e3efe0c1f65b0dd021b50ca604f491f5c0ea739fdea2ec`，在 gold run 1 因呈现/上限问题中止。其 original 臂已完成，为 **38/38/38**。没有最终 v5 报告；这次部分运行 **invalid**，不计为通过。本地日志在 `.artifacts/bench-v5/test.log`；冻结 v5 hash 和中止记录写在这里，不静默删除。

### v5.1 偏离

- **CJK rubric 放宽（commit `71ae82d`）**及 fixture hash 从 `a7a169…` 改为 `087da…`：CJK action rubric 接受首句改写，例如用 `扩容连接池` 回答 `先扩容连接池，再重放队列`。完整短语和首句本来已接受；exact-string 权重未变。
- **exact-token 文本索引**进入生产 checkpoint（最多 80 行带标签文本），因为 64 字符摘要无法从像素可靠读出。负控去掉它。
- **Gold 呈现**：gold 臂包含与 pure visual 相同的索引和相同的收尾重读规则。
- **逐臂 reasoning**：生产/native/degraded 使用 `reasoning_effort: low`；gold 使用 provider 默认。
- **上限容差**：v5.1 在看到 v5 部分结果后允许 `gold ≥ visual − 1`，因为 visual 满分时严格比较退化，而 gold 是 39–40 的随机量。本次严格比较仍然通过。**产品门槛未变。**
- **负控**：50% 降采样、隔帧、去掉索引。
- v5.1 test 开始后没有改 rubric、gold 提示、阈值或 fixture；未来改动只能开 v6（新 seed、新冻结）。

### 不是靠放水过线

v5 original 是 **38/38/38**；v5.1 original 是 **40/38/40**。任务没有被变简单：original 也提高了，pure visual 的精确串是 15.67/16，所有分类门槛通过。视觉提升来自 exact-token 索引、2 px 字间距、foveation 和更密序列化，而不是删难题或放宽 exact-string 评分。

v5 工具见 [evaluation.md](zh/evaluation.md)；设计与阈值冻结于 [evaluation-v5-prereg.md](zh/evaluation-v5-prereg.md)。test split 由种子 20261113 生成到 `.artifacts/`，不入库。test fixture SHA-256 是 `087da65cd52a3087b622de8925eb1acf366abe6d15f7941b551aec4de9c5cb13`。

## v5 dev 验证

dev split（种子 20261112，SHA-256 `d208662ccf6c27401648002924f8d8d89e3f4437d5e50ae715f7f481deae409b`）用于迭代和工具验收，不用于验收决定。代表性单次结果：

| 臂                   |  分数 | 精确串 | 备注                       |
| -------------------- | ----: | -----: | -------------------------- |
| `original`           | 38/40 |  16/16 | 对照                       |
| `pure-visual`        | 40/40 |  16/16 | 3 帧 + exact-token 索引    |
| `gold-text`          | 40/40 |  16/16 | 文本 + 同一索引            |
| `degraded-visual`    | 11/40 |   1/16 | 50% 降采样、隔帧、去掉索引 |
| `recall-ref`（离线） | 40/40 |  16/16 | 仅参照                     |

同一次 dev 运行中，pure visual 峰值 prompt 7,212 tokens、加权 34,073；`original` 为 128,100 和 254,491（峰值 0.056×、加权 0.134×）。exact-token 索引让校验和、路径、命令无需搜索工具就精确。负控刻意很重：去掉索引并隔帧，因此测的是帧路径而不是文本索引。

dev 还说明了为什么工具需要上限和负控：更早的纯视觉版本没有字间距时读 26/40，校验和 0/4；索引和 2 px tracking 把同一任务带到 40/40。细节见 [evaluation-audit.md](zh/evaluation-audit.md) 和预注册里的 changelog。

## v4 历史结果

v4 是**不同的工具**：单请求携带 `engineering-recall-v3` 全部 40 题，加一个六轮长会话成本套件。它作为历史保留，不是 v5 门槛。

| v4 工具            | 臂                   | 结果                                          | 状态 |
| ------------------ | -------------------- | --------------------------------------------- | ---- |
| accuracy，0.4 三次 | `snapcompact-recall` | 39.7/40；head 21/21、middle 60/60、tail 38/39 | 历史 |
| accuracy，0.4 三次 | `snapcompact`        | 28–31/40                                      | 历史 |
| accuracy，0.4 三次 | `original`           | 39–40/40（一次失败）                          | 历史 |
| accuracy，0.4 三次 | `native-text`        | 40/40                                         | 历史 |
| session，一次      | `snapcompact-recall` | 8/8，加权 0.78×，峰值 0.28×                   | 历史 |
| session，一次      | `snapcompact`        | 4/8，加权 0.70×，峰值 0.28×                   | 历史 |

v4 accuracy 的 recall 臂是 0.4 份额、单请求携带 40 题；其成本不是稳态会话成本，报告当时也这么说。v4 session 只有六轮、8 题，100% recall 点是建模而非测量。完整 v4 表格和复现命令保留在本文件的 git 历史里；当前仓库不再提供 v4 harness。

## 撤回与保留的结论

**撤回：**

- “recall 是精确的”作为**产品**结论。它描述的是 v4 recall 臂，不是纯视觉使用。0.7.0 移除了 recall 工具。
- “纯视觉只有 28–31/40”作为**能力上限**。它是 v4 fixture 的覆盖/预算和字间距假象。v5 dev 纯视觉在有界 exact-token 索引和 2 px tracking 下是 40/40。
- “长会话纯视觉 4/8”作为**普遍**结果。它是覆盖假象：v4 视觉臂只保留最新的中段帧。v5 foveate 两端、保留精确 head/tail，并加索引。
- “0.4 份额偏向 recall”作为**默认建议**。0.4 仍是默认，但 v5 测的是整个 checkpoint；没有 recall 路径可偏向。
- v4 的“33% recall 轮 = 0.78×”作为**可比**成本结果。v5 的任务、schedule 和成本口径不同。

**保留：**

- Usage audit 和加权成本公式。
- 从提交种子确定性生成 fixture。
- 精确串题占任务 40%。
- 持久多轮历史和逐轮成本。
- 精确 head/tail 文本 + 位图中段。
- `FILES` 索引。
- v4 结果作为历史数据，带上述 caveat。

## 复现

```sh
# dev 验证（不是验收入口）
SNAPCOMPACT_BENCH_REASONING=low node --experimental-strip-types scripts/benchmark-v5.ts \
  --split=dev --runs=1 --out=.artifacts/bench-v5/dev

# 冻结 test，三次运行
SNAPCOMPACT_BENCH_REASONING=low node --experimental-strip-types scripts/benchmark-v5.ts \
  --split=test --runs=3 --out=.artifacts/bench-v5/test
```

test fixture 由提交种子生成；仓库含生成器和 hash，不含 test 内容。冻结非劣效检查用的离线 `recall-ref` 臂不在发布 harness 中。

## Caveats

结果只对路由 `opencode-go/deepseek-v4.1-flash` 成立。benchmark 对生产、native、degraded 臂使用 `reasoning_effort: low`，gold 上限使用 provider 默认；不同解码设置可能移动一两题。exact-token 索引是产品特性，不是 benchmark 技巧：由同一序列化历史生成，最多 80 行带标签文本，负控去掉它。加权成本是相对单位，不是账单。生成场景可复现，但不代表所有语言或项目。
