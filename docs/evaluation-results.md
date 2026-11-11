# Evaluation results

[简体中文](zh/evaluation-results.md)

## Benchmark v3

A real synthetic-fixture run on **2026-11-11** with route `opencode-go/deepseek-v4.1-flash`, fixture `engineering-recall-v3`, one run. It used the production renderer, the native summary engine and the `evaluate()` path; no private session history was read or uploaded. A single run is not a range.

| Arm                  | Status   | Accepted | Strict | head | middle |  tail |
| -------------------- | -------- | -------: | -----: | ---: | -----: | ----: |
| `original`           | measured |    40/40 |  40/40 |  7/7 |  20/20 | 13/13 |
| `native-text`        | measured |    38/40 |  37/40 |  6/7 |  20/20 | 12/13 |
| `snapcompact`        | measured |    33/40 |  32/40 |  7/7 |  14/20 | 12/13 |
| `snapcompact-recall` | measured |    34/40 |  34/40 |  7/7 |  15/20 | 12/13 |

| Arm                  | One-time generation | Per-turn read | One-run total | 3-turn context |
| -------------------- | ------------------: | ------------: | ------------: | -------------: |
| `original`           |                   0 |        15,963 |        20,546 |         47,889 |
| `native-text`        |              20,440 |         1,623 |        27,111 |         25,309 |
| `snapcompact`        |                   0 |         6,710 |        18,806 |         20,130 |
| `snapcompact-recall` |                   0 |        23,650 |        31,230 |         70,950 |

The native summary used 20,440 generation tokens (83.8s). The visual checkpoint used 5 frames, an estimated 8,268 tokens against an 8,426-token half-of-source budget, and prepared in 0.9s. The archive contained all 40 sources verbatim. The recall arm made 4 tool calls and gained one accepted answer over OCR.

### What the run shows

- **Answerability:** the native summary scored 38/40 accepted (37 strict) against 33/40 (32 strict) for the visual OCR arm. The visual arm's head text was perfect (7/7); its loss is concentrated in middle-frame exact strings (14/20), mostly audit tokens, checksums, request ids and command suffixes.
- **Cost:** the visual arm paid no generation call and read 6,710 tokens per turn; the native summary paid 20,440 tokens once and read 1,623 per turn. At three turns the visual context is still cheaper (20,130 vs 25,309). The summary becomes cheaper on longer horizons.
- **Recall:** four bounded tool calls recovered two middle facts (`m_flag`, `m_logcode`), lost `m_request`, and added one accepted answer net, but raised the read to 23,650 tokens. On this fixture, recall is a targeted exact-string path, not a cheaper default.
- **Control:** the uncompressed original scored 40/40, so the accepted rubric is calibrated. `t_next` was missed by every compacted arm (truncated to "run integration tests"); the text was present verbatim, so this is an answer-completeness failure, not missing context.

One run can move one or two questions; treat the table as a measurement, not a universal ranking. Run `/snapcompact benchmark 3` on your route for a range.

## Rendering measurements

These numbers come from the current continuous-flow layout and one-bit PNG encoder. They are rendering measurements, not model-recall scores, and they make no model call.

| Corpus @ 1568×1568                             | Frames | Content chars/frame | PNG total | PNG/frame |
| ---------------------------------------------- | -----: | ------------------: | --------: | --------: |
| Indented code corpus (28,729 chars, 960 lines) |      3 |               9,257 |   35.5 KB |   11.8 KB |

The same rendering path is regression-tested by [`src/rendering/density.test.ts`](../src/rendering/density.test.ts), which fixes frame count, characters per frame and PNG bytes on synthetic prose and code corpora; exact bytes vary slightly with the zlib build.

The reading legend is part of the checkpoint: `¶` marks one source newline, consecutive `¶` mark blank lines, leading spaces keep indentation, and rows wrap at the frame edge.
