<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact 帧图标"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact) · **简体中文**

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**DeepSeek Harness 上下文压缩插件：把 DSH 会话的历史上下文渲染成图片，让模型直接读图，而不是读摘要。**

具体实现：DSH 触发上下文压缩时，保持首尾部分的原内容，将中段部分渲染成图片（渲染在本地完成，不需要调用模型），每份压缩结果旁附一份可复制的精确文本索引和 `FILES` 文件地图。

该插件适合长时间运行、需要反复回溯细节的会话。不适用于短聊天压缩。

**快速开始：** 插件 → 添加插件 → `dsh-snapcompact` → 新建会话 → **Snapcompact (Standard)**。

## 安装

需要 DSH `0.2.x` 和 Node.js 24+。

1. 打开 **插件 → 添加插件**。
2. 安装 `dsh-snapcompact`。
3. 如提示则重启，然后新建会话并选择变体。

| 官方模式 | 对应的 Snapcompact 预设    |
| -------- | -------------------------- |
| 标准模式 | **Snapcompact (Standard)** |
| PTC 模式 | **Snapcompact (PTC)**      |
| 创造模式 | **Snapcompact (Cordis)**   |

不支持极简模式——它刻意省略了 `read`/`write`/`edit`，Snapcompact 会违背它的设计目的。

卸载：在插件页面移除插件即可。它新增的预设会一起消失；已生成的压缩结果会作为普通摘要保留在会话中。

命令行：

```sh
dsh plugin --profile web add dsh-snapcompact
```

把 `web` 换成你的 profile 名。DSH Desktop 请优先用应用内的插件页面：CLI 可能写到桌面应用不用的 profile。

<details>
<summary>其他安装来源</summary>

本地打包的 tarball 和 tarball URL 也可以：

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.7.0.tgz"
```

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-<version>.tgz
```

npm 包是预构建选项；本地 clone 需要先 `pnpm pack`（或 `pnpm run build`）。

</details>

## 为什么用图片代替摘要？

用图片代替摘要的思路来自 [Oh My Pi](https://github.com/can1357/oh-my-pi) 的 `snapcompact`；本插件是 `snapcompact` 在 DSH 上的独立实现。

视觉模型主要按图像面积计费，而不管图中有多少个字符。在可读性上限内，密集帧每 token 能承载的信息量高于纯文本。我们将原本会压缩为文本摘要的内容渲染为图片，由此做到保留更多上下文的同时降低 tokens 消耗。

|          | 原始历史 | 原生摘要     | Snapcompact                |
| -------- | -------- | ------------ | -------------------------- |
| 保留什么 | 全部     | 一份摘要     | 首尾精确文本、帧、文本索引 |
| 压缩成本 | 0        | 一次模型调用 | 0（本地渲染）              |
| 精确串   | 有       | 可能丢失     | 逐字留在首尾，并进索引     |

短会话中原生摘要可能更适用，见[限制](#限制)。

## 工作方式

```text
DSH 选择安全区域
        │
        ▼
确定性序列化（首尾上限、日志省略、精确 token 标记）
        │
        ▼
snapcompact → shake → soft
        │
        ▼
一个压缩结果（checkpoint）：首尾精确文本 + 帧 + 文本索引
```

| 顺序 | 方法          | 模型调用 | 输出                                                |
| ---- | ------------- | -------- | --------------------------------------------------- |
| 1    | `snapcompact` | 无       | 密集帧、首尾精确文本、`FILES` 索引、精确 token 索引 |
| 2    | `shake`       | 无       | 超大工具输出替换为有界摘录                          |
| 3    | `soft`        | 原生摘要 | DSH 原生文本摘要                                    |

`snapcompact` 方法（顺序 1）只在两个条件都成立时运行：路由（route：本会话所用的 provider/model，例如 `opencode-go/deepseek-v4.1-flash`）声明了图片输入和计价（或带标签的估算），且压缩结果放得进触发阈值下的余量。否则方法链回退到文本。取消会停止压缩，绝不会静默改选下一个方法。区域选择、事务锁、恢复和容量检查仍由宿主负责。

## 用法

| 入口                  | 作用                                                         |
| --------------------- | ------------------------------------------------------------ |
| `/compact`            | 手动压缩；需要在 Snapcompact 预设内运行                      |
| `/snapcompact status` | 当前路由（provider/model）、有效阈值、可压空间和逐方法可用性 |

## 配置

**插件 → Snapcompact** 卡片覆盖常用配置项，通过 DSH 的设置服务写入 profile 的配置补丁。一个卡片配置三个变体，保存的值对新会话生效。默认是方法链 `[snapcompact, shake, soft]`、窗口 0.8 的触发阈值、最多 40 帧；其余字段只能写 YAML——见[配置参考](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)。

## 限制

- **不是无损压缩，丢失来自两处。** 一是渲染成图这一步：位图字体覆盖不到的字符（emoji、生僻文字、组合符号）会显示成 `?`，制表符展开为空格、连续空格折叠、ANSI 转义被剥掉；而模型读的是像素不是文本，64 位 digest 这类串本来就不该指望从图里逐字读出。二是渲染之前这一步：常规 `INFO`/`PASS` 行、堆栈调用行、成片重复的文件清单和指标行会被确定性省略，超长字段只留头尾、删去中段，帧预算不够时，帧内文本保留时间轴两端、丢弃最旧的密集中段——每处省略都留下形状如 `[… elided …]` 的标记。错误、带标签事实、命令和路径不会被省略；需要逐字精确的内容以首尾精确文本为准（它不经过渲染，逐字保留），digest 等读图不可靠的串则收进文本索引。
- **是否更省取决于所用模型和上下文长度。** 短会话中一份简短摘要每轮可能更小；图片 token 贵或需要覆盖的历史短会抵消优势。实测数据见[评测结果](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation-results.md)。
- **不提供跨压缩检索。** 首尾文本和文本索引就是全部保证；被两者同时裁掉的唯一字符串，事后找不回来。

## 排障

<details>
<summary>选择器里没有 Snapcompact 预设</summary>

确认插件已安装，按页面提示重启 DSH，然后新建**会话**，查找 **Snapcompact (Standard)**、**Snapcompact (PTC)** 和 **Snapcompact (Cordis)**。已有会话保留启动时的预设。DSH Desktop 请通过应用内的插件页面安装。

</details>

<details>
<summary>总是回退到文本</summary>

运行 `/snapcompact status`。当前路由（provider/model）可能没有声明图片输入，或没有可用的图片计价，这是预期的安全行为。已有的图片最多携带四张；没有图片槽位时走文本链（先 shake 摘录，再原生摘要）。

</details>

<details>
<summary>压缩失败："No compaction method produced a safe smaller checkpoint"</summary>

每个候选都被跳过或超预算。检查 `/snapcompact status`；用更多历史重试，或切换到文本摘要可用的模型。错误会列出每个方法的原因，取消会单独报告。

</details>

## 文档

- [配置与路由计价](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)
- [架构与阅读指南](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/architecture.md)
- [评测与解释](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation.md)
- [评测结果](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation-results.md)
- [贡献指南](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/contributing.md)
- [0.7.0 迁移](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/migration-0.7.md)
- [第三方声明](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.zh.md)
- [问题与反馈](https://github.com/Cyberbolt/dsh-snapcompact/issues)
- [English docs](https://github.com/Cyberbolt/dsh-snapcompact/tree/main/docs)

## 开发

```sh
pnpm install --ignore-scripts
pnpm run check
pnpm pack
```

安装细节、安装检查和评测工具见[贡献指南](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/contributing.md)。

## 许可

原始应用代码为 [MIT](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)。捆绑的 GNU Unifont 18.0.01 数据保留 SIL Open Font License 1.1；Oh My Pi 的 snapcompact 设计参考为 MIT。见[第三方声明](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.zh.md)。
