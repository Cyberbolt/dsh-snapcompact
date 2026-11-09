<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact 归档帧图标"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · 简体中文

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.1-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**面向 DeepSeek Harness 的可回查图文上下文压缩。** Snapcompact 把长对话变成一个更小的 checkpoint，同时在背后保留一份精确、可搜索的原文归档。它以可选的 DSH preset 形式安装：新会话可以选用一条“先尝试图片帧、始终保留独立文本交接、图片不可靠时自动回退”的压缩链。

> **不承诺无条件省 token。** 图片路径取决于当前路由是否支持图片输入、真实计价以及识读准确率；能力或价格不明确时回退文本。摘要不是无损的：涉及精确命令、路径、缩进或标识符时，请使用 `snapcompact_recall` 回查原文。

## 亮点

| 你的需求                     | Snapcompact 提供的能力                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| 缩小上下文，但不丢掉原始对话 | 每个 checkpoint 都附带本次选中历史的精确归档。                               |
| 压缩后仍能找回精确字符串     | 独立文本交接摘要、归档引用，以及 `snapcompact_recall` 工具。                 |
| 失败时不冒险                 | `snapcompact → handoff → shake → soft`；无法证明“更小且可读”的候选会被跳过。 |
| 保留 DSH 原生行为            | 压缩区间选择、事务锁、恢复和容量校验仍由宿主负责。                           |
| 用数据而不是口号说明效果     | `/snapcompact benchmark` 用内置合成语料对比文本、摘要和图片路径。            |

## 工作原理

```text
DSH 选择安全的压缩区间
        │
        ▼
精确归档（sha256:…）  ──┐
        │                │  在 checkpoint 之后仍然保留
        ▼                │
snapcompact → handoff → shake → soft
        │
        ▼
原生压缩事务提交一个 checkpoint
```

| 顺序 | 方法          | 模型调用         | 产出                                                                              |
| ---- | ------------- | ---------------- | --------------------------------------------------------------------------------- |
| 1    | `snapcompact` | 一次交接摘要调用 | 把归档对话渲染为位图 PNG 帧，并保留独立文本交接摘要和归档引用。                   |
| 2    | `handoff`     | 一次交接摘要调用 | 结构化任务交接：目标、约束、决策、精确命令、已完成/未完成工作、下一步、关键事实。 |
| 3    | `shake`       | 无               | 先归档大工具输出，再用有界头尾摘录和回查引用来替代。                              |
| 4    | `soft`        | 原生摘要         | DSH 原生文本摘要，作为最后的兜底。                                                |

只有当当前路由明确声明支持图片输入 **并且** 提供图片计价（或显式配置的保守上限）时，才会尝试图片路径。以下情况会跳过图片路径：选中的历史里已经包含图片、请求没有剩余图片槽位、文本无法清晰渲染，或收益达不到配置的压缩比。

一个 checkpoint 大致如下（已删节）：

```text
Snapcompact v1; method=snapcompact
Exact archived history: sha256:…
Goal / Constraints / Decisions / Files and exact commands / …
[image frame 1 of N] … [image frame N of N]
[file] snapcompact archive reference
```

安全性质：

- 图片永远不是任务状态的唯一副本；文本交接摘要和归档始终存在。
- 取消会终止本次压缩，不会静默改用下一种方法。
- 只有在该会话中成功完成的压缩，才会授予对应归档的回查权限。
- 历史中已有图片或此前的视觉 checkpoint 时，选择文本交接，而不是把附件描述重新渲染成“原始图片”。
- 视觉能力或计价不明确时，按失败关闭处理，回退文本。
- 不注册自定义 Session event 类型，也不替换宿主的事务引擎。

## 安装

Snapcompact 要求 **DeepSeek Harness `0.2.2-rc.1`**。其他 DSH 版本尚未声明兼容；宿主可能直接拒绝安装，而不是运行未经验证的代码。

| 要求           | 值                               |
| -------------- | -------------------------------- |
| DSH            | `0.2.2-rc.1`（精确）             |
| Node.js        | 24 或更新（宿主的要求）          |
| 构建步骤       | 无；npm 包已包含编译后的 `dist/` |
| 安装期构建脚本 | 无                               |

### 通过插件页安装（推荐）

1. 在 DSH 中打开 **插件（Plugins）→ 添加插件（Add plugin）**。
2. 填写 `dsh-snapcompact@0.1.1`，点击 **安装（Install）**。
3. 若页面提示重启，按提示完成。
4. 新建会话，在 preset 选择器中选择 **Snapcompact**。

建议带版本号安装，确保拿到的是这个确切版本；不带版本号时，包管理器会解析到最新发布版本。

### 通过命令行安装

```sh
dsh plugin --profile web add dsh-snapcompact@0.1.1
```

把 `web` 换成你实际使用的 profile，然后按提示重启。使用 DSH Desktop 时请通过应用内的插件页安装：CLI 写入的是指定 profile，可能并不是桌面端正在使用的那个。

### 其他分发来源

`dsh plugin add` 不只接受 npm 包名，也可以安装本地打包的 tarball 或 tarball URL：

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.1.1.tgz"
```

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-0.1.1.tgz
```

npm 包是预构建选项；使用本地源码时需要先执行 `pnpm pack`（或 `pnpm run build`）。

### 启用 preset

安装只会新增一个**可选 preset**，不会修改默认 preset 或任何运行中的会话。请新建会话并选择 **Snapcompact**。该 preset 把 Snapcompact 挂载在独立的压缩分组中，因此默认会话仍使用原生压缩行为。

## 使用

| 入口                     | 作用                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `/compact`               | DSH 标准手动压缩命令，已包含在该 preset 中。                             |
| `/snapcompact run`       | 空闲时立即压缩。                                                         |
| `/snapcompact status`    | 查看方法链、自动压缩开关、当前路由、是否可以尝试图片路径，以及归档数量。 |
| `/snapcompact benchmark` | 运行合成语料对照。这会显式授权最多四次辅助模型请求，可能产生费用。       |
| `snapcompact_recall`     | 让模型列举、分页读取或字面量搜索精确归档内容。                           |

回查示例：

```json
{ "action": "list" }
{ "action": "read", "archiveId": "sha256:…", "offset": 0, "limit": 100 }
{ "action": "search", "archiveId": "sha256:…", "query": "pnpm deploy --filter" }
```

回查返回物理行号和 `(nextOffset, nextColumn)` 游标；继续读取超长单行时要把两者一起传回。文本分页最多返回 200 行片段和 20,000 个 UTF-16 码元。搜索是区分大小写的字面量子串匹配，不是正则表达式。

归档 ID 必须由当前会话中已完成压缩的 checkpoint 引用（包括继承的历史）；任意路径和其他会话的归档不可访问。

## 配置

配置位于 Snapcompact preset 独立压缩分组内的 `snapcompact` 行。请使用 DSH 的 preset/配置编辑器修改，不要手工修改活动 profile 文件。最小示例：

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
minCompressionRatio: 2
rendering:
  width: 1536
  height: 1024
  maxFrames: 12
```

默认上限包括 12 帧（最多 20 帧）、16 MiB 生成图片、64 MiB 源数据/归档数据，以及 15 秒渲染期限；宿主更小的限制同样生效。

如果模型确实支持图片输入且有已知价格，但 DSH 适配器没有暴露图片计价，可以显式声明一个保守上限：

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # 仅为示例，请按实际模型和帧尺寸校准。
```

这个上限不是实际用量，也不能凭空赋予模型缺失的图片模态。完整字段、原生 policy 透传和路由匹配规则见[配置文档](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)。

## 兼容性

| 组件     | 支持范围                        |
| -------- | ------------------------------- |
| DSH      | 仅 `0.2.2-rc.1`                 |
| Node.js  | 24+                             |
| DSH 包   | 由宿主提供的 peer，无需本地副本 |
| npm 安装 | 预构建包，无安装脚本            |

上游插件 API 仍处于 release candidate 阶段，因此这里刻意锁定精确版本。DSH 会检查声明的版本，并可能拒绝在不同宿主上安装。放宽范围需要重新验证类型、原生集成、包内容和真实 preset 激活；不要通过修改 profile 文件绕过检查。

## 限制与隐私

- **不是无损压缩。** 生成的摘要和图片可能省略细节。归档保存本次选中的消息内容，但无法恢复其他插件已经删除的数据。
- **不承诺通用 2× 节省。** token 数是估算，图片计价因路由而异；更小的 checkpoint 不等于更低账单，也不等于任务信息完整保留。
- **图片路径的适用条件很窄。** 路由必须声明图片输入和计价。缺字形、需要 shaping 的文字、页数过多、缩放后不可读、存储失败或压缩收益不足时，都会回退文本，而不是输出空白或截断的图片。
- **评测会产生费用。** `/snapcompact benchmark` 使用内置合成语料，最多发起四次辅助模型调用；它不会读取或上传你的私有会话历史。
- **归档访问有边界。** 回查只接受当前会话中已完成压缩所引用的归档 ID，没有任意路径或跨会话的入口。
- **无遥测。** 归档通过 DSH 的 attachment 存储保存在 profile 内；插件不会把对话数据上传到其他地方。

## 常见问题

<details>
<summary>安装后 preset 选择器里没有 Snapcompact</summary>

先确认插件显示为已安装；如果插件页要求重启，请完成重启；然后**新建**会话。已有会话会保持它启动时使用的 preset。使用 DSH Desktop 时，请确认是通过应用内插件页安装，而不是装进了桌面端不使用的 CLI profile。

</details>

<details>
<summary>总是回退文本，从不渲染图片</summary>

运行 `/snapcompact status`。最常见的原因是当前路由没有声明图片输入或没有图片计价，这是预期的安全行为。除非你确认模型接受图片并已校准数值，否则不要随意添加 `routePolicies` 上限。历史中已有图片时也会选择文本交接。

</details>

<details>
<summary>压缩失败，提示 “No compaction method produced a safe smaller checkpoint”</summary>

说明所有候选都被跳过或未通过预算检查。先看 `/snapcompact status`，等历史更长一些再试，或换用文本摘要可用的路由。错误信息会列出每个方法的原因；取消是单独报告的，不会继续回退。

</details>

<details>
<summary>回查提示归档未被当前会话引用</summary>

请使用当前会话中已完成压缩生成的 checkpoint 里的归档 ID（继承的历史也算）。来自其他会话、其他 profile 或失败尝试的 ID 会被有意拒绝。

</details>

<details>
<summary>安装被判定为不兼容</summary>

这个版本只支持 DSH `0.2.2-rc.1`。请升级或切换到该版本，不要修改兼容性检查来绕过。经过验证的更宽范围会在后续版本发布。

</details>

## 文档

- [配置与路由计价](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/configuration.md)
- [架构与代码阅读顺序](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/architecture.md)
- [评测及解释边界](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/evaluation.md)
- [第三方许可与来源](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.zh.md)
- [English docs](https://github.com/Cyberbolt/dsh-snapcompact/tree/main/docs)

## 开发

```sh
pnpm install --ignore-scripts
pnpm run check          # 类型、lint、格式、构建、preset、测试、包资源
pnpm run check:install  # 把打包后的 tarball 安装到一次性 DSH profile
pnpm pack
```

`check:install` 不会触碰真实 profile，临时目录保留在 `.artifacts/` 下，可用 `--keep` 保留用于排查。DSH 包是宿主提供的 peer；开发安装只用于本地类型和集成测试模块。本包不需要安装脚本。

源码按压缩、归档、渲染、计量、DSH 适配和评测分层，开启严格 TypeScript 检查。建议从[架构与阅读顺序](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/zh/architecture.md)开始。注释与主文档使用英文，中文文档同步维护。

## 许可

原创应用代码使用 [MIT](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)。内置的 GNU Unifont 18.0.01 数据保留 SIL Open Font License 1.1；见[第三方声明](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.zh.md)。
