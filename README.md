# omp-cache-monitor

English | [Русский](docs/README.ru.md)

OMP extension: prefix-cache hit rate in the status line, miss warnings, and the
`/cache-monitor` command (`history` shows the last 8 turns).

It changes nothing in settings or requests: it reads the completed turn usage
(`turn_end.message.usage`) and the session journal
(`sessionManager.getEntries()`), then publishes a status. An error inside the
handler never breaks the turn.

## What it shows

Status line (TUI only), key `cache-monitor`:

```
cache-safe ↺ 98%
```

The mode comes from `OMP_MODE` (set by `omp-mode`); without a mode it is
`↺ 98%`, before the first turn `↺ …`, and with a zero denominator `↺ n/a`
(no `%`).

`/cache-monitor` prints one line with the mode, model, thinking level, last
turn with `saved` and `miss premium`, the trend, and session totals:

```
режим: cache-safe · test/model-a · thinking high · ход: ↺ 25% · in 3000 · cacheRead 1000 · cacheWrite 0 · $0.0200 · saved $0.0027 · miss premium: $0.0081 (3000 tok) · тренд: ▁▃ · сессия: $0.0700, ходов 2, ↺ 11.1%, saved $0.0027, miss premium $0.0081 (3000 tok)
```

| Field | Meaning |
|---|---|
| _(labels)_ | Command output stays Russian (`режим`, `ход`, `сессия`, `тренд`); the table explains each field |
| `режим` | `OMP_MODE`; `без пресета` means a bare `omp` launch |
| model, `thinking` | active model and live level (`/effort`); when `undefined`, the configured value; `?` means unknown |
| `ход: ↺ / in / cacheRead / cacheWrite / $ / saved` | last request: hit, new input, cache read, cache write, cost, and `saved $X` — cache-read savings versus the full input price; printed only when positive (`cacheRead > 0`, known prices, positive `input − cacheRead` delta) |
| `miss premium: $X (N tok)` | re-billed tokens after a miss: `N` tokens paid at the full price; money only when the model has numeric `cost.input` and `cost.cacheRead`, otherwise `miss premium: N tok`; printed only when `N > 0` |
| `тренд: ▁…█` | last 12 hits: `▁` = 0%, `█` = 100%, `·` = hit undefined (zero denominator) |
| `сессия: $ / ходов / ↺ / saved / miss premium` | session cost, turn count, hit, savings, and re-billed tokens; `saved $X` when the sum is known in full, `saved ≥$X` when it is only a lower bound (e.g. after resume); `miss premium $X (N tok)` only when `N > 0`, `≥$X` when some turns have no model prices |

Before the first turn the field reads `ход: нет данных`. With a zero
denominator hit is `↺ n/a`, without `%`. `/new` resets the trend and totals;
resume/reload/fork restore them from the journal on `session_start`. `/clear`
and tree navigation keep the totals.

## Turn history

`/cache-monitor history` (alias `/cache-monitor hist`) prints the last 8
completed turns as a separate notification, oldest first:

```
история (3/8):
1. ↺ 98% · prompt 5261 · saved $0.0139
2. ↺ 0% · prompt 4600 · miss premium $0.0124 (4600 tok) · перезапись префикса
3. ↺ 50% · prompt 4200 · saved $0.0057 · miss premium $0.0057 (2100 tok)
```

- `hit` and `prompt` as in the rest of the report; `saved` is printed only when
  `cacheRead > 0`: `saved $X` with known prices, `saved ?` when the model price
  is unknown after resume.
- `miss premium` is printed only when `reBilled > 0`: `$X (N tok)`, or
  `? (N tok)` without a price.
- The cause (`простой N мин` / `перезапись префикса`) is attached only to a
  canonical miss; the first turn of an epoch never gets one.
- The window is 8 turns; older ones fall off. No data prints
  `история: нет данных`.

`/new` clears the history; resume/fork restores it from the journal (last 8
assistant messages); `/clear` and tree navigation keep it. The last restored
record never shows `miss premium`: the resume boundary is not journaled, so the
comparison with the previous prefix is not proven.

`/cache-monitor` without an argument prints the previous report; history is not
added to it.

## Resume, compaction, and cache warming

On `session_start` (startup, resume, reload, fork) the extension reads
`ctx.sessionManager.getEntries()` and restores totals from assistant messages,
the last 12 trend hits, the last 8 turns of history, the last turn, and
re-billed tokens. Journaled epoch boundaries (`model_change`,
`thinking_level_change`, `compaction`, `branch_summary`) prevent comparing
turns across a prefix change.

`usage` entries (any `kind`) and `model_usage` (OMP 19.1: cache warming,
title/composer and other off-transcript calls), plus `compaction.usage` and
`branch_summary.usage`, add to session cost but not to hit tokens, turns, or
trend: that is background work, not dialog requests. Before printing,
`/cache-monitor` recomputes cost from the journal, so cache warming and
compaction are counted even without a live event.

The first turn after resume is a new epoch: it is not compared with the previous
prefix and does not warn. `/new` still resets the totals.

Model prices are not stored in the journal. `saved` for restored cache tokens is
not estimated: it grows only from live turns, and if the journal had
`cacheRead > 0` the session sum is marked `≥` (`saved ≥$X`). Re-billed tokens
are restored after resume, but their money is not invented either: `miss
premium` is printed in tokens, and a partially known sum keeps the `≥` marker.
The last turn's re-bill before resume is conservatively not restored: the resume
boundary is not journaled, so the comparison with the previous prefix is not
proven. Earlier resume boundaries are not marked either, so re-billing between
such turns can remain approximate.

## Formula

```
hit = cacheRead / (input + cacheRead + cacheWrite)
```

`cacheWrite` is in the denominator: writing to the cache is billed too. A zero
denominator means hit is undefined — `n/a`.

## Saved and miss premium

Both metrics are per token; prices are `$/1M` from `model.cost`:

```
saved        = cacheRead × (inputPrice − cacheReadPrice)
miss premium = reBilled  × (inputPrice − cacheReadPrice)
reBilled     = max(0, min(prevPrompt, prompt) − cacheRead)
```

`inputPrice − cacheReadPrice` is the difference between the full new-input
price and the cache-read price, clamped at zero. `saved` is what cache reads
saved versus the full price; `miss premium` is what re-billed tokens cost at the
full price after a miss. If the model has no numeric `cost.input` and
`cost.cacheRead`, `saved` is omitted and `miss premium` stays in tokens. After
resume historical prices are unknown, so `saved` counts only the live part and
shows `≥`.

## Warnings

Comparison is epoch-aware: the baseline resets on compaction, model change,
thinking change, or tool-set change, so a legitimately cold turn after such an
event is not treated as a mid-session miss.

1. **Canonical miss** — the previous turn's prompt was ≥ 2048 tokens, while the
   current turn has `cacheRead = 0` and `cacheWrite > 0`: the prefix was fully
   rewritten or the cache expired. The cause is computed per turn:
   `простой N мин` when consecutive completed turns are ≥ 5 minutes apart by
   `message.timestamp`, otherwise `перезапись префикса`. The 5-minute threshold
   is an empirical heuristic, **not** a provider-declared TTL: `cline-pass`
   does not declare a lifetime. Idle time across an epoch boundary (model,
   thinking, or tool-set change, compaction, resume) is not attributed to the
   new prefix; without a timestamp the cause is `перезапись префикса`, and a
   turn without a timestamp breaks the idle chain for the next turn.
2. **Low hit** — below 50% on a turn other than the first (the first turn is
   cold by definition).

A warning is a signal to check what changed 1–2 turns before it, not an error
by itself.

## Installation

The npm package is not published. OMP 19.1.0:

```bash
# from GitHub (private repository: authentication required)
omp plugin install github:metapeka/omp-cache-monitor

# local checkout: loaded from the directory, no copying
omp plugin link /path/to/omp-cache-monitor

# equivalent (alias of plugin link)
omp install /path/to/omp-cache-monitor
```

Alternative — copy the single extension file:

```bash
cp /path/to/omp-cache-monitor/index.ts ~/.omp/agent/extensions/cache-monitor.ts
```

Install in exactly one way: `omp plugin link` **or** a copied file. Doing both
loads the extension twice. Restart `omp` after installation.

### Status-line segment

The `status` segment places the hook status into the shared status line.
Without it, with `statusLine.showHookStatus: true` (the default) the status is
still shown, but as a separate element. In `~/.omp/agent/config.yml`:

```yaml
statusLine:
  preset: custom
  leftSegments: ["vim", "model", "mode", "path", "git", "pr"]
  rightSegments: ["session_name", "token_total", "cost", "context_pct", "status"]
```

## Compatibility and name conflicts

- OMP 19.1.0; verified on the `cline-pass` route.
- The command is `/cache-monitor` because `/cache` is already taken by
  `ubranch/omp-cache-control`. Both extensions can stay enabled: they register
  different commands and different status keys.
- The status is published only in the TUI; in `--mode json`/`--print` UI calls
  are harmless and display nothing.

## Related documents

- Cheat sheet for modes, `/cache-monitor`, and diagnostics:
  https://metapeka.github.io/docs-omp-debian-availability/wiki/guide.html
- `cache-safe`/`quality`/`throughput` presets, the `omp-mode` wrapper, and the
  decision history — https://github.com/metapeka/docs-omp-debian-availability
  (`presets/`, `docs/plan-cache-modes.md`).

## License

MIT, see `LICENSE`.
