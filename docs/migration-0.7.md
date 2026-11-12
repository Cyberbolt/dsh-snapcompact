# Migrating to 0.7.0

[简体中文](zh/migration-0.7.md)

## What changed

0.7.0 makes the pure-visual checkpoint self-contained:

- **Removed:** the exact-text archive, the `snapcompact_recall` tool, the archive projection, archive attachments on checkpoints, and the archive settings/metrics.
- **Added:** a bounded, deterministic exact-token text index in every visual checkpoint. It carries labeled checksums, paths, commands, identifiers and key facts as text, capped at 80 lines.
- **Changed:** serialization defaults are denser (1,500 characters per message text, 1,200 per tool result), routine log lines are elided, and frames default to 40 with 2 px letter spacing.
- **Changed:** the benchmark is the v5 generated task-level suite. The old 40-question single-request fixture and the long-session suite are retired as gates; their historical results remain in [evaluation-audit.md](evaluation-audit.md).

There is no hidden recall path. A 0.7.0 checkpoint has no archive attachment and the host has no `snapcompact_recall` tool from this plugin.

## Who is affected

- If you used `snapcompact_recall` to search old compaction archives, 0.7.0 cannot do that. Stay on 0.6.x, or use the native text summary when you need a searchable record.
- If you only used the visual checkpoint for context and read exact strings from the head/tail or the model's reading, 0.7.0 is the replacement: exact strings are now in the head/tail and the exact-token index.
- Existing sessions keep the summary they already have. Old archive attachments are ignored by 0.7.0; they are not deleted. A new compaction produces a 0.7.0 checkpoint without an archive.

## Configuration migration

- `archiveMaxBytes` is **accepted and ignored** so a saved 0.6 profile still mounts. Remove it when convenient; the settings card no longer writes it.
- `rendering.maxFrames` default is now 40 (host image cap still clamps it). `rendering.letterSpacing` (default 2) and the denser `serialization` defaults are new.
- `methodOrder`, `budget.checkpointShare`, `policy` and `guard` keep their meanings. A chain ending in `soft` is still required.
- The `handoff` method remains retired. Old saved chains are normalized on read; hand-written YAML that still names it is rejected.

## Verification

```sh
pnpm check
pnpm run check:install
```

The v5 benchmark lives in `scripts/benchmark-v5.ts`. The test split is generated under `.artifacts/`; it is not committed. See [evaluation.md](evaluation.md) and [evaluation-v5-prereg.md](evaluation-v5-prereg.md).
