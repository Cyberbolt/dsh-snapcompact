# 评测结果

[English](../evaluation-results.md)

## 评测 v4

**2026-11-12** 用路由 `opencode-go/deepseek-v4.1-flash`、生产渲染器、原生摘要引擎和 v4 评测代码执行的真实运行。准确性套件使用 40 题的 `engineering-recall-v3` 语料；会话套件使用 5,000 行的 `engineering-long-5000` 语料（约 337,000 字符）。选定的 checkpoint 份额是 **0.4**；另有一次 0.5 的参考准确性运行。

准确性套件计划跑三次 0.4。两次跑完所有臂；另一次 original/native 臂因 provider 返回 null usage 而失败（recall/visual 臂完成）。该 bug 已在 `scripts/benchmark-live.ts` 修复；失败的臂如实记为失败，没有静默替换。0.35 的准确性尝试卡在 provider，取消后没有产生数据；默认值由 0.4 与 0.5 的对比决定。会话套件完成一次运行。

### 准确性压力测试

| 方案                 | 0.4 A | 0.4 B | 0.4 C  | 0.5 参考 |
| -------------------- | ----- | ----- | ------ | -------- |
| `original`           | 39/40 | 40/40 | failed | 39/40    |
| `native-text`        | 40/40 | 40/40 | failed | 40/40    |
| `snapcompact`        | 31/40 | 28/40 | 29/40  | 34/40    |
| `snapcompact-recall` | 39/40 | 40/40 | 40/40  | 40/40    |

C 的 `original` / `native-text` 失败于 `Cannot read properties of null (reading 'prompt_tokens')`；它的 recall 臂有 3 次调用/3 个模型请求，有效。recall 臂合并接受分数是 **39.7/40**（39、40、40），head 21/21、middle 60/60、tail 38/39。0.5 参考只有一次，不与 0.4 合并。

strict recall 分别是 38/40（A）、38/40（B）、37/40（C）和 37/40（0.5）。接受匹配是主分数，因为引用整句会多出句号；strict 用于透明对照。

| 方案                 | input（A / B） | cache read      | cache write | output          | 加权成本（相对） |
| -------------------- | -------------- | --------------- | ----------- | --------------- | ---------------- |
| `original`           | 91 / 83        | 15,872 / 15,872 | 0 / 0       | 3,788 / 5,445   | 16,830 / 23,450  |
| `native-text`        | 17,396 / 1,651 | 0 / 15,616      | 0 / 0       | 10,784 / 11,474 | 60,532 / 49,109  |
| `snapcompact`        | 5,108 / 5,128  | 0 / 0           | 0 / 0       | 17,265 / 13,974 | 74,168 / 61,024  |
| `snapcompact-recall` | 7,286 / 7,857  | 19,328 / 13,184 | 0 / 0       | 1,549 / 1,942   | 15,415 / 16,943  |

这张表**只作诊断**：一次请求携带 40 题，无工具视觉臂会生成很长的答案，所以它不是稳态成本。成本以会话套件为准。

| 检查                             | 结果                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| Usage 审计（A）                  | reported 98,467，computed 98,467，unreported 0              |
| Usage 审计（B）                  | reported 92,226，computed 92,226，unreported 0              |
| Usage 审计（C，recall + visual） | reported 40,672，computed 40,672，unreported 0              |
| Usage 审计（session）            | reported 861,307，computed 861,307，unreported 0，27 个请求 |
| 视觉 checkpoint（A/B）           | 3 帧，估算 5,701 token，预算 6,741，593 ms                  |
| 视觉 checkpoint（0.5）           | 5 帧，估算 8,382 token，预算 8,426，797 ms                  |
| 归档完整性                       | 每次运行 40/40 source 原文可找回                            |

### 长会话成本

| 方案                 | 6 轮 prompt | 单请求峰值 prompt | output | 加权成本 | 相对 original | 准确率 | 请求 | recall 调用 | 工具字节 |
| -------------------- | ----------- | ----------------- | ------ | -------- | ------------- | ------ | ---- | ----------- | -------- |
| `original`           | 476,393     | 79,645            | 550    | 50,625   | 1.00×         | 8/8    | 6    | 0           | 0        |
| `native-text`        | 83,979      | 995               | 1,505  | 87,119   | 1.72×         | 8/8    | 6    | 0           | 0        |
| `snapcompact`        | 124,104     | 20,954            | 1,000  | 35,598   | 0.70×         | 4/8    | 6    | 0           | 0        |
| `snapcompact-recall` | 173,276     | 22,154            | 500    | 39,570   | 0.78×         | 8/8    | 8    | 2           | 931      |

每臂使用同一条持久历史：source/checkpoint 只放一次，之后追加问题、回答和 recall 页面。recall 臂的两个检索轮各需要第二次模型请求（一次工具调用）；其余四轮是 plain。视觉臂本地渲染 19 帧，估算 checkpoint 27,446 token。native 臂包含一次摘要生成。

| 检索率敏感性 | 加权成本 | 相对 original | 来源                    |
| ------------ | -------- | ------------- | ----------------------- |
| 0%           | 35,598   | 0.70×         | 视觉臂实测              |
| 33%          | 39,570   | 0.78×         | schedule 实测           |
| 100%         | 51,070   | 1.01×         | 由 heavy/plain 轮次外推 |

100% 是 modeled，不是真实运行；它把四个 plain 轮替换为实测 heavy 轮均值。真实 100% schedule 的 cache 行为也会变，所以标为模型。

| Recall 归因     | 估算 token | 占 prompt |
| --------------- | ---------- | --------- |
| checkpoint 重发 | 165,284    | 95.4%     |
| recall 工具页   | 233        | 0.1%      |
| 其它 prompt     | 7,759      | 4.5%      |
| output          | 500        | —         |

checkpoint 重发 = 视觉臂实测 plain 轮 prompt × recall 臂请求数；工具页 = 序列化字节 ÷ 4。页面本身几乎免费，成本来自每个检索轮多一次请求时重发的 checkpoint。

| 容量（确定性） | 估算 source token | original 装得下 200k | checkpoint 估算 |
| -------------- | ----------------- | -------------------- | --------------- |
| 250,000 字符   | 62,500            | yes                  | 27,446          |
| 500,000 字符   | 125,000           | yes                  | 27,446          |
| 1,000,000 字符 | 250,000           | no                   | 27,446          |

### 这次运行说明了什么

- **v3 的记账问题是真的，已修好。** v4 审计把每个 measured 请求和 provider total 对账。准确性 A 的 98,467 和会话的 861,307 都是 0 unreported。v3 recall 运行差的 18,688 正是漏掉的 `prompt_cache_hit_tokens`；v3 的“19,812 total”不是测量值。
- **recall 是精确的。** 0.4 recall 臂三次平均 39.7/40（head 21/21、middle 60/60、tail 38/39），长会话 8/8。纯视觉臂在准确性语料 28–31/40、长会话 4/8，因为帧会漏掉或误读中段精确值。精确性由归档承担。
- **长会话确实省，但没达到计划目标。** 33% 检索轮的加权成本是 **0.78× original**（39,570 vs 50,625），不是 0.65×。单请求峰值是 **0.28×**（22,154 vs 79,645），通过 0.4× 目标。纯视觉 0.70× 更便宜，但只答对 4/8。
- **100% 检索轮不省。** modeled 100% 是 **1.01× original**。每个检索轮多一次请求并重发 checkpoint；0.4 份额下这足以抵消节省。0.9× 目标未达到。
- **成本在 checkpoint，不在页面。** recall prompt 的 95.4% 是 checkpoint 重发，工具页只占 0.1%。snippet 已经把页面问题解决；剩余杠杆是更少的检索轮、更小的 checkpoint 或更高的 cache 折扣；继续降份额会牺牲视觉准确率和帧数。
- **0.4 默认是有意的取舍。** 准确性语料上 0.4 用 3 帧、5,701 token，纯视觉 28–31/40；0.5 用 5 帧、8,382 token，纯视觉 34/40。recall 臂在两个份额下都是 39–40/40。如果纯视觉路径更重要，设 `budget.checkpointShare: 0.5`。
- **原生摘要在 6 轮尺度不是成本赢家。** 它是 1.72× original：一次性摘要生成占主导，尽管每轮 prompt 很小。更长的时间尺度可能改变结论，但本套件不宣称。
- **容量是另一条轴。** 337,000 字符的原文约 80k token；到 1,000,000 字符时原文装不进 200k 窗口，而 checkpoint 仍在 27k 左右。那个规模上的价值是容量，不是更低的账单。

### 对计划验收

| 项                | 目标                                      | 结果                             |
| ----------------- | ----------------------------------------- | -------------------------------- |
| Usage 审计        | 所有 measured 运行 `unreportedPrompt = 0` | 通过（A/B/C/session）            |
| recall 准确率     | 均值 ≥ 39.5/40                            | **39.7/40**（39、40、40）        |
| recall middle     | ≥ 59/60                                   | **60/60**                        |
| recall head       | 21/21                                     | **21/21**                        |
| recall tail       | ≥ 38/39                                   | **38/39**                        |
| 长会话峰值 prompt | ≤ 0.4× original                           | **0.28×** 通过                   |
| 33% 检索轮        | ≤ 0.65× original                          | **0.78×** 未达到                 |
| 100% 检索轮       | ≤ 0.9× original                           | **1.01×** 未达到                 |
| 纯视觉路径        | 如实报告，不设通过线                      | 准确性 28–31/40，会话 4/8，0.70× |
| 工程              | `check` 全绿                              | 通过（319 个测试）               |

33% 和 100% 的成本目标没有达到。实测结果是：三分之一检索轮省 22%，每轮都检索时基本持平。这就是“压缩还有没有意义”的诚实答案：长历史、适中精确检索频率下有意义；高检索率或短会话下没有。

### 为什么 v3 不可比

- v3 recall 运行报告 `total_tokens = 32,593`，但只映射了 13,905 input+output；差的 18,688 是独立的 cache-hit 侧。修正后四轮 prompt 约 36,550，不是 18,341。
- v3 的“3 轮上下文”列是把冷启动单请求 prompt 乘 3；它既不是三轮，也不是账单，还没有 output 和 cache 价格。v4 报告 input、cache read、cache write、output 和相对加权成本。
- v3 用的是 63,000 字符、16k token 的语料，original 永远装得下。v4 的会话语料是 337,000 字符、约 80k token。
- v3 一次请求问 40 题，强制 2–4 个 recall 轮和约 5k 页面。v4 会话 schedule 是 33% 检索轮，每轮 1–3 题。
- 本文档已删除 v3 表格，不要再引用。

### 复现

```text
/snapcompact benchmark 3
/snapcompact benchmark session 1
```

可追踪脚本把 JSON 和 Markdown 写到 `.artifacts/v4/`：

```sh
node --experimental-strip-types scripts/benchmark-live.ts --preflight --lines=5000 --share=0.4
node --experimental-strip-types scripts/benchmark-live.ts --suite=accuracy --runs=3 --share=0.4
node --experimental-strip-types scripts/benchmark-live.ts --suite=session --runs=1 --share=0.4
```

accuracy 的三次单进程调用两次卡在 provider，最终由两次完整单跑加一次部分跑替代；上面的数据是已完成的测量，不是合成重跑。session 是一次运行。换路由前请重新跑同一组命令。
