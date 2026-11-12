# Evaluation results

[简体中文](zh/evaluation-results.md)

> **Status: valid.** v5.1 test, 3 runs per arm: 12/12 product gates and 7/7 instrument checks pass.
> Route `opencode-go/deepseek-v4.1-flash` · fixture `project-recall-v5-20261113` (seed 20261113, SHA-256 `087da65c…`) · report SHA-256 `2e62ad36…` · frozen design commit `71ae82d`.

## Verdict

Snapcompact scored **39.67/40 per run**, level with the uncompressed history at 39.33 (0.33 questions apart, inside run-to-run noise) and ahead of the native summary at 32.33. It used **5.6%** of the uncompressed peak prompt and **18.9%** of its weighted cost. In one sentence: a compaction that drops information costs about seven questions per run, and this checkpoint loses none.

## Terms

| Term          | Meaning                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| arm           | one experimental condition: the same history, presented differently                                          |
| run           | one pass of an arm over all 40 questions (10 turns × 4). Every score is per run unless it says "3-run total" |
| exact string  | 1 of 16 questions that must be copied character for character (checksums, paths, commands, identifiers)      |
| frame         | one rendered image of the checkpoint history                                                                 |
| peak prompt   | the largest single-request prompt inside a run (the report prints the first measured run)                    |
| weighted cost | `input + 0.1·cacheRead + 1.25·cacheWrite + 4·output`; a relative unit, not a bill                            |

## Product arms

| Arm                              | Score per run (3 runs) | Exact per run (/16) | Frames | Peak prompt | Weighted cost |
| -------------------------------- | ---------------------- | ------------------- | ------ | ----------- | ------------- |
| `original` — nothing compressed  | 39.33 (40, 38, 40)     | 16.00               | —      | 128,092     | 140,860       |
| `native-text` — one host summary | 32.33 (34, 31, 32)     | 13.67               | —      | 3,332       | 19,612        |
| `pure-visual` — snapcompact      | **39.67** (39, 40, 40) | 15.67               | 3      | 7,178       | 26,604        |

`original` is what the model can do with the full history. `native-text` is what a normal lossy summary costs: 32.33, about seven questions worse. `pure-visual` is the shipped checkpoint — 3 frames plus a bounded exact-token text index, priced at 6,317 checkpoint tokens — and it gives the seven questions back.

## Instrument controls (not product results)

Think of one open-book exam in three groups: one gets photographs of the textbook (`pure-visual`), one gets the textbook itself (`gold-text`), one gets deliberately damaged photographs (`degraded-visual`).

| Arm                                 | What it measures                                                      | Result | Criterion                    |
| ----------------------------------- | --------------------------------------------------------------------- | ------ | ---------------------------- |
| `gold-text` — exact-text ceiling    | how many points survive when the history is handed over as exact text | 39.67  | ≥ 38 and ≥ visual − 1        |
| `degraded-visual` — damaged control | whether the score really comes from reading the frames                | 11.67  | ≤ 32 and ≥ 4 questions worse |

`gold-text` uses the same head/middle/tail selection and the same exact-token index as snapcompact, but the middle arrives as text instead of pixels. It is the **ceiling**, not a product: if the ceiling could not reach 38, the task or the rubric would be broken and a high snapcompact score would mean nothing. This run the ceiling and snapcompact are identical at 39.67, so rendering the middle as pixels cost nothing.

`degraded-visual` keeps every other frame, downscales each by 50% and drops the index. Its score must collapse; if damaging the frames changed nothing, the suite would not be testing the frame path at all. It fell from 39.67 to 11.67.

Neither row belongs in the product verdict. They are what makes the table above trustworthy.

## Gates

| Group      | Check                       | Threshold                          | Actual                | Result |
| ---------- | --------------------------- | ---------------------------------- | --------------------- | ------ |
| Instrument | Exact-text ceiling          | ≥ 38/40                            | 39.67                 | pass   |
| Instrument | Ceiling ≥ snapcompact − 1   | gold ≥ visual − 1                  | 39.67 vs 39.67        | pass   |
| Instrument | Damaged control             | ≤ 32/40                            | 11.67                 | pass   |
| Instrument | Damaged ≥ 4 questions worse | ≥ 4.00                             | 28.00                 | pass   |
| Instrument | Ordering (strict)           | gold ≥ visual > degraded           | 39.67 / 39.67 / 11.67 | pass   |
| Instrument | No leakage                  | 40 questions + ≥ 20 decoys         | 40 / 20               | pass   |
| Instrument | Reproducible                | fixture and report hashes recorded | recorded              | pass   |
| Product    | Overall                     | ≥ 38/40                            | 39.67                 | pass   |
| Product    | Exact-string subset         | ≥ 15/16                            | 15.67                 | pass   |
| Product    | Cross-region                | ≥ 5/6                              | 6.00/6                | pass   |
| Product    | Temporal / causal           | ≥ 5/6                              | 6.00/6                | pass   |
| Product    | Negation / constraint       | ≥ 4/5                              | 5.00/5                | pass   |
| Product    | CJK                         | ≥ 3/4                              | 4.00/4                | pass   |
| Product    | Numeric                     | ≥ 2/3                              | 3.00/3                | pass   |
| Product    | Head region                 | ≥ 6/7                              | 7.00/7                | pass   |
| Product    | Middle region               | ≥ 25/27                            | 26.67/27              | pass   |
| Product    | Tail region                 | ≥ 5/6                              | 6.00/6                | pass   |
| Product    | Peak prompt                 | ≤ 0.40× original                   | 0.056×                | pass   |
| Product    | Weighted cost               | ≤ 0.78× original                   | 0.189×                | pass   |

## Hits by class and region

Snapcompact, pooled over the three runs. The 3-run denominator is always the per-run question count × 3; every threshold is judged per run.

| Class                 | Questions per run | 3-run total | Per run |
| --------------------- | ----------------- | ----------- | ------- |
| Exact command         | 4                 | 12/12       | 4.00    |
| Exact path            | 4                 | 12/12       | 4.00    |
| Exact checksum        | 4                 | 12/12       | 4.00    |
| Exact identifier      | 4                 | 11/12       | 3.67    |
| Cross-region          | 6                 | 18/18       | 6.00    |
| Temporal / causal     | 6                 | 18/18       | 6.00    |
| Negation / constraint | 5                 | 15/15       | 5.00    |
| CJK                   | 4                 | 12/12       | 4.00    |
| Numeric               | 3                 | 9/9         | 3.00    |
| Head region           | 7                 | 21/21       | 7.00    |
| Middle region         | 27                | 80/81       | 26.67   |
| Tail region           | 6                 | 18/18       | 6.00    |

Across all 120 scored answers there is exactly one miss: a single question in the middle region, classed as an exact identifier, on turn 7 of run 1. The other two runs are perfect.

## Cost

Peak prompt and weighted cost come from the first measured run of each arm; ratios are against `original`. The usage audit reconciles all 150 requests: 4,758,294 reported and 4,758,294 computed total tokens, 0 unreported prompt tokens. Weighted cost is a relative unit, not a bill.

Both instrument arms cost more than the arm they check: the ceiling used a 15,782-token peak prompt and 52,718 weighted, and the damaged control a 5,096 peak prompt and 66,653 weighted against snapcompact's 26,604. Unreadable frames make the model search longer, which is the practical reason frames have to stay legible in production.

## Conventions of this run

- `gold-text` receives the same exact-token index and the same closing re-read rule as snapcompact, so it is a strict information superset rather than a different presentation.
- The CJK rubric accepts a leading-clause paraphrase (for example `扩容连接池` for `先扩容连接池，再重放队列`), per commit `71ae82d`.
- `gold-text` uses the provider default reasoning effort while the other arms use `low`. The asymmetry can only raise the ceiling, not lower it.
- The ceiling check allows `gold ≥ visual − 1` (the authorized v5.1 tolerance) while the ordering check still requires `gold ≥ visual` strictly. Both passed; **no product threshold changed**.

## Provenance

- Design, frozen thresholds and the full history: [evaluation-v5-prereg.md](evaluation-v5-prereg.md) — its changelog carries the aborted v5 run and every v5.1 deviation.
- Reproduction commands, arms and the schedule: [evaluation.md](evaluation.md).
- v4 historical numbers and the audit that retired it: [evaluation-audit.md](evaluation-audit.md).
- The frozen v5 test (SHA-256 `a7a169…`) was aborted during `gold-text` run 1 on a presentation/ceiling issue; its `original` arm had completed at 38/38/38. That partial run is **invalid** and is not counted as a pass.
- The test split is generated from the committed seed under `.artifacts/` and is not committed.

## Boundaries

Route-specific (`opencode-go/deepseek-v4.1-flash`); a different decoding setting can move a question or two. The exact-token index is a product feature, not a benchmark trick: it is generated from the same serialized history, capped at 80 labeled lines, and the damaged control removes it. A generated scenario is reproducible, not representative of every language or project. Read these numbers with the pre-registration, not as a universal savings claim.
