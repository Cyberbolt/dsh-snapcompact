# Architecture and reading guide

[简体中文](zh/architecture.md)

## Follow the data flow first

Native balanced-range selection → deterministic serialization → local visual checkpoint → capability, pricing and complete-budget checks → **native compaction transaction**.

The plugin does not replace the transaction engine, invent Session event types, silently rewrite routed requests, or use hidden workspace/profile files. It supplies one candidate summary to the host; the host decides whether to commit it.

## What a checkpoint contains

A committed checkpoint is one ordinary summary message. It has no archive attachment and no recall tool. The blocks are, in order:

1. a short guide: frame order, the `¶` newline marker, the exact-token index, and the rule that later questions must re-read the checkpoint;
2. an optional `FILES` index from read/write/edit calls;
3. the exact head text (the first `serialization.headChars` characters of the projection);
4. carried images, oldest first, bounded by the host image policy;
5. an omission marker when the middle was clipped;
6. bitmap frames of the middle, oldest first;
7. the exact tail text (the last `serialization.tailChars` characters);
8. a bounded exact-token index: up to 80 labeled lines copied from the same projection;
9. a closing rule that repeats the no-memory instruction.

The exact head/tail and the index are text; the frames carry the surrounding history. The index exists because 64-character digests are not reliably readable from pixels. It is deterministic, generated from the same serialized history as the frames, and is not a search tool or an archive.

## Serialization

`serializeConversation` builds a frame-oriented projection rather than a byte-for-byte transcript:

- section prefixes (`»user:`, `»ai:`, `»think:`, `»call:`) replace verbose JSON-ish headers;
- tool calls and their results merge into one section, so a command sits next to its output;
- every field is clipped head-and-tail (default 1,500 characters for message text, 1,200 for tool results, 500 per tool argument), with a visible `…Nch elided…` marker;
- routine `INFO`/`PASS`/stack-frame/metric/paragraph lines are dropped and counted in one `routine log lines elided` marker;
- long runs of structurally identical lines collapse to their first two and last two lines plus a count;
- lines matching a generic exact-token pattern (checksums, commands, paths, ports, timeouts, locks, flags, owners, targets, incident facts) get a leading `* ` marker;
- the exact-token index extracts the labeled subset of those lines, deduplicated and capped.

The filters are deliberately generic. They do not know the questions, the fixture, or the benchmark. A line that carries a durable label or a value survives; routine log noise does not. The tradeoff is explicit: a unique exact string buried inside a long `INFO` line can be dropped. Errors, labeled facts, commands, paths and digests survive.

## Rendering

The renderer is a local, zero-model-call path:

- the bundled GNU Unifont 18.0.01 bitmap font is the only font; it covers Latin, CJK, kana, hangul and common symbols;
- layout is a continuous text flow: a full row wraps at the frame edge, one `¶` marks each source newline, leading indentation is preserved, and internal runs of spaces collapse;
- `letterSpacing` (default 2 px) widens each cell; `lineHeight` (default 20 px) controls leading; both trade characters per frame for OCR legibility;
- frames are one-bit grayscale PNGs, so dense text compresses well and the bundled two-tone font loses nothing;
- frame size, count and pixel projection are checked against the host's image limits and the model's readable-glyph floor before anything is committed;
- when the middle exceeds the frame budget, the layout keeps both chronological edges and drops the oldest dense center (foveation); the exact head/tail stay outside the frames.

The model's image tokenization and max-edge policy are resolved through the host's image route. A route with no declared vision support or no usable price estimate falls through to the text chain.

## FILES

The checkpoint carries a bounded `FILES` text block outside the frames. It is derived deterministically from read/write/edit tool arguments and earlier snapcompact checkpoints; `bash`, apply-patch and other mutation paths are outside its scope. FILES is `(Read)` / `(Write)` / `(RW)` metadata for navigation, not a filesystem snapshot, and it is included in the checkpoint's token estimate.

## Transaction and lifetime

Each preset owns one renderer instance with a bounded queue. Its deadline includes queue wait and cold startup. Disposal permanently rejects new work, terminates the worker and does not affect another preset's queue.

DSH owns maintenance admission and transaction locks; the plugin adds no competing session lock. A failed candidate is not partially committed. Cancellation stops the compaction and never silently selects the next method.

## Deliberate tradeoffs

- **No search after compaction.** There is no archive and no recall tool. Exact strings are recoverable from the exact head/tail and the bounded exact-token index; a string that was clipped from both is not recoverable. This is the 0.7.0 contract.
- **The index is bounded.** Up to 80 labeled lines. It is a legibility aid, not a complete transcript.
- **Routine log lines are elided.** A unique value inside a routine `INFO` line may be lost; errors and labeled facts are kept.
- **Rendering is deterministic but not lossless.** The source projection may drop characters; the exact text and index are the source of truth for the strings they contain.
- **The visual path is not always cheaper.** It avoids a summary call and usually has a much smaller peak prompt, but a route with expensive image tokens or a short horizon can cost more than raw text. The v5 benchmark reports per-turn weighted cost; it does not promise a universal saving.
- **Estimated size, reading accuracy and monetary cost are different measurements.** An explicit benchmark calibrates a route; it never silently changes user configuration.

### Renderer levers not ported

The renderer is deliberately a small 1-bit TypeScript path. It does not implement omp's grayscale dim ink, the embedded Silver TrueType fallback, six-hue sentence ink, or line repetition. Instead it uses generic `* ` markers for exact-token lines, a 2 px cell advance, Unifont's built-in CJK coverage, and the bounded exact-token text index for digests and paths. Those omissions are visible here rather than hidden in a benchmark claim; the v5.1 results measure the renderer that ships.
