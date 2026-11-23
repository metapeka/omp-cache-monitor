# Настройки и справка (UI settings)

Статус: **Phase 1 (0.8.0), Phase 1.5 (0.8.1), Phase 2 (0.9.0), Phase 3
(0.10.0) и Phase 4 (0.10.1) реализованы**.

Настройки позволяют менять поведение `omp-cache-monitor` без правки кода:
выключить статус или предупреждения, поменять пороги, окно истории, показ
денег, язык вывода, а пресетом — сразу набор значений. Плагин остаётся
read-only: настройки только читаются. В схеме 15 ключей: 9 базовых, `preset`
и 5 advanced.

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
  префиксом в `description` (`Preset · …`, `Status · …`, `Warnings · …`,
  `Reports · …`). `/cache-monitor settings` повторяет те же группы явными
  заголовками.
- Upstream-предложение: добавить в схему плагина необязательные `group` и
  `icon`, чтобы OMP рисовал секции без хаков с порядком и текстом.

## Ключи

| Ключ | Default | Диапазон | Что меняет |
|---|---|---|---|
| `preset` | `balanced` | `balanced` / `quiet` / `verbose` / `custom` (`enum`) | Набор значений остальных ключей. `balanced` — текущие defaults, `quiet` — тише статус и предупреждения, `verbose` — больше сигналов. Явно заданный ключ сильнее пресета; `custom` не применяет пресетных значений. `language` пресет не меняет. |
| `statusEnabled` | `true` | boolean | Показывать hit rate в статус-строке. `false` — `setStatus` не вызывается; старый статус не чистится. |
| `statusShowMode` | `true` | boolean | Префикс `OMP_MODE` у статуса (`cache-safe ↺ 75%`). `false` — только `↺ 75%`. |
| `statusShowCost` | `false` | boolean | Публиковать стоимость последнего хода отдельным статус-ключом `cache-monitor-cost` (`$0.0027`, 4 знака). Hit-строка `cache-monitor` не меняется. |
| `warningsEnabled` | `true` | boolean | Предупреждения о каноническом промахе и низком hit. `false` — ни одного warning. |
| `lowHitPercent` | `50` | 1–100, шаг 1 | Порог «низкого hit»: warning, когда `hit < N%`. |
| `idleMinutes` | `5` | 1–240, шаг 1 | Разрыв между ходами, который причина промаха называет простоем (`простой N мин`). Эмпирическая эвристика, **не** TTL провайдера. |
| `minPromptTokens` | `4000` | 0–1 000 000, шаг 500 | Не предупреждать на промптах меньше N токенов; тот же порог уходит в причину промаха и в restore. |
| `warnCanonicalMiss` | `true` | boolean | Toast о каноническом промахе. `false` отключает только его, low-hit продолжает работать. |
| `minPrevPromptTokens` | `2048` | 0–1 000 000, шаг 256 | Минимальный prompt предыдущего хода, чтобы вообще сравнивать с ним канонический промах; заменяет прежнюю константу `MIN_PREV_PROMPT`. |
| `oncePerEpoch` | `true` | boolean | `true` — один warning каждого типа за эпоху; `false` — на каждом подходящем ходе. |
| `historySize` | `8` | 1–50, шаг 1 | Окно `/cache-monitor history` (live и после resume) и делитель в заголовке `история (N/M):`. |
| `trendSize` | `12` | 1–50, шаг 1 | Длина спарклайна в отчёте; live-окно и restore из журнала используют одно значение. |
| `showMoney` | `true` | boolean | `saved` и деньги `miss premium` в отчёте и history. `false` — остаются токены (`miss premium: 3000 tok` / `miss premium 3000 tok`); `/cache-monitor costs` всегда показывает деньги. |
| `language` | `ru` | `ru` / `en` (`enum`) | Язык всех пользовательских строк: отчёт, history (заголовок и причины), costs, `settings`, `help`, warning-и. `ru` — прежний вывод байт-в-байт; `en` — английский. Метрики, токены и формат денег не меняются. Описания `omp.settings` в манифесте всегда английские. |

Некорректные значения (не bool, не число, `NaN`/`Infinity`) заменяются
значением пресета, а без пресета — default. Числа округляются и зажимаются в
диапазон: например, `lowHitPercent: 500` → `100`, `idleMinutes: 0` → `1`,
`historySize: 3.6` → `4`, `trendSize: 999` → `50`, `minPrevPromptTokens: -5`
→ `0`. `language` принимает только `ru`/`en`; любое другое значение (включая
число) откатывается к `ru` и пресетом не меняется.

Статус `cache-monitor` можно вынести в Powerline: нативный OMP-разделитель
`powerline-thin` или `pi-powerline-footer` через `customItems` (при
`statusShowCost` — второй элемент для `cache-monitor-cost`). Настройки
powerline-плагина не входят в `omp.settings` этого пакета; конфигурация и
проверка — [`powerline.md`](powerline.md).

## Команды

### `/cache-monitor settings` (алиас `setting`)

Печатает текущие значения одной notification:

```
⚙ настройки cache-monitor
🎛 Пресет
  preset: balanced (default) — набор значений
⚙ Статус
  statusEnabled: true (default) — ↺ N% в статус-строке
  statusShowMode: true (default) — префикс OMP_MODE
  statusShowCost: false (default) — стоимость хода отдельным сегментом
⚠️ Предупреждения
  warningsEnabled: true (default) — toast о промахах
  lowHitPercent: 50 (default) — порог низкого hit
  idleMinutes: 5 (default) — «простой N мин», не TTL
  minPromptTokens: 4000 (default) — не шуметь на мелких промптах
  warnCanonicalMiss: true (default) — warning о каноническом промахе
  minPrevPromptTokens: 2048 (default) — порог предыдущего промпта
  oncePerEpoch: true (default) — один warning за эпоху
📊 Отчёты
  historySize: 8 (default) — окно /cache-monitor history
  trendSize: 12 (default) — точек в спарклайне
  showMoney: true (default) — $ в saved/miss premium
  language: ru (default) — язык вывода
💵 цены модели: да
Изменить: omp plugin config set omp-cache-monitor <key> <value>
```

- Заголовки `Пресет`/`Статус`/`Предупреждения`/`Отчёты` — те же группы, что
  в `description` схемы; подпись после `—` статична и не зависит от значения.
  При `language: en` заголовки и подписи английские (`Preset`/`Status`/
  `Warnings`/`Reports`, `output language`), а `(changed)`/`(default)`
  остаются как есть.
- `(changed)` — ключ задан явно (в т.ч. строкой из `omp plugin config set`);
  `(default)` — не задан. Поэтому при `quiet`/`verbose` значение может
  приходить от пресета и всё равно помечаться `(default)`: маркер говорит об
  источнике ключа, а не о равенстве hard default.
- Все 15 ключей разложены по группам: `preset`; `statusEnabled`,
  `statusShowMode`, `statusShowCost`; `warningsEnabled`, `lowHitPercent`,
  `idleMinutes`, `minPromptTokens`, `warnCanonicalMiss`,
  `minPrevPromptTokens`, `oncePerEpoch`; `historySize`, `trendSize`,
  `showMoney`, `language`.
- `language` — группа `Reports`. Смена языка перерисовывает `settings`,
  `help`, отчёт, costs и сохранённые причины history: причина хранится
  структурно (`{ kind: "idle"; minutes: number }` или
  `{ kind: "rewrite" }`), а текст рендерится на текущем языке.
- `(changed)` — ключ реально пришёл из настроек (даже если значение потом
  нормализовано); `(default)` — ключа нет, действует default. Значения,
  пришедшие из пресета, помечаются `(default)`: в настройках задан только
  `preset`.
- `preset` печатается только здесь: в отчёте, history и costs его нет.
- `💵 цены модели: да|нет` (EN `model prices: yes|no`) — есть ли у текущей
  модели числовые `cost.input` и `cost.cacheRead` (от них зависят `saved` и
  деньги `miss premium`).
- Команда перечитывает настройки: следующие ходы текущей сессии используют
  новые значения для warnings, статуса и окна спарклайна (лишние точки
  отрезаются сразу).

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
  настроек побайтово совпадает с версией до 0.8.0, кроме новых строк
  `/cache-monitor settings` (их 15 вместо 9).
- `normalizeConfig(raw)` дополнительно защищает от чужих форм: сначала
  выбирается пресет (`quiet`/`verbose`/`custom`, иначе `balanced`), затем
  каждый явно заданный **валидный** ключ перекрывает значение пресета;
  невалидный explicit-ключ откатывается к значению пресета, а не к default.
  Bool принимается как boolean или строка `"true"`/`"false"` (именно строки
  хранит `omp plugin config set`), числа — конечное число или числовая строка
  с rounding/clamp, `language` — только `ru`/`en` (пресетом не меняется).

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
- [x] **Phase 3 — пресеты и advanced-ключи (0.10.0).** `preset`
  (`balanced` / `quiet` / `verbose` / `custom`) задаёт набор значений;
  advanced: `warnCanonicalMiss`, `minPrevPromptTokens`, `oncePerEpoch`,
  `trendSize`, `statusShowCost`. Итого 15 ключей.
  Критерий: пресет меняет только перечисленные ключи, `custom` оставляет
  ручные значения, каждый advanced-ключ покрыт тестом и строкой в docs;
  defaults без настроек и `ru`-вывод остаются байт-в-байт прежними, кроме
  новых строк `settings`.
- [x] **Phase 4 — онбординг и upstream (0.10.1).** Первый канонический
  промах за процесс добавляет одноразовую подсказку: `/cache-monitor settings`
  и что значит `preset`; скриншоты Settings → Plugins и вывода `settings` —
  в README (EN/RU), файлы в `docs/images/`; upstream-предложение
  `group`/`icon` заведено — <https://github.com/can1357/oh-my-pi/issues/20253>,
  локальная копия — [`upstream-settings-groups.md`](upstream-settings-groups.md).
  Критерий: новый пользователь находит настройки по подсказке; скриншоты в
  README; предложение заведено.

### Онбординг (Phase 4)

Первый канонический промах в процессе добавляет к warning одну строку:

```text
Настройки: /cache-monitor settings (или Settings → Plugins → omp-cache-monitor). preset — набор значений: balanced, quiet, verbose, custom.
```

EN-версия (`language: en`) — та же подсказка на английском. Она показывается
один раз за процесс: не повторяется в следующих эпохах и при смене сессии в
том же процессе. Отдельной настройки нет — подсказка часть онбординга, а не
поведения предупреждений.

Скриншоты для README: `docs/images/omp-plugins-settings.png` (Settings →
Plugins) и `docs/images/cache-monitor-settings.png` (вывод `settings`).

### Пресеты (Phase 3)

| Пресет | Значения |
|---|---|
| `balanced` (default) | текущие defaults: status on, mode on, warnings on, lowHit 50, idle 5, minPrompt 4000, history 8, money on, trend 12, status cost off, canonical on, minPrev 2048, once/epoch on |
| `quiet` | `statusShowMode=false`, `warningsEnabled=false`, `statusShowCost=false`; остальное как balanced |
| `verbose` | `lowHitPercent=60`, `idleMinutes=3`, `minPromptTokens=2000`, `historySize=12`, `trendSize=20`, `statusShowCost=true`, `minPrevPromptTokens=1024`, `oncePerEpoch=false`; остальное как balanced |
| `custom` | preset-значения не применяются: только individual keys + defaults |

Правило приоритета: **явно заданный ключ сильнее пресета**; `preset` не
меняет `language`. Пресет применяется к незаданным ключам, `custom` — только
defaults + individual keys.

### Advanced-ключи (Phase 3)

| Ключ | Default | Смысл |
|---|---|---|
| `warnCanonicalMiss` | `true` | Отдельно выключать канонический промах, оставляя low hit. |
| `minPrevPromptTokens` | `2048` (0..1e6, step 256) | Заменить константу `MIN_PREV_PROMPT` порогом предыдущего промпта. |
| `oncePerEpoch` | `true` | `true` — один warning каждого типа за эпоху; `false` — на каждом подходящем ходе. |
| `trendSize` | `12` (1..50) | Длина спарклайна; live и restore используют одно значение. |
| `statusShowCost` | `false` | Отдельный статус-ключ `cache-monitor-cost` со стоимостью последнего хода (`$0.0027`, 4 знака); hit-строка `cache-monitor` не меняется. |

### Группы `settings` (Phase 3)

| Группа | Ключи |
|---|---|
| `🎛 Пресет` / `🎛 Preset` | `preset` |
| `⚙ Статус` / `⚙ Status` | `statusEnabled`, `statusShowMode`, `statusShowCost` |
| `⚠️ Предупреждения` / `⚠️ Warnings` | `warningsEnabled`, `lowHitPercent`, `idleMinutes`, `minPromptTokens`, `warnCanonicalMiss`, `minPrevPromptTokens`, `oncePerEpoch` |
| `📊 Отчёты` / `📊 Reports` | `historySize`, `trendSize`, `showMoney`, `language` |

Порядок ключей в таблице совпадает с порядком в `omp.settings` и с
заголовками `/cache-monitor settings`; `description` каждой строки начинается
с той же группы (`Preset ·`, `Status ·`, `Warnings ·`, `Reports ·`).

## Риски

- `getPluginSettings` — внутренний API OMP, не публичный контракт. Он может
  измениться между версиями; поэтому импорт динамический, а ошибка даёт
  defaults, а не падение расширения.
- Значения применяются к новой сессии; уже открытая сессия не меняет
  настройки сама, кроме перечитывания командой `settings`.
- Настройки read-only для плагина: он ничего не пишет в конфиг OMP и не
  меняет запросы.
- `statusShowCost` публикует второй ключ `cache-monitor-cost` только на
  `turn_end` в main TUI. До первого хода и при `statusEnabled: false` его нет,
  а старый сегмент не очищается — то же известное ограничение, что и у
  `cache-monitor`. Powerline скрывает отсутствующий ключ через
  `hideWhenMissing`.
- Схема в `package.json` не добавляет файлов в tarball: `npm pack` по-прежнему
  отдаёт 4 файла. Скриншоты `docs/images/` в tarball не входят.
- Онбординг-подсказка привязана к процессу, а не к сессии: после перезапуска
  OMP она появится снова. Отдельного ключа для неё нет — это не поведение
  warning-ов, а подсказка при первом промахе.
