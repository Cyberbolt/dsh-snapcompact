# Evaluation audit: v4 and the recall-era benchmark

[简体中文](zh/evaluation-audit.md)

Status: **Phase A1 audit**, written before any v5 implementation or tuning. This document is deliberately independent of the new benchmark's results: it judges the instrument that produced the 0.6.x numbers, not the product direction.

## What was measured

The v4 harness has two model-backed suites.

- **Accuracy pressure test**: one request carries all 40 questions of the fixed `engineering-recall-v3` fixture. The fixture has 7 head facts, 13 tail facts, 20 middle facts, 40 unscored decoys, and synthetic filler lines. Four arms run: `original`, `native-text`, `snapcompact`, and `snapcompact-recall`.
- **Long-session cost suite**: one persistent history of 5,000 synthetic lines (about 337,000 characters), six turns with schedule `plain, plain, light, plain, heavy, plain`, and eight scored questions. The same four arms run.

The published v4 numbers are in [evaluation-results.md](evaluation-results.md). The key ones are: recall 39.7/40 over three runs, pure visual 28–31/40, long-session recall 8/8 at 0.78× weighted cost, and long-session pure visual 4/8 at 0.70×.

## Findings

### 1. One request with forty questions is not a multi-turn session

The accuracy suite concatenates all forty questions into one user message. A model that answers all of them emits 13,000–17,000 output tokens in the visual arms; the recall arm emits 1,500–1,900 because it can stop after tool results. That is a reading-pressure test, and the harness says so. It is not steady-state use: a real session asks a few questions per turn, re-sends the checkpoint on every turn, and accumulates the previous answers.

The session suite does have turns, but only six, only eight scored questions, and its `plain` turns ask one head/tail fact. It therefore does not measure the interaction that matters for pure visual use: a long checkpoint, several turns, four or more questions per turn, and no tool available to repair a misread frame.

**Verdict: replace as the primary accuracy instrument. Retain the pressure test only as a diagnostic if it is cheap to keep.**

### 2. Synthetic padding and fixed line numbers are easy to overfit

Every padding line has the same shape: `Observation <n>: routine build log entry; no user-visible change.` Middle probes are placed at fixed fractions or fixed physical lines. The questions and the recall arm both use the literal label `Observation <n>:` as the search key. The renderer, the serializer, and the recall query generator can all be tuned against that regularity without learning anything about real history.

There is no held-out split. The fixture is committed, every run uses it, and the same fixture decides both iteration and acceptance. The decoys are unscored and never asked, so they test choice only weakly; a model can ignore them without penalty.

**Verdict: replace. A generated task-level corpus with separate dev and test seeds is required. The test material must not be committed and must not be inspected before the freeze.**

### 3. Exact-string scoring over-represents recall and under-represents understanding

All forty questions have a short canonical answer and an exact accepted-match rule. The `kind` labels include `constraint`, `negation`, `next-action`, and `ordered-step`, but the scoring still compares one string. A correct paraphrase, a correct causal explanation, or a correct "do not use X because Y" answer scores zero unless it reproduces the fixture's exact token.

The region label (`head`, `middle`, `tail`) is derived from where the source string sits in the serialized projection. It is a _rendering_ region, not a semantic region. Calling a fact "middle" says nothing about whether it is temporal, causal, negated, or cross-referential.

**Verdict: replace the scoring with a pre-registered mixed rubric. Keep exact-string questions at a substantial share (at least 40%) because they are the hardest and most product-relevant class. Add deterministic token/constraint rubrics for semantic, temporal, causal, and negation questions. Do not let a model judge its own answer.**

### 4. The missing controls are the ones that would falsify the claim

v4 has no **gold-text ceiling** arm. Without it, a low visual score cannot be attributed to rendering versus comprehension. v4 has no **degraded-renderer negative control**. Without it, a high visual score could come from the language model's prior or from the text outside the frames rather than from the frames. v4 has no multi-turn no-tool control beyond the single visual arm, and no arm that isolates the cost of the checkpoint from the cost of the question.

The recall arm is a useful _offline reference_, but it is not a control for visual usability: it changes the task by giving the model a search tool and an archive. It also creates a production dependency that the objective is trying to remove.

**Verdict: add gold-text, degraded-renderer, and a multi-turn no-tool visual arm. Keep recall only as an offline reference arm during Phase A/B; never register it in production.**

### 5. One route, few runs, and no interval

The published results come from one route, `opencode-go/deepseek-v4.1-flash`, with two or three accuracy runs and one session run. The accuracy table reports mean/min/max, but the session table is a single run and no confidence interval is reported. The image price is a hard-coded 1,343 tokens per frame in the live adapter, and the route's real image tokenization is not verified. A different provider, a different image downscale policy, or a different model line can invert a one- or two-question difference.

**Verdict: retain the usage audit and the weighted-cost formula; replace the single-run headline with a pre-registered multi-run report that includes variance and an interval. Treat route-specific conclusions as route-specific.**

## What the audit does not invalidate

- The usage audit is sound and should be kept. It reconciles every measured request against the provider total and fails a run with unreported prompt tokens.
- The persistent-history session mechanism is the right shape for a cost measurement. It should be extended, not discarded.
- The architecture (exact head/tail text plus bitmap middle, deterministic local rendering, no summary call) is not indicted by the benchmark defects.
- The v4 results remain valid **as measurements of the v4 instrument**. They are retained as historical regression data, not deleted.

## Retain, replace, retire

| Part                                              | Decision                                                           | Reason                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Deterministic fixture generation from a seed      | **Retain**                                                         | Reproducibility; extend to a task-level generator.                          |
| Usage audit and weighted cost                     | **Retain**                                                         | The strongest part of v4; catches invisible cache accounting.               |
| Persistent multi-turn history                     | **Retain and extend**                                              | The right shape for cost; v4 under-samples turns and questions.             |
| Exact head/tail text plus bitmap middle           | **Retain**                                                         | Product architecture; the audit does not test it directly.                  |
| Single-request 40-question accuracy suite         | **Replace**                                                        | Not multi-turn; forces long answers; distorts cost.                         |
| Fixed-line synthetic facts                        | **Replace**                                                        | Overfittable; no held-out; decoys too weak.                                 |
| Exact-string-only scoring                         | **Replace**                                                        | Rewards archive lookup and penalizes understanding.                         |
| Rendering region as the only region label         | **Retain as a rendering diagnostic; replace as the semantic axis** | Add task/character-class tags.                                              |
| No gold-text arm                                  | **Add**                                                            | Separates comprehension from rendering.                                     |
| No degraded-renderer arm                          | **Add**                                                            | Negative control for frame reading.                                         |
| No held-out test split                            | **Add**                                                            | Prevents tuning on the acceptance set.                                      |
| `snapcompact-recall` production arm               | **Retire from production**                                         | The objective removes the recall tool; keep offline only until Phase B4.    |
| Archive coverage metric                           | **Retire with recall**                                             | It measures the archive, not the model.                                     |
| v4 accuracy fixture `engineering-recall-v3`       | **Retire as a gate; retain results**                               | Overfittable and single-request.                                            |
| v4 session fixture `engineering-long-5000`        | **Retain as a historical cost regression**                         | Useful scale reference; not the primary gate.                               |
| "Recall is exact" as the product conclusion       | **Retract**                                                        | It is a statement about the recall arm, not about pure visual use.          |
| "Pure visual is 28–31/40" as the capability limit | **Retract**                                                        | It is a coverage/budget artifact of the v4 fixture as much as an OCR limit. |

## Consequences for the Phase A gate

The old 39.5/40 target cannot be carried over unchanged, because the instrument that produced it is being replaced. The replacement must be at least as demanding in the dimensions that matter:

- at least 40 questions, at least 10 turns, a long history that does not fit a small checkpoint by accident;
- at least 40% exact-string questions (commands, paths, checksums, identifiers), plus cross-region, temporal/causal, negation, and constraint questions;
- a held-out test split generated from a committed seed and never used for tuning;
- gold-text ceiling, degraded-renderer negative control, and pure-visual no-tool arm;
- recall only as an offline non-inferiority reference on the same test set;
- pre-registered thresholds, means, variance/interval, per-region and per-character-class errors, and a fixed multi-turn schedule.

The detailed design and thresholds are frozen in [evaluation-v5-prereg.md](evaluation-v5-prereg.md). If the new benchmark and the old one disagree, both are reported; neither is silently deleted.

## Historical numbers kept for comparison

| Instrument                | Arm         | Result                                        | Status                             |
| ------------------------- | ----------- | --------------------------------------------- | ---------------------------------- |
| v4 accuracy (3 runs, 0.4) | recall      | 39.7/40; head 21/21, middle 60/60, tail 38/39 | Historical; production arm retired |
| v4 accuracy (3 runs, 0.4) | pure visual | 28–31/40                                      | Historical; not a capability limit |
| v4 accuracy (3 runs, 0.4) | original    | 39–40/40 (one failed run)                     | Historical                         |
| v4 session (1 run)        | recall      | 8/8, 0.78× weighted, peak 0.28×               | Historical                         |
| v4 session (1 run)        | pure visual | 4/8, 0.70× weighted, peak 0.28×               | Historical; coverage-limited       |

These numbers are not comparable to v5 because the task, the turn schedule, the scoring rubric, and the history differ. The v5 report must print both instruments' results side by side and must not claim a v5 improvement over a v4 number as if it were the same measurement.
