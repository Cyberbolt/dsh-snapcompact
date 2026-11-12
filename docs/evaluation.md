# Evaluation

[简体中文](zh/evaluation.md)

Snapcompact's current evaluation is **v5**: a generated, task-level, multi-turn benchmark with a frozen dev/test split, a pre-registered rubric, and explicit controls. It replaces the v4 single-request 40-question pressure test and the six-turn session cost suite as the acceptance instrument. The v4 numbers remain in [evaluation-results.md](evaluation-results.md) as historical data.

The v5 design and thresholds were frozen before tuning in [evaluation-v5-prereg.md](evaluation-v5-prereg.md). The audit that retired v4 is [evaluation-audit.md](evaluation-audit.md).

## What the suite measures

One generated project scenario, 10 fixed turns, 4 questions per turn, 40 questions total. The history is a long engineering session (about 81,000 estimated source tokens) with user messages, assistant messages, tool calls, tool results, build/test logs, file listings, stack traces, incident notes and 20 plausible decoys. Questions cover:

| Class                 | Count |
| --------------------- | ----: |
| Exact command         |     4 |
| Exact path            |     4 |
| Exact checksum        |     4 |
| Exact identifier      |     4 |
| Numeric               |     3 |
| Cross-region semantic |     6 |
| Temporal / causal     |     6 |
| Negation / constraint |     5 |
| CJK                   |     4 |

Exact-string questions are 16/40 = 40% and are not down-weighted. The rubric is deterministic and source-derived:

- `exact`: trim outer whitespace, strip one surrounding backtick/quote pair, accept one terminal `.`/`。`; otherwise character-for-character.
- `all`: every required literal is present and no forbidden decoy literal is present.
- `any`: at least one accepted literal is present and no forbidden literal is present.

No model judges an answer. The prompt contains only the question text and JSON keys; the answer, rubric and source line stay in the fixture.

## Arms

| Arm               | Input                                                                                   | Tools | Purpose                |
| ----------------- | --------------------------------------------------------------------------------------- | ----- | ---------------------- |
| `original`        | Full fixture history                                                                    | None  | Control; no compaction |
| `native-text`     | Native summary generated once                                                           | None  | Host baseline          |
| `pure-visual`     | Production checkpoint: exact head/tail + bitmap frames + bounded exact-token text index | None  | Target                 |
| `gold-text`       | Same head/middle/tail selection as text                                                 | None  | Comprehension ceiling  |
| `degraded-visual` | Frames downscaled 50%, every other frame, index omitted                                 | None  | Negative control       |

The frozen test also ran an offline `recall-ref` arm (production checkpoint + archive recall) to check non-inferiority. That arm was never registered in production and was removed after the frozen test; the shipped harness has no archive or recall code.

The exact-token index is part of the checkpoint, not a recall tool: it is generated from the same serialized history as the frames, capped at 80 labeled lines, and contains no model-generated answer. It exists because 64-character digests are not reliably readable from pixels. The frames still carry the surrounding history.

## Schedule and cost

The 10-turn schedule is fixed. Each turn asks 4 questions in one user message and expects one JSON object. The persistent history appends the question and the assistant answer (and, for the offline recall reference only, tool traffic). Cost is recorded per turn:

```text
prompt    = input + cacheRead + cacheWrite
weighted  = input + 0.1·cacheRead + 1.25·cacheWrite + 4·output
```

Weighted cost is a relative unit, not a bill. The report includes peak single-request prompt, total weighted cost, ratios to `original`, model requests and usage-audit reconciliation.

The benchmark sets `reasoning_effort: low` on each request to bound hidden reasoning and keep the schedule feasible. The model still receives the full checkpoint and the same questions. The run log records the setting.

## Dev and test

| Split |     Seed | Committed?                               | Use                                                              |
| ----- | -------: | ---------------------------------------- | ---------------------------------------------------------------- |
| dev   | 20261112 | Seed and generator only                  | Iteration, renderer/serialization tuning, measurement validation |
| test  | 20261113 | Seed, generator and fixture SHA-256 only | Final acceptance, once, after the freeze                         |

The test fixture is generated under `.artifacts/bench-v5/test/` and is not committed. The generator prints only its SHA-256 and counts. The repository contains the generator, the seeds and the hashes; the test content is not inspected before the final run.

## Commands

The tracked harness runs the same suites against an OpenAI-compatible endpoint:

```sh
# Generate the dev fixture and print its hash/counts; no model call.
node --experimental-strip-types scripts/benchmark-v5.ts --split=dev --generate-only

# One dev run of all production arms.
SNAPCOMPACT_BENCH_REASONING=low node --experimental-strip-types scripts/benchmark-v5.ts \
  --split=dev --runs=1 --out=.artifacts/bench-v5/dev

# Final test: three runs, after the freeze.
SNAPCOMPACT_BENCH_REASONING=low node --experimental-strip-types scripts/benchmark-v5.ts \
  --split=test --runs=3 --out=.artifacts/bench-v5/test
```

The in-session `/snapcompact benchmark [1-5]` runs the **dev** split only. The test split is deliberately outside the repository and is run by the tracked harness.

The script reads `OPENCODE_GO_API_KEY` (or `SNAPCOMPACT_BENCH_API_KEY`) from the environment or the DSH credential store. It accepts `--provider`, `--model`, `--api-url`, `--share`, `--runs` and `--out`.

## Reading the report

The report includes fixture id/seed/hash, the fixed schedule, per-arm/per-run/per-turn/per-class/per-region/per-character-class results, means/min/max/95% intervals, usage audit, weighted cost, the measurement-instrument table and the product-gate table. It prints the v4 historical numbers separately.

The pre-registered gates are:

| Gate                        | Threshold                     |
| --------------------------- | ----------------------------- |
| Pure visual overall         | ≥ 38/40 mean over 3 test runs |
| Exact-string subset         | ≥ 15/16                       |
| Cross-region                | ≥ 5/6                         |
| Temporal / causal           | ≥ 5/6                         |
| Negation / constraint       | ≥ 4/5                         |
| CJK                         | ≥ 3/4                         |
| Numeric                     | ≥ 2/3                         |
| Head / tail / middle region | ≥ 6/7 / 5/6 / 25/27           |
| Peak single-request prompt  | ≤ 0.40× original              |
| Total weighted cost         | ≤ 0.78× original              |

Instrument acceptance (gold ceiling ≥38 and ≥ pure visual − 1, degraded ≤32 and ≥4 worse, ordering, no leakage, reproducibility, no test tuning) must pass before the product gates decide anything.

## Interpretation limits

A generated scenario is reproducible, not representative of every language, provider or project. The route is one model line; a different vision encoder can change frame legibility. The test split is held out from tuning but is still synthetic. The exact-token index is a product feature, not a benchmark trick; the degraded control removes it so the frame path is still tested. Weighted cost is relative, not a bill. The report must be read with the pre-registration, not as a universal savings claim.
