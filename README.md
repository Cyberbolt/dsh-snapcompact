<p align="center"><img src="https://raw.githubusercontent.com/Cyberbolt/dsh-snapcompact/main/icon.svg" width="96" height="96" alt="Snapcompact archive frame icon"></p>

# dsh-snapcompact

[English](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.md) · [简体中文](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-snapcompact?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-snapcompact)
[![downloads](https://img.shields.io/npm/dt/dsh-snapcompact?logo=npm&label=downloads)](https://www.npmjs.com/package/dsh-snapcompact)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.2--rc.1-1f485c)](https://github.com/Cyberbolt/dsh-snapcompact#compatibility)
[![stars](https://img.shields.io/github/stars/Cyberbolt/dsh-snapcompact?style=flat&logo=github&label=stars)](https://github.com/Cyberbolt/dsh-snapcompact)

**Recoverable visual and text compaction for DeepSeek Harness.** Snapcompact turns a long conversation into a smaller checkpoint that still has an exact, searchable archive behind it. Install it as an opt-in DSH preset: new sessions can choose a compaction chain that tries visual page frames first, keeps an independent text handoff, and falls back to safer methods whenever images would be unreliable.

> **Not an unconditional token-saving promise.** The visual path depends on the route's image support, real image pricing and OCR accuracy. Unknown capabilities or pricing fall back to text. Summaries are not lossless: use `snapcompact_recall` when an exact command, path, indentation or identifier matters.

## Highlights

| What you need                                                 | What Snapcompact provides                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A smaller context window without throwing the transcript away | Every checkpoint ships with an exact archive of the selected history.                                            |
| Recover exact strings after compaction                        | A standalone text handoff, an archive reference and the `snapcompact_recall` tool.                               |
| A safe failure mode                                           | `snapcompact → handoff → shake → soft`; a candidate that cannot prove a smaller, readable checkpoint is skipped. |
| Native DSH behavior                                           | Compaction region selection, transaction locks, recovery and capacity checks stay in the host.                   |
| Evidence instead of a slogan                                  | `/snapcompact benchmark` compares the bundled synthetic fixture across text, summary and visual arms.            |

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
| 1     | `snapcompact` | One handoff call | Bitmap PNG frames of the archived transcript, plus the independent text handoff and archive reference.                               |
| 2     | `handoff`     | One handoff call | A structured task handoff: goal, constraints, decisions, exact commands, completed and unfinished work, next action, critical facts. |
| 3     | `shake`       | None             | Large tool outputs are archived, then replaced with bounded head/tail excerpts and recall references.                                |
| 4     | `soft`        | Native summary   | DSH's native text summarization as the final fallback.                                                                               |

The visual method is attempted only when the current route declares image input **and** supplies image pricing (or an explicit conservative ceiling). It is skipped when the selected history already contains images, when no request image slots remain, when text cannot be rendered readably, or when the result would not meet the configured reduction ratio.

A checkpoint looks roughly like this (abridged):

```text
Snapcompact v1; method=snapcompact
Exact archived history: sha256:…
Goal / Constraints / Decisions / Files and exact commands / …
[image frame 1 of N] … [image frame N of N]
[file] snapcompact archive reference
```

Safety properties:

- Images are never the only copy of task state; a text handoff and the archive remain.
- Cancellation stops the compaction and never silently selects the next method.
- Recall is granted only by a successfully completed compaction in the owning session.
- Existing images or earlier visual checkpoints select a text handoff instead of re-rendering an attachment descriptor.
- Unknown vision support or pricing fails closed to text.
- The plugin adds no custom Session event type and does not replace the host's transaction engine.

## Install

Snapcompact requires **DeepSeek Harness `0.2.2-rc.1`**. Other DSH versions are not declared compatible, and the host may reject the install rather than run untested code.

| Requirement                | Value                                        |
| -------------------------- | -------------------------------------------- |
| DSH                        | `0.2.2-rc.1` (exact)                         |
| Node.js                    | 24 or newer (the host's requirement)         |
| Build step                 | None; the npm package ships compiled `dist/` |
| Install-time build scripts | None                                         |

### From the Plugins page (recommended)

1. Open **Plugins → Add plugin** in DSH.
2. Paste `dsh-snapcompact@0.1.2` and click **Install**.
3. Follow the page's restart prompt if one appears.
4. Start a **new session** and select **Snapcompact** in the preset picker.

Pin the version to install exactly this release. Without a version, the package manager resolves the newest published release.

### From the command line

```sh
dsh plugin --profile web add dsh-snapcompact@0.1.2
```

Replace `web` with the profile you actually use, then follow the restart instruction. On DSH Desktop, install through the in-app Plugins page: the CLI writes to the named profile, which may not be the profile the desktop app uses.

### Other install sources

`dsh plugin add` accepts more than an npm package name. You can install a locally packed tarball or a tarball URL:

```sh
pnpm install --ignore-scripts
pnpm pack
dsh plugin --profile web add "file:$PWD/dsh-snapcompact-0.1.2.tgz"
```

```sh
dsh plugin --profile web add https://example.com/dsh-snapcompact-0.1.2.tgz
```

The npm package is the prebuilt option; a local checkout needs `pnpm pack` (or `pnpm run build`) first.

### Enable the preset

Installation adds an **opt-in preset**; it does not change the default preset or any running session. Create a new session, choose **Snapcompact**, and continue there. The preset mounts Snapcompact in an isolated compaction group, so the default sessions keep their native compaction behavior.

## Use it

| Entry point              | What it does                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `/compact`               | DSH's standard manual compaction command, included in the preset.                                                                |
| `/snapcompact run`       | Compact an idle session immediately.                                                                                             |
| `/snapcompact status`    | Show the method chain, automatic-compaction setting, current route, whether a visual attempt is possible, and the archive count. |
| `/snapcompact benchmark` | Run the synthetic comparison. This explicitly authorizes up to four auxiliary model requests and can incur fees.                 |
| `snapcompact_recall`     | Let the model list, page through or literally search exact archived content.                                                     |

Recall examples:

```json
{ "action": "list" }
{ "action": "read", "archiveId": "sha256:…", "offset": 0, "limit": 100 }
{ "action": "search", "archiveId": "sha256:…", "query": "pnpm deploy --filter" }
```

Recall returns physical line numbers and `(nextOffset, nextColumn)` cursors. Pass both back to continue a very long line. Text pages are capped at 200 line fragments and 20,000 UTF-16 code units. Search is a case-sensitive literal substring match, not a regular expression.

Archive IDs must be referenced by a completed compaction in the owning session (including inherited history). Arbitrary paths and other sessions' archives are not accessible.

## Configuration

Configuration lives on the `snapcompact` row inside the Snapcompact preset's isolated compaction group. Edit it through DSH's preset/config editor rather than modifying active profile files by hand. A minimal example:

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
minCompressionRatio: 2
rendering:
  width: 1536
  height: 1024
  maxFrames: 12
```

Defaults include 12 frames (maximum 20), 16 MiB of generated images, 64 MiB of source/archive data and a 15-second render deadline. The host's smaller limits also apply.

If a model genuinely has image input and a known price but DSH's adapter exposes no image pricing, you can declare a conservative ceiling explicitly:

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
| DSH          | `0.2.2-rc.1` only                            |
| Node.js      | 24+                                          |
| DSH packages | Host-provided peers; no local copy is needed |
| npm install  | Prebuilt package, no install scripts         |

Compatibility is intentionally pinned while the upstream plugin API is still a release candidate. DSH checks the declared version and can reject an install on a different host. Widening this range requires revalidating types, native integration, package contents and live preset activation; do not bypass the check by editing profile files.

## Limits and privacy

- **Not lossless.** Generated summaries and images can omit details. The archive preserves the selected message content, but it cannot recover content another plugin already deleted.
- **Not a universal 2× saving.** Token counts are estimates, image pricing varies by route, and a smaller checkpoint is not proof of lower billing or preserved task information.
- **Visual eligibility is narrow.** The route must declare image input and pricing. Missing glyphs, scripts that require shaping, too many pages, unreadable downscaling, storage failures or insufficient reduction fall back to text rather than producing blank or truncated images.
- **Benchmarks cost money.** `/snapcompact benchmark` makes up to four auxiliary model calls using the bundled synthetic fixture. It does not read or upload private session history.
- **Archive access is scoped.** Recall accepts only archive IDs referenced by a completed compaction in the owning session; there is no path or cross-session escape hatch.
- **No telemetry.** Archives are stored through DSH's attachment storage in the profile. The plugin does not upload conversation data anywhere else.

## Troubleshooting

<details>
<summary>I installed it, but the Snapcompact preset is not in the picker</summary>

Confirm the plugin appears as installed, restart DSH if the Plugins page asks for it, and create a **new** session. Existing sessions keep the preset they started with. On DSH Desktop, make sure you installed through the app's Plugins page rather than a CLI profile the desktop app does not use.

</details>

<details>
<summary>It always falls back to text and never renders images</summary>

Run `/snapcompact status`. The usual cause is that the current route has no declared image input or no image pricing. This is the intended safe behavior; do not add a `routePolicies` ceiling unless you know the model accepts images and have calibrated the value. A history that already contains images also selects the text handoff.

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

This release supports DSH `0.2.2-rc.1` only. Upgrade or switch the host to that version instead of editing the compatibility check. A wider range will be published after it is validated.

</details>

## Documentation

- [Configuration and route pricing](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/configuration.md)
- [Architecture and reading guide](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/architecture.md)
- [Evaluation and interpretation](https://github.com/Cyberbolt/dsh-snapcompact/blob/main/docs/evaluation.md)
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
