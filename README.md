<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact archive frame icon"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**Compact a long DSH session by rendering it, not summarizing it.**

When a session gets long, Snapcompact turns the middle of the transcript into dense PNG frames a vision model reads directly. The visual path makes no summarizer call; exact head and tail text stay in place, and a searchable archive keeps commands, paths and identifiers recoverable.

Use it for long coding or debugging sessions where you still need the exact command from forty turns ago. It is not for short chats, text-only routes, or minimal mode.

**Install:** Plugins → Add plugin → `dsh-snapcompact@0.6.2` → new session → **Snapcompact (Standard)**. No build step.

## Why render?

A vision model is billed largely by image area, not by how many characters the image contains. Up to the legibility limit, a dense frame can carry more text per token than the same text sent verbatim. That is the mechanism: the discarded middle becomes a few readable images instead of a lossy summary.

|                  | Raw history | Native summary   | Snapcompact (visual path)                             |
| ---------------- | ----------- | ---------------- | ----------------------------------------------------- |
| What survives    | Everything  | A summary        | Exact head/tail + archived middle                     |
| Compaction cost  | 0           | One model call   | 0 (local render)                                      |
| Per-turn context | Largest     | Usually smallest | Smaller than raw; usually larger than a terse summary |
| Exact strings    | Yes         | May be lost      | Recoverable from the archive                          |

**When it wins:** long histories, routes with cheap image tokens, and work where you need the exact strings back after compaction. **When it doesn't:** short sessions, text-only routes, or when a terse summary is enough.

## What you get

- **No summarizer call on the visual path.** Rendering is local: no generation cost, no network call, no extra API key.
- **Exact recall after compaction.** Head/tail text plus a searchable archive; `snapcompact_recall` reads it line by line.
- **A file map that survives compaction.** A bounded `FILES` index from read/write/edit calls, with `(Read)`/`(Write)`/`(RW)` markers.
- **A safe fallback.** `snapcompact → shake → soft`; the native summary is last.
- **Native DSH behavior.** Region selection, transaction locks, recovery and capacity checks stay in the host.

## Install

Requires DSH `^0.2.2-rc.1` (verified on `0.2.2-rc.1`) and Node.js 24+. The npm package ships compiled `dist/`; there is no build step and no install script. A 0.2.x patch installs without a new plugin release; the next minor is declared only after revalidation.

1. Open **Plugins → Add plugin**.
2. Install `dsh-snapcompact@0.6.2`.
3. Restart if prompted, then create a new session and choose a variant.

| Official mode | Choose                     | What you keep                                                         |
| ------------- | -------------------------- | --------------------------------------------------------------------- |
| `standard`    | **Snapcompact (Standard)** | Shell, files, search, subagents, workflows, web, plan mode            |
| `ptc`         | **Snapcompact (PTC)**      | `run_code` as the only direct tool; everything else through `tools.*` |
| `cordis`      | **Snapcompact (Cordis)**   | `tool-cordis` and the official Cordis authoring skills                |

Installation adds opt-in presets. It does not change official presets or running sessions; choosing a variant is the enable action, and existing sessions keep the preset they started with. `minimal` is not supported: it deliberately omits read/write/edit, so frames and archive recall would defeat its purpose.

From the CLI:

```sh
dsh plugin --profile web add dsh-snapcompact@0.6.2
```

Use your profile name. On DSH Desktop, prefer the in-app Plugins page: the CLI may write to a profile the desktop app does not use.

<details>
<summary>Other install sources</summary>

A locally packed tarball and a tarball URL work too:

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.6.0.tgz"
```

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-0.6.0.tgz
```

The npm package is the prebuilt option; a local checkout needs `pnpm pack` (or `pnpm run build`) first.

</details>

## How it works

```text
DSH selects a safe region
        │
        ▼
exact archive (sha256) ── survives the checkpoint
        │
        ▼
snapcompact → shake → soft
        │
        ▼
one checkpoint committed by DSH
```

| Order | Method        | Model call     | Output                                                          |
| ----- | ------------- | -------------- | --------------------------------------------------------------- |
| 1     | `snapcompact` | none           | Dense frames, exact head/tail, `FILES` index, archive reference |
| 2     | `shake`       | none           | Large tool outputs archived, replaced by bounded excerpts       |
| 3     | `soft`        | native summary | DSH's native text summary                                       |

The visual method runs only when the route declares image input and pricing (or a labelled estimate) and the checkpoint fits the room left under the trigger. Otherwise the chain falls through to text. Cancellation stops the compaction; it never silently selects the next method.

A checkpoint looks like this (abridged):

```text
Snapcompact v2; method=snapcompact
Exact archived history: sha256:…
Visual checkpoint: N frames; ¶ marks a source newline; use snapcompact_recall for exact strings.
FILES (from read/write/edit; not a disk snapshot)
(Read) read-only; (Write) written without a read; (RW) read and written
# src/compaction/
visual-source.ts (Read)
## methods/
snapcompact.ts (RW)
[exact text head]
[frame 1 of N] … [frame N of N]
[exact text tail]
[file] snapcompact archive reference
```

## Use it

| Entry point                    | What it does                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `/compact`                     | Manual compaction; inside a Snapcompact preset it runs the chain                      |
| `/snapcompact status`          | Route, effective threshold, compactable space, per-method availability, archive count |
| `/snapcompact benchmark [1-5]` | Synthetic v3 comparison; up to eight auxiliary calls per run, may incur fees          |
| `snapcompact_recall`           | List, page or literally search an archive                                             |

```json
{ "action": "list" }
{ "action": "read", "archiveId": "sha256:…", "offset": 0, "limit": 100 }
{ "action": "search", "archiveId": "sha256:…", "query": "pnpm deploy --filter" }
```

Recall returns physical line numbers and `(nextOffset, nextColumn)` cursors. Text pages are capped at 200 line fragments and 20,000 UTF-16 code units. Search is a case-sensitive literal substring match, not a regular expression. Archive IDs must be referenced by a completed compaction in the owning session.

## Configure

The **Plugins → Snapcompact** card covers the common keys and writes through DSH's settings service to the profile's config patch. One card configures all three variants; saved values apply to new sessions.

| Control           | Key                                                                        | Default                      |
| ----------------- | -------------------------------------------------------------------------- | ---------------------------- |
| Method chain      | `methodOrder`                                                              | `[snapcompact, shake, soft]` |
| Trigger threshold | `policy.thresholdRatio`                                                    | host default 0.8             |
| Retained tail     | derived `thresholdRatio ÷ 5`; YAML `retainRatio` / `retainTokens` override | 0.16 at 0.8                  |
| Frame size        | `rendering.width` / `rendering.height`                                     | 1568                         |
| Maximum frames    | `rendering.maxFrames`                                                      | 20 (max 64)                  |
| Archive limit     | `archiveMaxBytes`                                                          | 64 MiB                       |
| Externalize above | `shakeThresholdChars`                                                      | 8192                         |

`guard`, `serialization`, `routePolicies` and render limits are YAML-only. See the [configuration reference](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md) for every field.

## Limits and privacy

- **Not lossless.** Frames can drop characters; invisible trailing spaces are trimmed and each source newline becomes `¶`. The archive, not the frame, is the source of truth, and it cannot recover content another plugin already deleted. Up to four existing images are carried forward.
- **Savings depend on the route and horizon.** A terse summary can be smaller per turn on short sessions; the visual path can win on long histories or cheap image tokens. A smaller checkpoint is not automatically a smaller bill.
- **Visual eligibility is narrow.** The route must declare image input and pricing; unreadable frames or a tight budget fall back to text. On a route without image pricing, DSH's own context meter can lag until provider usage anchors the next request; the plugin uses its own conservative frame price for the visual gate.
- **`FILES` is an index, not a disk snapshot.** It sees read/write/edit calls, not `bash` or apply-patch.
- **No telemetry.** Archives live in the profile's attachment storage; conversation data is not uploaded elsewhere.

## Troubleshooting

<details>
<summary>The Snapcompact presets are not in the picker</summary>

Confirm the plugin is installed, restart DSH if the page asks, then create a **new** session and look for **Snapcompact (Standard)**, **Snapcompact (PTC)** and **Snapcompact (Cordis)**. Existing sessions keep the preset they started with. On DSH Desktop, install through the app's Plugins page, not a CLI profile the desktop app does not use.

</details>

<details>
<summary>It always falls back to text</summary>

Run `/snapcompact status`. The route probably has no declared image input or no usable image price; that is the intended safe behavior. Existing images are carried forward, up to four; if no image slot is left, the text chain (shake excerpts, then the native summary) is used.

</details>

<details>
<summary>Compaction fails with "No compaction method produced a safe smaller checkpoint"</summary>

Every candidate was skipped or missed its budget. Check `/snapcompact status`; retry with more history, or use a route with a working text summarizer. The error lists each method's reason, and cancellation is reported separately.

</details>

<details>
<summary>It refuses to start with "leaves only … of the window compactable"</summary>

Usually this means YAML sets an explicit `retainRatio` or `retainTokens` that leaves too little room. Raise `policy.thresholdRatio`, lower or remove the explicit tail, or set `guard.minCompactableRatio: 0`.

</details>

<details>
<summary>Compaction fails with "below the …-token floor"</summary>

The source history is smaller than `max(1024, window × guard.minSourceRatio)`. Wait for more history, or lower `guard.minSourceRatio` (`0` disables the check). The guard runs before the archive and before any method, so nothing was spent.

</details>

<details>
<summary>The install is rejected as incompatible</summary>

This release declares DSH `^0.2.2-rc.1` and is verified on `0.2.2-rc.1`. Install a release that matches your host's minor line; do not hand-edit the check.

</details>

## Documentation

- [Configuration and route pricing](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md)
- [Architecture and reading guide](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/architecture.md)
- [Evaluation and interpretation](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation.md)
- [Third-party notices](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.md)
- [Issues and feedback](https://github.com/Cyberbolt/dsh-snapcompact/issues)
- [中文文档](https://github.com/Cyberbolt/dsh-snapcompact/tree/main/docs/zh)

## Development

```sh
pnpm install --ignore-scripts
pnpm run check          # types, lint, formatting, build, preset, tests, package resources
pnpm run check:install  # install the packed tarball into a throwaway DSH profile
pnpm run release:plan   # preview whether the current version would publish
pnpm pack
```

`check:install` never touches your real profiles and keeps its temporary home under `.artifacts/` for debugging with `--keep`. DSH packages are host-provided peers; the development install supplies local types and integration-test modules. The package needs no install scripts.

Source is organized by compaction, archives, rendering, budgeting, DSH integration and evaluation, with strict TypeScript checking. Start with the [architecture and reading guide](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/architecture.md). Comments and primary documentation are English; Chinese documentation is maintained alongside them.

## License

Original application code is [MIT](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE). Bundled GNU Unifont 18.0.01 data retains the SIL Open Font License 1.1; see [third-party notices](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.md).
