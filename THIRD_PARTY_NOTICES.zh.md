# 第三方许可与来源

[English](THIRD_PARTY_NOTICES.md)

## GNU Unifont

随包原样分发的 `unifont_all-18.0.01.hex.gz` **不采用 MIT 许可**。本项目选择上游双许可中的 SIL Open Font License 1.1（OFL）。字体版权、原始 OFL 全文、来源和 SHA-256 保留在[字体目录](assets/fonts/README.md)。

只分发字体数据，没有复制 GPL 字体工具程序。生成的 PNG 文档不会仅因使用字体而自动采用 OFL。派生字体需继续遵守字体许可与保留名称要求，不能把字体单独出售。法律许可文本以原文为准，本说明不是其替代译本。

## 设计参考

光学文本压缩思路参考 [oh-my-pi snapcompact](https://github.com/can1357/oh-my-pi/tree/75e7801e247d4e3263439d4cc08ccad60dc64bdd/packages/snapcompact)。本项目使用自有小型 TypeScript 渲染器，不运行其 Bun/native renderer，也不继承其评测结论。

checkpoint 的 `FILES` 段沿用 oh-my-pi 文件操作摘要的分组、前缀折叠路径列表形态；本包中的 TypeScript 提取、解析和渲染代码由本项目实现。

DSH 接入使用 DeepSeek Harness（MIT）的公开 `BasicCompactionEngine` 扩展接口。DSH 包作为宿主提供的 peer dependencies，不将其实现或许可冒充本项目原创内容。

原创应用代码见 [LICENSE](LICENSE)。
