# dsh-snapcompact

[English](README.md) · 简体中文

适用于 DeepSeek Harness 的可回查上下文压缩插件，提供 **`snapcompact → handoff → shake → soft`** 方法链、自动/手动压缩及三组对照评测。

> 不承诺所有模型都更省 token。图片路径要求明确的视觉能力、计价和识读准确率；未知能力或价格默认回退文本。每份图片 checkpoint 都保留独立文本交接摘要和原文回查入口。

## 开发

要求 Node.js 24+、pnpm 11.28.5、DSH **0.2.2-rc.1**。其他 DSH 版本尚未声明兼容。

```sh
pnpm install --ignore-scripts
pnpm run check
pnpm pack
pnpm run check:install   # 可选：安装到一次性 DSH profile
```

`check:install` 会构建并打包当前代码，安装到 `.artifacts/` 下的临时 DSH profile，并断言宿主接受该 bundle：patch 能组合出独立的 Snapcompact preset、DSH 兼容性通过、没有 bundle 被跳过。运行需要本机 DSH 与包管理器网络访问；不会触碰真实 profile，`--keep` 可保留临时目录用于排查。

DSH 包作为 peer dependency 由宿主提供，开发时安装到项目内供类型检查和测试。本包不需要安装脚本。

源码按压缩、归档、渲染、计量、DSH 适配和评测分层，开启严格 TypeScript 检查。阅读顺序见[架构文档](docs/zh/architecture.md)。

## 安装与使用

先构建，再通过 DSH 插件管理器安装此目录，不手工修改活动 profile。安装后在**新建会话**中选择 **Snapcompact** preset；不替换现有默认选择、其他 preset 或运行中的会话。

| 入口                             | 作用                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| `/compact` 或 `/snapcompact run` | 空闲时立即压缩                                              |
| `/snapcompact status`            | 查看方法链、自动压缩、路由能力与归档数量                    |
| `/snapcompact benchmark`         | 显式运行合成语料对照，最多四次辅助模型调用，会产生用量/费用 |
| `snapcompact_recall`             | 模型列举、分页读取或字面量搜索本会话归档                    |

回查仅限当前会话及继承日志中成功压缩引用的归档，不接受任意路径或任意会话 ID。使用 checkpoint 中的完整 archive ID；返回物理行号及 `nextOffset`/`nextColumn`，一起传回可继续超长单行。单页最多 200 行片段、20,000 个 UTF-16 码元。

## 方法与安全

- **snapcompact**：自有 TS 位图 PNG 帧＋独立文本摘要＋原文引用。
- **handoff**：结构化任务交接文档，保留目标、约束、精确命令、待办与下一步。
- **shake**：完整归档大工具输出，再保留头尾和可恢复引用，无模型调用。
- **soft**：原生文本摘要兜底。

只扩展 `BasicCompactionEngine.summarize()`，区间选择、事务锁、恢复和模型切换容量预检复用原生实现。不 fork 宿主，不注册自定义 Session event 类型。

渲染采用 GNU Unifont 18.0.01，不依赖 Bun/native renderer。无法可靠表示的字形、超页数、缩放、存储失败、未知计价或收益不足都会回退，不以空白图或裁掉尾部冒充完整压缩。取消不触发下一方法。

图片和生成摘要不宣称无损，精确命令/缩进应回查。归档保存本次选中消息，不能恢复其他插件此前已删除的数据。已有图片/视觉 checkpoint 会走文本交接并保留父归档链，而不是把附件描述当作原始图片重渲染。

## 文档与许可

- [配置与路由价格](docs/zh/configuration.md)
- [架构与代码阅读顺序](docs/zh/architecture.md)
- [评测及解释边界](docs/zh/evaluation.md)
- [第三方许可与来源](THIRD_PARTY_NOTICES.zh.md)

原创代码使用 [MIT](LICENSE)；字体独立保留 OFL 1.1。
