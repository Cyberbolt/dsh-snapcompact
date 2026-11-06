# Configuration

[简体中文](zh/configuration.md)

Configure the **dsh-snapcompact row inside the Snapcompact preset's isolated compaction group**, not a second global compaction service. Use DSH's preset/config editor rather than modifying the active profile files manually.

```yaml
methodOrder: [snapcompact, handoff, shake, soft]
policy:
  auto: true
  thresholdRatio: 0.8
  retainRatio: 0.16
  # Smaller windows need less headroom; native capacity validation still applies.
  headroomTokens: 65536
rendering:
  width: 1536
  height: 1024
  maxFrames: 12
  maxTotalBytes: 16777216
  maxSourceBytes: 67108864
  timeoutMs: 15000
minCompressionRatio: 2
archiveMaxBytes: 67108864
handoffMaxTokens: 4096
shakeThresholdChars: 8192
routePolicies: []
```

## Native policy

`policy` is validated by `BasicCompactionEngine`. It supports thresholdRatio, headroomTokens, retainRatio/retainTokens (mutually exclusive), summarizationProvider/summarizationModel (a pair), maxTokens, compactionRetries, maxOverflowRetries, auto and modelPolicies. An empty object uses native defaults.

Do not copy 65,536-token headroom to a small-window model without adjustment. The native backend validates capacity, output reservation and retained-tail budgets.

## Visual eligibility

A route must explicitly declare image input and supply image pricing, or have an exact configured ceiling. Saved/request images must retain readable bitmap dimensions. Frames, bytes and pixels must fit the host policy. The complete checkpoint must meet `minCompressionRatio` estimated reduction.

When an adapter has no pricing, an explicit conservative route ceiling is possible:

```yaml
routePolicies:
  - provider: your-provider
    model: exact-model-id
    visualTokensPerFrame: 4096 # Example only, NOT a recommended price. Calibrate for the actual model and frame size.
```

Provider/model matching is exact, with no aliases, fuzzy matching or cross-model reuse. A ceiling is not actual usage and cannot grant missing image modality. Recalibrate after changing dimensions.

## Bounds and failure

Defaults are 12 frames, with a maximum of 20; at most 16 MiB of generated images, 64 MiB of source/archive data and a 15-second render deadline. The host's smaller limits and retained-image count also apply. Archive JSON includes formatting and duplicated transcript data, so a source near its own limit can exceed the archive limit and be rejected.

The method chain must be nonempty, unique and end in soft. Unknown pricing, visual failures or insufficient savings select another method. When every candidate fails, native failure logging preserves the selected history. Cancellation never falls through.

Only DSH `0.2.2-rc.1` is currently declared compatible. Validate types, native integration, package contents and live preset activation before widening this range; do not bypass version checks.
