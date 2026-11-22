# Настройки и справка (UI settings)

Статус: **Phase 1 (0.8.0), Phase 1.5 (0.8.1) и Phase 2 (0.9.0)
реализованы**; Phase 3–4 — запланированы в разделе «Роудмап фаз».

Настройки позволяют менять поведение `omp-cache-monitor` без правки кода:
выключить статус или предупреждения, поменять пороги, окно истории, показ
денег и язык вывода. Плагин остаётся read-only: настройки только читаются.

Схема объявлена в `package.json` → `omp.settings`; OMP показывает её в
**Settings → Plugins → omp-cache-monitor** и в CLI:

```bash
omp plugin config list omp-cache-monitor
omp plugin config set omp-cache-monitor lowHitPercent 30
omp plugin config set omp-cache-monitor statusEnabled false
```

Значения читаются на `session_start`/`session_switch` и перед каждой
командой, поэтому изменение из UI применяется со следующего хода после любой
команды `/cache-monitor` (или в новой сессии). Команда
`/cache-monitor settings` перечитывает их сразу и показывает, что реально
пришло из настроек.

## Ограничения UI OMP

- Схема плагинных настроек — **плоский список** `omp.settings`: групп,
  заголовков и иконок в ней нет (они есть только у core settings).
- OMP показывает `description` только **выбранной строки**, в подвале
  Settings → Plugins; длинный текст обрезается по ширине панели.
- Поэтому группы кодируются порядком объявления ключей в `package.json` и
  префиксом в `description` (`Status · …`, `Warnings · …`, `Reports · …`).
  `/cache-monitor settings` повторяет те же группы явными заголовками.
- Upstream-предложение: добавить в схему плагина необязательные `group` и
  `icon`, чтобы OMP рисовал секции без хаков с порядком и текстом.

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
| `language` | `ru` | `ru` / `en` (`enum`) | Язык всех пользовательских строк: отчёт, history (заголовок и причины), costs, `settings`, `help`, warning-и. `ru` — прежний вывод байт-в-байт; `en` — английский. Метрики, токены и формат денег не меняются. Описания `omp.settings` в манифесте всегда английские. |

Некорректные значения (не bool, не число, `NaN`/`Infinity`) заменяются
default. Числа округляются и зажимаются в диапазон: например,
`lowHitPercent: 500` → `100`, `idleMinutes: 0` → `1`, `historySize: 3.6` → `4`.
`language` принимает только `ru`/`en`; любое другое значение (включая число)
откатывается к `ru`.

## Команды

### `/cache-monitor settings` (алиас `setting`)

Печатает текущие значения одной notification:

```
⚙ настройки cache-monitor
⚙ Статус
  statusEnabled: true (default) — ↺ N% в статус-строке
  statusShowMode: true (default) — префикс OMP_MODE
⚠️ Предупреждения
  warningsEnabled: true (default) — toast о промахах
  lowHitPercent: 50 (default) — порог низкого hit
  idleMinutes: 5 (default) — «простой N мин», не TTL
  minPromptTokens: 4000 (default) — не шуметь на мелких промптах
📊 Отчёты
  historySize: 8 (default) — окно /cache-monitor history
  showMoney: true (default) — $ в saved/miss premium
  language: ru (default) — язык вывода
💵 цены модели: да
Изменить: omp plugin config set omp-cache-monitor <key> <value>
```

- Заголовки `Статус`/`Предупреждения`/`Отчёты` — те же группы, что в
  `description` схемы; подпись после `—` статична и не зависит от значения.
  При `language: en` заголовки и подписи английские (`Status`/`Warnings`/
  `Reports`, `output language`), а `(changed)`/`(default)` остаются как есть.
- `language` — девятый ключ, группа `Reports`. Смена языка перерисовывает
  `settings`, `help`, отчёт, costs и сохранённые причины history: причина
  хранится структурно (`{ kind: "idle"; minutes: number }` или
  `{ kind: "rewrite" }`), а текст рендерится на текущем языке.
- `(changed)` — ключ реально пришёл из настроек (даже если значение потом
  нормализовано); `(default)` — ключа нет, действует default.
- `💵 цены модели: да|нет` (EN `model prices: yes|no`) — есть ли у текущей
  модели числовые `cost.input` и `cost.cacheRead` (от них зависят `saved` и
  деньги `miss premium`).
- Команда перечитывает настройки: следующие ходы текущей сессии используют
  новые значения для warnings и статуса.

### `/cache-monitor help` (алиас `?`)

Короткая справка из 8 строк: что такое `↺` («чем выше, тем дешевле»),
что промах — это `cacheRead 0`, список подкоманд (`отчёт`, `history`,
`costs`, `settings`, `help`), пути к настройкам и ссылки на `README.md`,
`docs/ui-settings.md`, `docs/omp-docs-map.md`. Без обещаний TTL: на
`cline-pass` провайдер lifetime не декларирует. При `language: en` справка
печатается по-английски теми же 8 строками.

## Чтение в runtime

- Источник — `getPluginSettings(pluginName, cwd)` из
  `@oh-my-pi/pi-coding-agent/extensibility/plugins/loader`: OMP мержит
  глобальные настройки и проектные overrides.
- Импорт динамический, как и у реестра `defaultThinkingLevel`: внутренний
  subpath может переехать, и расширение не должно из-за этого не загрузиться.
- Любая ошибка или недоступность API — `{}`, то есть defaults. Поведение без
  настроек побайтово совпадает с версией до 0.8.0, кроме строки `language` в
  `/cache-monitor settings`.
- `normalizeConfig(raw)` дополнительно защищает от чужих форм: только bool
  для bool, finite-числа с rounding/clamp, `language` только `ru`/`en`,
  иначе default.

## Роудмап фаз

- [x] **Phase 1 — настройки (0.8.0).** 8 ключей в `omp.settings`,
  runtime-чтение через `getPluginSettings`, defaults побайтово прежние.
  Критерий: настройки видны в OMP, меняют поведение и не ломают вывод без
  настроек.
- [x] **Phase 1.5 — UI и справка (0.8.1).** Сгруппированные `description`
  (`Group · what. Default/range. Why.`), группы в `/cache-monitor settings`,
  переписанный `help` из 8 строк, карта `docs/omp-docs-map.md`.
  Критерий: группа и смысл ключа читаются без открытия кода; help объясняет
  `↺` и ведёт к документации.
- [x] **Phase 2 — язык (`language: ru | en`) (0.9.0).** Все строки отчёта,
  history, costs, `settings`, `help` и warning-ов вынесены в один словарь
  `TEXTS`; причина промаха хранится структурно и перерисовывается при смене
  языка. Тесты на оба языка (плюс проверка отсутствия кириллицы в `en`),
  docs на двух языках. Критерий: `language: en` даёт полностью английский
  вывод, ни одной русской строки; `ru` (default) не меняет текущий вывод,
  кроме новой строки `language` в `settings`.
- [ ] **Phase 3 — пресеты и advanced-ключи.** `preset`
  (`balanced` / `quiet` / `verbose` / `custom`) задаёт набор значений;
  advanced: `warnCanonicalMiss`, `minPrevPromptTokens`, `oncePerEpoch`,
  `trendSize`, `statusShowCost`.
  Критерий: пресет меняет только перечисленные ключи, `custom` оставляет
  ручные значения, каждый advanced-ключ покрыт тестом и строкой в docs.
- [ ] **Phase 4 — онбординг и upstream.** Подсказка при первом промахе (как
  открыть `settings`), скриншоты Settings → Plugins, upstream-предложение
  `group`/`icon` для плагинных настроек.
  Критерий: новый пользователь находит настройки по подсказке; скриншоты в
  README; предложение заведено в `can1357/oh-my-pi`.

### Advanced-ключи (Phase 3)

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
