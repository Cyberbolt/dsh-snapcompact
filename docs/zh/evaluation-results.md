# 评测结果

[English](../evaluation-results.md)

这是 **2026-11-09** 在 DSH `0.2.2-rc.1`、路由 `opencode-go/deepseek-v4.1-flash` 上用内置 `engineering-recall-v1` 合成语料真实执行 `/snapcompact benchmark` 的结果；不读取或上传任何私有会话历史。

## 结果

| 方案        | 状态     | 精确匹配 | prompt token |  耗时 | 说明                                                             |
| ----------- | -------- | -------- | -----------: | ----: | ---------------------------------------------------------------- |
| original    | measured | 8/9      |       14,357 | 11.6s | 完整语料                                                         |
| native-text | measured | 8/9      |          639 | 10.0s | 原生摘要基线                                                     |
| snapcompact | measured | 8/9      |        8,149 | 15.1s | 6 帧 2048×2040，估算 checkpoint 8,786 token；`deepseek-estimate` |

摘要生成使用 112 input / 1,476 output tokens（含缓存共 16,052）。视觉组没有调用 handoff，只做本地渲染和读图。

## 解释

- **可读性：** 视觉组 8/9，与原文组一致，并高于本次原生文本的 7/9。另一次真实检查让模型读帧中段的标记，模型正确回答 `ID_40`；随后用 `snapcompact_recall` 逐字取回了被截断中段的 `ID_300` 行。
- **token 经济性：** 该路由上原生文本摘要只需 523 prompt tokens，视觉 checkpoint 约 8,152；视觉**不是**通用省 token 方案。引擎的 `minCompressionRatio: 2` 通常会优先选择文本回退，除非源历史足够大。代价是保真度：视觉在语料上与原文完全一致，而原生摘要漏了一题。
- **适用场景：** 精确位图保真、图片价格很低的路由，或者不能接受有损文本摘要、需要归档回查的历史。不能仅凭 checkpoint 更小就宣称账单更低。
- **评测边界：** 固定合成语料，不代表所有语言、provider 或真实长项目。

## 复现

```text
/snapcompact benchmark
```

报告会出现在人类命令结果中；一次最多四次辅助模型调用。
