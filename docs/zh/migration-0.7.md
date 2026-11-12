# 迁移到 0.7.0

[English](../migration-0.7.md)

## 变化

0.7.0 让纯视觉 checkpoint 自包含：

- **移除：** exact-text 归档、`snapcompact_recall` 工具、archive projection、checkpoint 上的归档附件，以及归档设置/指标。
- **增加：** 每个视觉 checkpoint 内的有界、确定性 exact-token 文本索引。它以文本承载带标签的校验和、路径、命令、标识符和关键事实，最多 80 行。
- **变化：** 序列化默认更密（消息文本 1,500 字符，工具结果 1,200），常规日志行被省略，帧默认 40、字间距 2 px。
- **变化：** benchmark 是 v5 生成的 task-level 套件。旧的 40 题单请求 fixture 和长会话套件作为门槛退役；历史结果保留在 [evaluation-audit.md](evaluation-audit.md)。

没有隐藏 recall 路径。0.7.0 checkpoint 没有归档附件，host 也没有本插件提供的 `snapcompact_recall` 工具。

## 谁受影响

- 如果你用 `snapcompact_recall` 搜索旧压缩归档，0.7.0 做不到。请留在 0.6.x，或在需要可搜索记录时使用原生文本摘要。
- 如果你只用视觉 checkpoint 提供上下文，并从 head/tail 或模型阅读中取精确串，0.7.0 是替代品：精确串现在在 head/tail 和 exact-token 索引中。
- 已有会话保留已有 summary。0.7.0 忽略旧归档附件，不删除它们。新的压缩产生没有归档的 0.7.0 checkpoint。

## 配置迁移

- `archiveMaxBytes` 被**接受并忽略**，所以保存的 0.6 profile 仍能挂载。方便时删除；设置卡不再写它。
- `rendering.maxFrames` 默认 40（host image cap 仍会 clamp）。新增 `rendering.letterSpacing`（默认 2）和更密的 `serialization` 默认。
- `methodOrder`、`budget.checkpointShare`、`policy`、`guard` 含义不变。链仍必须以 `soft` 结尾。
- `handoff` 方法仍退役。旧保存链读取时规范化；手写 YAML 仍写它会拒绝。

## 验证

```sh
pnpm check
pnpm run check:install
```

v5 benchmark 在 `scripts/benchmark-v5.ts`。test split 生成到 `.artifacts/`，不入库。见 [evaluation.md](evaluation.md) 和 [evaluation-v5-prereg.md](evaluation-v5-prereg.md)。
