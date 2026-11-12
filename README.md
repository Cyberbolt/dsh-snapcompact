<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact frame icon"></p>

# dsh-snapcompact

**English** · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**A DeepSeek Harness context compaction plugin: renders a DSH session's history as images the model reads directly, rather than a summary.**

The middle of a long context is rendered as images the model reads directly, while the start and the end stay ordinary text — so a command, path or checksum from many turns ago is still there to copy. Each checkpoint carries a copyable index of exact strings and a `FILES` file map; the render happens locally, so nothing is summarized and no extra API key is needed.

Built for long-running sessions that keep needing details from many turns ago — typically coding or debugging sessions. Not for short chats, text-only models, or `minimal` mode.

**Quick start:** Plugins → Add plugin → `dsh-snapcompact` → new session → **Snapcompact (Standard)**.

## Install

Requires DSH `0.2.x` and Node.js 24+.

1. Open **Plugins → Add plugin**.
2. Install `dsh-snapcompact@0.7.0`.
3. Restart if prompted, then create a new session and choose a variant.

| Official mode | Choose                     | What it is                                                            |
| ------------- | -------------------------- | --------------------------------------------------------------------- |
| `standard`    | **Snapcompact (Standard)** | Shell, files, search, subagents, workflows, web, plan mode            |
| `ptc`         | **Snapcompact (PTC)**      | `run_code` as the only direct tool; everything else through `tools.*` |
| `cordis`      | **Snapcompact (Cordis)**   | `tool-cordis` and the official Cordis authoring skills                |

Installation only adds opt-in presets: official presets and running sessions are untouched, and choosing a variant is the enable action. `minimal` is not supported — it deliberately omits read/write/edit, so frames would defeat its purpose.

To uninstall, remove the plugin from the Plugins page. Its presets disappear; checkpoints already committed stay in their sessions as ordinary summary messages. Upgrading from 0.6.x? 0.7.0 changed how exact strings are kept — read the [migration note](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/migration-0.7.md).

From the CLI:

```sh
dsh plugin --profile web add dsh-snapcompact
```

Use your profile name. On DSH Desktop, prefer the in-app Plugins page: the CLI may write to a profile the desktop app does not use.

<details>
<summary>Other install sources</summary>

A locally packed tarball and a tarball URL work too:

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.7.0.tgz"
```

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-<version>.tgz
```

The npm package is the prebuilt option; a local checkout needs `pnpm pack` (or `pnpm run build`) first.

</details>

## Why images instead of a summary?

The idea of replacing a summary with images comes from the [Oh My Pi](https://github.com/can1357/oh-my-pi) `snapcompact` project; this plugin is an independent DSH implementation of it.

A vision model is billed largely by image area, not by how many characters the image contains. Up to the legibility limit, a dense frame carries more text per token than the same text sent verbatim, so the part of the history you no longer need character for character becomes a few readable images instead of a lossy summary.

|                 | Raw history | Native summary | Snapcompact                         |
| --------------- | ----------- | -------------- | ----------------------------------- |
| What survives   | Everything  | A summary      | Exact head/tail, frames, text index |
| Compaction cost | 0           | One model call | 0 (local render)                    |
| Exact strings   | Yes         | May be lost    | Verbatim in head/tail, indexed      |

A terse summary can still be smaller per turn on short sessions; [Limits](#limits) explains when the trade-off reverses.

## How it works

```text
DSH selects a safe region
        │
        ▼
deterministic serialization (head/tail caps, log elision, exact-token marking)
        │
        ▼
snapcompact → shake → soft
        │
        ▼
one checkpoint: exact head/tail + frames + text index
```

| Order | Method        | Model call     | Output                                                          |
| ----- | ------------- | -------------- | --------------------------------------------------------------- |
| 1     | `snapcompact` | none           | Dense frames, exact head/tail, `FILES` index, exact-token index |
| 2     | `shake`       | none           | Large tool outputs replaced by bounded excerpts                 |
| 3     | `soft`        | native summary | DSH's native text summary                                       |

The `snapcompact` method (order 1) runs only when both hold: the route (this session's provider/model, e.g. `opencode-go/deepseek-v4.1-flash`) declares image input and pricing — or a labelled estimate — and the checkpoint fits the room left under the trigger. Otherwise the chain falls through to text. Cancellation stops the compaction and never silently selects the next method. Region selection, transaction locks, recovery and capacity checks stay in the host.

## Use it

| Entry point           | What it does                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `/compact`            | Manual compaction; inside a Snapcompact preset it runs the chain                                   |
| `/snapcompact status` | Current route (provider/model), effective threshold, compactable space and per-method availability |

## Configure

The **Plugins → Snapcompact** card covers the common keys and writes through DSH's settings service to the profile's config patch. One card configures all three variants, and saved values apply to new sessions. The defaults are the chain `[snapcompact, shake, soft]`, a trigger at 0.8 of the window and at most 40 frames; every other field is YAML-only — see the [configuration reference](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md).

## Limits

- **Not lossless, in two places.** The first is rendering: characters the bitmap font does not cover (emoji, rare scripts, combining marks) become `?`, tabs expand to spaces, inner space runs collapse and ANSI escapes are stripped; and the model reads pixels, not text, so a 64-character digest is not something to expect back from a picture. The second is serialization, before rendering: routine `INFO`/`PASS` lines, stack-call lines, long runs of repeated file listings and metric lines are deterministically elided, long fields keep only their head and tail with the middle removed, and an over-budget projection keeps both ends of the middle and drops the oldest dense center — every omission leaves a marker shaped like `[… elided …]`. Errors, labeled facts, commands and paths are not elided; for character-exact history rely on the exact head/tail text, which is never rendered, and strings like digests go into the text index.
- **Savings depend on the model in use and the horizon you need.** A terse summary can be smaller per turn on short sessions; expensive image tokens or a short horizon can erase the gain. Measurements are in [Evaluation results](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation-results.md).
- **No search across compactions.** The head/tail text and the text index are the whole guarantee; a unique string clipped from both is not recoverable later.

## Troubleshooting

<details>
<summary>The Snapcompact presets are not in the picker</summary>

Confirm the plugin is installed, restart DSH if the page asks, then create a **new** session and look for **Snapcompact (Standard)**, **Snapcompact (PTC)** and **Snapcompact (Cordis)**. Existing sessions keep the preset they started with. On DSH Desktop, install through the app's Plugins page, not a CLI profile the app does not use.

</details>

<details>
<summary>It always falls back to text</summary>

Run `/snapcompact status`. The current route (provider/model) probably declares no image input or no usable image pricing, which is the intended safe behavior. Up to four carried images are forwarded; when no image slot is left, the text chain (shake excerpts, then the native summary) runs.

</details>

<details>
<summary>Compaction fails with "No compaction method produced a safe smaller checkpoint"</summary>

Every candidate was skipped or missed its budget. Check `/snapcompact status`; retry with more history, or switch to a model whose text summarizer works. The error lists each method's reason, and cancellation is reported separately.

</details>

## Documentation

- [Configuration and route pricing](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md)
- [Architecture and reading guide](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/architecture.md)
- [Evaluation and interpretation](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation.md)
- [Evaluation results](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation-results.md)
- [Contributing](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/contributing.md)
- [0.7.0 migration](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/migration-0.7.md)
- [Third-party notices](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.md)
- [Issues and feedback](https://github.com/Cyberbolt/dsh-snapcompact/issues)
- [中文文档](https://github.com/Cyberbolt/dsh-snapcompact/tree/main/docs/zh)

## Development

```sh
pnpm install --ignore-scripts
pnpm run check
pnpm pack
```

Setup details, the install check and the evaluation harness live in the [contributing guide](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/contributing.md).

## License

Original application code is [MIT](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE). Bundled GNU Unifont 18.0.01 data retains the SIL Open Font License 1.1; the Oh My Pi snapcompact design reference is MIT. See [third-party notices](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.md).
