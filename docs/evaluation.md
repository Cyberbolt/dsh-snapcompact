# Evaluation

[简体中文](zh/evaluation.md)

`/snapcompact benchmark` **explicitly starts model requests**: at most four auxiliary calls for original-text questions, native-summary generation, summary questions and hybrid-image questions. If visuals cannot be generated safely, that arm is skipped, not replaced with a text call labeled as vision.

The bundled synthetic fixture is used by default; private session history is not read or uploaded. Evaluation uses the current route without changing provider configuration, the current task or the conversation surface. Its report is retained in the human-command result.

## Reported metrics

- Exact answer matches for Chinese constraints, paths, commands, numbers, Python indentation, variable spelling, final corrections and next action.
- Provider-reported input/output/cacheRead/cacheWrite usage, preserved separately. Missing fields are not invented.
- Prompt totals follow DSH's contract: input + cacheRead + cacheWrite, not totalTokens, which can also include output.
- Summary generation overhead is reported separately and must be amortized over later turns.
- Request latency, summary/visual preparation latency, generated frame dimensions and bytes, and estimated image-checkpoint cost.

## Interpretation limits

A fixed exact-match fixture is reproducible, not representative of every language or long-running project. A single run does not automatically reconfigure the plugin or prove universal 2× savings. Standalone fixture requests also differ from a full routed conversation's system/tool envelope.

The visual arm reuses the native summary as its text baseline to isolate the extra effect of images; it is not an exact replay of every production handoff/framing byte. Cache reuse, output length and model-specific billing affect comparisons. Smaller estimated checkpoints are not sufficient evidence of monetary savings or preserved task information.

Visual arms can be skipped for missing vision metadata, undeclared pricing, unsupported glyphs or unreadable request resizing. That is a safety fallback, not evidence of successful image comprehension. A response without provider usage is marked unmeasured rather than used for a fabricated token-saving claim.

For real-project evaluation, obtain permission for both the history and destination provider, then prepare redacted fixtures. Never commit private session logs as public benchmark assets.
