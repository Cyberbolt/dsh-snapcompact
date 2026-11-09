# Configuration

[简体中文](zh/configuration.md)

Configure the **dsh-snapcompact row inside the Snapcompact preset's isolated compaction group**, not a second global compaction service. The settings card on the plugin page manages the common keys; the preset/config editor and the YAML below cover the rest. Both persist through the active profile's configuration patch; do not rewrite profile files by hand.

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
policy:
  auto: true
  thresholdRatio: 0.8
  retainRatio: 0.16
  # Smaller windows need less headroom; native capacity validation still applies.
  headroomTokens: 65536
rendering:
  width: 2048
  height: 2048
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
minCompressionRatio: 2
archiveMaxBytes: 67108864
handoffMaxTokens: 4096
shakeThresholdChars: 8192
routePolicies: []
```

## In-app settings

The **Plugins → Snapcompact** page renders a settings card for the current profile's `snapcompact-settings` row. The row is separate from the preset on purpose: DSH only projects volatile Config fields of profile-plane entries into its settings document, while the compaction plugin must stay inside the opt-in preset. The row publishes the live values as the `snapcompactSettings` service; each session's preset instance reads them while it mounts.

The card manages eight keys:

| Control                   | Config path                              | Default                               |
| ------------------------- | ---------------------------------------- | ------------------------------------- |
| Method chain              | `methodOrder`                            | `[snapcompact, handoff, shake, soft]` |
| Custom trigger threshold  | `policy.thresholdRatio`                  | unset (native default 0.8)            |
| Frame size                | `rendering.width` and `rendering.height` | 2048                                  |
| Maximum frames            | `rendering.maxFrames`                    | 20                                    |
| Minimum compression ratio | `minCompressionRatio`                    | 2                                     |
| Archive limit             | `archiveMaxBytes`                        | 64 MiB                                |
| Handoff budget            | `handoffMaxTokens`                       | 4096                                  |
| Externalize above         | `shakeThresholdChars`                    | 8192                                  |

Persistence and precedence:

- Writes go through DSH's settings service to the profile's configuration patch; they survive restarts and are removed by "Restore default" (per field or for the whole card).
- A saved card value overrides the same key in preset YAML. `thresholdRatio` is the exception: until the custom threshold is enabled the key is absent, so a preset-level `policy.thresholdRatio` still applies.
- The engine is constructed when a session mounts the preset, so changes take effect for **new sessions**; `/snapcompact status` in an existing session keeps reporting its starting configuration.
- The settings schema cannot express chain ordering, so a stored chain that is empty, repeated, or does not end in `soft` is ignored by the plugin; the strict parser remains the final gate.

The bundle also declares a profile-plane carrier row (`snapcompact-ui`, module `dsh-snapcompact`) whose config is `role: ui`. DSH's browser module scanner only reads `dsh.client` from Loader entries named by a bare package specifier, so this row exists to make the card loadable; it registers no compaction, tools or commands. Keep it enabled: disabling it removes the settings card from the plugin page (the preset keeps working).

Everything outside the eight keys stays YAML-only: the rest of `policy`, `serialization`, `routePolicies`, `rendering.maxTotalBytes`, `rendering.maxSourceBytes`, `rendering.timeoutMs`, `rendering.lineHeight` and `rendering.minGlyphPx`.

## Native policy

`policy` is validated by `BasicCompactionEngine`. It supports thresholdRatio, headroomTokens, retainRatio/retainTokens (mutually exclusive), summarizationProvider/summarizationModel (a pair), maxTokens, compactionRetries, maxOverflowRetries, auto and modelPolicies. An empty object uses native defaults.

Do not copy 65,536-token headroom to a small-window model without adjustment. The native backend validates capacity, output reservation and retained-tail budgets.

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
- `minCompressionRatio` only constrains `snapcompact`; every other method only has to produce a checkpoint smaller than the source.
- The archive is created before the chain runs, so a `[soft]` chain still keeps `snapcompact_recall` available.
- Cancellation aborts the transaction; it never falls through to the next method.

## Trigger threshold

Automatic compaction starts when measured request pressure reaches the routed model's threshold:

```text
threshold = floor(min(W × thresholdRatio, W − O − headroomTokens))
retain    = retainTokens ?? floor((W − O) × retainRatio)
```

`W` is the adapter-declared context window, `O` the effective output reservation, and `headroomTokens` a capacity safety margin. `thresholdRatio` is a window fraction, not an absolute token count; small-window models usually need both a lower ratio and smaller headroom. `retainRatio`/`retainTokens` must stay below the threshold, or the native backend rejects that route.

`/snapcompact status` resolves the exact route and prints current tokens, `W`, threshold tokens, retained tokens and whether pressure has crossed. That display mirrors the formula above for explanation only; the native engine remains the authority. Thresholds are configuration-time settings (reload required), and they never disable the host's overflow recovery. There is no absolute token-count trigger; use `thresholdRatio` and inspect the effective token number with `/snapcompact status`.

## Visual eligibility

A route must explicitly declare image input and supply image pricing, a configured ceiling, or the labelled DeepSeek estimate. Saved/request images must retain readable bitmap dimensions; otherwise the visual method is skipped. Frames, bytes and pixels must fit the host policy, and the complete checkpoint must meet `minCompressionRatio` estimated reduction.

When an adapter has no pricing, DeepSeek model IDs use a labelled 1024-token/frame estimate. Other models can use an explicit conservative route ceiling:

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # Example only, NOT a recommended price. Calibrate for the actual model and frame size.
```

Provider/model matching is exact, with no aliases, fuzzy matching or cross-model reuse. A ceiling is not actual usage and cannot grant missing image modality. Recalibrate after changing dimensions.

## Bounds and failure

Defaults use 2048×2048 frames, with a maximum of 20 (the host's default image-count cap); at most 16 MiB of generated images, 64 MiB of source/archive data and a 15-second render deadline. The frame count is chosen dynamically under `minCompressionRatio`; the host's smaller limits and retained-image count also apply. Archive JSON includes formatting and duplicated transcript data, so a source near its own limit can exceed the archive limit and be rejected.

Unknown pricing, visual failures or insufficient savings select another method. When every candidate fails, native failure logging preserves the selected history. Cancellation never falls through.

Only DSH `0.2.2-rc.1` is currently declared compatible. Validate types, native integration, package contents and live preset activation before widening this range; do not bypass version checks.
