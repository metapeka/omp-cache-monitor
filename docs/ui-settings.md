# Настройки и справка (UI settings)

Настройки позволяют менять поведение `omp-cache-monitor` без правки кода:
выключить статус или предупреждения, поменять пороги, окно истории и показ
денег. Плагин остаётся read-only: настройки только читаются.

Схема объявлена в `package.json` → `omp.settings`; OMP показывает её в
**Settings → Plugins → omp-cache-monitor** и в CLI:

```bash
omp plugin config list omp-cache-monitor
omp plugin config set omp-cache-monitor lowHitPercent 30
omp plugin config set omp-cache-monitor statusEnabled false
```

Значения читаются на `session_start` (и при старте новой сессии через
`/new`), поэтому применяются к **новой сессии**. Команда
`/cache-monitor settings` перечитывает их сразу и показывает, что реально
пришло из настроек.

## Ключи

| Ключ | Default | Диапазон | Что меняет |
|---|---|---|---|
| `statusEnabled` | `true` | boolean | Показывать hit rate в статус-строке. `false` — `setStatus` не вызывается; старый статус не чистится. |
| `statusShowMode` | `true` | boolean | Префикс `OMP_MODE` у статуса (`cache-safe ↺ 75%`). `false` — только `↺ 75%`. |
| `warningsEnabled` | `true` | boolean | Предупреждения о каноническом промахе и низком hit. `false` — ни одного warning. |
| `lowHitPercent` | `50` | 1–100, шаг 1 | Порог «низкого hit»: warning, когда `hit < N%`. |
| `idleMinutes` | `5` | 1–240, шаг 1 | Разрыв между ходами, который причина промаха называет простоем (`простой N мин`). Эмпирическая эвристика, **не** TTL провайдера. |
| `minPromptTokens` | `4000` | 0–1 000 000, шаг 500 | Не предупреждать на промптах меньше N токенов; тот же порог уходит в причину промаха и в restore. |
| `historySize` | `8` | 1–50, шаг 1 | Окно `/cache-monitor history` (live и после resume) и делитель в заголовке `история (N/M):`. |
| `showMoney` | `true` | boolean | `saved` и деньги `miss premium` в отчёте и history. `false` — остаются токены (`miss premium: 3000 tok` / `miss premium 3000 tok`); `/cache-monitor costs` всегда показывает деньги. |

Некорректные значения (не bool, не число, `NaN`/`Infinity`) заменяются
default. Числа округляются и зажимаются в диапазон: например,
`lowHitPercent: 500` → `100`, `idleMinutes: 0` → `1`, `historySize: 3.6` → `4`.

## Команды

### `/cache-monitor settings` (алиас `setting`)

Печатает текущие значения одной notification:

```
настройки cache-monitor:
statusEnabled: true (default)
statusShowMode: true (default)
warningsEnabled: true (default)
lowHitPercent: 50 (default)
idleMinutes: 5 (default)
minPromptTokens: 4000 (default)
historySize: 8 (default)
showMoney: true (default)
цены модели: да
изменить: omp plugin config set omp-cache-monitor <key> <value>
```

- `(changed)` — ключ реально пришёл из настроек (даже если значение потом
  нормализовано); `(default)` — ключа нет, действует default.
- `цены модели: да|нет` — есть ли у текущей модели числовые `cost.input` и
  `cost.cacheRead` (от них зависят `saved` и деньги `miss premium`).
- Команда перечитывает настройки: следующие ходы текущей сессии используют
  новые значения для warnings и статуса.

### `/cache-monitor help` (алиас `?`)

Короткая справка: что означает `↺`, список подкоманд (`отчёт`, `history`,
`costs`, `settings`, `help`), пути к настройкам и ссылка на README. Без
обещаний TTL: на `cline-pass` провайдер lifetime не декларирует.

## Чтение в runtime

- Источник — `getPluginSettings(pluginName, cwd)` из
  `@oh-my-pi/pi-coding-agent/extensibility/plugins/loader`: OMP мержит
  глобальные настройки и проектные overrides.
- Импорт динамический, как и у реестра `defaultThinkingLevel`: внутренний
  subpath может переехать, и расширение не должно из-за этого не загрузиться.
- Любая ошибка или недоступность API — `{}`, то есть defaults. Поведение без
  настроек побайтово совпадает с версией до 0.8.0.
- `normalizeConfig(raw)` дополнительно защищает от чужих форм: только bool
  для bool, finite-числа с rounding/clamp, иначе default.

## Phase 2: язык

Следующий ключ — `language` (`enum: ru | en`, default `ru`): язык отчёта,
history, `settings` и `help`. Пока не реализовано; вывод остаётся русским.

## Phase 3: advanced

Кандидаты, которые не нужны для Phase 1 и добавляются только с тестами:

| Ключ | Смысл |
|---|---|
| `warnCanonicalMiss` | Отдельно выключать канонический промах, оставляя low hit. |
| `minPrevPromptTokens` | Заменить константу `MIN_PREV_PROMPT = 2048` порогом предыдущего промпта. |
| `oncePerEpoch` | Предупреждать один раз за эпоху или каждый подходящий ход. |
| `trendSize` | Длина спарклайна (сейчас константа 12). |
| `statusShowCost` | Добавить стоимость в статус-строку рядом с `↺`. |

## Риски

- `getPluginSettings` — внутренний API OMP, не публичный контракт. Он может
  измениться между версиями; поэтому импорт динамический, а ошибка даёт
  defaults, а не падение расширения.
- Значения применяются к новой сессии; уже открытая сессия не меняет
  настройки сама, кроме перечитывания командой `settings`.
- Настройки read-only для плагина: он ничего не пишет в конфиг OMP и не
  меняет запросы.
- Схема в `package.json` не добавляет файлов в tarball: `npm pack` по-прежнему
  отдаёт 4 файла.
