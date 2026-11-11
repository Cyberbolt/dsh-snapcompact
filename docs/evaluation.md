# Evaluation

[简体中文](zh/evaluation.md)

`/snapcompact benchmark` **explicitly starts model requests**. A single run makes one native-summary generation plus four QA arms: three single-call arms (raw history, native summary, visual OCR) and a recall arm that may use up to five tool rounds and forty executed recall calls before the runner forces one final answer without tools. The OCR arm is explicitly told that its run has no tools, so a model cannot be scored on asking for a recall it does not have. If visuals cannot be generated safely, the visual arms are skipped, not replaced by a text call labeled as vision.

## Benchmark v3

The default fixture is `engineering-recall-v3`: 40 questions across three regions, 20 middle probes and 40 decoys. Seven head facts stay in the exact head text, thirteen tail facts stay in the exact tail text, and twenty middle facts sit in the bitmap. Decoys are plausible but unscored, so a summarizer has to choose rather than copy one fact message.

The report separates four arms:

| Arm                  | What it measures                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `original`           | The control: the full fixture text, no compaction.                                          |
| `native-text`        | The host's native summary generation plus a QA read.                                        |
| `snapcompact`        | The production visual checkpoint (bounded head/tail text + bitmap frames), no tools.        |
| `snapcompact-recall` | The same checkpoint with the real `snapcompact_recall` tool schema and a bounded tool loop. |

### Scoring

- **Accepted match** is the primary score. It compares the answer after trimming outer whitespace against the canonical answer plus fixture-declared equivalent spellings. It fixes rubric noise such as a quoted label prefix, and ignores one terminal `.`/`。` because quoting a whole source sentence appends it.
- **Strict match** is the secondary score: the canonical answer only, still after outer trim. Internal whitespace and code indentation remain significant.
- Each question is classified as `head`, `middle` or `tail` from where its exact source line sits in the serialized projection, not from its fixture label alone. Questions that cannot be located are `unknown` and reported.
- Every run records raw answers, the parse mode (`raw`, `extracted`, `failed`), per-region and per-kind tallies, and token usage.
- `benchmark` runs once. `benchmark 3` repeats the four QA arms three times and reports mean/min/max. The native summary and the visual checkpoint are generated once and reused, so the range measures reading stability, not summary-generation stability. That limitation is stated in the report warning.

### Recall arm

The recall arm receives the same checkpoint plus the production `snapcompact_recall` schema. A tool call runs against the benchmark's own archive, with the same page reader the registered tool uses. It is capped at five tool rounds and forty executed tool calls; if the model asks for more, the runner forces one final answer without tools. The cap tracks the production agent, which has no per-turn recall limit of its own. The benchmark archive is created directly rather than by a committed compaction, so the arm bypasses the session index; the page/query semantics are identical. If a route rejects tools, only this arm fails and the OCR arm still runs.

### Archive integrity

Before any QA call, the report checks whether every question's exact source line is present in the archive transcript. This is a deterministic coverage check for the recall path, not a model-recall score.

## Reported metrics

- Accepted and strict match counts, mean/min/max across runs, and pooled head/middle/tail totals.
- Per-region and per-kind tallies, plus every missed key with its expected and given answer.
- Native-summary generation usage and latency; visual frame count, checkpoint tokens, the half-of-source budget, whether the checkpoint is over budget, and preparation latency.
- Provider-reported input/output/cacheRead/cacheWrite usage. Missing fields are not invented.
- Prompt totals follow DSH's contract: input + cacheRead + cacheWrite, not totalTokens, which can also include output.
- Recall tool calls, extra tokens, and the accepted-score delta between the OCR and recall arms.
- A local-only density check (`src/rendering/density.test.ts`) fixes frame count, characters per frame and PNG bytes without a model call; it does not measure recall.

## Cost axes

Token economy has a one-time axis and a steady-state axis. The local visual path has no generation call but a larger checkpoint; a native summary pays a summarizer call once and then carries a smaller context. The report shows generation tokens, per-turn read tokens, one-run total tokens and a three-turn context projection. Image pricing is an estimate, not a bill. Never compare a summary's per-turn read against a visual checkpoint's per-turn read without the summarizer call.

## Interpretation limits

A fixed fixture is reproducible, not representative of every language, provider or long-running project. A single run can invert one or two questions; `benchmark 3` exists for published ranges. Standalone fixture requests differ from a full routed conversation's system/tool envelope. The accepted score is deliberately more forgiving than strict matching; quote both when comparing.

The visual arms are the production local-rendering path: bounded head/tail text plus bitmap frames, with no summary call. v3 scatters facts across head, middle and tail and reports regions separately, so a middle-frame score is visible on its own. A checkpoint that fits the benchmark's half-of-source budget may still be rejected by a real session whose trigger leaves less room; the report flags over-budget checkpoints.

Visual arms can be skipped for missing vision metadata, undeclared pricing, unreadable request resizing or an insufficient frame budget. That is a safety fallback, not evidence of successful image comprehension. A response without provider usage is marked unmeasured rather than used for a fabricated token-saving claim.

## Reproduction

```text
/snapcompact benchmark      # one run
/snapcompact benchmark 3    # three QA runs; use for published ranges
```

For real-project evaluation, obtain permission for both the history and destination provider, then prepare redacted fixtures. Never commit private session logs as public benchmark assets.
