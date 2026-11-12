# 贡献指南

[English](../contributing.md)

Snapcompact 是一个 DSH 插件：它只向宿主的原生事务提交一个压缩候选，从不替换该事务。开发需要 Node.js 24+ 和 pnpm 11。

## 准备

```sh
pnpm install --ignore-scripts
```

包本身没有安装脚本。DSH 各包由宿主以 peer 依赖提供，因此开发安装只提供本地类型和集成测试模块。

## 检查

```sh
pnpm run check          # 构建、类型、lint、格式、preset、测试、包资源
pnpm run test           # 只跑单元与原生集成测试
pnpm run check:install  # 把打包 tarball 装进一次性 DSH profile
pnpm run release:plan   # 预览当前版本是否会发布
pnpm pack
```

`check:install` 不碰真实 profile，临时主目录留在 `.artifacts/`，可用 `--keep` 保留下来调试。CI 跑的就是 `pnpm run check`。

## 评测

评测套件是 `scripts/benchmark-v5.ts`。开发集由提交的种子生成；测试集生成到 `.artifacts/`，不入库。会话内的 `/snapcompact benchmark [1-5]` 只跑开发集，会发出模型请求并产生费用。见 [evaluation.md](evaluation.md) 与[预注册](evaluation-v5-prereg.md)。

## 发布

`scripts/check-package.ts` 要求两个 README 都提到 `dsh-snapcompact@<当前版本>`；准备稳定版发布时同步改 `README.md` 和 `README.zh.md` 里那一行。DSH 兼容范围的唯一来源是 `scripts/compat.ts`——只在那里改，不要在正文里手改。文档默认用英文写，并保留中文版本（`README.md` / `README.zh.md`，`docs/` / `docs/zh/`）。

提交前跑 `pnpm run format`。
