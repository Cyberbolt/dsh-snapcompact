<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact frame icon"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**Compact a long DSH session by rendering it, not summarizing it.**

When a session gets long, Snapcompact stops sending the middle of it verbatim and renders that part into dense PNG frames a vision model reads directly. The exact text at both ends stays verbatim, and a small text index beside the frames carries the checksums, paths and commands that pixels cannot be trusted to reproduce. The visual path calls no summarizer, needs no extra API key and makes no network request.

It is an independent DSH implementation of the [Oh My Pi](https://github.com/can1357/oh-my-pi) `snapcompact` idea.

Built for long coding or debugging sessions where you still need a command, path, checksum or identifier from many turns ago. Not for short chats, text-only models, or `minimal` mode.

**Quick start:** Plugins → Add plugin → `dsh-snapcompact` → new session → **Snapcompact (Standard)**.

## Why render?

A vision model is billed largely by image area, not by how many characters the image contains. Up to the legibility limit, a dense frame carries more text per token than the same text sent verbatim, so the part of the history you no longer need character for character becomes a few readable images instead of a lossy summary.

|                 | Raw history | Native summary | Snapcompact                         |
| --------------- | ----------- | -------------- | ----------------------------------- |
| What survives   | Everything  | A summary      | Exact head/tail, frames, text index |
| Compaction cost | 0           | One model call | 0 (local render)                    |
| Exact strings   | Yes         | May be lost    | Verbatim in head/tail, indexed      |

A terse summary can still be smaller per turn on short sessions; [Limits](#limits) explains when the trade-off reverses.

## What you get

- **Exact strings come back as text.** The first and last part of the history stay verbatim, and a bounded index lists checksums, paths, commands, identifiers and labeled facts as plain text you can copy.
- **Your history becomes one message.** Compaction replaces the middle with a single checkpoint — an ordinary summary message in the session. Nothing else changes, and nothing is deleted from disk.
- **No summarizer call on the visual path.** Rendering is local: no generation cost, no network round trip, no extra API key.
- **A file map that survives.** A bounded `FILES` index built from read/write/edit calls, marked `(Read)` / `(Write)` / `(RW)`. It is navigation, not a disk snapshot.
- **A safe fallback.** `snapcompact → shake → soft`, with the native summary last.

## Install

Requires DSH `^0.2.2-rc.1` (verified on `0.2.2-rc.1`) and Node.js 24+. The npm package ships compiled `dist/`, so there is no build step and no install script.

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

The visual method runs only when both hold: the route (the provider/model this session runs on, e.g. `opencode-go/deepseek-v4.1-flash`) declares image input and pricing — or a labelled estimate — and the checkpoint fits the room left under the trigger. Otherwise the chain falls through to text. Cancellation stops the compaction and never silently selects the next method. Region selection, transaction locks, recovery and capacity checks stay in the host.

## Use it

| Entry point           | What it does                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `/compact`            | Manual compaction; inside a Snapcompact preset it runs the chain                                   |
| `/snapcompact status` | Current route (provider/model), effective threshold, compactable space and per-method availability |

## Configure

The **Plugins → Snapcompact** card covers the common keys and writes through DSH's settings service to the profile's config patch. One card configures all three variants, and saved values apply to new sessions. The defaults are the chain `[snapcompact, shake, soft]`, a trigger at 0.8 of the window and at most 40 frames; every other field is YAML-only — see the [configuration reference](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md).

## Limits

- **Not lossless.** Frames can drop characters; routine `INFO`/`PASS`/stack-frame/file-listing lines are elided and long fields are clipped head-and-tail. Errors, labeled facts, commands, paths and digests are kept.
- **Savings depend on the model in use and the horizon you need.** A terse summary can be smaller per turn on short sessions; expensive image tokens or a short horizon can erase the gain. Measurements are in [Evaluation results](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation-results.md).
- **No search across compactions.** The head/tail text and the text index are the whole guarantee; a unique string clipped from both is not recoverable later.
- **No telemetry.** Conversation data stays in the profile's attachment storage; nothing is uploaded elsewhere.

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
