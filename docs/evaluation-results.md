# Evaluation results

[简体中文](zh/evaluation-results.md)

This is a real, synthetic-fixture run of `/snapcompact benchmark` on **2026-11-09** with DSH `0.2.2-rc.1` and route `opencode-go/deepseek-v4.1-flash`. It uses the bundled `engineering-recall-v1` fixture; no private session history is read or uploaded.

## Result

The table below is the 08:11 UTC run. An earlier run of the same fixture is recorded under "Run-to-run variance" so this page keeps one consistent set of numbers.

| Arm         | Status   | Exact match | Frames |  Time | Notes                                                                    |
| ----------- | -------- | ----------- | -----: | ----: | ------------------------------------------------------------------------ |
| original    | measured | 8/9         |      — |  9.4s | Full fixture text                                                        |
| native-text | measured | 7/9         |      — | 12.5s | Native summary baseline                                                  |
| snapcompact | measured | 8/9         |      6 | 16.3s | 2048×2040 frames, estimated checkpoint 8,786 tokens; `deepseek-estimate` |

The native summary used 112 input, 14,464 cache-read and 1,476 output tokens (16,052 total). The visual arm made no handoff call; it rendered and read bitmap frames.

The benchmark calls the visual method directly and applies the same half-of-the-source cap the engine falls back to without a live trigger. In a normal session the checkpoint must fit the trigger-relative budget instead (half of the room under the threshold, never more than half of the source), so a short history can fall back to text even when the measured checkpoint is smaller.

## Token accounting

These are token totals, not billed dollars. Prompt totals follow DSH's contract: input + cacheRead + cacheWrite. One-time generation is the cost of producing the checkpoint; per-turn is the context carried after it.

| Arm         | One-time generation | Per-turn read | First compaction | 3-turn total |
| ----------- | ------------------: | ------------: | ---------------: | -----------: |
| original    |                   0 |        14,357 |           14,357 |       43,071 |
| native-text |              16,052 |           523 |           16,575 |       17,621 |
| snapcompact |                   0 |         8,152 |            8,152 |       24,456 |

- The native summary is smaller on every turn after the first, but generating it costs ~16k tokens once. Comparing its 523-token read with the visual checkpoint's 8,152-token read omits that generation call.
- The visual checkpoint is cheaper for the first compaction (8,152 vs 16,575). The summary overtakes it between the second and third turn on this fixture.
- Cache reads usually cost less than fresh input, and image pricing varies by route; these totals are not bills.

## Interpretation

- **Readability:** both runs scored the visual arm 8/9, matching the original. The native summary scored 7/9 here and 8/9 in the earlier run, so one comparison does not establish a stable recall advantage. A separate live check asked the model to read a marker in the frame's middle; it answered `ID_40` correctly, and a follow-up `snapcompact_recall` retrieved an omitted archive line verbatim.
- **Token economy:** snapcompact has no generation call and a larger steady-state footprint; a native summary has a generation call and a smaller footprint. Which is cheaper depends on the turn horizon, cache pricing and image price.
- **When visual is useful:** long histories, routes with cheap image tokens, fidelity-critical work where a lossy summary is unacceptable, and overflow recovery where no summarizer call is wanted.
- **Run-to-run variance:** an earlier run of the same fixture (07:46 UTC) measured original 8/9 at 14,357 prompt tokens, native-text 8/9 at 639, and snapcompact 8/9 at 8,149 with 6 frames. Exact-match answers vary by one question between runs.
- **Benchmark scope:** the fixture is synthetic and fixed; it does not represent every language, provider or long-running project.

## Reproduce

```text
/snapcompact benchmark
```

The report is returned in the human-command result. A run costs up to four auxiliary model calls.
