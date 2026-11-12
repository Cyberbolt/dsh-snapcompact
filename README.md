<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact frame icon"></p>

# dsh-snapcompact

**English** · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**A DeepSeek Harness context compaction plugin: renders DSH session history as images instead of text summaries, keeping more information while using fewer tokens.**

Concretely: when DSH triggers context compaction, the start and the end of the context stay as ordinary text while the middle is rendered as images (locally, with no model call), and each checkpoint carries a copyable index of exact strings and a `FILES` file map.

The plugin suits long-running sessions that keep coming back to earlier details. It is not meant for compacting short chats.

**Quick start:** Plugins → Add plugin → `dsh-snapcompact` → new session → **Snapcompact (Standard)**.

## Install

Requires DSH `0.2.x` and Node.js 24+.

1. Open **Plugins → Add plugin**.
2. Install `dsh-snapcompact`.
3. Restart if prompted, then create a new session and choose the Snapcompact preset for your official mode.

| Official mode | Snapcompact preset         |
| ------------- | -------------------------- |
| `standard`    | **Snapcompact (Standard)** |
| `ptc`         | **Snapcompact (PTC)**      |
| `cordis`      | **Snapcompact (Cordis)**   |

`minimal` is not supported — it deliberately omits `read`/`write`/`edit`, so Snapcompact would defeat its purpose.

To uninstall, remove the plugin from the Plugins page. Its presets disappear; checkpoints already committed stay in their sessions as ordinary summary messages.

From the CLI:

```sh
dsh plugin --profile <your profile name> add dsh-snapcompact
```

On DSH Desktop, prefer the in-app Plugins page.

<details>
<summary>Other install sources</summary>

A locally packed tarball:

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.7.1.tgz"
```

A tarball URL:

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-<version>.tgz
```

The npm package is the prebuilt option; for a local checkout, run `pnpm pack` (or `pnpm run build`) first.

</details>

## Why images instead of a summary?

Replacing a summary with images is an idea from `snapcompact` in [Oh My Pi](https://github.com/can1357/oh-my-pi); this plugin is an independent implementation of `snapcompact` for DSH.

A vision model is billed mainly by image area, regardless of how many characters an image holds. Within the legibility limit, a dense frame carries more information per token than plain text. Content that would otherwise be condensed into a text summary is rendered as images instead, so more context survives at a lower token cost.

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

The `snapcompact` method (order 1) runs only when both conditions hold:

- **The model accepts images and can be priced.** This session's route (provider/model, e.g. `opencode-go/deepseek-v4.1-flash`) must declare image input, and its image pricing must be determinable: the adapter supplies prices, an explicit per-frame cap is configured, or a labelled conservative estimate covers a known model family.
- **The whole checkpoint fits.** The entire checkpoint must fit in the room left under the trigger threshold (the threshold minus the parts that cannot be replaced: system prompt, tool schemas, output reservation and retained tail).

If either condition fails, snapcompact is skipped, the chain moves on to the next method, and it ends at the native summary.

## Commands

| Entry point           | What it does                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/compact`            | Manual compaction; needs to run inside a Snapcompact preset                                                                         |
| `/snapcompact status` | Current route (provider/model), trigger threshold, retained tail and compactable space, plus whether each compaction method can run |

## Configure

Manage the common keys on the **Plugins → Snapcompact** settings card. Saved values apply only to new sessions; existing sessions keep running with the configuration they were created with. The defaults are the chain `[snapcompact, shake, soft]`, a trigger at 80% of the context window and at most 40 frames per compaction; every other key is YAML-only — see the [configuration reference](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md).

## Limits

- **Not lossless: information can be lost before and during rendering.**
  - **While rendering to an image:** characters the bitmap font does not cover (emoji, rare scripts, combining marks) show up as `?`; tabs expand to spaces, runs of spaces collapse and ANSI escapes are stripped. The model reads pixels, not text, so a 64-character digest is not something to expect back from a picture.
  - **Before rendering:** serialization elides by fixed rules, so the same history loses the same spots, in the same numbers, every time.
    - Boilerplate lines such as routine `INFO`/`PASS` lines and stack-call lines are dropped whole.
    - Long runs of structurally identical lines (repeated file listings, metric lines) keep only the first two and the last two lines.
    - Over-long fields keep their head and tail with the middle removed; when the frame's middle text budget runs short, both ends are kept and the middle is dropped.
    - Every omission leaves a counted marker, e.g. `[…80ch elided…]` or `[…3 routine log lines elided…]`.
  - **What is never elided:** errors, labeled facts, commands and paths are kept verbatim.
  - **For character-exact content, take it from the text, not the image:** the exact head/tail text is kept verbatim, and strings that read unreliably from a picture, such as digests, go into the text index.

- **Whether it saves tokens depends on the context length and the model in use.** On short sessions a native summary may use fewer tokens, and expensive image tokens can also cancel the gain. Measurements are in [Evaluation results](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation-results.md).
- **No lookup after compaction.** The only character-exact copies are the head/tail text and the text index; a string that made it into neither is not recoverable later.

## Troubleshooting

<details>
<summary>The Snapcompact presets are not in the picker</summary>

Confirm the plugin is installed, restart DSH if the page asks, then create a **new** session and look for **Snapcompact (Standard)**, **Snapcompact (PTC)** and **Snapcompact (Cordis)**.

</details>

<details>
<summary>It always falls back to text</summary>

Run `/snapcompact status`. The current route (provider/model) probably declares no image input or no usable image pricing, which is the intended safe behavior.

</details>

<details>
<summary>Compaction fails with "No compaction method produced a safe smaller checkpoint"</summary>

This means every method (snapcompact, shake, soft) was skipped — it either could not shrink the checkpoint enough or went over budget. Run `/snapcompact status` first to see the current route, the compactable space and each method's availability; then retry once the session has more history, or move to a model that works. The error text lists, one by one, why each method was skipped or failed.

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
