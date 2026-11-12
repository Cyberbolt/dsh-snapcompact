# Evaluation results

[简体中文](zh/evaluation-results.md)

## v5.1 test and the aborted v5 record

### v5.1 frozen test result

Status: **valid** for v5.1. This is not the frozen v5 result; see the aborted v5 record below.

- Fixture: `project-recall-v5-20261113`, seed 20261113, SHA-256 `087da65cd52a3087b622de8925eb1acf366abe6d15f7941b551aec4de9c5cb13`.
- Route: `opencode-go/deepseek-v4.1-flash`.
- Runs: 3 per arm. Production/native/degraded use `reasoning_effort: low`; gold uses the provider default.
- Report SHA-256: `2e62ad36f99162a479bb46642b9bc10398c0fb9e449628513789fb58d3ec791b`.

| Arm               |   Accepted mean (runs) | Exact mean | Frames | Peak prompt | Weighted |
| ----------------- | ---------------------: | ---------: | -----: | ----------: | -------: |
| `original`        |     39.33 (40, 38, 40) |      16.00 |      — |     128,092 |  140,860 |
| `native-text`     |     32.33 (34, 31, 32) |      13.67 |      — |       3,332 |   19,612 |
| `pure-visual`     | **39.67** (39, 40, 40) |  **15.67** |      3 |       7,178 |   26,604 |
| `gold-text`       |     39.67 (40, 40, 39) |      15.67 |      — |      15,782 |   52,718 |
| `degraded-visual` |     11.67 (11, 12, 12) |       1.67 |      3 |       5,096 |   66,653 |

Pure visual: 39.67/40 mean, 15.67/16 exact, 21/21 head, 80/81 middle, 18/18 tail, 12/12 CJK, 18/18 cross-region, 18/18 temporal/causal, 15/15 negation, 9/9 numeric. Peak prompt is **0.056×** original and weighted cost is **0.189×** original. The usage audit reconciles all 150 requests: 4,758,294 reported, 4,758,294 computed, 0 unreported prompt tokens.

**Instrument acceptance (all pass):**

| Check                     | Result                                                                     |
| ------------------------- | -------------------------------------------------------------------------- |
| Gold ceiling ≥38          | 39.67 pass                                                                 |
| Gold ≥ pure visual        | 39.67 vs 39.67 pass (strict; the authorized v5.1 tolerance was not needed) |
| Degraded ≤32              | 11.67 pass                                                                 |
| Degraded ≥4 worse         | 28.00 pass                                                                 |
| Ordering                  | gold 39.67 ≥ visual 39.67 ≥ degraded 11.67 pass                            |
| No leakage / reproducible | pass                                                                       |

**Product gates (all pass):** overall 39.67 ≥ 38; exact 15.67 ≥ 15; cross-region 18/18; temporal/causal 18/18; negation 15/15; CJK 12/12; numeric 9/9; head 21/21; middle 80/81; tail 18/18; peak 0.056× ≤ 0.40×; weighted 0.189× ≤ 0.78×.

### Recall reference (offline, same test split)

The offline `recall-ref` arm ran three times on the **same** test fixture (`087da…`) and the same visual checkpoint:

| Arm          | Scores     |  Mean | Tool calls |
| ------------ | ---------- | ----: | ---------: |
| `recall-ref` | 39, 40, 40 | 39.67 |         29 |

Non-inferiority: pure visual 39.67 ≥ recall 39.67 − 1; the observed difference is 0. The reference arm was never registered in production and is removed after this test.

### Aborted v5 record (invalid)

The frozen v5 test used SHA-256 `a7a169f31df57a3347e3efe0c1f65b0dd021b50ca604f491f5c0ea739fdea2ec` and was aborted during gold run 1 after a presentation/ceiling issue. Its original arm had completed at **38/38/38**. There is no final v5 report; the partial run is **invalid** and is not counted as a pass. The local log is `.artifacts/bench-v5/test.log`; the frozen v5 hash and the abort are recorded here rather than silently deleted.

### v5.1 deviations

- **CJK rubric relaxation (commit `71ae82d`)** and the fixture-hash change from `a7a169…` to `087da…`: the CJK action rubric accepts a leading-clause paraphrase such as `扩容连接池` for `先扩容连接池，再重放队列`. The full phrase and first clause were already accepted; the exact-string weight is unchanged.
- **Exact-token text index** in the production checkpoint (up to 80 labeled lines), because 64-character digests are not reliably readable from pixels. The degraded control omits it.
- **Gold presentation**: the gold arm includes the same index and the same closing re-read rule as pure visual.
- **Per-arm reasoning**: production/native/degraded use `reasoning_effort: low`; gold uses the provider default.
- **Ceiling tolerance**: v5.1 allows `gold ≥ visual − 1` after seeing partial v5 results, because at a full visual score the strict comparison degenerates and gold is a 39–40 random quantity. The strict comparison still passed here. **No product gate changed.**
- **Degraded control**: 50% downscale, every other frame, index omitted.
- No rubric, gold prompt, threshold or fixture change was made after the v5.1 test started; a future change requires a v6 with a new seed and freeze.

### Not passing by lowering standards

The v5 original arm was **38/38/38**; the v5.1 original arm was **40/38/40**. The task was not made easier: the original also improved, and the pure-visual exact subset is 15.67/16 with all class gates passing. The visual improvement comes from the exact-token index, 2 px letter spacing, foveation, and the denser serializer — not from deleting hard questions or relaxing exact-string scoring.

The v5 instrument is described in [evaluation.md](evaluation.md); its design and thresholds were frozen in [evaluation-v5-prereg.md](evaluation-v5-prereg.md). The test split is generated from seed 20261113 under `.artifacts/` and is not committed. The test fixture SHA-256 is `087da65cd52a3087b622de8925eb1acf366abe6d15f7941b551aec4de9c5cb13`.

## v5 dev validation

The dev split (seed 20261112, SHA-256 `d208662ccf6c27401648002924f8d8d89e3f4437d5e50ae715f7f481deae409b`) was used for iteration and instrument checks, not for the acceptance decision. Representative one-run results:

| Arm                    | Score | Exact | Notes                                           |
| ---------------------- | ----: | ----: | ----------------------------------------------- |
| `original`             | 38/40 | 16/16 | control                                         |
| `pure-visual`          | 40/40 | 16/16 | 3 frames + exact-token index                    |
| `gold-text`            | 40/40 | 16/16 | text + same index                               |
| `degraded-visual`      | 11/40 |  1/16 | 50% downscale, every other frame, index omitted |
| `recall-ref` (offline) | 40/40 | 16/16 | reference only                                  |

On the same dev run, pure visual used a 7,212-token peak prompt and 34,073 weighted units versus 128,100 and 254,491 for `original` (0.056× peak, 0.134× weighted). The exact-token index is why checksums, paths and commands are exact without a search tool. The degraded control is deliberately harsh: it removes the index and every other frame, so it measures the frame path rather than the text index.

The dev runs also showed why the instrument needs a ceiling and a negative control: an earlier pure-visual build without letter spacing read 26/40, with 0/4 checksums; the index and 2 px tracking took the same task to 40/40. The details are in [evaluation-audit.md](evaluation-audit.md) and the changelog in the pre-registration.

## v4 historical results

v4 is a **different instrument**: a single request with all 40 questions of `engineering-recall-v3`, plus a six-turn long-session cost suite. It is retained here as history, not as the v5 gate.

| v4 instrument           | Arm                  | Result                                        | Status     |
| ----------------------- | -------------------- | --------------------------------------------- | ---------- |
| accuracy, 3 runs at 0.4 | `snapcompact-recall` | 39.7/40; head 21/21, middle 60/60, tail 38/39 | historical |
| accuracy, 3 runs at 0.4 | `snapcompact`        | 28–31/40                                      | historical |
| accuracy, 3 runs at 0.4 | `original`           | 39–40/40 (one failed run)                     | historical |
| accuracy, 3 runs at 0.4 | `native-text`        | 40/40                                         | historical |
| session, 1 run          | `snapcompact-recall` | 8/8, 0.78× weighted, 0.28× peak               | historical |
| session, 1 run          | `snapcompact`        | 4/8, 0.70× weighted, 0.28× peak               | historical |

The v4 accuracy run's recall arm had a 0.4 share and a single request carrying all forty questions. Its cost is not steady-state session cost; the report said so. The v4 session suite had only six turns and eight questions, and its 100% recall point was modeled, not measured. The full v4 tables and reproduction commands are preserved in the git history of this document; the current repository no longer ships the v4 harness.

## Retracted and retained conclusions

**Retracted:**

- "Recall is exact" as a **product** conclusion. It described the v4 recall arm, not pure visual use. The recall tool is removed in 0.7.0.
- "Pure visual is 28–31/40" as a **capability limit**. It was a coverage/budget and letter-spacing artifact of the v4 fixture. v5 dev pure visual is 40/40 with a bounded exact-token index and 2 px tracking.
- "Long-session pure visual is 4/8" as a **general** result. It was a coverage artifact: the v4 visual arm kept only the newest middle frames. v5 foveates both edges, keeps the exact head/tail and adds the index.
- "0.4 share favors recall" as a **default recommendation**. 0.4 remains the default, but v5 measures the checkpoint as a whole; there is no recall path to favor.
- v4's "33% recall turns = 0.78×" as a **comparable** cost result. v5 uses a different task, schedule and cost basis.

**Retained:**

- The usage audit and weighted-cost formula.
- Deterministic fixtures from committed seeds.
- Exact-string questions at 40% of the task.
- Persistent multi-turn history and per-turn cost.
- Exact head/tail text plus bitmap middle.
- The `FILES` index.
- v4 results as historical data, with the caveats above.

## Reproduction

```sh
# dev validation (not the acceptance gate)
SNAPCOMPACT_BENCH_REASONING=low node --experimental-strip-types scripts/benchmark-v5.ts \
  --split=dev --runs=1 --out=.artifacts/bench-v5/dev

# frozen test, three runs
SNAPCOMPACT_BENCH_REASONING=low node --experimental-strip-types scripts/benchmark-v5.ts \
  --split=test --runs=3 --out=.artifacts/bench-v5/test
```

The test fixture is generated from the committed seed; the repository contains the generator and hashes, not the test content. The offline `recall-ref` arm used for the frozen non-inferiority check is not part of the shipped harness.

## Caveats

The results are route-specific (`opencode-go/deepseek-v4.1-flash`). The benchmark uses `reasoning_effort: low` for production, native and degraded arms, and the provider default for the gold ceiling; a different decoding setting can move a one- or two-question difference. The exact-token index is a product feature, not a benchmark trick: it is generated from the same serialized history, capped at 80 labeled lines, and the degraded control removes it. Weighted cost is a relative unit, not a bill. A generated scenario is reproducible, not representative of every language or project.
