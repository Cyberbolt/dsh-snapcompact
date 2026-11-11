# Evaluation results

[简体中文](zh/evaluation-results.md)

## Benchmark v3

A real synthetic-fixture run on **2026-11-11** with route `opencode-go/deepseek-v4.1-flash`, fixture `engineering-recall-v3`, three runs. It used the production renderer, the native summary engine and the `evaluate()` path; no private session history was read or uploaded.

| Arm                  | Status   | Accepted |  Strict |  head | middle |  tail |
| -------------------- | -------- | -------: | ------: | ----: | -----: | ----: |
| `original`           | measured |    40/40 | 38.7/40 | 21/21 |  60/60 | 39/39 |
| `native-text`        | measured |  38.3/40 | 37.3/40 | 17/21 |  59/60 | 39/39 |
| `snapcompact`        | measured |  34.0/40 | 33.7/40 | 21/21 |  43/60 | 38/39 |
| `snapcompact-recall` | measured |    40/40 | 36.7/40 | 21/21 |  60/60 | 39/39 |

Accepted counts are per-run means with a 38–39 range for `native-text`, 33–35 for `snapcompact` and 36–37 for the strict column of `snapcompact-recall`; every other cell was identical across the three runs.

| Arm                  | One-time generation | Per-turn read | One-run total | 3-turn context |
| -------------------- | ------------------: | ------------: | ------------: | -------------: |
| `original`           |                   0 |        15,955 |        20,548 |         47,865 |
| `native-text`        |              24,409 |         1,701 |        32,631 |         29,512 |
| `snapcompact`        |                   0 |         6,803 |        15,631 |         20,408 |
| `snapcompact-recall` |                   0 |        30,841 |        34,463 |         92,524 |

The native summary used 24,409 generation tokens (54.6s). The visual checkpoint used 5 frames, 8,367 estimated tokens against an 8,426-token half-of-source budget, and prepared in 1.0s. The archive contained all 40 sources verbatim. The recall arm made 24 tool calls on average.

### What the run shows

- **The shipped configuration is at parity, and above the native summary.** `snapcompact-recall` — the checkpoint a session actually receives, frames plus the `snapcompact_recall` tool — scored 40/40 in all three runs. The native summary scored 38.3/40 and lost head facts: the Chinese constraint was truncated to its first clause, and one negation lost its exact punctuation. The frames alone scored 34.0/40, so the archive is doing real work, not decoration.
- **The renderer is exact where text is structured, not where it is random.** All four arms kept the head text (21/21) when it stayed verbatim; the frames-only arm kept 43/60 middle facts. Every frames-only miss is a random token — audit id, checksum, request id, rollback suffix — and several wrong values (`AUDIT-9F3C-7B2`, `CRC32:9e2f31ac`) appear nowhere in the corpus. That is confident transcription drift, the failure mode upstream omp also documents (its 0/O identifier corruption fix), not a layout defect: head text is perfect and every token sat inside a row.
- **Recall converts drift into exactness.** With one search per exact-string question, the middle went 60/60 and the tail 39/39. Search targets the label the model can read (`Observation 240:`), so a misread value cannot poison the lookup.
- **Cost moved to the tool loop.** The checkpoint is 6,803 tokens for 63,423 characters of history; the recall arm's 30,841 per-turn read is 24 verification calls inside a single 40-question benchmark turn, not a steady-state cost. One search returns a few lines, so a session that asks for one exact string pays one small lookup.
- **Strict matching is looser than native.** 36.7 vs 37.3: quoting `X-Snap-Trace: 5b7e9c1d` or `PRIMARY-ONLY until further notice.` is accepted but not the bare canonical string. Accepted is the primary score because the answer is factually right.

One run can move one or two questions; these figures pool three runs. Run `/snapcompact benchmark 3` on your route for a range.

## Rendering measurements

These numbers come from the current continuous-flow layout and one-bit PNG encoder. They are rendering measurements, not model-recall scores, and they make no model call.

| Corpus @ 1568×1568                             | Frames | Content chars/frame | PNG total | PNG/frame |
| ---------------------------------------------- | -----: | ------------------: | --------: | --------: |
| Indented code corpus (28,729 chars, 960 lines) |      3 |               9,257 |   35.5 KB |   11.8 KB |

The same rendering path is regression-tested by [`src/rendering/density.test.ts`](../src/rendering/density.test.ts), which fixes frame count, characters per frame and PNG bytes on synthetic prose and code corpora; exact bytes vary slightly with the zlib build.

The reading legend is part of the checkpoint: `¶` marks one source newline, consecutive `¶` mark blank lines, leading spaces keep indentation, and rows wrap at the frame edge.
