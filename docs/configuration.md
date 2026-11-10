# Configuration

[简体中文](zh/configuration.md)

Configure the **dsh-snapcompact row inside the selected Snapcompact preset's isolated compaction group**, not a second global compaction service. The standard, PTC and Cordis variants all mount the same row id and configuration key, so the same settings apply whichever variant a session selects. The settings card on the plugin page manages the common keys; the preset/config editor and the YAML below cover the rest. Both persist through the active profile's configuration patch; do not rewrite profile files by hand.

Manual compaction is `/compact`; it resolves to whichever backend the preset mounts. `/snapcompact status` is read-only diagnostics, not a compaction entry point.

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
policy:
  auto: true
  thresholdRatio: 0.8
  retainRatio: 0.16
  # Smaller windows need less headroom; native capacity validation still applies.
  headroomTokens: 65536
guard:
  # Refuse to mount when thresholdRatio - retainRatio is below this; 0 disables.
  minCompactableRatio: 0.1
  # Skip one compaction whose source is below max(1024, window x this); 0 disables.
  minSourceRatio: 0.01
rendering:
  width: 1568
  height: 1568
  maxFrames: 20
  lineHeight: 20
  minGlyphPx: 12
  maxTotalBytes: 16777216
  maxSourceBytes: 67108864
  timeoutMs: 15000
serialization:
  toolResultMaxChars: 2000
  toolArgumentMaxChars: 500
  toolCallMaxChars: 2000
  messageTextMaxChars: 8000
  headChars: 2000
  tailChars: 2000
  includeReasoning: false
  maxCarriedImages: 4
archiveMaxBytes: 67108864
handoffMaxTokens: 4096
shakeThresholdChars: 8192
routePolicies: []
```

## In-app settings

The **Plugins → Snapcompact** page renders a settings card for the current profile's `snapcompact-settings` row. The row is separate from the preset on purpose: DSH only projects volatile Config fields of profile-plane entries into its settings document, while the compaction plugin must stay inside the opt-in preset. The row publishes the live values as the `snapcompactSettings` service; each session's preset instance reads them while it mounts, so one card configures every Snapcompact variant.

The card manages nine keys:

| Control                  | Config path                              | Default                               |
| ------------------------ | ---------------------------------------- | ------------------------------------- |
| Method chain             | `methodOrder`                            | `[snapcompact, handoff, shake, soft]` |
| Custom trigger threshold | `policy.thresholdRatio`                  | unset (native default 0.8)            |
| Retained tail            | `policy.retainRatio` or `retainTokens`   | unset (native default 0.16)           |
| Frame size               | `rendering.width` and `rendering.height` | 1568                                  |
| Maximum frames           | `rendering.maxFrames`                    | 20 (max 64)                           |
| Archive limit            | `archiveMaxBytes`                        | 64 MiB                                |
| Handoff budget           | `handoffMaxTokens`                       | 4096                                  |
| Externalize above        | `shakeThresholdChars`                    | 8192                                  |

Persistence and precedence:

- Writes go through DSH's settings service to the profile's configuration patch; they survive restarts and are removed by "Restore default" (per field or for the whole card).
- A saved card value overrides the same key in preset YAML. `thresholdRatio` is the exception: until the custom threshold is enabled the key is absent, so a preset-level `policy.thresholdRatio` still applies.
- The retained tail is one three-state control (inherit 0.16 / ratio / absolute tokens). `retainRatio` and `retainTokens` are mutually exclusive: saving one removes the other from the merged row, and the strict parser rejects YAML that sets both.
- The engine is constructed when a session mounts the preset, so changes take effect for **new sessions**; `/snapcompact status` in an existing session keeps reporting its starting configuration.
- The settings schema cannot express chain ordering, so a stored chain that is empty, repeated, or does not end in `soft` is ignored by the plugin; the strict parser remains the final gate.

The bundle also declares a profile-plane carrier row (`snapcompact-ui`, module `dsh-snapcompact`) whose config is `role: ui`. DSH's browser module scanner only reads `dsh.client` from Loader entries named by a bare package specifier, so this row exists to make the card loadable; it registers no compaction, tools or commands. Keep it enabled: disabling it removes the settings card from the plugin page (the preset keeps working).

Everything outside those nine keys stays YAML-only: the rest of `policy`, `guard`, `serialization`, `routePolicies`, `rendering.maxTotalBytes`, `rendering.maxSourceBytes`, `rendering.timeoutMs`, `rendering.lineHeight` and `rendering.minGlyphPx`.

## Native policy

`policy` is validated by `BasicCompactionEngine`. It supports thresholdRatio, headroomTokens, retainRatio/retainTokens (mutually exclusive), summarizationProvider/summarizationModel (a pair), maxTokens, compactionRetries, maxOverflowRetries, auto and modelPolicies. An empty object uses native defaults.

Do not copy 65,536-token headroom to a small-window model without adjustment. The native backend validates capacity, output reservation and retained-tail budgets. The plugin additionally validates the gap between the threshold and the retained tail at mount time (see [retained tail and guards](#retained-tail-and-usefulness-guards)).

## Method chains and fallback order

`methodOrder` is the ordered priority list of candidate methods. The engine tries each in turn and stops at the **first successful candidate**; the order is the fallback order, not a pipeline of stages. The chain must be nonempty, unique, and end in `soft`. Any subset with that shape is valid:

| Preset                 | `methodOrder`                         | Behavior                                                      |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Visual-first (default) | `[snapcompact, handoff, shake, soft]` | Local visuals, then handoff, excerpts, native summary         |
| Visual + native        | `[snapcompact, soft]`                 | Skip handoff/shake; native summary when visuals fail          |
| Local-first            | `[snapcompact, shake, soft]`          | Both local paths first; native summary only if they both fail |
| Text-first             | `[handoff, shake, soft]`              | One model call for a structured handoff first                 |
| Native-only            | `[soft]`                              | Back to the DSH native summary; archive and recall remain     |

Semantics that are easy to miss:

- `shake` succeeds whenever any tool output exceeds `shakeThresholdChars`, so placing it before `snapcompact` preempts the visual path.
- The checkpoint budget (half of the room under the trigger) only constrains `snapcompact`; every other method only has to produce a checkpoint smaller than the source.
- The archive is created before the chain runs, so a `[soft]` chain still keeps `snapcompact_recall` available.
- Cancellation aborts the transaction; it never falls through to the next method.

## Trigger threshold

Automatic compaction starts when measured request pressure reaches the routed model's threshold:

```text
threshold = floor(min(W × thresholdRatio, W − O − headroomTokens))
retain    = retainTokens ?? floor((W − O) × retainRatio)
```

`W` is the adapter-declared context window, `O` the effective output reservation, and `headroomTokens` a capacity safety margin. `thresholdRatio` is a window fraction, not an absolute token count; small-window models usually need both a lower ratio and smaller headroom. `retainRatio`/`retainTokens` must stay below the threshold, or the native backend rejects that route.

`/snapcompact status` resolves the exact route and prints current tokens, `W`, threshold tokens, retained tokens, the compactable space between them, the guard floors and whether pressure has crossed. That display mirrors the formula above for explanation only; the native engine remains the authority. Thresholds are configuration-time settings (reload required), and they never disable the host's overflow recovery. There is no absolute token-count trigger; use `thresholdRatio` and inspect the effective token number with `/snapcompact status`.

### Retained tail and usefulness guards

The trigger only means something relative to the retained tail:

```text
compactable = threshold - retain
```

At a 1M-token window the native `retainRatio: 0.16` reserves about 158,720 tokens, so `thresholdRatio: 0.2` leaves only about 4% of the window (roughly 41K tokens). A checkpoint plus the retained text can easily cost more than that, which is why "20% occupied" can round to "19% occupied" after a full compaction. The native backend only rejects `retainRatio >= thresholdRatio`; it cannot know the gap is too small to pay for itself.

`guard` adds the missing checks:

| Key                   | Default | Meaning                                                                                               |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `minCompactableRatio` | `0.1`   | Reject the mount when `thresholdRatio - retainRatio` is below this. `0` disables the check.           |
| `minSourceRatio`      | `0.01`  | Skip one compaction whose source is below `max(1024, window × ratio)` tokens. `0` disables the check. |

The mount check runs in the engine constructor after native defaults are resolved, so it covers the global policy and every exact `modelPolicies` entry (using the same inheritance rules). The error lists every infeasible scope with the actual fractions and the fix. The absolute `retainTokens` form is window-dependent, so it is not rejected at mount time; `/snapcompact status` prints the real compactable space and warns when it is below `max(1024, window × minCompactableRatio)`.

The source floor runs after the source history is measured and before the archive or any method: a too-small source fails immediately, without a model call. Manual `/compact` is subject to the same guard; lower `guard.minSourceRatio` to allow a small manual run.

Upgrading a profile that combines `thresholdRatio: 0.2` with the default tail therefore fails at mount. Fix it by raising the threshold (the card floor is `0.5`; the host default is `0.8`), lowering the tail (`retainRatio: 0.03` leaves about 30K at a 1M window), or explicitly setting `guard.minCompactableRatio: 0`.

### Checkpoint budget

`snapcompact` may spend at most half of the room left under that threshold:

```text
fixed  = max(0, surface - source)
room   = threshold - fixed
budget = floor(min(room, source) / 2)    # no declared window: floor(source / 2)
```

`surface` is the whole request pressure before compaction and `source` the history the checkpoint replaces; both come from the token meter the native engine re-measures after committing. Everything a checkpoint cannot replace — system prompt, tool schemas, output reservation, retained tail — stays in `fixed`.

Spending half of the room keeps the post-compaction total below the threshold with an equal share of headroom, which is the condition the native engine re-checks before it accepts a checkpoint. When automatic pressure fires, `room ≈ source`, so this matches the older "half of the source" rule and only tightens by the amount the session overshot its trigger. It also stays correct for a manual `/compact` below the threshold, where the room is larger than the source and the source stays the binding half. A route without a declared context window, or a failed model lookup, falls back to `floor(source / 2)`; `room ≤ 0` skips the visual path because no frame can bring the session back under the threshold.

The budget is recomputed per compaction from the live route, so it follows `thresholdRatio`, `headroomTokens` and per-model overrides without another setting. Older rows may still carry `minCompressionRatio`; it is accepted for upgrade compatibility and ignored.

## Visual eligibility

A route must explicitly declare image input and supply image pricing, a configured ceiling, or the labelled DeepSeek estimate. Saved/request images must retain readable bitmap dimensions; otherwise the visual method is skipped. Frames, bytes and pixels must fit the host policy, and the complete checkpoint must fit the trigger-relative budget below.

When an adapter has no pricing, DeepSeek model IDs use a labelled 1024-token/frame estimate. Other models can use an explicit conservative route ceiling:

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # Example only, NOT a recommended price. Calibrate for the actual model and frame size.
```

Provider/model matching is exact, with no aliases, fuzzy matching or cross-model reuse. A ceiling is not actual usage and cannot grant missing image modality. Recalibrate after changing dimensions.

## Bounds and failure

Defaults use 1568×1568 frames (1568 is omp's standard frame edge) and 20 frames per checkpoint, with a configurable maximum of 64; the host's per-message image cap (20 by default) still clamps the effective count, so raise both to use more. At most 16 MiB of generated images, 64 MiB of source/archive data and a 15-second render deadline. The frame count is chosen dynamically under the trigger-relative checkpoint budget; the host's smaller limits and retained-image count also apply. Archive JSON includes formatting and duplicated transcript data, so a source near its own limit can exceed the archive limit and be rejected.

Unknown pricing, visual failures or insufficient savings select another method. When every candidate fails, native failure logging preserves the selected history. Cancellation never falls through. A threshold/retention pair below the compactable floor refuses to mount, and a source below the earnings floor fails before the archive or any method runs.

Snapcompact declares `^0.2.2-rc.1` (0.2.x) and is verified on `0.2.2-rc.1`. Raise the floor only after an install and activation check on that host release, and keep a finite ceiling: validate types, native integration, package contents and live preset activation before widening it. Do not bypass the host check.
