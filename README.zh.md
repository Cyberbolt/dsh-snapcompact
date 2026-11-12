<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact 帧图标"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**把长 DSH 会话压缩成可读的渲染结果，而不是摘要。**

会话变长时，Snapcompact 把 transcript 的中段确定性序列化，渲染成视觉模型可直接阅读的密集 PNG 帧，并在帧旁保留一个有界的 exact-token 文本索引。视觉路径不调用摘要模型；精确 head/tail 文本留在原位。没有归档，也没有 recall 工具：精确串来自 checkpoint 里已有的精确文本和索引。

适用于长代码/调试会话：你仍需要很多轮之前的命令、路径、校验和或标识符。不适用于短聊天、纯文本路由或 minimal 模式。

**安装：** Plugins → Add plugin → `dsh-snapcompact@0.7.0` → 新会话 → **Snapcompact (Standard)**。无需构建。

> **0.7.0 移除归档和 `snapcompact_recall`。** 精确串现在保存在 checkpoint 自身（head/tail 文本 + 有界 exact-token 索引），而不是压缩后回查。如果你依赖搜索旧归档，请留在 0.6.x。见[迁移说明](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/migration-0.7.md)。

## 为什么渲染？

视觉模型主要按图像面积计费，而不是按图像里有多少字符。在可读性上限内，密集帧每 token 能承载比逐字文本更多的内容。Snapcompact 把被丢弃的中段变成少量可读图像，而不是有损摘要；再加一个小文本索引，承载像素无法可靠读出的字符串。

|            | 原始历史 | 原生摘要     | Snapcompact（视觉路径）                     |
| ---------- | -------- | ------------ | ------------------------------------------- |
| 保留什么   | 全部     | 一份摘要     | 精确 head/tail + 帧 + 有界 exact-token 索引 |
| 压缩成本   | 0        | 一次模型调用 | 0（本地渲染）                               |
| 每轮上下文 | 最大     | 通常最小     | 小于原始；通常大于简短摘要                  |
| 精确串     | 有       | 可能丢失     | 在 head/tail 或索引中；不可搜索             |

**适合：** 长历史、图片 token 便宜的路由、压缩后仍需要精确串的工作。**不适合：** 短会话、纯文本路由、简短摘要就够的场景。

## 你会得到什么

- **视觉路径不调用摘要模型。** 渲染是本地行为：无生成成本、无网络调用、无额外 API key。
- **不需要工具就能读精确串。** 精确 head/tail 文本，加上有界的 exact-token 文本索引，覆盖校验和、路径、命令、标识符和带标签事实。
- **压缩后仍保留文件地图。** 来自 read/write/edit 调用的有界 `FILES` 索引，带 `(Read)`/`(Write)`/`(RW)` 标记。
- **安全回退。** `snapcompact → shake → soft`；原生摘要最后。
- **原生 DSH 行为。** Region 选择、事务锁、恢复和容量检查仍由 host 负责。

## 安装

需要 DSH `^0.2.2-rc.1`（在 `0.2.2-rc.1` 验证）和 Node.js 24+。npm 包自带编译后的 `dist/`；无构建步骤，无 install script。

1. 打开 **Plugins → Add plugin**。
2. 安装 `dsh-snapcompact@0.7.0`。
3. 如提示则重启，然后新建会话并选择变体。

| 官方模式   | 选择                       | 保留                                                  |
| ---------- | -------------------------- | ----------------------------------------------------- |
| `standard` | **Snapcompact (Standard)** | Shell、文件、搜索、subagent、workflow、web、plan mode |
| `ptc`      | **Snapcompact (PTC)**      | `run_code` 是唯一直接工具；其他通过 `tools.*`         |
| `cordis`   | **Snapcompact (Cordis)**   | `tool-cordis` 和官方 Cordis authoring skills          |

安装只添加 opt-in preset，不改官方 preset 或运行中的会话；选择变体就是启用动作，已有会话保留启动时的 preset。不支持 `minimal`：它刻意省略 read/write/edit，帧会破坏它的目的。

CLI：

```sh
dsh plugin --profile web add dsh-snapcompact@0.7.0
```

替换你的 profile 名。DSH Desktop 优先用应用内 Plugins 页面：CLI 可能写到桌面应用不用的 profile。

<details>
<summary>其他安装来源</summary>

本地 tarball 和 tarball URL 也可以：

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.7.0.tgz"
```

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-0.7.0.tgz
```

npm 包是预构建选项；本地 checkout 需要先 `pnpm pack`（或 `pnpm run build`）。

</details>

## 工作方式

```text
DSH 选择安全区域
        │
        ▼
确定性序列化
（head/tail 上限、常规日志省略、exact-token 标记）
        │
        ▼
snapcompact → shake → soft
        │
        ▼
DSH 提交一个 checkpoint：
精确 head/tail + 位图帧 + exact-token 索引
```

| 顺序 | 方法          | 模型调用 | 输出                                                   |
| ---- | ------------- | -------- | ------------------------------------------------------ |
| 1    | `snapcompact` | 无       | 密集帧、精确 head/tail、`FILES` 索引、exact-token 索引 |
| 2    | `shake`       | 无       | 超大工具输出替换为有界摘录                             |
| 3    | `soft`        | 原生摘要 | DSH 原生文本摘要                                       |

视觉方法只在路由声明图片输入和计价（或带标签估算）且 checkpoint 放得进触发余量时运行；否则链回退到文本。取消会停止压缩，绝不静默选择下一个方法。

checkpoint 示例（节选）：

```text
Visual snapcompact checkpoint: N bitmap frames; ¶ marks a source newline; …
FILES (from read/write/edit; not a disk snapshot)
# src/compaction/
visual-source.ts (Read)
## methods/
snapcompact.ts (RW)
[精确 head 文本]
[frame 1 of N] … [frame N of N]
[精确 tail 文本]
Exact-token index (deterministic; copy values character for character):
* artifact checksum sha256:…
* the migrate command was pnpm run migrate --to=…
Checkpoint rule: for every later question, re-read the relevant frame or the index.
```

## 使用

| 入口                           | 作用                                          |
| ------------------------------ | --------------------------------------------- |
| `/compact`                     | 手动压缩；在 Snapcompact preset 内运行方法链  |
| `/snapcompact status`          | 路由、有效阈值、可压空间和逐方法可用性        |
| `/snapcompact benchmark [1-5]` | 生成的 task-level dev benchmark；可能产生费用 |

0.7.0 没有 `snapcompact_recall` 工具。精确串从 checkpoint 的精确 head/tail 文本和 exact-token 索引读取。同时被两者裁掉的串不可恢复。

## 配置

**Plugins → Snapcompact** 卡片覆盖常用键，通过 DSH settings service 写入 profile 的 config patch。一个卡片配置三个变体；保存值对新会话生效。

| 控件     | Key                                                                   | 默认                         |
| -------- | --------------------------------------------------------------------- | ---------------------------- |
| 方法链   | `methodOrder`                                                         | `[snapcompact, shake, soft]` |
| 触发阈值 | `policy.thresholdRatio`                                               | host 默认 0.8                |
| 保留尾部 | 派生 `thresholdRatio ÷ 5`；YAML `retainRatio` / `retainTokens` 可覆盖 | 0.8 时为 0.16                |
| 帧尺寸   | `rendering.width` / `rendering.height`                                | 1568                         |
| 最大帧数 | `rendering.maxFrames`                                                 | 40（最大 64；host cap 优先） |
| 行高     | `rendering.lineHeight`                                                | 20                           |
| 字间距   | `rendering.letterSpacing`                                             | 2                            |
| 外置阈值 | `shakeThresholdChars`                                                 | 8192                         |

`budget.checkpointShare`、`guard`、`serialization`、`routePolicies` 和渲染限制是 YAML-only。`budget.checkpointShare`（0.25–0.5，默认 0.4）是一个 checkpoint 可花掉触发余量的比例。每个字段见[配置参考](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)。

## 限制与隐私

- **压缩后没有归档，也没有搜索。** 这是 0.7.0 的契约。精确 head/tail 和有界索引是唯一精确串保证；同时被两者裁掉的唯一串会丢失。
- **非无损。** 帧可能丢字符；常规 `INFO`/`PASS`/stack frame/文件列表/metric 行会被省略，长字段头尾裁剪。错误、带标签事实、命令、路径和摘要保留。
- **exact-token 索引有界。** 最多 80 行带标签文本。它是可读性辅助，不是完整 transcript。
- **节省取决于路由和 horizon。** 短会话里简短摘要可能每轮更小。视觉路径通常峰值 prompt 小得多，但图片 token 贵或 horizon 短会抵消优势。v5 benchmark 报告逐轮加权成本；不是普遍节省承诺。
- **视觉资格很窄。** 路由必须声明图片输入和计价；帧不可读或预算太紧会回退文本。没有图片计价时，插件使用保守的模型族估算，并明确标注。
- **`FILES` 是索引，不是磁盘快照。** 它只看 read/write/edit，不看 `bash` 或 apply-patch。
- **无遥测。** 会话数据留在 profile 的 attachment storage；不上传到其他地方。

## 排障

<details>
<summary>选择器里没有 Snapcompact preset</summary>

确认插件已安装，按页面提示重启 DSH，然后新建**会话**，查找 **Snapcompact (Standard)**、**Snapcompact (PTC)** 和 **Snapcompact (Cordis)**。已有会话保留启动时的 preset。DSH Desktop 请通过应用内 Plugins 页面安装，而不是桌面应用不用的 CLI profile。

</details>

<details>
<summary>总是回退到文本</summary>

运行 `/snapcompact status`。路由可能没有声明图片输入或没有可用图片价格；这是预期的安全行为。已有图片最多携带四张；没有图片槽位时使用文本链（shake 摘录，然后原生摘要）。

</details>

<details>
<summary>压缩失败："No compaction method produced a safe smaller checkpoint"</summary>

每个候选都被跳过或超预算。检查 `/snapcompact status`；用更多历史重试，或换有可用文本摘要的路由。错误会列出每个方法的原因，取消单独报告。

</details>

<details>
<summary>启动被拒绝："leaves only … of the window compactable"</summary>

通常意味着 YAML 显式设置了 `retainRatio` 或 `retainTokens`，留下空间太少。提高 `policy.thresholdRatio`、降低或移除显式尾部，或设 `guard.minCompactableRatio: 0`。

</details>

<details>
<summary>压缩失败："below the …-token floor"</summary>

源历史小于 `max(1024, window × guard.minSourceRatio)`。等更多历史，或降低 `guard.minSourceRatio`（`0` 关闭）。

</details>

<details>
<summary>安装被拒绝为不兼容</summary>

本版本声明 DSH `^0.2.2-rc.1`，在 `0.2.2-rc.1` 验证。安装匹配 host minor line 的版本；不要手改检查。

</details>

## 文档

- [配置与路由计价](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)
- [架构与阅读指南](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/architecture.md)
- [评测与解释](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation.md)
- [0.7.0 迁移](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/migration-0.7.md)
- [第三方声明](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.zh.md)
- [问题与反馈](https://github.com/Cyberbolt/dsh-snapcompact/issues)
- [English docs](https://github.com/Cyberbolt/dsh-snapcompact/tree/main/docs)

## 开发

```sh
pnpm install --ignore-scripts
pnpm run check          # 类型、lint、格式、构建、preset、测试、包资源
pnpm run check:install  # 把打包 tarball 安装到一次性 DSH profile
pnpm run release:plan   # 预览当前版本是否会发布
pnpm pack
```

`check:install` 不碰真实 profile，临时 home 留在 `.artifacts/`，可用 `--keep` 调试。DSH 包是 host-provided peer；开发安装提供本地类型和集成测试模块。包不需要 install script。

v5 benchmark 是 `scripts/benchmark-v5.ts`。dev fixture 由提交的种子生成；test split 生成到 `.artifacts/`，不入库。见[评测指南](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation.md)和[预注册](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation-v5-prereg.md)。

## 许可

原始应用代码为 [MIT](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)。捆绑的 GNU Unifont 18.0.01 数据保留 SIL Open Font License 1.1；oh-my-pi snapcompact 设计参考为 MIT。见[第三方声明](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.zh.md)。
