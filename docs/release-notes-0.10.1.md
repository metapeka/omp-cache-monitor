# omp-cache-monitor v0.10.1

Read-only prefix-cache visibility for OMP: hit rate, miss causes, costs, and
8-turn history — without warming the cache, rewriting prompts, or spending an
extra token.

This release bundles the 0.10.0 presets work and the 0.10.1 onboarding/docs
work; v0.10.0 was not tagged separately.

## Highlights

- **15 settings, 4 presets.** `preset` = `balanced` / `quiet` / `verbose` /
  `custom`; `statusShowCost`, `warnCanonicalMiss`, `minPrevPromptTokens`,
  `oncePerEpoch`, `trendSize` and the rest of the advanced keys.
- **Mode-aware status.** `cache-safe ↺ 98%` from `OMP_MODE`; optional
  `cache-monitor-cost` segment.
- **Epoch-aware warnings.** Canonical miss and low hit, once per prefix epoch,
  with a named cause: `простой N мин` / `idle N min` or `перезапись префикса` /
  `prefix rewrite`.
- **One command.** `/cache-monitor`, `history`, `costs`, `settings`, `help`;
  report combines mode, model, thinking, last turn, session, trend, `saved`
  and `miss premium`.
- **Honest resume.** Totals, trend and history restore from the journal;
  historical prices are not invented (`≥` / `?`).
- **Onboarding.** The first canonical miss adds a one-time hint about
  `/cache-monitor settings` and `preset`.
- **Three-language docs.** English (main), Simplified Chinese, Russian, with
  screenshots, a demo GIF, Mermaid diagrams and a competitor comparison.
- **Zero runtime dependencies.** One `index.ts`, 85 tests, CI, `npm pack` = 4
  files.

## Install

```bash
# public GitHub shorthand
omp plugin install github:metapeka/omp-cache-monitor

# or HTTPS git
omp plugin install git+https://github.com/metapeka/omp-cache-monitor.git

# or from a local checkout
omp plugin link /path/to/omp-cache-monitor
```

Then restart `omp` and try `/cache-monitor`, `/cache-monitor history`,
`/cache-monitor costs`, `/cache-monitor settings`.

## Documentation

- [English README](https://github.com/metapeka/omp-cache-monitor/blob/main/README.md)
- [中文 README](https://github.com/metapeka/omp-cache-monitor/blob/main/docs/README.zh.md)
- [Русский README](https://github.com/metapeka/omp-cache-monitor/blob/main/docs/README.ru.md)
- [Settings and OMP UI limits](https://github.com/metapeka/omp-cache-monitor/blob/main/docs/ui-settings.md)
- [Competitor research](https://github.com/metapeka/omp-cache-monitor/blob/main/docs/research/cache-extensions.md)

## Why it is different

The individual metrics exist elsewhere. This plugin combines a read-only
observer with `OMP_MODE`-aware status, one command that covers report/history/
costs/settings, epoch-aware warnings with a cause, resume without invented
prices, 15-key presets, and a zero-dependency single file. It deliberately does
not do TTL countdowns, warming, prompt optimization or dashboards.

Upstream proposal for grouped plugin settings: can1357/oh-my-pi#20253.

## Verification

- `npm test` — 85/85
- `npm run typecheck` — clean
- `npm pack` — 4 files (`index.ts`, `README.md`, `LICENSE`, `package.json`)
- `omp plugin list` — `omp-cache-monitor@0.10.1`
- Runtime load check — exit 0, empty stderr

**Asset:** `omp-cache-monitor-0.10.1.tgz`
