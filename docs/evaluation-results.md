# Evaluation results

[简体中文](zh/evaluation-results.md)

## Benchmark v4

A real run on **2026-11-12** with route `opencode-go/deepseek-v4.1-flash`, the production renderer, the native summary engine and the v4 evaluation code. The accuracy suite used the 40-question `engineering-recall-v3` fixture; the session suite used the 5,000-line `engineering-long-5000` fixture (about 337,000 characters). The chosen checkpoint share is **0.4**; one reference accuracy run used 0.5.

The accuracy suite was attempted with three 0.4 runs. Two completed every arm; one run's original and native arms failed on a provider usage object that arrived as `null` in the v3-era adapter (the recall and visual arms completed). The bug is fixed in `scripts/benchmark-live.ts`; the failed arms are reported as failed, not silently replaced. A 0.35 accuracy attempt stalled at the provider and was canceled without producing data; the 0.4-versus-0.5 comparison decided the default. The session suite completed in one run.

### Accuracy pressure test

| Arm                  | 0.4 run A | 0.4 run B | 0.4 run C | 0.5 reference |
| -------------------- | --------- | --------- | --------- | ------------- |
| `original`           | 39/40     | 40/40     | failed    | 39/40         |
| `native-text`        | 40/40     | 40/40     | failed    | 40/40         |
| `snapcompact`        | 31/40     | 28/40     | 29/40     | 34/40         |
| `snapcompact-recall` | 39/40     | 40/40     | 40/40     | 40/40         |

Run C's `original` and `native-text` failed with `Cannot read properties of null (reading 'prompt_tokens')`; its `snapcompact-recall` arm was measured with 3 calls and 3 model requests. The recall arm's pooled accepted score is **39.7/40** (39, 40, 40), with head 21/21, middle 60/60 and tail 38/39. The 0.5 reference is one run and is not pooled with the 0.4 runs.

Strict recall scores were 38/40 (A), 38/40 (B), 37/40 (C) and 37/40 (0.5). The accepted score is the primary score because quoting a source sentence can append punctuation; strict matching is reported for transparency.

| Arm                  | Input (A / B)  | Cache read      | Cache write | Output          | Weighted (relative) |
| -------------------- | -------------- | --------------- | ----------- | --------------- | ------------------- |
| `original`           | 91 / 83        | 15,872 / 15,872 | 0 / 0       | 3,788 / 5,445   | 16,830 / 23,450     |
| `native-text`        | 17,396 / 1,651 | 0 / 15,616      | 0 / 0       | 10,784 / 11,474 | 60,532 / 49,109     |
| `snapcompact`        | 5,108 / 5,128  | 0 / 0           | 0 / 0       | 17,265 / 13,974 | 74,168 / 61,024     |
| `snapcompact-recall` | 7,286 / 7,857  | 19,328 / 13,184 | 0 / 0       | 1,549 / 1,942   | 15,415 / 16,943     |

This table is **diagnostic only**: one request carries all forty questions, and the no-tool visual arm generates a large answer, so these numbers are not steady-state cost. The session suite is the cost measurement.

| Check                            | Result                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| Usage audit (A)                  | 98,467 reported, 98,467 computed, 0 unreported                |
| Usage audit (B)                  | 92,226 reported, 92,226 computed, 0 unreported                |
| Usage audit (C, recall + visual) | 40,672 reported, 40,672 computed, 0 unreported                |
| Usage audit (session)            | 861,307 reported, 861,307 computed, 0 unreported, 27 requests |
| Visual checkpoint (A/B)          | 3 frames, 5,701 estimated tokens, 6,741-token budget, 593 ms  |
| Visual checkpoint (0.5)          | 5 frames, 8,382 estimated tokens, 8,426-token budget, 797 ms  |
| Archive coverage                 | 40/40 sources verbatim in every run                           |

### Long-session cost

| Arm                  | 6-turn prompt | Peak single-request prompt | Output | Weighted cost | Relative to original | Accuracy | Requests | Recall calls | Tool bytes |
| -------------------- | ------------- | -------------------------- | ------ | ------------- | -------------------- | -------- | -------- | ------------ | ---------- |
| `original`           | 476,393       | 79,645                     | 550    | 50,625        | 1.00×                | 8/8      | 6        | 0            | 0          |
| `native-text`        | 83,979        | 995                        | 1,505  | 87,119        | 1.72×                | 8/8      | 6        | 0            | 0          |
| `snapcompact`        | 124,104       | 20,954                     | 1,000  | 35,598        | 0.70×                | 4/8      | 6        | 0            | 0          |
| `snapcompact-recall` | 173,276       | 22,154                     | 500    | 39,570        | 0.78×                | 8/8      | 8        | 2            | 931        |

Each arm used the same persistent history: the source or checkpoint once, then the question, answer and any recall pages. The recall arm's two recall turns each needed a second model request (one tool call); the other four turns were plain. The visual arm rendered 19 frames locally, with an estimated checkpoint of 27,446 tokens. The native arm includes one summary generation.

| Recall-rate sensitivity | Weighted cost | Relative to original | Source                         |
| ----------------------- | ------------- | -------------------- | ------------------------------ |
| 0%                      | 35,598        | 0.70×                | measured visual arm            |
| 33%                     | 39,570        | 0.78×                | measured recall schedule       |
| 100%                    | 51,070        | 1.01×                | modeled from heavy/plain turns |

The 100% point is modeled, not a run. It replaces the four plain turns with the measured heavy-turn average. The model is intentionally labeled because a real 100% schedule would also change cache behavior.

| Recall attribution | Estimated tokens | Share of prompt |
| ------------------ | ---------------- | --------------- |
| Checkpoint resend  | 165,284          | 95.4%           |
| Recall tool pages  | 233              | 0.1%            |
| Other prompt       | 7,759            | 4.5%            |
| Output             | 500              | —               |

Checkpoint resend is the visual arm's measured plain-turn prompt × the recall arm's requests; tool pages are serialized bytes ÷ 4. The page payload is nearly free. The cost comes from re-sending the checkpoint for the extra request in each recall turn.

| Capacity (deterministic) | Estimated source tokens | Original fits 200k | Checkpoint estimate |
| ------------------------ | ----------------------- | ------------------ | ------------------- |
| 250,000 chars            | 62,500                  | yes                | 27,446              |
| 500,000 chars            | 125,000                 | yes                | 27,446              |
| 1,000,000 chars          | 250,000                 | no                 | 27,446              |

### What the run shows

- **The v3 accounting problem is real and fixed.** The v4 audit reconciles every measured request against the provider total. The accuracy A run's 98,467 and the session's 861,307 totals have zero unreported prompt tokens. The v3 recall run's 18,688-token gap is exactly the missing `prompt_cache_hit_tokens` side; v3's "19,812 total" was not a measurement.
- **Recall is exact.** The 0.4 recall arm scored 39.7/40 across three runs (head 21/21, middle 60/60, tail 38/39) and 8/8 on the long session. The visual-only arm scored 28–31/40 on the accuracy fixture and 4/8 on the session because the frames omit or garble exact middle values. The archive is doing the exactness work.
- **The long-session saving is real but smaller than the plan's target.** At 33% recall turns, the weighted cost is **0.78× original** (39,570 vs 50,625), not the 0.65× target. The peak single-request prompt is **0.28×** original (22,154 vs 79,645), which passes the 0.4× target. The 0.70× visual-only arm is cheaper, but it answers only 4/8.
- **At 100% recall, compaction does not save.** The modeled 100% point is **1.01× original**. Every recall turn adds a second request that re-sends the checkpoint; at a 0.4 share that is enough to erase the win. The 0.9× target is not met.
- **The checkpoint, not the page, is the cost.** 95.4% of the recall prompt is checkpoint resend; the recall tool pages are 0.1%. Snippet trimming already removed the page problem. The remaining lever is fewer recall rounds, a smaller checkpoint, or a higher cache-read discount; lowering the share further trades visual-only accuracy and frame count.
- **The 0.4 default is a deliberate trade.** At the accuracy fixture, 0.4 uses 3 frames and 5,701 tokens, and the visual-only arm scored 28–31/40. At 0.5 it uses 5 frames and 8,382 tokens and scored 34/40. The recall arm stayed at 39–40/40 at both shares. Set `budget.checkpointShare: 0.5` if the visual-only path matters more than the smaller checkpoint.
- **A native summary is not a cost win at this horizon.** At six turns it cost 1.72× original: the one-time summary generation dominates its tiny per-turn prompt. A longer horizon changes that, but the suite does not claim it.
- **Capacity is the other axis.** The original 337,000-character history is about 80k tokens. At 1,000,000 characters the original no longer fits a 200k window while the checkpoint stays around 27k. The win at that scale is capacity, not a lower bill.

### Acceptance against the plan

| Item                      | Target                                    | Result                                |
| ------------------------- | ----------------------------------------- | ------------------------------------- |
| Usage audit               | every measured run `unreportedPrompt = 0` | pass (A/B/C/session)                  |
| Recall accuracy           | mean ≥ 39.5/40                            | **39.7/40** (39, 40, 40)              |
| Recall middle             | ≥ 59/60                                   | **60/60**                             |
| Recall head               | 21/21                                     | **21/21**                             |
| Recall tail               | ≥ 38/39                                   | **38/39**                             |
| Peak prompt, long session | ≤ 0.4× original                           | **0.28×** pass                        |
| 33% recall turns          | ≤ 0.65× original                          | **0.78×** fail                        |
| 100% recall turns         | ≤ 0.9× original                           | **1.01×** fail                        |
| Visual-only path          | report honestly, no pass line             | 28–31/40 accuracy, 4/8 session, 0.70× |
| Engineering               | `check` green                             | pass (319 tests)                      |

The 33% and 100% cost targets were not met. The measured result is a 22% saving at one third recall turns and parity at every-turn recall. That is the honest answer to "does compaction still make sense": it can, for long histories with moderate exact recall; it does not at a high recall rate or a short horizon.

### Why v3 is not comparable

- v3's recall run reported `total_tokens = 32,593` but only accounted for 13,905 input+output; the missing 18,688 was a separate cache-hit side that the adapter never mapped. The corrected prompt is about 36,550 across four rounds, not 18,341.
- v3's "3-turn context" column multiplied a cold single-request prompt by three; it was neither three turns nor a bill, and it omitted output and cache prices. v4 reports input, cache read, cache write, output and a relative weighted cost.
- v3 used a 63,000-character, 16k-token fixture where the original always fit. v4's session fixture is 337,000 characters and 80k tokens.
- v3 asked all forty questions in one heavy request, forcing two to four recall rounds and a 5k page. v4's session schedule is 33% recall turns with one to three questions each.
- The v3 tables in this document have been removed. Do not cite them.

### Reproduction

```text
/snapcompact benchmark 3
/snapcompact benchmark session 1
```

The tracked harness wrote the JSON and Markdown under `.artifacts/v4/`:

```sh
node --experimental-strip-types scripts/benchmark-live.ts --preflight --lines=5000 --share=0.4
node --experimental-strip-types scripts/benchmark-live.ts --suite=accuracy --runs=3 --share=0.4
node --experimental-strip-types scripts/benchmark-live.ts --suite=session --runs=1 --share=0.4
```

The accuracy three-run invocation stalled twice at the provider and was replaced by the two completed one-run invocations plus the partial run; the data above is the completed measurement, not a synthetic rerun. The session run is a single run. Run the same commands on another route before generalizing.
