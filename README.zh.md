<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact 归档帧图标"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · 简体中文

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md#安装)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**把长会话渲染成图片来压缩，而不是总结掉。**

会话变长时，Snapcompact 把对话中段渲染成密集的 PNG 帧，交给视觉模型直接阅读。视觉路径本身不调用摘要模型；精确头尾文本留在原位，可检索归档保存原文，命令、路径和标识符都能找回。

适合长代码或调试会话——几十轮之后，你还要精确找回某条命令。不适合短会话、纯文本模型或 minimal 模式。

**安装：** 插件 → 添加插件 → `dsh-snapcompact@0.5.3` → 新建会话 → **Snapcompact (Standard)**。无需构建。

## 为什么用图片

视觉模型主要按图片面积计费，和图片里塞了多少字符关系不大。在可读的前提下，一帧密集图片用同样的 token 能装下更多字符。于是，被丢弃的中段变成几张可读的图片，而不是一段有损摘要。

|            | 原始历史 | 原生摘要     | Snapcompact（视觉路径）    |
| ---------- | -------- | ------------ | -------------------------- |
| 保留内容   | 全部     | 摘要         | 精确头尾 + 归档中段        |
| 压缩成本   | 0        | 一次模型调用 | 0（本地渲染）              |
| 每轮上下文 | 最大     | 通常最小     | 比原始小，通常比精简摘要大 |
| 精确字符串 | 有       | 可能丢失     | 可从归档回查               |

**什么时候划算：** 长历史、图片 token 便宜的路由，以及压缩后仍要精确找回原文的工作。**什么时候不划算：** 短会话、纯文本路由，或者一段精简摘要就够用。

## 你得到什么

- **视觉路径不调用摘要模型。** 渲染在本地完成：没有生成成本，不联网，也不需要额外的 API key。
- **压缩后仍能精确回查。** 精确头尾文本 + 可检索归档；`snapcompact_recall` 可以逐行读取。
- **文件地图不会丢。** 由 read/write/edit 调用生成的有界 `FILES` 索引，带 `(Read)`/`(Write)`/`(RW)` 标记。
- **失败有兜底。** `snapcompact → handoff → shake → soft`，原生摘要是最后一步。
- **保留 DSH 原生行为。** 区间选择、事务锁、恢复和容量校验仍由宿主负责。

## 实测

| 对照（fixture v2，40 题） | 精确匹配 | 中段 probe | 每轮读取 | 一次性生成 | 3 轮合计 |
| ------------------------- | -------: | ---------: | -------: | ---------: | -------: |
| 原始历史                  |    38/40 |          — |   15,107 |          0 |   45,321 |
| 原生摘要                  |    40/40 |          — |    1,515 |     20,361 |   24,906 |
| Snapcompact               |    36/40 |       8/10 |    6,717 |          0 |   20,151 |

视觉检查点（checkpoint）在首次压缩时更便宜（6,717 vs 21,876），3 轮合计也更便宜（20,151 vs 24,906）；摘要大约从第 4 轮开始反超。视觉组答对 8/10 个中段 probe，这是第一个真正依赖帧读取的分数；4 个未命中里有 2 个是头尾事实，归档里仍然保留。固定语料也可能出现顺序反转（原生摘要 40/40，原文 38/40），请在你的路由上跑 `/snapcompact benchmark`。

## 安装

需要 DSH `^0.2.2-rc.1`（在 `0.2.2-rc.1` 上验证）和 Node.js 24+。npm 包已包含编译后的 `dist/`，没有构建步骤，也没有安装脚本。0.2.x 的 patch 可以直接安装，不需要重新发布插件；下一条 minor 只在重新验证后才会声明。

1. 打开 **插件（Plugins）→ 添加插件（Add plugin）**。
2. 安装 `dsh-snapcompact@0.5.3`。
3. 若页面提示重启，按提示完成；然后新建会话，选择变体。

| 官方模式   | 选择                       | 保留的行为                                               |
| ---------- | -------------------------- | -------------------------------------------------------- |
| `standard` | **Snapcompact (Standard)** | shell、文件工具、搜索、子代理、workflow、web、plan mode  |
| `ptc`      | **Snapcompact (PTC)**      | `run_code` 仍是唯一直接工具，其余工具通过 `tools.*` 调用 |
| `cordis`   | **Snapcompact (Cordis)**   | `tool-cordis` 与官方 Cordis 技能目录                     |

安装只会新增可选 preset，不会修改官方 preset 或运行中的会话；选中变体就是启用动作，已有会话保持启动时的 preset。`minimal` 不提供：这个模式刻意去掉 read/write/edit，加入帧和归档回查会违背其定位。

通过命令行安装：

```sh
dsh plugin --profile web add dsh-snapcompact@0.5.3
```

把 `web` 换成你实际使用的 profile。使用 DSH Desktop 时优先用应用内插件页：CLI 可能写入桌面端不使用的 profile。

<details>
<summary>其他分发来源</summary>

也可以安装本地打包的 tarball 或 tarball URL：

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.5.3.tgz"
```

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-0.5.3.tgz
```

npm 包是预构建选项；使用本地源码时需要先执行 `pnpm pack`（或 `pnpm run build`）。

</details>

## 工作原理

```text
DSH 选择安全的压缩区间
        │
        ▼
精确归档（sha256） ── 在 checkpoint 之后仍然保留
        │
        ▼
snapcompact → handoff → shake → soft
        │
        ▼
原生事务提交一个 checkpoint
```

| 顺序 | 方法          | 模型调用 | 产出                                     |
| ---- | ------------- | -------- | ---------------------------------------- |
| 1    | `snapcompact` | 无       | 密集帧、精确头尾、`FILES` 索引、归档引用 |
| 2    | `handoff`     | 一次调用 | 结构化任务交接                           |
| 3    | `shake`       | 无       | 大工具输出先归档，再用有界摘录替代       |
| 4    | `soft`        | 原生摘要 | DSH 原生文本摘要                         |

只有当路由声明支持图片输入并提供计价（或带标签的估算），且 checkpoint 放得进触发阈值下的剩余空间时，才会走视觉路径；否则按链回退到文本。取消会终止本次压缩，不会静默改用下一种方法。

一个 checkpoint 大致如下（已删节；示例为实际 checkpoint 的英文格式）：

```text
Snapcompact v2; method=snapcompact
Exact archived history: sha256:…
Visual checkpoint: N frames; ¶ marks a source newline; use snapcompact_recall for exact strings.
FILES (from read/write/edit; not a disk snapshot)
(Read) read-only; (Write) written without a read; (RW) read and written
# src/compaction/
visual-source.ts (Read)
## methods/
snapcompact.ts (RW)
[exact text head]
[frame 1 of N] … [frame N of N]
[exact text tail]
[file] snapcompact archive reference
```

## 使用

| 入口                     | 作用                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `/compact`               | 手动压缩；在任一 Snapcompact preset 内由 Snapcompact 链执行 |
| `/snapcompact status`    | 查看路由、有效阈值、可压空间、各方法可用性和归档数量        |
| `/snapcompact benchmark` | 运行合成对照；最多四次辅助模型调用，可能产生费用            |
| `snapcompact_recall`     | 列举、分页读取或字面量搜索归档                              |

```json
{ "action": "list" }
{ "action": "read", "archiveId": "sha256:…", "offset": 0, "limit": 100 }
{ "action": "search", "archiveId": "sha256:…", "query": "pnpm deploy --filter" }
```

回查返回物理行号和 `(nextOffset, nextColumn)` 游标。文本分页最多返回 200 行片段和 20,000 个 UTF-16 码元。搜索是区分大小写的字面量子串匹配，不是正则。只有当前会话中已完成压缩引用过的归档 ID 才能访问。

## 配置

**插件 → Snapcompact** 设置卡覆盖常用项，通过 DSH 的设置服务写入当前 profile 的配置补丁。一张卡同时配置三个变体；保存后的改动对新会话生效。

| 界面项   | 配置键                                                                       | 默认                                  |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| 方法链   | `methodOrder`                                                                | `[snapcompact, handoff, shake, soft]` |
| 触发阈值 | `policy.thresholdRatio`                                                      | 宿主默认 0.8                          |
| 保留尾部 | 自动派生 `thresholdRatio ÷ 5`；YAML 可用 `retainRatio` / `retainTokens` 覆盖 | 0.8 时 0.16                           |
| 帧尺寸   | `rendering.width` / `rendering.height`                                       | 1568                                  |
| 最多帧数 | `rendering.maxFrames`                                                        | 20（上限 64）                         |
| 归档上限 | `archiveMaxBytes`                                                            | 64 MiB                                |
| 交接预算 | `handoffMaxTokens`                                                           | 4096                                  |
| 外置阈值 | `shakeThresholdChars`                                                        | 8192                                  |

`guard`、`serialization`、`routePolicies` 和渲染上限只在 YAML 里配置。完整字段见[配置文档](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)。

## 限制与隐私

- **不是无损压缩。** 帧可能漏字符；行尾不可见空格会被裁掉，每个源换行变成 `¶`。以归档为准，但归档也救不回其他插件已经删掉的内容。最多携带 4 张已有图片。
- **省不省取决于路由和使用时长。** 短会话里精简摘要可能更小；长历史或图片 token 便宜时视觉路径更划算。checkpoint 更小，不等于账单更低。
- **图片路径的适用条件很窄。** 路由必须声明图片输入和计价；帧不可读或预算不够时回退文本。路由没有图片计价时，DSH 自身的上下文计量可能在下一次 provider usage 锚定前滞后；插件用自己的保守帧价做视觉 gate。
- **`FILES` 是索引，不是磁盘快照。** 它只看 read/write/edit，不看 `bash` 或 apply-patch。
- **无遥测。** 归档保存在 profile 的 attachment 存储里，对话数据不会上传到别处。

## 常见问题

<details>
<summary>安装后 preset 选择器里没有 Snapcompact 变体</summary>

先确认插件显示为已安装；如果插件页要求重启，请完成重启；然后**新建**会话，查找 **Snapcompact (Standard)**、**Snapcompact (PTC)** 和 **Snapcompact (Cordis)**。已有会话会保持它启动时使用的 preset。使用 DSH Desktop 时，请确认是通过应用内插件页安装，而不是装进了桌面端不使用的 CLI profile。

</details>

<details>
<summary>总是回退文本，从不渲染图片</summary>

运行 `/snapcompact status`。最常见的原因是当前路由没有声明图片输入或没有图片计价，这是预期的安全行为。历史中已有图片时会优先携带，最多 4 张；没有剩余图片槽位时才回退文本交接。

</details>

<details>
<summary>压缩失败，提示 “No compaction method produced a safe smaller checkpoint”</summary>

说明所有候选都被跳过或未通过预算检查。先看 `/snapcompact status`，等历史更长一些再试，或换用文本摘要可用的路由。错误信息会列出每个方法的原因；取消是单独报告的，不会继续回退。

</details>

<details>
<summary>启动被拒绝，提示 “leaves only … of the window compactable”</summary>

通常是 YAML 里显式写了 `retainRatio`/`retainTokens`，留给 checkpoint 的空间太小。提高 `policy.thresholdRatio`、降低或删除显式尾部，或设置 `guard.minCompactableRatio: 0`。

</details>

<details>
<summary>压缩失败，提示 “below the …-token floor”</summary>

本次源历史小于 `max(1024, 窗口 × guard.minSourceRatio)`。等历史更长再压缩，或调低 `guard.minSourceRatio`（设为 `0` 关闭收益门槛）。该守卫在创建归档和调用方法之前运行，所以没有产生任何开销。

</details>

<details>
<summary>安装被判定为不兼容</summary>

这个构建声明 DSH `^0.2.2-rc.1`，并在 `0.2.2-rc.1` 上验证。请安装声明了你所用 minor 的 Snapcompact 版本；不要手改兼容性检查来强装。

</details>

## 文档

- [配置与路由计价](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)
- [架构与代码阅读顺序](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/architecture.md)
- [评测及解释边界](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation.md)
- [评测结果与成本口径](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation-results.md)
- [第三方许可与来源](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.zh.md)
- [问题与反馈](https://github.com/Cyberbolt/dsh-snapcompact/issues)
- [English docs](https://github.com/Cyberbolt/dsh-snapcompact/tree/main/docs)

## 开发

```sh
pnpm install --ignore-scripts
pnpm run check          # 类型、lint、格式、构建、preset、测试、包资源
pnpm run check:install  # 把打包后的 tarball 安装到一次性 DSH profile
pnpm run release:plan   # 预演当前版本是否会被发布
pnpm pack
```

`check:install` 不会触碰真实 profile，临时目录保留在 `.artifacts/` 下，可用 `--keep` 保留用于排查。DSH 包是宿主提供的 peer；开发安装只用于本地类型和集成测试模块。本包不需要安装脚本。

源码按压缩、归档、渲染、计量、DSH 适配和评测分层，开启严格 TypeScript 检查。建议从[架构与阅读顺序](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/architecture.md)开始。注释与主文档使用英文，中文文档同步维护。

## 许可

原创应用代码使用 [MIT](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)。内置的 GNU Unifont 18.0.01 数据保留 SIL Open Font License 1.1；见[第三方声明](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.zh.md)。
