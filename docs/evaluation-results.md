# Evaluation results

[简体中文](zh/evaluation-results.md)

## Benchmark v3

A real synthetic-fixture run on **2026-11-11** with route `opencode-go/deepseek-v4.1-flash`, fixture `engineering-recall-v3`, three runs. It used the production renderer, the native summary engine and the `evaluate()` path; no private session history was read or uploaded.

| Arm                  | Status   | Accepted |  Strict |  head | middle |  tail |
| -------------------- | -------- | -------: | ------: | ----: | -----: | ----: |
| `original`           | measured |  39.7/40 | 38.7/40 | 21/21 |  60/60 | 38/39 |
| `native-text`        | measured |  37.7/40 | 35.0/40 | 15/21 |  60/60 | 38/39 |
| `snapcompact`        | measured |  33.0/40 | 32.7/40 | 21/21 |  39/60 | 39/39 |
| `snapcompact-recall` | measured |  39.7/40 | 37.3/40 | 21/21 |  60/60 | 38/39 |

Accepted counts are per-run means with a 39–40 range for `original`, 37–38 for `native-text`, 32–34 for `snapcompact` and 37–38 for the strict column of `snapcompact-recall`.

| Arm                  | One-time generation | Per-turn read | One-run total | 3-turn context |
| -------------------- | ------------------: | ------------: | ------------: | -------------: |
| `original`           |                   0 |        15,955 |        21,075 |         47,865 |
| `native-text`        |              21,434 |         1,551 |        35,566 |         26,087 |
| `snapcompact`        |                   0 |         6,813 |        17,192 |         20,439 |
| `snapcompact-recall` |                   0 |        18,341 |        19,812 |         55,022 |

The native summary used 21,434 generation tokens (36.0s). The visual checkpoint used 5 frames, 8,367 estimated tokens against an 8,426-token half-of-source budget, and prepared in 0.9s. The archive contained all 40 sources verbatim. The recall arm made 2.0 batched tool calls and 2.3 model rounds per run, with 20,366 serialized tool-result bytes.

### What the run shows

- **The shipped configuration matches the control's accuracy while keeping exact recall.** `snapcompact-recall` — the checkpoint a session actually receives, frames plus the `snapcompact_recall` tool — scored 39.7/40, the same mean as raw history. Two of three runs were 40/40; the single miss was `t_next`, the same question the control missed. The native summary scored 37.7/40 and lost head facts: the Chinese constraint was truncated to its first clause, and one negation lost its exact punctuation. Frames alone scored 33.0/40, so the archive is doing real work.
- **The renderer is exact where text is structured, not where it is random.** All four arms kept the head text (21/21) when it stayed verbatim; the frames-only arm kept 39/60 middle facts. Every frames-only miss is a random token — audit id, checksum, request id, rollback suffix — and several wrong values (`AUDIT-9F3C-7B2`, `CRC32:9e2f31ac`) appear nowhere in the corpus. That is confident transcription drift, the failure mode upstream omp also documents, not a layout defect.
- **Recall converts drift into exactness.** Batching up to twenty literals per call still returned the middle 60/60 and the tail 38/39. Search targets the label the model can read (`Observation 240:`), so a misread value cannot poison the lookup.
- **Batching is the dominant token lever.** The checkpoint is 6,813 tokens for 63,423 characters of history; every tool round re-sends it. Two batched calls in 2.3 rounds cut the per-turn read to 18,341 (from 30,841 with one call per fact) and the three-turn projection to 55,022 (from 92,524). One 20-literal batch is about 14k characters, still far cheaper than the checkpoint re-reads it replaces.
- **Strict matching now beats native.** 37.3 vs 35.0: quoting `X-Snap-Trace: 5b7e9c1d` or `PRIMARY-ONLY until further notice.` is accepted but not the bare canonical string. Accepted is the primary score because the answer is factually right.

One run can move one or two questions; these figures pool three runs. Run `/snapcompact benchmark 3` on your route for a range.

## Rendering measurements

These numbers come from the current continuous-flow layout and one-bit PNG encoder. They are rendering measurements, not model-recall scores, and they make no model call.

| Corpus @ 1568×1568                             | Frames | Content chars/frame | PNG total | PNG/frame |
| ---------------------------------------------- | -----: | ------------------: | --------: | --------: |
| Indented code corpus (28,729 chars, 960 lines) |      3 |               9,257 |   35.5 KB |   11.8 KB |

The same rendering path is regression-tested by [`src/rendering/density.test.ts`](../src/rendering/density.test.ts), which fixes frame count, characters per frame and PNG bytes on synthetic prose and code corpora; exact bytes vary slightly with the zlib build.

The reading legend is part of the checkpoint: `¶` marks one source newline, consecutive `¶` mark blank lines, leading spaces keep indentation, and rows wrap at the frame edge.
