# Contributing

[简体中文](zh/contributing.md)

Snapcompact is a DSH plugin: it hands one compaction candidate to the host's native transaction and never replaces that transaction. Development needs Node.js 24+ and pnpm 11.

## Setup

```sh
pnpm install --ignore-scripts
```

The package has no install scripts. DSH packages are host-provided peers, so the development install supplies local types and the integration-test modules only.

## Checks

```sh
pnpm run check          # build, types, lint, formatting, preset, tests, package resources
pnpm run test           # unit and native-integration tests only
pnpm run check:install  # install the packed tarball into a throwaway DSH profile
pnpm run release:plan   # preview whether the current version would publish
pnpm pack
```

`check:install` never touches real profiles and keeps its temporary home under `.artifacts/`, so `--keep` leaves it behind for debugging. `pnpm run check` is what CI runs.

## Evaluation

The suite is `scripts/benchmark-v5.ts`. Dev fixtures are generated from a committed seed; the test split is generated under `.artifacts/` and is not committed. The in-session `/snapcompact benchmark [1-5]` command runs the dev split only and spends model requests and money. See [evaluation.md](evaluation.md) and the [pre-registration](evaluation-v5-prereg.md).

## Releasing

`scripts/check-package.ts` asserts that both READMEs mention `dsh-snapcompact@<current version>`; bump that one line in `README.md` and `README.zh.md` when preparing a stable release. The DSH compatibility range has a single source, `scripts/compat.ts`: the READMEs name `DSH_SUPPORT_LINE`, `docs/configuration.md` carries `DSH_COMPAT_RANGE`, and a bare copy of `DSH_BASELINE_VERSION` in any of the four asserted documents fails the check, so a DSH patch release never requires a documentation edit. Documentation is written in English with a Chinese version kept beside it (`README.md` / `README.zh.md`, `docs/` / `docs/zh/`).

Run `pnpm run format` before sending a change.
