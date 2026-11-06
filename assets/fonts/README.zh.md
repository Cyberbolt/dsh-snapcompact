# GNU Unifont 18.0.01 字体数据

[English](<README.md>)

本包原样分发 [Unifont 字体](<unifont_all-18.0.01.hex.gz>)，选择上游双许可中的 **SIL OFL 1.1**。没有重命名、子集化或修改字体，也没有复制 GPL 字体转换/渲染工具。TypeScript 字形读取与网格绘制代码为本项目自行实现。

- SHA-256：`14c96e497466a82e46cf20032ce510e186bdc8658c9158e2290f452cda9bc498`
- [官方来源](https://unifoundry.com/pub/unifont/unifont-18.0.01/font-builds/unifont_all-18.0.01.hex.gz)
- [上游版权原文](<UPSTREAM-COPYRIGHT.txt>)
- [原始 OFL 全文](<OFL-1.1.txt>)

版权说明保留同版 BDF 的原文及作者名单。本项目选用 OFL；生成 PNG 不会仅因使用字体而自动采用 OFL。法律文本以未修改的原文为准。

渲染前校验字体压缩文件摘要。使用原生 8×16/16×16 位图，不做复杂文字整形；缺字、组合附加符、上下文文字、emoji 组合等无法可靠表达时拒绝并回退文本。空格、缩进、换行保留；TAB、CR、ANSI/控制符以 ASCII 转义显式显示，不静默归一化。

每个 renderer 实例拥有独立队列：一个活动任务和最多四个等待任务，15 秒上限包括排队及冷启动。超过帧/字节预算则整次失败，不裁掉尾部。销毁会终止线程并永久关闭该实例；新插件生命周期必须创建新实例，不能复活旧队列。
