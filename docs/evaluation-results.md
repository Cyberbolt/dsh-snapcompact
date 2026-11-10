# Evaluation results

[简体中文](zh/evaluation-results.md)

## Current format: local rendering measurements

These numbers come from the current continuous-flow layout and one-bit PNG encoder. They are rendering measurements, not model-recall scores, and they make no model call; the fixture row renders the full bitmap middle before any trigger-budget trimming.

| Corpus @ 1568×1568                                   | Frames | Content chars/frame | PNG total | PNG/frame |
| ---------------------------------------------------- | -----: | ------------------: | --------: | --------: |
| `engineering-recall-v2` bitmap middle (67,888 chars) |      5 |              13,380 |   55.2 KB |   11.0 KB |
| Indented code corpus (28,729 chars, 960 lines)       |      3 |               9,257 |   35.5 KB |   11.8 KB |

The previous row-per-line renderer needed 14 frames for a 70k-character fixture, carried about 5.0k characters per frame and produced 792 KB of PNG. The same rendering path is regression-tested by [`src/rendering/density.test.ts`](../src/rendering/density.test.ts), which fixes frame count, characters per frame and PNG bytes on synthetic prose and code corpora; exact bytes vary slightly with the zlib build.

The reading legend is part of the checkpoint: `¶` marks one source newline, consecutive `¶` mark blank lines, leading spaces keep indentation, and rows wrap at the frame edge.

## Current live run: fixture v2 (40 questions, 10 middle probes)

This is a real, synthetic-fixture run on **2026-11-10** with DSH `0.2.2-rc.1` and route `opencode-go/deepseek-v4.1-flash`. It uses the bundled `engineering-recall-v2` fixture; no private session history is read or uploaded. The run exercised the production renderer and `evaluate()` path over the same route in four auxiliary calls. It is not a relabel of the v1 table.

| Arm         | Status   | Exact match | Frames |  Time | Notes                                                                    |
| ----------- | -------- | ----------- | -----: | ----: | ------------------------------------------------------------------------ |
| original    | measured | 38/40       |      — | 33.2s | Full fixture text; missed `next` and `cjk_note`                          |
| native-text | measured | 40/40       |      — | 50.9s | Native summary baseline; generation cost 20,361 tokens                   |
| snapcompact | measured | 36/40       |      5 | 56.9s | 1568×1560 frames, estimated checkpoint 7,607 tokens; `deepseek-estimate` |

The visual arm answered 8 of the 10 middle probes correctly. Its missed keys were `constraint`, `next`, `probe_340` and `probe_420`; the two probe misses were the CJK rollback path and the audit token. The other two misses are exact head/tail facts, so this run does not support a claim that exact text is always recovered when the bitmap middle is present.

The five frames carried 56,545 bytes (55.2 KiB) of PNG in total and prepared in 0.9s. The visual checkpoint was 7,607 estimated tokens; the provider reported 6,717 prompt tokens for the visual question call. The native summary used 14,814 input and 5,547 output tokens to generate (20,361 total) in 49.4s, then 1,515 prompt tokens per turn. Provider output counts include reasoning tokens, so the summary text itself is smaller than 5,547 tokens.

### Token accounting (fixture v2)

| Arm         | One-time generation | Per-turn read | First compaction | 3-turn total |
| ----------- | ------------------: | ------------: | ---------------: | -----------: |
| original    |                   0 |        15,107 |           15,107 |       45,321 |
| native-text |              20,361 |         1,515 |           21,876 |       24,906 |
| snapcompact |                   0 |         6,717 |            6,717 |       20,151 |

- The visual checkpoint was cheaper than the summary on the first compaction (6,717 vs 21,876) and still cheaper at three turns (20,151 vs 24,906). The summary crosses over at about the fourth turn on this fixture.
- The native summary scored 40/40 while the original text scored 38/40. A single fixed-fixture run can invert that ordering; this is not evidence that a summary preserves more information, only that this fixture's questions were answerable from it.
- The 40-question run needed a 32,768-token output cap. With the previous 8,192 cap, the original and visual arms hit `max-tokens` before answering and produced no score; that was a harness limit, not a recall result.

## Previous live run: fixture v1 (9 questions) and the previous renderer

This section is historical. It was measured before the continuous-flow layout and before fixture v2. The table below must not be presented as the current format's score.

This is a real, synthetic-fixture run of `/snapcompact benchmark` on **2026-11-09** with DSH `0.2.2-rc.1` and route `opencode-go/deepseek-v4.1-flash`. It uses the bundled `engineering-recall-v1` fixture; no private session history is read or uploaded.

| Arm         | Status   | Exact match | Frames |  Time | Notes                                                                    |
| ----------- | -------- | ----------- | -----: | ----: | ------------------------------------------------------------------------ |
| original    | measured | 8/9         |      — |  9.4s | Full fixture text                                                        |
| native-text | measured | 7/9         |      — | 12.5s | Native summary baseline                                                  |
| snapcompact | measured | 8/9         |      6 | 16.3s | 2048×2040 frames, estimated checkpoint 8,786 tokens; `deepseek-estimate` |

The native summary used 112 input, 14,464 cache-read and 1,476 output tokens (16,052 total). The visual arm made no handoff call; it rendered and read bitmap frames.

The benchmark calls the visual method directly and applies the same half-of-the-source cap the engine falls back to without a live trigger. In a normal session the checkpoint must fit the trigger-relative budget instead (half of the room under the threshold, never more than half of the source), so a short history can fall back to text even when the measured checkpoint is smaller.

### Token accounting (fixture v1)

These are token totals, not billed dollars. Prompt totals follow DSH's contract: input + cacheRead + cacheWrite. One-time generation is the cost of producing the checkpoint; per-turn is the context carried after it.

| Arm         | One-time generation | Per-turn read | First compaction | 3-turn total |
| ----------- | ------------------: | ------------: | ---------------: | -----------: |
| original    |                   0 |        14,357 |           14,357 |       43,071 |
| native-text |              16,052 |           523 |           16,575 |       17,621 |
| snapcompact |                   0 |         8,152 |            8,152 |       24,456 |

- The native summary is smaller on every turn after the first, but generating it costs ~16k tokens once. Comparing its 523-token read with the visual checkpoint's 8,152-token read omits that generation call.
- The v1 visual checkpoint was cheaper for the first compaction (8,152 vs 16,575). The summary overtook it between the second and third turn on this fixture.
- Cache reads usually cost less than fresh input, and image pricing varies by route; these totals are not bills.

## Interpretation

- **Readability:** v1 scored the visual arm 8/9, but every scored fact landed in the 2,000-character exact tail, so that score did not prove bitmap reading. In the v2 run ten probes sit in the bitmap middle and the visual arm answered 8/10 correctly, including the indented Python helper; the two probe misses were a CJK path and an audit token. That is the first score here that actually depends on reading the frames.
- **Token economy:** the v1 numbers above are historical. The current layout packs roughly 2.7× more characters per frame at 1568 and produces fewer, smaller PNGs, so the old frame count and per-turn totals are not a forecast for the current build.
- **When visual is useful:** long histories, routes with cheap image tokens, fidelity-critical work where a lossy summary is unacceptable, and overflow recovery where no summarizer call is wanted.
- **Run-to-run variance:** an earlier v1 run of the same fixture (07:46 UTC) measured original 8/9 at 14,357 prompt tokens, native-text 8/9 at 639, and snapcompact 8/9 at 8,149 with 6 frames. Exact-match answers vary by one question between runs.
- **Benchmark scope:** v2 is synthetic, fixed and larger (40 questions, 10 middle probes), but it still does not represent every language, provider or long-running project.

## Reproduce

```text
/snapcompact benchmark
```

The report is returned in the human-command result, including per-arm missed question keys. A run costs up to four auxiliary model calls. A v2 run cannot be compared one-for-one with the v1 table above: the fixture, question count and frame layout all changed, so publish a fresh table rather than relabelling the old one.
