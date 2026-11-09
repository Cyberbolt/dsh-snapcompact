# Evaluation results

[简体中文](zh/evaluation-results.md)

This is a real, synthetic-fixture run of `/snapcompact benchmark` on **2026-11-09** with DSH `0.2.2-rc.1` and route `opencode-go/deepseek-v4.1-flash`. It uses the bundled `engineering-recall-v1` fixture; no private session history is read or uploaded.

## Result

| Arm         | Status   | Exact match | Prompt tokens |  Time | Notes                                                                       |
| ----------- | -------- | ----------- | ------------: | ----: | --------------------------------------------------------------------------- |
| original    | measured | 8/9         |        14,357 | 11.6s | Full fixture text                                                           |
| native-text | measured | 8/9         |           639 | 10.0s | Native summary baseline                                                     |
| snapcompact | measured | 8/9         |         8,149 | 15.1s | 6 frames, 2048×2040, estimated checkpoint 8,786 tokens; `deepseek-estimate` |

Summary generation used 112 input and 1,476 output tokens (16,052 total with cache) in this run. The visual arm made no handoff call; it rendered and read bitmap frames.

## Interpretation

- **Readability:** the visual arm matched the original's 8/9 and beat the native text baseline (7/9) on this run. A separate live check asked the model to read a marker in the frame's middle; it answered `ID_40` correctly, and a follow-up `snapcompact_recall` retrieved an omitted archive line verbatim.
- **Token economy:** on this route the native text summary was far cheaper (523 prompt tokens) than the visual checkpoint (8,152 prompt tokens). The visual method is therefore **not** a universal token-saving choice; the engine's `minCompressionRatio: 2` gate will usually prefer the text fallback unless the source is large enough. The tradeoff is fidelity: visual matched the original exactly on the fixture while the native summary missed one answer.
- **When visual is useful:** exact bitmap fidelity, routes with cheap image tokens, or histories where a lossy text summary is unacceptable and the archive recall path is needed. Do not claim lower billing from a smaller checkpoint alone.
- **Benchmark scope:** the fixture is synthetic and fixed; it does not represent every language, provider, or long-running project.

## Reproduce

```text
/snapcompact benchmark
```

The report is returned in the human-command result. A run costs up to four auxiliary model calls.
