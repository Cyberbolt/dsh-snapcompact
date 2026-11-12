# Evaluation

[简体中文](zh/evaluation.md)

Snapcompact has two model-backed suites. The **accuracy suite** asks forty fixed questions against one history and measures reading quality. The **session suite** drives six consecutive turns against one long persistent history and measures cost, including checkpoint resend and the recall pages that stay in that history. Neither suite is a billing measurement, and neither uploads private session content.

Both commands explicitly start model requests:

```text
/snapcompact benchmark [1-5]          # accuracy suite
/snapcompact benchmark session [1-5]  # long-session cost suite
```

The standalone harness under [`scripts/benchmark-live.ts`](../scripts/benchmark-live.ts) runs the same suites against a configured OpenAI-compatible endpoint and writes JSON and Markdown under `--out`.

## Accuracy suite

The fixture is `engineering-recall-v3`: 40 questions across three regions, 20 middle probes and 40 decoys. Seven head facts stay in the exact head text, thirteen tail facts stay in the exact tail text, and twenty middle facts sit in the bitmap. Decoys are plausible but unscored, so a summarizer has to choose rather than copy one fact message.

| Arm                  | What it measures                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `original`           | The control: the full fixture text, no compaction.                                          |
| `native-text`        | The host's native summary generation plus a QA read.                                        |
| `snapcompact`        | The production visual checkpoint (bounded head/tail text + bitmap frames), no tools.        |
| `snapcompact-recall` | The same checkpoint with the real `snapcompact_recall` tool schema and a bounded tool loop. |

A single request carries all forty questions. That makes this a reading pressure test, not steady-state session cost: the report never uses it to claim a long-session saving. `benchmark 3` repeats the four QA arms three times; the native summary and the visual checkpoint are prepared once and reused, so the range measures reading stability, not summary-generation stability.

### Scoring

- **Accepted match** is the primary score. It compares the answer after trimming outer whitespace against the canonical answer plus fixture-declared equivalent spellings. It fixes rubric noise such as a quoted label prefix, and ignores one terminal `.`/`。` because quoting a whole source sentence appends it.
- **Strict match** is the secondary score: the canonical answer only, still after outer trim. Internal whitespace and code indentation remain significant.
- Each question is classified as `head`, `middle` or `tail` from where its exact source line sits in the serialized projection, not from its fixture label alone. Questions that cannot be located are `unknown` and reported.
- Every run records raw answers, the parse mode (`raw`, `extracted`, `failed`), per-region and per-kind tallies, token usage and the reconciled usage audit.

### Recall arm

The recall arm receives the same checkpoint plus the production `snapcompact_recall` schema. A tool call runs against the benchmark's own archive, through the same reader the registered tool uses. Search defaults to `detail: "snippet"`: up to three bounded windows per query with a complete matching-line count. `complete: true` means every query matched and nothing was clipped; `missing` and `truncated` report query indexes so a retry does not echo the batch.

A batch accepts up to twenty literals and is capped at 20,000 serialized characters. The report records tool calls, model requests and serialized tool-result bytes, so payload and round-count changes stay visible. The arm is capped at five tool rounds and forty executed calls; if the model asks for more, the runner forces one final answer without tools. The benchmark archive is created directly rather than by a committed compaction, so the arm bypasses the session index; page/query semantics are identical. If a route rejects tools, only this arm fails and the no-tool arms still run.

### Archive integrity

Before any QA call, the report checks whether every question's exact source line is present in the archive transcript. This is a deterministic coverage check for the recall path, not a model-recall score.

## Session suite

The long fixture is generated deterministically at 5,000 padding lines (about 337,000 characters, 84,000 estimated tokens with the benchmark meter). It has exact head and tail facts and six middle facts spread from 8% to 82% of the history, so a recall search cannot get every answer from one region. The messages are chunked below `messageTextMaxChars`; otherwise the serializer would clip the history before the model ever sees it.

The schedule is `plain, plain, light, plain, heavy, plain`:

| Turn type | Questions        | What the model is told                            |
| --------- | ---------------- | ------------------------------------------------- |
| `plain`   | 1 head/tail fact | Answer from the checkpoint; do not call recall.   |
| `light`   | 1 middle fact    | Use at most one batched recall call, then answer. |
| `heavy`   | 3 middle facts   | Use at most one batched recall call, then answer. |

One sixth of the turns is `light` and one sixth is `heavy`; together the two recall turns are one third of the six. The rest are `plain`. The suite also records `offSchedule` when a plain turn calls recall or a recall turn makes more than one call.

Each arm uses **one persistent message history**:

1. The source history (original) or the checkpoint is placed at the start, exactly once.
2. Each turn appends the question, the assistant answer and any recall tool traffic.
3. Recall pages are not removed. Later turns re-send them, which is the real page-residency cost.

The four arms are the same as the accuracy suite. The native summary is generated once and its usage is amortized into the native arm; the visual checkpoint is rendered once locally and its render time is excluded from model cost. The suite records, per turn: prompt tokens, output tokens, cache read/write, weighted cost, model requests, recall calls, recall bytes, correctness and elapsed time.

### Reported cost

```text
prompt    = input + cacheRead + cacheWrite
weighted  = input + 0.1·cacheRead + 1.25·cacheWrite + 4·output
```

Weighted cost is a **relative unit**, not a bill. The multipliers are a transparent assumption, not a provider price list.

The 0% and 33% points are measured arms: the visual arm has no recall turns, and the recall arm runs the schedule above. The 100% point is modeled from the measured heavy and plain turns:

```text
modeled100 = recallCost + plainTurnCount × (meanHeavyCost − meanPlainVisualCost)
```

It is labelled `modeled` in the report and should not be read as a run. The attribution table splits the recall arm's prompt into checkpoint resend (`checkpointTokens × requests`), tool pages (serialized bytes ÷ 4) and the remainder.

The capacity table is deterministic and makes no model call: at 250k, 500k and 1M source characters it estimates source tokens as `chars / 4`, compares them with the routed window's trigger threshold, and shows the measured checkpoint size. It demonstrates the regime where the original history no longer fits; it does not claim a saving at those sizes.

## Usage audit

DSH's `TokenUsage` counts are disjoint: `inputTokens` is uncached input, and cached input is reported separately as `cacheReadTokens`/`cacheWriteTokens`. The benchmark's provider adapter must map the provider's fields into those three buckets and preserve `total_tokens`.

Every measured request is audited:

```text
computed = input + cacheRead + cacheWrite + output
unreportedPrompt = max(0, reportedTotal − computed)
```

Any positive `unreportedPrompt` fails that run. This is the v3 defect that invalidated its recall comparison: the adapter read only `prompt_tokens_details.cached_tokens`, so a separate `prompt_cache_hit_tokens` side was invisible and one recall run's `total_tokens` exceeded its mapped input plus output by 18,688. The report now prints the audit and the harness exits non-zero when it is incomplete.

## Reported metrics

- Accepted and strict match counts, mean/min/max across accuracy runs, and pooled head/middle/tail totals.
- Per-region and per-kind tallies, plus every missed key with its expected and given answer.
- Native-summary generation usage and latency; visual frame count, checkpoint tokens, the configured-share budget, whether the checkpoint is over budget, and preparation latency.
- Input, cacheRead, cacheWrite and output usage with the audit, plus relative weighted cost.
- Recall tool calls, model requests and serialized payload bytes.
- Session peak prompt, cumulative prompt, output, weighted cost, requests, calls, correctness and attribution.
- A local-only density check (`src/rendering/density.test.ts`) fixes frame count, characters per frame and PNG bytes without a model call; it does not measure recall.

## Interpretation limits

A fixed fixture is reproducible, not representative of every language, provider or long-running project. A single run can invert one or two questions; `benchmark 3` exists for published ranges. Standalone fixture requests differ from a full routed conversation's system/tool envelope. The accepted score is deliberately more forgiving than strict matching; quote both when comparing.

The visual arms are the production local-rendering path: bounded head/tail text plus bitmap frames, with no summary call. A checkpoint that fits the benchmark's configured-share budget may still be rejected by a real session whose trigger leaves less room; the report flags over-budget checkpoints. Visual arms can be skipped for missing vision metadata, undeclared pricing, unreadable request resizing or an insufficient frame budget. That is a safety fallback, not evidence of successful image comprehension.

A response without provider usage is marked unmeasured rather than used for a fabricated token-saving claim. The session suite's 100% point is explicitly modeled, and the capacity table is explicitly an estimate. The only claims that survive are the measured arms, the audited usage and the fixture-relative accuracy.

## Reproduction

```text
/snapcompact benchmark        # one accuracy run
/snapcompact benchmark 3      # three accuracy runs; use for published ranges
/snapcompact benchmark session  # one six-turn session run
```

For a tracked, non-interactive run:

```sh
node --experimental-strip-types scripts/benchmark-live.ts --preflight --lines=5000
node --experimental-strip-types scripts/benchmark-live.ts --suite=all --runs=1 --share=0.4
```

The script reads `OPENCODE_GO_API_KEY` (or `SNAPCOMPACT_BENCH_API_KEY`) and accepts `--provider`, `--model` and `--api-url` for an OpenAI-compatible chat-completions endpoint. `--preflight` renders the long fixture once and makes no model call.

For real-project evaluation, obtain permission for both the history and destination provider, then prepare redacted fixtures. Never commit private session logs as public benchmark assets.
