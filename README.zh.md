<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact 帧图标"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**把长 DSH 会话压缩成可阅读的渲染结果，而不是摘要。**

会话变长后，Snapcompact 不再逐字发送中段，而是把这部分渲染成视觉模型可直接阅读的密集 PNG 帧；首尾的精确文本原样保留，帧旁边配一个小文本索引，专门存放像素无法可靠复现的校验和、路径和命令。视觉路径不调用摘要模型，不需要额外的 API 密钥，也不发起网络请求。

Snapcompact 是 [Oh My Pi](https://github.com/can1357/oh-my-pi) 的 `snapcompact` 思路在 DSH 上的独立实现。

适合长代码或调试会话，你仍然需要很多轮之前的命令、路径、校验和或标识符。不适用于短聊天、纯文本路由或极简模式。

**快速开始：** 插件 → 添加插件 → `dsh-snapcompact` → 新建会话 → **Snapcompact (Standard)**。

## 为什么渲染？

视觉模型主要按图像面积计费，而不是按图里有多少字符。在可读性上限内，密集帧每 token 能承载比逐字发送更多的文本，于是那部分你不再需要逐字保留的历史变成几张可读图片，而不是一份有损摘要。

|          | 原始历史 | 原生摘要     | Snapcompact                |
| -------- | -------- | ------------ | -------------------------- |
| 保留什么 | 全部     | 一份摘要     | 首尾精确文本、帧、文本索引 |
| 压缩成本 | 0        | 一次模型调用 | 0（本地渲染）              |
| 精确串   | 有       | 可能丢失     | 逐字留在首尾，并进索引     |

一份简短摘要，在某些短会话里每轮仍可能更小；什么时候反过来，见[限制](#限制)。

## 你会得到什么

- **精确串以文本形式回来。** 历史的首尾逐字保留，另有一个有界索引，把校验和、路径、命令、标识符和带标签事实列成可直接复制的纯文本。
- **历史变成一条消息。** 压缩会把中段替换成一条摘要消息，它和会话里任何一条普通摘要消息没有区别。其余都不变，磁盘上也不删任何东西。
- **视觉路径不调用摘要模型。** 渲染在本地完成：没有生成成本，没有网络往返，不需要额外 API 密钥。
- **文件地图保留。** 有界 `FILES` 索引来自 `read`/`write`/`edit` 调用，带 `(Read)` / `(Write)` / `(RW)` 标记。它用于导航，不是磁盘快照。
- **安全回退。** `snapcompact → shake → soft`，原生摘要排在最后。

## 安装

需要 DSH `^0.2.2-rc.1`（在 `0.2.2-rc.1` 上验证）和 Node.js 24+。npm 包自带编译好的 `dist/`，所以既没有构建步骤，也没有安装脚本。

1. 打开 **插件 → 添加插件**。
2. 安装 `dsh-snapcompact@0.7.0`。
3. 如提示则重启，然后新建会话并选择变体。

| 官方模式    | 选择                       | 它是什么                                          |
| ----------- | -------------------------- | ------------------------------------------------- |
| 标准模式    | **Snapcompact (Standard)** | Shell、文件、搜索、子代理、工作流、联网、计划模式 |
| PTC 模式    | **Snapcompact (PTC)**      | `run_code` 是唯一直接工具，其余都通过 `tools.*`   |
| Cordis 模式 | **Snapcompact (Cordis)**   | `tool-cordis` 和官方的 Cordis 编写技能            |

安装只会新增可选预设：官方预设和正在运行的会话都不受影响，选择变体就是启用动作。不支持极简模式——它刻意省略了 `read`/`write`/`edit`，渲染帧会违背它的设计目的。

卸载：在插件页面移除插件即可。它新增的预设会一起消失；已经生成的压缩结果会作为普通摘要消息留在会话里。从 0.6.x 升级？0.7.0 改变了精确文本的保存方式，见[迁移说明](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/migration-0.7.md)。

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

视觉方法只在路由（会话背后的模型和供应商）声明了图片输入和计价、或给出带标签的估算，且压缩结果放得进触发阈值下的余量时运行；否则方法链回退到文本。取消会停止压缩，绝不会静默改选下一个方法。区域选择、事务锁、恢复和容量检查仍由宿主负责。

## 用法

| 入口                  | 作用                                      |
| --------------------- | ----------------------------------------- |
| `/compact`            | 手动压缩；在 Snapcompact 预设内运行方法链 |
| `/snapcompact status` | 路由、有效阈值、可压空间和逐方法可用性    |

## 配置

**插件 → Snapcompact** 卡片覆盖常用配置项，通过 DSH 的设置服务写入 profile 的配置补丁。一个卡片配置三个变体，保存的值对新会话生效。默认是方法链 `[snapcompact, shake, soft]`、窗口 0.8 的触发阈值、最多 40 帧；其余字段只能写 YAML——见[配置参考](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)。

## 限制

- **非无损。** 帧可能丢字符；常规的 `INFO`/`PASS`、堆栈帧、文件清单和指标行会被省略，长字段按头尾裁剪。错误、带标签事实、命令、路径和摘要会保留。
- **是否更省取决于路由和使用跨度。** 短会话里一份简短摘要每轮可能更小；图片 token 贵或使用跨度短会抵消优势。实测数据见[评测结果](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation-results.md)。
- **不提供跨压缩检索。** 首尾文本和文本索引就是全部保证；被两者同时裁掉的唯一字符串，事后找不回来。
- **无遥测。** 会话数据留在 profile 的附件存储中，不会上传到别处。

## 排障

<details>
<summary>选择器里没有 Snapcompact 预设</summary>

确认插件已安装，按页面提示重启 DSH，然后新建**会话**，查找 **Snapcompact (Standard)**、**Snapcompact (PTC)** 和 **Snapcompact (Cordis)**。已有会话保留启动时的预设。DSH Desktop 请通过应用内的插件页面安装，而不是桌面应用不用的 CLI profile。

</details>

<details>
<summary>总是回退到文本</summary>

运行 `/snapcompact status`。路由可能没有声明图片输入，或没有可用的图片价格，这是预期的安全行为。已有的图片最多携带四张；没有图片槽位时走文本链（先 shake 摘录，再原生摘要）。

</details>

<details>
<summary>压缩失败："No compaction method produced a safe smaller checkpoint"</summary>

每个候选都被跳过或超预算。检查 `/snapcompact status`；用更多历史重试，或换一个有可用文本摘要的路由。错误会列出每个方法的原因，取消会单独报告。

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
