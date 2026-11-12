# Configuration

[简体中文](zh/configuration.md)

Configure the **dsh-snapcompact row inside the selected Snapcompact preset's isolated compaction group**, not a second global compaction service. The standard, PTC and Cordis variants mount the same row id and configuration key, so the same settings apply whichever variant a session selects. The settings card on the plugin page manages the common keys; the preset/config editor and the YAML below cover the rest. Both persist through the active profile's configuration patch; do not rewrite profile files by hand.

Manual compaction is `/compact`; it resolves to whichever backend the preset mounts. `/snapcompact status` is read-only diagnostics, not a compaction entry point.

```yaml
methodOrder: [snapcompact, shake, soft]
budget:
  # Fraction of the trigger room one checkpoint may spend; 0.5 restores the old rule.
  checkpointShare: 0.4
policy:
  auto: true
  thresholdRatio: 0.8
  retainRatio: 0.16
  headroomTokens: 65536
guard:
  # Refuse to mount when thresholdRatio - retainRatio is below this; 0 disables.
  minCompactableRatio: 0.1
  # Skip one compaction whose source is below max(1024, window x this); 0 disables.
  minSourceRatio: 0.01
rendering:
  width: 1568
  height: 1568
  maxFrames: 40
  lineHeight: 20
  letterSpacing: 2
  minGlyphPx: 12
  maxTotalBytes: 16777216
  maxSourceBytes: 67108864
  timeoutMs: 15000
serialization:
  toolResultMaxChars: 1200
  toolArgumentMaxChars: 500
  toolCallMaxChars: 2000
  messageTextMaxChars: 1500
  headChars: 2000
  tailChars: 2000
  includeReasoning: false
  maxCarriedImages: 4
shakeThresholdChars: 8192
routePolicies: []
```

## In-app settings

The **Plugins → Snapcompact** page renders a settings card for the current profile's `snapcompact-settings` row. The row is separate from the preset on purpose: DSH only projects volatile Config fields of profile-plane entries into its settings document, while the compaction plugin must stay inside the opt-in preset. The row publishes the live values as the `snapcompactSettings` service; each session's preset instance reads them while it mounts, so one card configures every Snapcompact variant.

| Control                  | Config path                              | Default                                     |
| ------------------------ | ---------------------------------------- | ------------------------------------------- |
| Method chain             | `methodOrder`                            | `[snapcompact, shake, soft]`                |
| Custom trigger threshold | `policy.thresholdRatio`                  | unset (native default 0.8)                  |
| Retained tail (hidden)   | `policy.retainRatio` (YAML only)         | derived: `thresholdRatio ÷ 5` (0.16 at 0.8) |
| Frame size               | `rendering.width` and `rendering.height` | 1568                                        |
| Maximum frames           | `rendering.maxFrames`                    | 40 (max 64; host cap wins)                  |
| Externalize above        | `shakeThresholdChars`                    | 8192                                        |

Persistence and precedence:

- Writes go through DSH's settings service to the profile's configuration patch; they survive restarts and are removed by "Restore default" (per field or for the whole card).
- A saved card value overrides the same key in preset YAML. `thresholdRatio` is the exception: until the custom threshold is enabled the key is absent, so a preset-level `policy.thresholdRatio` still applies.
- The retained tail is automatic: `retainRatio = thresholdRatio ÷ 5`. The card hides it and never writes it. Only a value saved by an older version remains visible, as one read-only “Custom” row with “Restore automatic” to unset it. `retainRatio` and `retainTokens` are still mutually exclusive: the strict parser rejects YAML that sets both.
- The engine is constructed when a session mounts the preset, so changes take effect for **new sessions**; `/snapcompact status` in an existing session keeps reporting its starting configuration.
- The settings schema cannot express chain ordering, so a stored chain that is empty, repeated, or does not end in `soft` is ignored by the plugin; the strict parser remains the final gate.

The bundle also declares a profile-plane carrier row (`snapcompact-ui`, module `dsh-snapcompact`) whose config is `role: ui`. DSH's browser module scanner only reads `dsh.client` from Loader entries named by a bare package specifier, so this row exists to make the card loadable; it registers no compaction, tools or commands. Keep it enabled: disabling it removes the settings card from the plugin page (the preset keeps working).

Everything outside those keys stays YAML-only: the rest of `policy`, `guard`, `serialization`, `routePolicies`, `rendering.maxTotalBytes`, `rendering.maxSourceBytes`, `rendering.timeoutMs`, `rendering.lineHeight`, `rendering.letterSpacing` and `rendering.minGlyphPx`.

## Native policy

`policy` is validated by `BasicCompactionEngine`. It supports thresholdRatio, headroomTokens, retainRatio/retainTokens (mutually exclusive), summarizationProvider/summarizationModel (a pair), maxTokens, compactionRetries, maxOverflowRetries, auto and modelPolicies. An empty object uses native defaults.

Do not copy 65,536-token headroom to a small-window model without adjustment. The native backend validates capacity, output reservation and retained-tail budgets. The plugin additionally validates the gap between the threshold and the retained tail at mount time (see [retained tail and guards](#retained-tail-and-usefulness-guards)).

## Method chains and fallback order

`methodOrder` is the ordered priority list of candidate methods. The engine tries each in turn and stops at the **first successful candidate**; the order is the fallback order, not a pipeline of stages. The chain must be nonempty, unique, and end in `soft`. Any subset with that shape is valid:

| Preset                 | `methodOrder`                | Behavior                                              |
| ---------------------- | ---------------------------- | ----------------------------------------------------- |
| Visual-first (default) | `[snapcompact, shake, soft]` | Local visuals, then excerpts, then the native summary |
| Visual + native        | `[snapcompact, soft]`        | Skip shake; native summary when visuals fail          |
| Native-only            | `[soft]`                     | Back to the DSH native summary; no visual checkpoint  |

Chains saved before the `handoff` method was removed are normalized on read: the name is dropped and the surviving order is kept. A hand-written YAML chain that still names `handoff` is rejected by the strict parser, so delete the name.

Semantics that are easy to miss:

- `shake` succeeds whenever any tool output exceeds `shakeThresholdChars`, so placing it before `snapcompact` preempts the visual path.
- The checkpoint budget (a configured share of the room under the trigger) only constrains `snapcompact`; every other method only has to produce a checkpoint smaller than the source.
- Cancellation aborts the transaction; it never falls through to the next method.
- There is no archive and no recall tool in 0.7.0. A `[soft]` chain does not keep a hidden search path.

## Trigger threshold

Automatic compaction starts when measured request pressure reaches the routed model's threshold:

```text
threshold   = floor(min(W × thresholdRatio, W − O − headroomTokens))
retainRatio = thresholdRatio ÷ 5                 # when not set explicitly
retain      = retainTokens ?? floor((W − O) × retainRatio)
```

`W` is the adapter-declared context window, `O` the effective output reservation, and `headroomTokens` a capacity safety margin. `thresholdRatio` is a window fraction, not an absolute token count; small-window models usually need both a lower ratio and smaller headroom. `retainRatio`/`retainTokens` must stay below the threshold, or the native backend rejects that route.

The derived tail follows the trigger ratio, not the effective token count: when headroom caps the threshold, `retain` still scales with `thresholdRatio`, so its token share can exceed 1/5. `/snapcompact status` prints the resolved tail for the current route.

`/snapcompact status` resolves the exact route and prints current tokens, `W`, threshold tokens, retained tokens, the compactable space between them, the guard floors and whether pressure has crossed. That display mirrors the formula above for explanation only; the native engine remains the authority. Thresholds are configuration-time settings (reload required), and they never disable the host's overflow recovery.

### Retained tail and usefulness guards

The trigger only means something relative to the retained tail:

```text
compactable = threshold - retain
```

Because the tail is derived as `thresholdRatio ÷ 5`, the automatic card path always leaves `4/5 × thresholdRatio` compactable (at least 0.4 at the 0.5 card floor), so it cannot trip the 0.1 guard. Explicit retention is where the old trap can still appear: at a 1M-token window `thresholdRatio: 0.2` with `retainRatio: 0.16` leaves only about 4% of the window. A checkpoint plus the retained text can easily cost more than that.

`guard` adds the missing checks:

| Key                   | Default | Meaning                                                                                               |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `minCompactableRatio` | `0.1`   | Reject the mount when `thresholdRatio - retainRatio` is below this. `0` disables the check.           |
| `minSourceRatio`      | `0.01`  | Skip one compaction whose source is below `max(1024, window × ratio)` tokens. `0` disables the check. |

The mount check runs in the engine constructor after native defaults are resolved, so it covers the global policy and every exact `modelPolicies` entry. The error lists every infeasible scope with the actual fractions and the fix. The absolute `retainTokens` form is window-dependent, so it is not rejected at mount time; `/snapcompact status` prints the real compactable space and warns when it is below `max(1024, window × minCompactableRatio)`.

The source floor runs after the source history is measured and before any method: a too-small source fails immediately, without a model call. Manual `/compact` is subject to the same guard; lower `guard.minSourceRatio` to allow a small manual run.

### Checkpoint budget

`snapcompact` may spend at most `budget.checkpointShare` of the room left under that threshold (0.25–0.5, default 0.4):

```text
fixed  = max(0, surface - source)
room   = threshold - fixed
budget = floor(min(room, source) × checkpointShare)   # no window: floor(source × share)
```

`surface` is the whole request pressure before compaction and `source` the history the checkpoint replaces; both come from the token meter the native engine re-measures after committing. Everything a checkpoint cannot replace — system prompt, tool schemas, output reservation, retained tail — stays in `fixed`.

Leaving `1 - share` of the room free means the post-compaction total stays below the threshold with a real margin. The historical rule was 0.5; 0.4 leaves more room for the checkpoint and the next answer that share the same window. When automatic pressure fires, `room ≈ source`, so the threshold basis equals `source × share`; it only tightens by the amount the session overshot its trigger. It also stays correct for a manual `/compact` below the threshold. A route without a declared context window, or a failed model lookup, falls back to `source × share`; `room ≤ 0` skips the visual path because no frame can bring the session back under the threshold.

The budget is recomputed per compaction from the live route, so it follows `thresholdRatio`, `headroomTokens` and per-model overrides without another setting. Set `budget.checkpointShare: 0.5` to restore the old behaviour. Older rows may still carry `minCompressionRatio`; it is accepted for upgrade compatibility and ignored.

## Serialization

The checkpoint is a frame-oriented projection, not a byte-for-byte transcript:

| Key                    | Default | Meaning                                              |
| ---------------------- | ------- | ---------------------------------------------------- |
| `messageTextMaxChars`  | 1500    | Head-and-tail cap for one user/assistant text block. |
| `toolResultMaxChars`   | 1200    | Head-and-tail cap for one tool result.               |
| `toolArgumentMaxChars` | 500     | Cap for one tool-call argument value.                |
| `toolCallMaxChars`     | 2000    | Cap across one serialized tool-call argument list.   |
| `headChars`            | 2000    | Exact leading text kept outside the frames.          |
| `tailChars`            | 2000    | Exact trailing text kept outside the frames.         |
| `includeReasoning`     | false   | Serialize assistant reasoning as `»think:` sections. |
| `maxCarriedImages`     | 4       | Existing images carried into the checkpoint.         |

On top of the caps, the serializer:

- merges a tool call with its result under one `»call:` section;
- drops routine `INFO`/`PASS`/stack-frame/file-listing/metric/paragraph lines and counts them in one `routine log lines elided` marker;
- collapses long runs of structurally identical lines to their first two and last two;
- prefixes generic exact-token lines with `* `;
- builds a deduplicated exact-token index of up to 80 labeled lines.

The filters are generic: they do not know the benchmark or the questions. A unique exact string inside a routine `INFO` line can be dropped; errors and labeled facts are kept.

## Rendering

| Key              | Default | Meaning                                                                 |
| ---------------- | ------- | ----------------------------------------------------------------------- |
| `width`/`height` | 1568    | Frame edge in pixels. The host image policy and max-edge may reduce it. |
| `maxFrames`      | 40      | Upper bound on frames; the host per-message image cap still clamps.     |
| `lineHeight`     | 20      | Pixel distance between bitmap baselines.                                |
| `letterSpacing`  | 2       | Extra horizontal pixels per glyph; wider tracking aids OCR.             |
| `minGlyphPx`     | 12      | Skip the visual path if the request would downscale glyphs below this.  |
| `maxTotalBytes`  | 16 MiB  | Generated PNG bytes per checkpoint.                                     |
| `maxSourceBytes` | 64 MiB  | Serialized source byte cap.                                             |
| `timeoutMs`      | 15000   | Render deadline, including queue wait and cold startup.                 |

Frames are one-bit grayscale PNGs. The bundled Unifont covers Latin, CJK, kana, hangul and common symbols. The layout is a continuous flow; `¶` marks one source newline. When the middle exceeds the frame budget, both chronological edges are kept and the oldest dense center is dropped.

## Visual eligibility

A route must explicitly declare image input and supply image pricing, a configured ceiling, or a labelled model-family estimate. Saved/request images must retain readable bitmap dimensions; otherwise the visual method is skipped. Frames, bytes and pixels must fit the host policy, and the complete checkpoint must fit the trigger-relative budget below.

When an adapter has no pricing, recognized model families use a labelled conservative per-frame estimate (DeepSeek 1024, Gemini 1120, Claude/GPT/Kimi/GLM 1568). Unknown lines fail closed to the text chain. Other models can use an explicit conservative route ceiling:

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # Example only, NOT a recommended price. Calibrate for the actual model and frame size.
```

Provider/model matching is exact, with no aliases, fuzzy matching or cross-model reuse. A ceiling is not actual usage and cannot grant missing image modality. Recalibrate after changing dimensions.

## Bounds and failure

Defaults use 1568×1568 frames, 40 frames per checkpoint (max 64), 16 MiB of generated images, 64 MiB of serialized source and a 15-second render deadline. The frame count is chosen dynamically under the trigger-relative checkpoint budget; the host's smaller limits and retained-image count also apply.

Unknown pricing, visual failures or insufficient savings select another method. When every candidate fails, native failure logging preserves the selected history. Cancellation never falls through. A threshold/retention pair below the compactable floor refuses to mount, and a source below the earnings floor fails before any method runs.

Snapcompact declares `^0.2.2-rc.1` (0.2.x) and is verified on `0.2.2-rc.1`. Raise the floor only after an install and activation check on that host release, and keep a finite ceiling. Do not bypass the host check.
