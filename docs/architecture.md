# Architecture and reading guide

[简体中文](zh/architecture.md)

## Follow the data flow first

Native balanced-range selection → immutable exact archive → ordered candidate methods → capability, pricing and complete-budget checks → standard summary blocks → **native compaction transaction**.

The plugin does not replace the transaction engine, invent Session event types, silently rewrite routed requests, or use hidden workspace/profile files as its source of truth.

Read the composition root, configuration, engine and method contract first. Then inspect individual methods, archives, rendering and DSH adapters. Modules are grouped by responsibility, not a single large plugin entry or one file per trivial function.

## Boundaries

| Subsystem        | Owns                                                      | Does not own                                  |
| ---------------- | --------------------------------------------------------- | --------------------------------------------- |
| plugin           | Assembly, registrations and resource lifetime             | Rendering or candidate policy                 |
| compaction       | Ordered methods, usage metadata, precommit budgets        | Native region selection and transaction locks |
| archives         | Versioned format, integrity, storage and bounded recall   | Access to arbitrary sessions or paths         |
| rendering        | Font, layout, rasterization, PNG and worker queue         | Model routing, billing or semantic summaries  |
| budgeting        | Modality, request size and conservative pricing           | Claiming estimates are provider measurements  |
| integrations/dsh | Incremental index, owning-session authorization, commands | Editing profile state or adding event types   |
| evaluation       | Fixed-fixture comparisons and reports                     | Background billing or private-history uploads |

## Invariants

1. Images are never the only task-state copy. Exact head/tail text plus the archive and recall reference remain.
2. Checkpoint references point to persisted bytes; archive schema, size, SHA-256, UTF-8 and reconstructed transcript must agree.
3. Native replay/signature blobs are not copied to portable archives. Message content, raw tool arguments and attachment identities are retained.
4. Cancellation remains authoritative and does not enter ordinary method fallback. Candidate failures have not changed the surface.
5. Only successfully closed native compactions grant recall access. The index derives from the log and survives replay/inheritance.
6. Image reference metadata is not visual-token pricing. Unknown capabilities fail closed; unknown prices are estimated only for DeepSeek model IDs and labelled as estimates.
7. Missing glyphs, unsupported shaping, page limits and unreadable resizing cannot silently omit content.
8. Existing images are carried into the next checkpoint when slots allow; attachment descriptors are not re-rendered as their original pixels. Repeated compaction retains parent archive references.
9. The `FILES` index is bounded, tool-observed metadata: read/write/edit calls plus earlier snapcompact FILES blocks, never a claim about current disk state. It is capped at 20 sorted paths and never replaces the exact archive or recall.

## Preset source of truth

The [standalone entry list](../presets/snapcompact.yml) is human-maintained. The build script emits a literal declaration into the [bundle patch](../cordis.patch.yml). Do not edit generated output. A literal patch avoids a runtime include's ambiguous relative base URL while keeping the source list readable.

## Why a separate preset

DSH mounts an agent's compaction backend and its consumers in one `cordis:group` isolation realm. A profile-plane plugin cannot publish a backend into that realm, and a user override of a shipped preset replaces its complete child list rather than patching one nested row. Swapping `compaction-basic` inside `standard` would therefore copy the whole built-in composition and drift with every DSH release. The standalone opt-in preset is the supported boundary; once selected, `/compact` and automatic compaction resolve to the backend that preset mounts.

## Release pipeline

The version in `package.json` is the only release switch. [publish.yml](../.github/workflows/publish.yml) publishes exactly that version when the registry does not have it yet, through npm trusted publishing, so no long-lived token exists in the repository. Three properties keep that honest: the registry address comes from `publishConfig` and is pinned for the whole job, so a mirror in someone's `.npmrc` cannot redirect a publish or a check; the plan step runs before `pnpm install` and reads the registry with `fetch`, so the decision cannot depend on installed state; and the tag and GitHub release are created immediately after a successful publish, because they are the deliverable.

The registry assertion runs last and is patient. `npm publish` returns before the public packument serves the new version — measured on this repository, 0.1.2 became readable 56 s later and 0.2.0 78 s later — so a fixed one-minute window passed or failed by luck. [verify-release.ts](../scripts/verify-release.ts) polls with exponential backoff for up to five minutes, then asserts the dist-tag, `dist.integrity` and the provenance attestation, and reports how long the registry actually took. Re-running the workflow repairs a missing tag or release: the plan reports `already-published`, publishing is skipped, and the release step still runs.

## Lifetime and concurrency

The preset isolates compaction and its consumers. Installation adds an opt-in preset without changing existing defaults or active sessions. DSH owns maintenance admission and transaction locks; the plugin adds no competing session lock.

Each plugin/preset owns a renderer instance with a bounded queue. Its deadline includes queue wait and cold startup. Disposal permanently rejects new work, terminates the worker and does not affect another preset's queue. Attachment storage belongs to the host; the plugin does not delete user data or unreachable objects left by failed attempts.

## Deliberate tradeoffs

The visual method is a local, zero-model-call renderer. When images are offloaded, the route has no usable price estimate, or the frame budget cannot fit the checkpoint budget implied by the trigger, an independent text handoff remains. Exact strings and uncertain facts still require archive recall.

The checkpoint also carries a bounded `FILES` text block outside the frames. It is derived deterministically from read/write/edit tool arguments and earlier snapcompact checkpoints; `bash`, apply-patch and other mutation paths are outside its scope. FILES is `(Read)` / `(Write)` / `(RW)` metadata for navigation, not a filesystem snapshot, and it is included in the checkpoint's token estimate.

It has no generation call, so the first compaction is cheaper in model tokens; its steady-state checkpoint is larger than a terse summary, so the advantage depends on the turn horizon and on cache/image pricing.

Estimated size, reading accuracy and actual monetary cost are different measurements. An explicit benchmark helps calibrate a route, but never silently changes user configuration or establishes universal savings.
