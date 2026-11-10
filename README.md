<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact archive frame icon"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#compatibility)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**Snapcompact compacts a long conversation by rendering it, not summarizing it.** DSH selects a safe history region; Snapcompact serializes the discarded middle into dense PNG frames of pixel-font text that a vision model reads directly, and keeps exact head/tail text plus a sha256-addressed archive behind the checkpoint. Rendering is local and deterministic: the visual path makes no summarizer call and needs no API key or network, and `snapcompact_recall` can still recover exact commands, paths and identifiers from the archive. If the route cannot take images, it falls back through the configured text methods and finally to DSH's native summary. It ships as opt-in presets for DSH's **standard**, **PTC** and **Cordis** modes; the official presets and running sessions are unchanged.

**Where it pays off.** Against raw history it spends fewer prompt tokens for the same recall. Against a native summary it keeps far more of the original and costs no generation call, but its checkpoint is larger on every later turn; on a short session a terse summary is cheaper. This is measurable, not a slogan: run `/snapcompact benchmark` on your route instead of assuming a fixed ratio.

## Highlights

| What you need                                                 | What Snapcompact provides                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A smaller context window without throwing the transcript away | Every checkpoint ships with an exact archive of the selected history.                                                                                          |
| Recover exact strings after compaction                        | Exact head/tail text, an archive reference and the `snapcompact_recall` tool.                                                                                  |
| Know which files are in play after compaction                 | A bounded `FILES` index from read/write/edit calls, with directory folding, `(Read)`/`(Write)`/`(RW)` markers and archive recall for exact content.            |
| A safe failure mode                                           | Default chain `snapcompact → handoff → shake → soft`, configurable as a subset/order; a candidate that cannot prove a smaller, readable checkpoint is skipped. |
| Native DSH behavior                                           | Compaction region selection, transaction locks, recovery and capacity checks stay in the host.                                                                 |
| Change the common knobs without hand-editing YAML             | The **Plugins → Snapcompact** settings card edits the chain, threshold, frame budget and limits, and saves through the profile's config patch.                 |
| Evidence instead of a slogan                                  | `/snapcompact benchmark` reports recall, one-time generation cost and per-turn checkpoint size for the text, summary and visual arms.                          |

## How it works

```text
DSH selects a safe history region
        │
        ▼
exact archive (sha256:…)  ──┐
        │                   │  survives the checkpoint
        ▼                   │
snapcompact → handoff → shake → soft
        │
        ▼
native compaction transaction commits one checkpoint
```

| Order | Method        | Model call       | What it produces                                                                                                                     |
| ----- | ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | `snapcompact` | None (local)     | Bounded 1568px bitmap frames of the compact middle, exact head/tail text, a bounded FILES index and an archive reference.            |
| 2     | `handoff`     | One handoff call | A structured task handoff: goal, constraints, decisions, exact commands, completed and unfinished work, next action, critical facts. |
| 3     | `shake`       | None             | Large tool outputs are archived, then replaced with bounded head/tail excerpts and recall references.                                |
| 4     | `soft`        | Native summary   | DSH's native text summarization as the final fallback.                                                                               |

Why frames: vision models bill an image by area, largely independent of how many characters are packed into it. Up to the reader's legibility limit, a dense frame can carry more text per token than the same text sent verbatim; the ratio depends on frame geometry, the reader's image pricing and how dense the transcript is.

The visual method is attempted only when the current route declares image input **and** supplies image pricing (or a labelled estimate). It renders up to `rendering.maxFrames` (20 by default, configurable to 64) and never past the host's per-message image cap, selecting the frame count dynamically so the checkpoint fits the room left under the trigger. It is skipped when no image slot remains, when every candidate frame would be downscaled below the readable glyph floor, or when the budget leaves no room for a frame. Existing images are carried into the checkpoint (up to four) instead of forcing a text fallback.

### Does it save tokens?

The visual path pays no generation cost: the compaction itself makes no model call. On the bundled synthetic fixture it turned 14,357 prompt tokens of raw history into an 8,152-token checkpoint and matched the original's 8/9 exact answers. A native summary read only 523 tokens per turn, but generating it cost a one-time 16,052 tokens and it scored 7/9. Counting that generation, the visual checkpoint is cheaper for the first compaction; the summary becomes cheaper in raw token count after roughly 2–3 turns. The method must also fit the room left under the trigger — at most half of what a checkpoint cannot replace, capped by half of the source — so a history too small for that budget falls back to text. Cache-read discounts and image pricing decide the actual bill, so treat this as a measurement, not a promise.

A checkpoint looks roughly like this (abridged):

```text
Snapcompact v2; method=snapcompact
Exact archived history: sha256:…
Visual snapcompact checkpoint: N frames; M carried images; use snapcompact_recall for exact strings.
FILES (touched by read/write/edit tools; not a current disk-state guarantee)
(Read) read-only; (Write) written without a read; (RW) read and written
============================================================
# src/compaction/
visual-source.ts (Read)
## methods/
snapcompact.ts (RW)
[exact text head]
[image frame 1 of N] … [image frame N of N]
[exact text tail]
[file] snapcompact archive reference
```

Safety properties:

- Images are never the only copy of task state; exact head/tail text and the archive remain. A text handoff is the fallback when visuals are unavailable.
- The `FILES` index is derived from read/write/edit tool calls in the compacted range and earlier snapcompact checkpoints. It is a navigation aid, not a disk snapshot; `bash` and apply-patch changes are not tracked.
- Cancellation stops the compaction and never silently selects the next method.
- Recall is granted only by a successfully completed compaction in the owning session.
- Existing images and earlier visual checkpoints are carried forward, not re-rendered as attachment descriptors.
- Unknown vision support fails closed to text; unknown pricing is estimated only for DeepSeek model IDs and is labelled as an estimate.
- The plugin adds no custom Session event type and does not replace the host's transaction engine.

## Install

Snapcompact declares **DeepSeek Harness `^0.2.2-rc.1`**, the 0.2.x line, and is verified on `0.2.2-rc.1`. A 0.2.x patch or prerelease installs without an exact-version exemption; the next minor line is declared only after the install and activation checks have passed against it.

| Requirement                | Value                                           |
| -------------------------- | ----------------------------------------------- |
| DSH                        | `^0.2.2-rc.1` (0.2.x; verified on `0.2.2-rc.1`) |
| Node.js                    | 24 or newer (the host's requirement)            |
| Build step                 | None; the npm package ships compiled `dist/`    |
| Install-time build scripts | None                                            |

### From the Plugins page (recommended)

1. Open **Plugins → Add plugin** in DSH.
2. Paste `dsh-snapcompact@0.5.1` and click **Install**.
3. Follow the page's restart prompt if one appears.
4. Start a **new session** and pick the Snapcompact variant that matches how you work: **Snapcompact (Standard)**, **Snapcompact (PTC)** or **Snapcompact (Cordis)**. From then on, `/compact` and automatic compaction use Snapcompact; no extra command is required.

Pin the version to install exactly this release. Without a version, the package manager resolves the newest published release.

### From the command line

```sh
dsh plugin --profile web add dsh-snapcompact@0.5.1
```

Replace `web` with the profile you actually use, then follow the restart instruction. On DSH Desktop, install through the in-app Plugins page: the CLI writes to the named profile, which may not be the profile the desktop app uses.

### Other install sources

`dsh plugin add` accepts more than an npm package name. You can install a locally packed tarball or a tarball URL:

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.5.1.tgz"
```

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-0.5.1.tgz
```

The npm package is the prebuilt option; a local checkout needs `pnpm pack` (or `pnpm run build`) first.

### Enable a preset

Installation adds **opt-in presets**; it does not change the official presets or any running session. Create a new session, choose one of the Snapcompact variants, and continue there.

Each variant copies the official preset it mirrors and swaps only the compaction backend: `compaction-basic` out, the Snapcompact chain in. The destructive result pruner stays out because shake archives before externalizing. Choosing a variant is the enable action. DSH mounts each agent's compaction backend inside the preset's isolated group, so a profile-plane plugin cannot replace the native backend globally, and a shipped preset cannot be extended in place. This is a DSH isolation boundary, not an extra per-turn mode.

| Official mode | Choose                     | What you keep                                                                                                                                                                               |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `standard`    | **Snapcompact (Standard)** | The regular tool set: shell, file tools, search, subagents and workflows, web, plan mode.                                                                                                   |
| `ptc`         | **Snapcompact (PTC)**      | `run_code` as the only direct tool; every other tool stays reachable through `tools.*`, including `snapcompact_recall`. Workflows and the plugin manager keep the official PTC disablement. |
| `cordis`      | **Snapcompact (Cordis)**   | `tool-cordis` plus the official Cordis authoring skills mounted from the shipped `@deepseek-ai/dsh-agent-preset` skills directory.                                                          |
| `minimal`     | not provided               | Minimal deliberately omits read/write/edit and the full tool surface; adding image frames and archive recall would defeat its purpose, so it is out of scope.                               |

The settings card is shared: it edits the profile-plane `snapcompact-settings` row, and whichever variant a session selects reads it at mount time.

## Use it

| Entry point              | What it does                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/compact`               | DSH's standard manual compaction command; inside any Snapcompact preset it runs the Snapcompact chain.                                                   |
| `/snapcompact status`    | Show the method-chain preset, automatic-compaction setting, current route, effective threshold in tokens, per-method availability and the archive count. |
| `/snapcompact benchmark` | Run the synthetic comparison. This explicitly authorizes up to four auxiliary model requests and can incur fees.                                         |
| `snapcompact_recall`     | Let the model list, page through or literally search exact archived content.                                                                             |

Recall examples:

```json
{ "action": "list" }
{ "action": "read", "archiveId": "sha256:…", "offset": 0, "limit": 100 }
{ "action": "search", "archiveId": "sha256:…", "query": "pnpm deploy --filter" }
```

Recall returns physical line numbers and `(nextOffset, nextColumn)` cursors. Pass both back to continue a very long line. Text pages are capped at 200 line fragments and 20,000 UTF-16 code units. Search is a case-sensitive literal substring match, not a regular expression.

Archive IDs must be referenced by a completed compaction in the owning session (including inherited history). Arbitrary paths and other sessions' archives are not accessible.

## Configuration

Configuration lives on the `snapcompact` row inside the selected Snapcompact preset's isolated compaction group. The settings card on the **Plugins → Snapcompact** page covers the common keys; the preset/config editor covers everything else. Both write into the active profile's configuration patch, so neither requires editing profile files by hand.

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
policy:
  auto: true
  # Trigger at 80% of the window; /snapcompact status shows the effective token count.
  thresholdRatio: 0.8
rendering:
  width: 1568
  height: 1568
  maxFrames: 20
  lineHeight: 20
  minGlyphPx: 12
serialization:
  toolResultMaxChars: 2000
  toolArgumentMaxChars: 500
  messageTextMaxChars: 8000
  headChars: 2000
  tailChars: 2000
  includeReasoning: false
  maxCarriedImages: 4
```

Defaults use 1568×1568 frames and 20 frames per checkpoint, with a configurable maximum of 64; the host's per-message image cap (20 by default) still clamps the effective count. Other limits are 16 MiB of generated images, 64 MiB of source/archive data and a 15-second render deadline. The frame count is chosen dynamically under the checkpoint budget implied by the trigger (see the [configuration reference](docs/configuration.md#trigger-threshold)).

### In-app settings

The Snapcompact detail page under **Plugins** carries a settings card backed by a `snapcompact-settings` row in the current profile. The card writes through DSH's settings service into that profile's configuration patch, so saved values survive restarts without hand-editing YAML. It manages:

| Control                  | Config path                              | Default                               |
| ------------------------ | ---------------------------------------- | ------------------------------------- |
| Method chain             | `methodOrder`                            | `[snapcompact, handoff, shake, soft]` |
| Custom trigger threshold | `policy.thresholdRatio`                  | unset (host default 0.8)              |
| Frame size               | `rendering.width` and `rendering.height` | 1568                                  |
| Maximum frames           | `rendering.maxFrames`                    | 20 (max 64)                           |
| Archive limit            | `archiveMaxBytes`                        | 64 MiB                                |
| Handoff budget           | `handoffMaxTokens`                       | 4096                                  |
| Externalize above        | `shakeThresholdChars`                    | 8192                                  |

Rules worth knowing:

- The engine is built when a session mounts the preset, so **saved changes apply to new sessions**; a running session keeps its configuration.
- For a key the card manages, the saved value overrides the same key in preset YAML. `thresholdRatio` is the exception: it stays unset until you enable the custom threshold, so a preset-level `policy.thresholdRatio` still applies.
- "Restore default" removes the override and falls back to the plugin default (or to YAML, for the threshold).
- Everything else — the rest of `policy`, `serialization`, `routePolicies`, render timeouts — remains YAML-only.

### Custom method chains and thresholds

`methodOrder` is a priority list: the engine tries methods in order and **the first candidate that succeeds within its compression constraint wins**, so the order is the fallback order. The final method must be `soft`. Subsets are allowed:

| Preset                 | `methodOrder`                         | Behavior                                                    |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------- |
| Visual-first (default) | `[snapcompact, handoff, shake, soft]` | Local visuals first, then handoff, excerpts, native summary |
| Visual + native        | `[snapcompact, soft]`                 | Skip handoff/shake; native summary when visuals fail        |
| Local-first            | `[snapcompact, shake, soft]`          | Call the native summarizer only after both local paths fail |
| Text-first             | `[handoff, shake, soft]`              | Spend one model call on a structured handoff first          |
| Native-only            | `[soft]`                              | Back to the DSH native summary; archive and recall remain   |

Two easy misreadings: `shake` succeeds whenever any tool output exceeds `shakeThresholdChars`, so putting it first preempts the visual path; and the checkpoint budget (half of the room left under the trigger) only constrains `snapcompact`, while every other method merely has to shrink the source.

The trigger is still the native `policy.thresholdRatio` (a window fraction, default 0.8). `/snapcompact status` converts it into tokens for the current route and explains whether each method will run or be skipped.

If a model genuinely has image input and a known price but DSH's adapter exposes no image pricing, DeepSeek model IDs use a labelled 1024-token/frame conservative estimate. Other models can declare a conservative ceiling explicitly:

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # Example only; calibrate for the model and frame size.
```

A ceiling is not actual usage and cannot grant missing image modality. See [configuration](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md) for every field, the native policy pass-through and route-matching rules.

## Compatibility

| Component    | Supported                                    |
| ------------ | -------------------------------------------- |
| DSH          | `^0.2.2-rc.1` (0.2.x)                        |
| Node.js      | 24+                                          |
| DSH packages | Host-provided peers; no local copy is needed |
| npm install  | Prebuilt package, no install scripts         |

The plugin declares a bounded range rather than a single version. The host's gate is a semver check; the floor is the newest host release this build was verified against, and the ceiling is the next minor line. A compatible patch installs without a new plugin release, while a newer minor stays rejected until it passes the same revalidation — types, native integration, package contents and live preset activation — and ships in a new plugin release. Do not bypass the host check by editing profile metadata.

## Limits and privacy

- **Not lossless.** Frames can omit characters (missing glyphs, a truncated middle), and the text fallbacks are summaries. The archive preserves the selected message content, but it cannot recover content another plugin already deleted. Only up to four existing images are carried into the next checkpoint; older image pixels remain outside the visual summary (their archive descriptors are retained).
- **Savings depend on the route and the horizon.** The numbers above come from one synthetic fixture on one route. A terse native summary can be smaller per turn on a short session; the visual checkpoint can win on a long history or a route with cheap image tokens. Cache-read discounts, image pricing and turn count decide the bill: a smaller checkpoint is not proof of a lower bill.
- **Visual eligibility is narrow.** The route must declare image input and pricing or a labelled estimate. Unrenderable characters become visible `?` placeholders, downscaled frames are rejected as unreadable, and insufficient budget or storage failures fall back to text. The visual middle may be truncated; the exact archive remains the source of truth.
- **FILES is a tool-observed index, not a snapshot.** It covers read/write/edit calls in the compacted range plus earlier snapcompact FILES blocks, is capped at 20 sorted paths, and does not see `bash` or apply-patch changes. Paths elided from an earlier checkpoint are not re-indexed; the archive and recall remain exact.
- **Host metering caveat.** On a route whose adapter does not price images, DSH's own context meter may underprice the checkpoint until provider usage anchors the next request; the plugin uses its own conservative frame price for the visual gate.
- **Benchmarks cost money.** `/snapcompact benchmark` makes up to four auxiliary model calls using the bundled synthetic fixture. It does not read or upload private session history.
- **Archive access is scoped.** Recall accepts only archive IDs referenced by a completed compaction in the owning session; there is no path or cross-session escape hatch.
- **No telemetry.** Archives are stored through DSH's attachment storage in the profile. The plugin does not upload conversation data anywhere else.

## Troubleshooting

<details>
<summary>I installed it, but the Snapcompact presets are not in the picker</summary>

Confirm the plugin appears as installed, restart DSH if the Plugins page asks for it, and create a **new** session. Look for **Snapcompact (Standard)**, **Snapcompact (PTC)** and **Snapcompact (Cordis)**. Existing sessions keep the preset they started with. On DSH Desktop, make sure you installed through the app's Plugins page rather than a CLI profile the desktop app does not use.

</details>

<details>
<summary>It always falls back to text and never renders images</summary>

Run `/snapcompact status`. The usual cause is that the current route has no declared image input or no usable image price estimate. This is the intended safe behavior; do not add a `routePolicies` ceiling unless you know the model accepts images and have calibrated the value. Existing images are carried forward, up to four; if there is no image slot left, the text handoff is used.

</details>

<details>
<summary>Compaction fails with "No compaction method produced a safe smaller checkpoint"</summary>

Every candidate was skipped or failed its budget check. Check `/snapcompact status` first, then retry when the history is larger or choose a route with a working text summarizer. The error lists each method's reason; cancellation is reported separately and does not fall through.

</details>

<details>
<summary>Recall says the archive is not referenced by this session</summary>

Use the archive ID from a checkpoint created by a completed compaction in the current session (inherited history counts). IDs copied from another session, another profile, or a failed attempt are intentionally rejected.

</details>

<details>
<summary>The install is rejected as incompatible</summary>

This build declares DSH `^0.2.2-rc.1` and is verified on `0.2.2-rc.1`. Upgrade or switch the host to a 0.2.x release, or install a Snapcompact release that declares your host's minor line. Do not hand-edit the compatibility check to force the install.

</details>

## Documentation

- [Configuration and route pricing](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md)
- [Architecture and reading guide](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/architecture.md)
- [Evaluation and interpretation](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation.md)
- [Evaluation results and cost accounting](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation-results.md)
- [Third-party notices](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/THIRD_PARTY_NOTICES.md)
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
