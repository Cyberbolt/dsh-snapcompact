# 架构与阅读指南

[English](architecture.md)

## 先看数据流

原生 balanced-range 选择 → 确定性序列化 → 本地视觉 checkpoint → 能力、计价与完整预算校验 → **原生 compaction 事务**。

插件不替换事务引擎、不发明 Session 事件类型、不静默改写路由请求、不使用隐藏的 workspace/profile 文件。它只向 host 提供一个候选 summary；是否提交由 host 决定。

## checkpoint 里有什么

已提交的 checkpoint 是一条普通 summary 消息。没有归档附件，没有 recall 工具。block 顺序：

1. 简短 guide：帧顺序、`¶` 换行标记、exact-token 索引，以及“后续问题必须重读 checkpoint”的规则；
2. 可选的 `FILES` 索引，来自 read/write/edit 调用；
3. 精确 head 文本（投影的前 `serialization.headChars` 个字符）；
4. carried images，最旧在前，受 host 图片策略限制；
5. 中段被裁剪时的 omission marker；
6. 中段的位图帧，最旧在前；
7. 精确 tail 文本（投影的后 `serialization.tailChars` 个字符）；
8. 有界 exact-token 索引：从同一投影复制的、最多 80 行带标签文本；
9. 重复“不要凭记忆回答”的收尾规则。

精确 head/tail 和索引是文本；帧承载周围历史。索引存在的原因是 64 字符摘要无法从像素可靠读出。它是确定性的，与帧来自同一序列化历史，不是搜索工具或归档。

## 序列化

`serializeConversation` 构建面向帧的投影，而不是逐字节 transcript：

- section 前缀（`»user:`、`»ai:`、`»think:`、`»call:`）替代冗长的 JSON 式头；
- 工具调用与结果合并为一个 section，命令紧挨输出；
- 每个字段头尾裁剪（消息文本默认 1,500 字符，工具结果 1,200，单参数 500），带可见的 `…Nch elided…` 标记；
- 常规 `INFO`/`PASS`/stack frame/metric/paragraph 行被丢弃，并用一个 `routine log lines elided` 标记计数；
- 结构相同的长行段折叠为前两行、后两行和计数；
- 匹配通用 exact-token 模式（校验和、命令、路径、端口、超时、锁、flag、owner、target、事故事实）的行加前导 `* ` 标记；
- exact-token 索引提取这些行的带标签子集，去重并限长。

过滤器刻意保持通用。它们不知道问题、fixture 或 benchmark。带持久标签或值的行保留；常规日志噪声丢弃。代价是明确的：埋在长 `INFO` 行里的唯一精确串可能被丢弃；错误、带标签事实、命令、路径和摘要保留。

## 渲染

渲染是本地、零模型调用的路径：

- 只使用 bundled GNU Unifont 18.0.01 位图字体；覆盖拉丁、CJK、假名、谚文和常见符号；
- 布局是连续文本流：满行在帧边缘换行，一个 `¶` 标记每个源换行，保留行首缩进，内部连续空格折叠；
- `letterSpacing`（默认 2 px）加宽每个 cell；`lineHeight`（默认 20 px）控制行距；两者都用每帧字符数换 OCR 可读性；
- 帧是一比特灰度 PNG，密集文本压缩好，双色字体没有损失；
- 帧尺寸、数量和像素投影在提交前按 host 图片限制与模型可读字高下限校验；
- 中段超出帧预算时，布局保留时间轴两端，丢弃最旧的密集中心（foveation）；精确 head/tail 留在帧外。

模型的 image tokenization 与 max-edge 策略通过 host 的 image route 解析。没有声明视觉能力或没有可用价格估计的路由回退到文本链。

## FILES

checkpoint 在帧外携带一个有界 `FILES` 文本块。它由 read/write/edit 工具参数和早先的 snapcompact checkpoint 确定性派生；`bash`、apply-patch 和其他变更路径不在范围内。FILES 是 `(Read)` / `(Write)` / `(RW)` 导航元数据，不是文件系统快照，并计入 checkpoint token 估算。

## 事务与生命周期

每个 preset 拥有一个带界队列的 renderer 实例。deadline 包含排队等待和冷启动。dispose 永久拒绝新工作、终止 worker，不影响另一个 preset 的队列。

DSH 拥有 maintenance admission 和事务锁；插件不添加竞争的 session lock。失败的候选不会被部分提交。取消会停止压缩，绝不静默选择下一个方法。

## 有意的取舍

- **压缩后没有搜索。** 没有归档，没有 recall 工具。精确串可从精确 head/tail 和有界 exact-token 索引恢复；同时被两者裁掉的串不可恢复。这是 0.7.0 的契约。
- **索引有界。** 最多 80 行带标签文本。它是可读性辅助，不是完整 transcript。
- **常规日志行会被省略。** 常规 `INFO` 行里的唯一值可能丢失；错误和带标签事实保留。
- **渲染确定但非无损。** 源投影可能丢字符；精确文本和索引是它们所含字符串的 source of truth。
- **视觉路径不总是更便宜。** 它避免 summary 调用，峰值 prompt 通常小得多，但图片 token 贵或 horizon 短时可能比原始文本更贵。v5 benchmark 报告逐轮加权成本，不承诺普遍节省。
- **估算大小、阅读准确率和金钱成本是不同测量。** 显式 benchmark 校准路由；绝不静默改用户配置。

### 没有移植的渲染杠杆

渲染器刻意保持为小型 1-bit TypeScript 路径。它没有实现 omp 的灰度 dim ink、内嵌 Silver TrueType fallback、六色句子 ink 或 line repetition。它改用通用 `* ` 标记 exact-token 行、2 px cell advance、Unifont 自带 CJK 覆盖，以及有界 exact-token 文本索引承载摘要和路径。这些省略写在这里，而不是藏在 benchmark 声明里；v5.1 测的就是实际发布的渲染器。
