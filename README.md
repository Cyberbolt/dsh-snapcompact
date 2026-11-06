# dsh-snapcompact

English · [简体中文](README.zh.md)

Recoverable conversation compaction for DeepSeek Harness. The opt-in **Snapcompact** preset provides `snapcompact → handoff → shake → soft`, native automatic/manual compaction, exact-history recall and an explicit synthetic benchmark.

**Not an unconditional token-saving promise.** Visual compression depends on actual image pricing and reading accuracy. Every visual checkpoint retains an independent text handoff and an exact archive reference. Unknown vision capabilities or pricing fall back to text.

## Requirements and development

Node.js 24+, pnpm 11.28.5, DSH **0.2.2-rc.1**. Compatibility with other DSH versions is not claimed.

```sh
pnpm install --ignore-scripts
pnpm run check
pnpm pack
```

DSH packages are host-provided peers; development installs provide local types and integration-test modules. No install scripts are required by this package.

Source is organized by compaction, archives, rendering, budgeting, DSH integration and evaluation, with strict TypeScript checking. Start with the [architecture and reading guide](docs/architecture.md). Comments and primary documentation are English; Chinese documentation is maintained alongside them.

## Installation and commands

Build first, then install the directory through DSH's Plugin Manager. Do not edit the active profile's package manifest or patch manually. Select **Snapcompact** for a **new session**; existing presets, the default selection and running sessions are not replaced.

- `/compact` or `/snapcompact run`: compact an idle session.
- `/snapcompact status`: explain route support, method order and archive availability.
- `/snapcompact benchmark`: explicitly authorize up to four auxiliary model requests using the bundled synthetic fixture, not private history. This consumes model usage and can incur fees.
- `snapcompact_recall`: list, read or literally search exact archived content. IDs must be referenced by a completed compaction in the owning session, including inherited history; arbitrary paths and session IDs are not accepted.

Recall returns physical line numbers and `(nextOffset, nextColumn)` cursors; forward both to continue a very long line. Text pages are capped at 200 line fragments and 20,000 UTF-16 code units.

## Methods and safety

- **snapcompact:** bitmap PNG frames, independent text handoff and exact archive reference.
- **handoff:** structured task state, constraints, commands, unfinished work and next action.
- **shake:** archive large tool outputs before replacing them with bounded excerpts and recall references; no model call.
- **soft:** native text summarization as the final fallback.

The plugin extends `BasicCompactionEngine.summarize()`, not its region transaction. Native selection, tool pairing, locks, recovery and model-switch capacity checks remain in the host. It adds no custom Session event type.

Rendering uses an original TypeScript grid implementation and unmodified GNU Unifont 18.0.01. No Bun or third-party native renderer is loaded. Unsupported glyphs, scripts requiring shaping, excessive pages, resizing, storage failure, uncertain pricing or insufficient reduction fall back to text, not blank/truncated images. Cancellation never selects the next method.

Pictures and generated summaries are **not lossless**. The archive preserves the selected message content, but cannot recover content another plugin already deleted. Existing images/visual checkpoints select a text handoff rather than rendering an attachment descriptor as the original image. Parent archive references survive repeated compactions.

## Documentation and license

- [Configuration and route pricing](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Evaluation and interpretation](docs/evaluation.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Original application code is [MIT](LICENSE); bundled font data retains OFL 1.1.
