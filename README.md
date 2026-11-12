<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact frame icon"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#install)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**Compact a long DSH session by rendering it, not summarizing it.**

When a session gets long, Snapcompact serializes the middle of the transcript, renders it into dense PNG frames a vision model reads directly, and keeps a bounded exact-token text index beside the frames. The visual path makes no summarizer call. Exact head and tail text stay in place. There is no archive and no recall tool: exact strings come from the exact text and the index that are already in the checkpoint.

Use it for long coding or debugging sessions where you still need the command, path, checksum or identifier from many turns ago. It is not for short chats, text-only routes, or minimal mode.

**Install:** Plugins → Add plugin → `dsh-snapcompact@0.7.0` → new session → **Snapcompact (Standard)**. No build step.

> **0.7.0 removes the archive and `snapcompact_recall`.** Exact strings are now preserved in the checkpoint itself (head/tail text and a bounded exact-token index), not searched after compaction. If you depend on searching an old archive, stay on 0.6.x. See the [migration note](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/migration-0.7.md).

## Why render?

A vision model is billed largely by image area, not by how many characters the image contains. Up to the legibility limit, a dense frame can carry more text per token than the same text sent verbatim. Snapcompact turns the discarded middle into a few readable images instead of a lossy summary, then adds a small text index for the strings pixels cannot reliably carry.

|                  | Raw history | Native summary   | Snapcompact (visual path)                             |
| ---------------- | ----------- | ---------------- | ----------------------------------------------------- |
| What survives    | Everything  | A summary        | Exact head/tail + frames + bounded exact-token index  |
| Compaction cost  | 0           | One model call   | 0 (local render)                                      |
| Per-turn context | Largest     | Usually smallest | Smaller than raw; usually larger than a terse summary |
| Exact strings    | Yes         | May be lost      | In head/tail or the index; not searchable             |

**When it wins:** long histories, routes with cheap image tokens, and work where you need the exact strings back after compaction. **When it doesn't:** short sessions, text-only routes, or when a terse summary is enough.

## What you get

- **No summarizer call on the visual path.** Rendering is local: no generation cost, no network call, no extra API key.
- **Exact strings without a tool.** Exact head/tail text plus a bounded exact-token text index for checksums, paths, commands, identifiers and labeled facts.
- **A file map that survives compaction.** A bounded `FILES` index from read/write/edit calls, with `(Read)`/`(Write)`/`(RW)` markers.
- **A safe fallback.** `snapcompact → shake → soft`; the native summary is last.
- **Native DSH behavior.** Region selection, transaction locks, recovery and capacity checks stay in the host.

## Install

Requires DSH `^0.2.2-rc.1` (verified on `0.2.2-rc.1`) and Node.js 24+. The npm package ships compiled `dist/`; there is no build step and no install script.

1. Open **Plugins → Add plugin**.
2. Install `dsh-snapcompact@0.7.0`.
3. Restart if prompted, then create a new session and choose a variant.

| Official mode | Choose                     | What you keep                                                         |
| ------------- | -------------------------- | --------------------------------------------------------------------- |
| `standard`    | **Snapcompact (Standard)** | Shell, files, search, subagents, workflows, web, plan mode            |
| `ptc`         | **Snapcompact (PTC)**      | `run_code` as the only direct tool; everything else through `tools.*` |
| `cordis`      | **Snapcompact (Cordis)**   | `tool-cordis` and the official Cordis authoring skills                |

Installation adds opt-in presets. It does not change official presets or running sessions; choosing a variant is the enable action, and existing sessions keep the preset they started with. `minimal` is not supported: it deliberately omits read/write/edit, so frames would defeat its purpose.

From the CLI:

```sh
dsh plugin --profile web add dsh-snapcompact@0.7.0
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
dsh plugin --profile web add https://example.com/dsh-snapcompact-0.7.0.tgz
```

The npm package is the prebuilt option; a local checkout needs `pnpm pack` (or `pnpm run build`) first.

</details>

## How it works

```text
DSH selects a safe region
        │
        ▼
deterministic serialization
(head/tail caps, routine-log elision, exact-token marking)
        │
        ▼
snapcompact → shake → soft
        │
        ▼
one checkpoint committed by DSH:
exact head/tail + bitmap frames + exact-token index
```

| Order | Method        | Model call     | Output                                                          |
| ----- | ------------- | -------------- | --------------------------------------------------------------- |
| 1     | `snapcompact` | none           | Dense frames, exact head/tail, `FILES` index, exact-token index |
| 2     | `shake`       | none           | Large tool outputs replaced by bounded excerpts                 |
| 3     | `soft`        | native summary | DSH's native text summary                                       |

The visual method runs only when the route declares image input and pricing (or a labelled estimate) and the checkpoint fits the room left under the trigger. Otherwise the chain falls through to text. Cancellation stops the compaction; it never silently selects the next method.

A checkpoint looks like this (abridged):

```text
Visual snapcompact checkpoint: N bitmap frames; ¶ marks a source newline; …
FILES (from read/write/edit; not a disk snapshot)
# src/compaction/
visual-source.ts (Read)
## methods/
snapcompact.ts (RW)
[exact text head]
[frame 1 of N] … [frame N of N]
[exact text tail]
Exact-token index (deterministic; copy values character for character):
* artifact checksum sha256:…
* the migrate command was pnpm run migrate --to=…
Checkpoint rule: for every later question, re-read the relevant frame or the index.
```

## Use it

| Entry point                    | What it does                                                              |
| ------------------------------ | ------------------------------------------------------------------------- |
| `/compact`                     | Manual compaction; inside a Snapcompact preset it runs the chain          |
| `/snapcompact status`          | Route, effective threshold, compactable space and per-method availability |
| `/snapcompact benchmark [1-5]` | Generated task-level dev benchmark; may incur fees                        |

There is no `snapcompact_recall` tool in 0.7.0. Exact strings are read from the checkpoint's exact head/tail text and the exact-token index. A string that was clipped from both is not recoverable.

## Configure

The **Plugins → Snapcompact** card covers the common keys and writes through DSH's settings service to the profile's config patch. One card configures all three variants; saved values apply to new sessions.

| Control           | Key                                                                        | Default                      |
| ----------------- | -------------------------------------------------------------------------- | ---------------------------- |
| Method chain      | `methodOrder`                                                              | `[snapcompact, shake, soft]` |
| Trigger threshold | `policy.thresholdRatio`                                                    | host default 0.8             |
| Retained tail     | derived `thresholdRatio ÷ 5`; YAML `retainRatio` / `retainTokens` override | 0.16 at 0.8                  |
| Frame size        | `rendering.width` / `rendering.height`                                     | 1568                         |
| Maximum frames    | `rendering.maxFrames`                                                      | 40 (max 64; host cap wins)   |
| Line height       | `rendering.lineHeight`                                                     | 20                           |
| Letter spacing    | `rendering.letterSpacing`                                                  | 2                            |
| Externalize above | `shakeThresholdChars`                                                      | 8192                         |

`budget.checkpointShare`, `guard`, `serialization`, `routePolicies` and render limits are YAML-only. `budget.checkpointShare` (0.25–0.5, default 0.4) is the fraction of the trigger room one checkpoint may spend. See the [configuration reference](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md) for every field.

## Limits and privacy

- **No archive and no search after compaction.** This is the 0.7.0 contract. The exact head/tail and the bounded index are the only exact-string guarantees; a unique string clipped from both is lost.
- **Not lossless.** Frames can drop characters; routine `INFO`/`PASS`/stack-frame/file-listing/metric lines are elided, and long fields are clipped head-and-tail. Errors, labeled facts, commands, paths and digests are kept.
- **The exact-token index is bounded.** Up to 80 labeled lines. It is a legibility aid, not a complete transcript.
- **Savings depend on the route and horizon.** A terse summary can be smaller per turn on short sessions. The visual path usually has a much smaller peak prompt, but expensive image tokens or a short horizon can erase the advantage. The v5 benchmark reports per-turn weighted cost; it is not a universal saving claim.
- **Visual eligibility is narrow.** The route must declare image input and pricing; unreadable frames or a tight budget fall back to text. On a route without image pricing, the plugin uses a conservative model-family estimate, clearly labelled.
- **`FILES` is an index, not a disk snapshot.** It sees read/write/edit calls, not `bash` or apply-patch.
- **No telemetry.** Conversation data stays in the profile's attachment storage; nothing is uploaded elsewhere.

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

The source history is smaller than `max(1024, window × guard.minSourceRatio)`. Wait for more history, or lower `guard.minSourceRatio` (`0` disables the check).

</details>

<details>
<summary>The install is rejected as incompatible</summary>

This release declares DSH `^0.2.2-rc.1` and is verified on `0.2.2-rc.1`. Install a release that matches your host's minor line; do not hand-edit the check.

</details>

## Documentation

- [Configuration and route pricing](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md)
- [Architecture and reading guide](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/architecture.md)
- [Evaluation and interpretation](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation.md)
- [Evaluation results](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation-results.md)
- [0.7.0 migration](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/migration-0.7.md)
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

The v5 benchmark is `scripts/benchmark-v5.ts`. Dev fixtures are generated from a committed seed; the test split is generated under `.artifacts/` and is not committed. See [the evaluation guide](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation.md) and [the pre-registration](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation-v5-prereg.md).

## License

Original application code is [MIT](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE). Bundled GNU Unifont 18.0.01 data retains the SIL Open Font License 1.1; the oh-my-pi snapcompact design reference is MIT. See [third-party notices](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.md).
