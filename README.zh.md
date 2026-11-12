<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact 帧图标"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact) · **简体中文**

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**DeepSeek Harness 上下文压缩插件：将 DSH 的会话历史渲染为图片，用图片代替文本摘要，保留更多信息并减少 token 消耗。**

具体实现：DSH 触发上下文压缩时，保持首尾部分的原内容，将中段部分渲染成图片（渲染在本地完成，不需要调用模型），每份压缩结果旁附一份可复制的精确文本索引和 `FILES` 文件地图。

该插件适合长时间运行、需要反复回溯细节的会话。不适用于短聊天压缩。

**快速开始：** 插件 → 添加插件 → `dsh-snapcompact` → 新建会话 → **Snapcompact (Standard)**。

## 安装

需要 DSH `0.2.x` 和 Node.js 24+。

1. 打开 **插件 → 添加插件**。
2. 安装 `dsh-snapcompact`。
3. 如提示则重启，然后新建会话，选择官方模式对应的 Snapcompact 预设。

| 官方模式 | 对应的 Snapcompact 预设    |
| -------- | -------------------------- |
| 标准模式 | **Snapcompact (Standard)** |
| PTC 模式 | **Snapcompact (PTC)**      |
| 创造模式 | **Snapcompact (Cordis)**   |

不支持极简模式——它刻意省略了 `read`/`write`/`edit`，Snapcompact 会违背它的设计目的。

卸载：在插件页面移除插件即可。它新增的预设会一起消失；已生成的压缩结果会作为普通摘要保留在会话中。

命令行：

```sh
dsh plugin --profile <你的 profile 名> add dsh-snapcompact
```

DSH Desktop 请优先使用应用内的插件页面。

<details>
<summary>其他安装来源</summary>

本地打包的 tarball 请执行：

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.7.2.tgz"
```

tarball URL 请执行：

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-<version>.tgz
```

npm 包是预构建选项，如果是本地 clone，需要先执行 `pnpm pack`（或 `pnpm run build`）。

</details>

## 为什么用图片代替摘要？

用图片代替摘要的思路来自 [Oh My Pi](https://github.com/can1357/oh-my-pi) 的 `snapcompact`；本插件是 `snapcompact` 在 DSH 上的独立实现。

视觉模型主要按图像面积计费，而不管图中有多少个字符。在可读上限内，密集帧每 token 能承载的信息量高于纯文本。我们将原本会压缩为文本摘要的内容渲染为图片，由此做到保留更多上下文的同时降低 tokens 消耗。

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

snapcompact（顺序 1）只在两个条件同时成立时运行：

- **模型支持图片输入与计价**。 此会话的路由（provider/model，例如 opencode-go/deepseek-v4.1-flash）要声明图片输入，并能确定图片计价：适配器提供价格、配置了显式的每帧上限，或对已知模型族使用带标签的保守估算。
- **完整 checkpoint 放得下**。 整个 checkpoint 必须落在触发阈值以下的剩余空间内（阈值减去 system prompt、工具 schema、输出预留和保留尾部等不可替换部分）。

任一条件不成立，就会跳过 snapcompact，由方法链继续尝试下一个方法，最终落到原生摘要。

## 命令

| 入口                  | 作用                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `/compact`            | 手动压缩；需要在 Snapcompact 预设内运行                                                  |
| `/snapcompact status` | 显示当前路由（provider/model）、触发阈值、保留尾部与可压缩空间，以及每个压缩方法能否运行 |

## 配置

在 **插件 → Snapcompact** 的设置卡中管理常用配置项。保存后只影响新会话，已有会话仍按创建时的配置运行。默认方法链为 [snapcompact, shake, soft]，上下文窗口用到 80% 时触发，每次压缩最多渲染 40 帧；其余配置项需要手写 YAML，详见[配置参考](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)。

## 限制

- **不是无损压缩：渲染前后两个阶段都可能丢信息。**
  - **渲染成图时**：位图字体覆盖不到的字符（emoji、生僻文字、组合符号）会显示成 `?`；制表符展开为空格、连续空格折叠、ANSI 转义被剥掉。模型读的是像素而不是文本，64 位 digest 这类串不能指望从图里逐字读出。
  - **渲染之前**：序列化按固定规则省略，同一份历史每次省略的位置和数量都相同。
    - 常规 `INFO`/`PASS` 行、堆栈调用行这类样板行，整行删除。
    - 连续成片、结构相同的行（重复的文件清单、指标行）只留首尾各两行。
    - 超长字段只留头尾、删去中段；帧中段文本预算不够时，保两端、舍中间。
    - 每处省略都留下带计数的标记，如 `[…80ch elided…]`、`[…3 routine log lines elided…]`。
  - **不会丢的**：错误、带标签事实、命令和路径将原样保留。
  - **要逐字精确的内容，从文本取，不从图上取**：首尾精确文本逐字保留；digest 这类读图不可靠的串收进文本索引。

- **是否更省 token 取决于上下文长度和所选模型。** 短会话中原生摘要可能消耗更少的 token；视觉模型的图片 token 贵也可能会抵消优势。实测数据见[评测结果](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation-results.md)。
- **压缩后不能回查。** 逐字可取的只有首尾文本和文本索引；两处都没收录的字符串，事后找不回来。

## 排障

<details>
<summary>选择器里没有 Snapcompact 预设</summary>

确认插件已安装，按页面提示重启 DSH，然后新建**会话**，查找 **Snapcompact (Standard)**、**Snapcompact (PTC)** 和 **Snapcompact (Cordis)**。

</details>

<details>
<summary>总是回退到文本</summary>

运行 `/snapcompact status`。当前路由（provider/model）可能没有声明图片输入，或没有可用的图片计价，这是预期的安全行为。

</details>

<details>
<summary>压缩失败："No compaction method produced a safe smaller checkpoint"</summary>

这表示每个方法（snapcompact、shake、soft）都被跳过，原因可能是缩得不够小或超出了预算。先运行 /snapcompact status，查看当前路由、可压空间和每个方法是否可用；然后等会话历史更多时重试，或换一个能正常运行的模型。错误信息会逐条列出各方法被跳过或失败的原因。

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
