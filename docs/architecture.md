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

## Preset source of truth

The [standalone entry list](../presets/snapcompact.yml) is human-maintained. The build script emits a literal declaration into the [bundle patch](../cordis.patch.yml). Do not edit generated output. A literal patch avoids a runtime include's ambiguous relative base URL while keeping the source list readable.

## Lifetime and concurrency

The preset isolates compaction and its consumers. Installation adds an opt-in preset without changing existing defaults or active sessions. DSH owns maintenance admission and transaction locks; the plugin adds no competing session lock.

Each plugin/preset owns a renderer instance with a bounded queue. Its deadline includes queue wait and cold startup. Disposal permanently rejects new work, terminates the worker and does not affect another preset's queue. Attachment storage belongs to the host; the plugin does not delete user data or unreachable objects left by failed attempts.

## Deliberate tradeoffs

The visual method is a local, zero-model-call renderer. When images are offloaded, the route has no usable price estimate, or the frame budget cannot satisfy the reduction ratio, an independent text handoff remains. Exact strings and uncertain facts still require archive recall.

Estimated size, reading accuracy and actual monetary cost are different measurements. An explicit benchmark helps calibrate a route, but never silently changes user configuration or establishes universal savings.
