# omp-cache-monitor

[English](../README.md) | Русский

Расширение OMP: hit rate кэша префикса в статус-строке, предупреждения о промахах
и команда `/cache-monitor` (`history` — последние 8 ходов, `costs` — разбивка
стоимости сессии по типам записей журнала, `settings` — настройки плагина,
`help` — краткая справка).

Ничего не меняет в настройках и запросах: читает usage завершённого хода
(`turn_end.message.usage`) и журнал сессии (`sessionManager.getEntries()`),
публикует статус. Ошибка в обработчике не ломает ход.

## Что показывает

Статус-строка (только в TUI), ключ `cache-monitor`:

```
cache-safe ↺ 98%
```

Режим берётся из `OMP_MODE` (его выставляет `omp-mode`); без режима остаётся
`↺ 98%`, до первого хода — `↺ …`, при нулевом знаменателе — `↺ n/a` (без `%`).

Команда `/cache-monitor` печатает одной строкой режим, модель, thinking,
последний ход с `saved`, `miss premium`, тренд и итог сессии:

```
режим: cache-safe · test/model-a · thinking high · ход: ↺ 25% · in 3000 · cacheRead 1000 · cacheWrite 0 · $0.0200 · saved $0.0027 · miss premium: $0.0081 (3000 tok) · тренд: ▁▃ · сессия: $0.0700, ходов 2, ↺ 11.1%, saved $0.0027, miss premium $0.0081 (3000 tok)
```

| Поле | Что значит |
|---|---|
| `режим` | `OMP_MODE`; `без пресета` — запуск голым `omp` |
| модель, `thinking` | активная модель и live-уровень (`/effort`), при `undefined` — сконфигурированный из настроек; `?` — неизвестно |
| `ход: ↺ / in / cacheRead / cacheWrite / $ / saved` | последний запрос: hit, новый input, из кэша, записано в кэш, стоимость и `saved $X` — экономия на чтении кэша против полной цены input; `saved` печатается, только когда он больше нуля (нужны `cacheRead > 0`, известные цены и положительная разница `input − cacheRead`) |
| `miss premium: $X (N tok)` | пере-оплаченные токены после промаха: `N` заново оплачены по полной цене; деньги — только если у модели числовые `cost.input` и `cost.cacheRead`, иначе `miss premium: N tok`; печатается только когда `N > 0` |
| `тренд: ▁…█` | последние 12 хитов: `▁` — 0%, `█` — 100%, `·` — hit не определён (нулевой знаменатель) |
| `сессия: $ / ходов / ↺ / saved / miss premium` | накопленная стоимость, число ходов, hit, экономия и пере-оплата за сессию; `saved $X` — когда сумма > 0 и известна полностью, `saved ≥$X` — известна лишь часть (например, после resume); `miss premium $X (N tok)` печатается только при N > 0, `≥$X` — часть ходов без цен модели |

Если ходов ещё не было — `ход: нет данных`. При нулевом знаменателе hit
печатается как `↺ n/a`, без знака `%`. На `/new` тренд и суммы обнуляются; при
resume/reload/fork на `session_start` они восстанавливаются из журнала.
`/clear` и переходы по дереву сохраняют суммы.

## История последних ходов

`/cache-monitor history` (алиас `/cache-monitor hist`) печатает последние 8
завершённых ходов отдельным уведомлением, от старого к новому:

```
история (3/8):
1. ↺ 98% · prompt 5261 · saved $0.0139
2. ↺ 0% · prompt 4600 · miss premium $0.0124 (4600 tok) · перезапись префикса
3. ↺ 50% · prompt 4200 · saved $0.0057 · miss premium $0.0057 (2100 tok)
```

- `hit` и `prompt` — как в остальном отчёте; `saved` печатается только при
  `cacheRead > 0`: `saved $X` при известной цене и `saved ?`, когда после
  resume цена модели неизвестна.
- `miss premium` печатается только при `reBilled > 0`: `$X (N tok)` либо
  `? (N tok)` без цены.
- Причина (`простой N мин` / `перезапись префикса`) — только у канонического
  промаха; первый ход эпохи её не получает.
- Окно — 8 ходов по умолчанию (`historySize`); более старые вытесняются. Нет
  данных — `история: нет данных`.

`/new` очищает историю; resume/fork восстанавливают её из журнала (последние 8
assistant-сообщений), `/clear` и переходы по дереву сохраняют. У последней
восстановленной записи `miss premium` не показывается: граница resume в журнал
не пишется, поэтому сравнение с прошлым префиксом не доказано.

`/cache-monitor` без аргумента печатает прежний отчёт — история в него не
добавляется.

## Разбивка стоимости

`/cache-monitor costs` (алиас `/cache-monitor cost`) печатает, на что ушли
деньги сессии, одной notification:

```
стоимость сессии: $0.6369
диалог: $0.5425
recap: $0.0656
composer-prediction: $0.0191
job-widget: $0.0084
title: $0.0012
```

- Источник — только `usage.cost.total` записей журнала: assistant-сообщения
  (`диалог`), `compaction` (`компакция`), `branch_summary` (`ветка`), а также
  записи `usage`/`model_usage` по `kind`/`purpose` (префиксы `usage:` и
  `model_usage:` срезаются). Фоновые вызовы приходят только из журнала, live
  событий у них нет.
- OMP 19.1 пишет стоимость компакции и branch-summary как `model_usage` с
  purpose `compaction:<method>` / `branch-summary`; они сводятся в те же
  бакеты `компакция`/`ветка`, что и отдельные записи `compaction`/
  `branch_summary`.
- `диалог` всегда первым; остальные строки — по убыванию известной стоимости,
  затем по подписи. Нестроковый `kind`/`purpose` показывается как `прочее`.
- Заголовок — `стоимость сессии: $X`, где `X` — сумма известных стоимостей
  бакетов. Если хоть один бакет неполон, заголовок `≥$X`; бакет с полностью
  неизвестной ценой печатается как `label: ?`, частично известный — как
  `label: ≥$X`. Оценок нет.
- Команда пересобирает карту из журнала и идемпотентна: повторный вызов
  заменяет её, а не добавляет. При пустом журнале (новая сессия) показывается
  live-карта диалога; `/new` её очищает, пустая карта печатает
  `стоимость: нет данных`.
- Дефолтный `/cache-monitor` и `/cache-monitor history` не меняются и этих
  строк не содержат.

## Resume, компакция и cache warming

На `session_start` (startup, resume, reload, fork) расширение читает
`ctx.sessionManager.getEntries()` и восстанавливает суммы по
assistant-сообщениям, последние 12 хитов тренда, историю последних 8 ходов,
последний ход и пере-оплаченные токены. Границы эпохи из журнала
(`model_change`, `thinking_level_change`, `compaction`, `branch_summary`) не
дают сравнивать ходы через смену префикса.

Записи `usage` (любой `kind`) и `model_usage` (в OMP 19.1: cache warming,
title/composer и другие off-transcript вызовы), а также `compaction.usage` и
`branch_summary.usage` входят в стоимость сессии, но не в токены hit, ходы или
тренд: это фоновая работа, а не запросы диалога. Перед печатью
`/cache-monitor` стоимость пересчитывается по журналу, поэтому cache warming и
компакция учитываются, даже если для них не было live-события.

Первый ход после resume — новая эпоха: он не сравнивается с прошлым префиксом
и не предупреждает. `/new` по-прежнему обнуляет суммы.

Цены моделей в журнале не хранятся. `saved` восстановленных токенов кэша не
оценивается: в сессии он растёт только по live-ходам, а если в журнале был
`cacheRead > 0`, сумма помечается `≥` (`saved ≥$X`). Пере-оплаченные токены
после resume восстанавливаются, но деньги за них тоже не выдумываются:
`miss premium` печатается в токенах, а при частично известной сумме остаётся
маркер `≥`. Пере-оплата самого последнего хода перед resume консервативно не
восстанавливается: граница resume в журнал не пишется, поэтому сравнение с
прошлым префиксом не доказано. Более ранние границы resume тоже не отмечены,
поэтому пере-оплата между такими ходами может остаться приблизительной.

## Формула

```
hit = cacheRead / (input + cacheRead + cacheWrite)
```

`cacheWrite` входит в знаменатель: запись в кэш тоже оплачивается. Если
знаменатель равен нулю, hit не определён — `n/a`.

## Saved и miss premium

Обе метрики считаются на токен, цены — `$/1M` из `model.cost`:

```
saved        = cacheRead × (inputPrice − cacheReadPrice)
miss premium = reBilled  × (inputPrice − cacheReadPrice)
reBilled     = max(0, min(prevPrompt, prompt) − cacheRead)
```

`inputPrice − cacheReadPrice` — разница между полной ценой нового input и ценой
чтения кэша, не меньше нуля. `saved` — сколько сэкономлено на чтении кэша
против полной цены; `miss premium` — сколько токенов после промаха заново
оплачено по полной цене. Если у модели нет числовых `cost.input` и
`cost.cacheRead`, `saved` не печатается, а `miss premium` остаётся в токенах.
После resume цены прошлых ходов неизвестны, поэтому `saved` считает только
live-часть и показывает `≥`.

## Предупреждения

Сравнение epoch-aware: база для сравнения сбрасывается на компакции, смене
модели, thinking или набора инструментов, поэтому законно холодный ход после
такого события не считается промахом посреди сессии.

1. **Канонический промах** — на предыдущем ходе промпт был ≥ 2048 токенов, а на
   текущем `cacheRead = 0` и `cacheWrite > 0`: префикс перезаписан целиком или
   кэш истёк. Причина считается per-turn: `простой N мин`, если между
   завершёнными ходами прошло ≥ 5 минут по `message.timestamp`, иначе
   `перезапись префикса`. Порог 5 минут — эмпирическая эвристика, **не**
   объявленный TTL провайдера: `cline-pass` lifetime не декларирует. Простой
   через границу эпохи (смена модели/thinking/tools, компакция, resume) новому
   префиксу не приписывается; без timestamp причина — `перезапись префикса`,
   а ход без timestamp разрывает цепочку простоя для следующего хода.
2. **Низкий hit** — меньше 50% на ходе не первом (первый ход холодный по
   определению).

Предупреждение — сигнал проверить, что менялось за 1–2 хода до него, а не ошибка
само по себе.

## Настройки

Схема лежит в `package.json` → `omp.settings`. OMP показывает её в
**Settings → Plugins → omp-cache-monitor** и в CLI:

```bash
omp plugin config list omp-cache-monitor
omp plugin config set omp-cache-monitor lowHitPercent 30
omp plugin config set omp-cache-monitor statusEnabled false
omp plugin config set omp-cache-monitor showMoney false
```

OMP рисует плагинные настройки **плоским списком**: `description` выбранной
строки показывается в подвале, а групп, заголовков и иконок в схеме плагина
нет (они есть только у core settings). Поэтому группы кодируются порядком
ключей и префиксом `Status ·` / `Warnings ·` / `Reports ·` в описании, а
`/cache-monitor settings` повторяет те же заголовки. Детали и
upstream-предложение `group`/`icon` — [`ui-settings.md`](ui-settings.md).
Карта документации OMP — [`omp-docs-map.md`](omp-docs-map.md).

Настройки читаются на старте/переключении сессии и перед каждой командой,
поэтому изменение из UI применяется со следующего хода после любой команды
`/cache-monitor` (или в новой сессии).
`/cache-monitor settings` (алиас `setting`) перечитывает их сразу и печатает
текущие значения, пометку `(changed)`/`(default)` и наличие цен модели:

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
💵 цены модели: да
Изменить: omp plugin config set omp-cache-monitor <key> <value>
```

| Ключ | Default | Диапазон | Что меняет |
|---|---|---|---|
| `statusEnabled` | `true` | boolean | Публиковать hit rate в статус-строке. `false` — `setStatus` не вызывается, старый статус не чистится. |
| `statusShowMode` | `true` | boolean | Префикс `OMP_MODE` у статуса (`cache-safe ↺ 75%`). `false` — только `↺ 75%`. |
| `warningsEnabled` | `true` | boolean | Предупреждения о каноническом промахе и низком hit. `false` — ни одного warning. |
| `lowHitPercent` | `50` | 1–100 | Warning, когда hit ниже этого процента. |
| `idleMinutes` | `5` | 1–240 | Разрыв, который причина промаха называет простоем (`простой N мин`). Эмпирика, **не** TTL провайдера. |
| `minPromptTokens` | `4000` | 0–1 000 000 | Не предупреждать на меньших промптах; тот же порог в причине и restore. |
| `historySize` | `8` | 1–50 | Окно `/cache-monitor history` (live и после resume) и делитель `история (N/M):`. |
| `showMoney` | `true` | boolean | `saved` и деньги `miss premium` в отчёте и history. При `false` остаются токены (`miss premium: 3000 tok` / `miss premium 3000 tok`), а `/cache-monitor costs` деньги показывает. |

Невалидные значения откатываются к default; числа округляются и зажимаются
(`lowHitPercent: 500` → `100`, `idleMinutes: 0` → `1`, `historySize: 3.6` → `4`).
Defaults воспроизводят вывод до 0.8.0 побайтово. Подробности:
[`ui-settings.md`](ui-settings.md).

`/cache-monitor help` (алиас `?`) печатает справку из 8 строк: что значит
`↺` («чем выше, тем дешевле»), что промах — это `cacheRead 0`, список
подкоманд (`отчёт`, `history`, `costs`, `settings`, `help`), где менять
настройки, и ссылки на `README.md`, `docs/ui-settings.md`,
`docs/omp-docs-map.md`. Обещаний TTL нет.

## Установка

npm-пакет не опубликован. Репозиторий private, поэтому установка из GitHub
требует авторизованного `gh`/SSH-доступа. OMP 19.1.0:

```bash
# из GitHub (private): git+ssh использует ваш SSH-ключ.
# Сокращение `github:` обращается к API без авторизации и получает 404
# для private-репозитория.
omp plugin install git+ssh://git@github.com/metapeka/omp-cache-monitor.git

# локальный чекаут: загружается из каталога без копирования
omp plugin link /path/to/omp-cache-monitor

# эквивалент (алиас plugin link)
omp install /path/to/omp-cache-monitor
```

Альтернатива — скопировать единственный файл расширения:

```bash
cp /path/to/omp-cache-monitor/index.ts ~/.omp/agent/extensions/cache-monitor.ts
```

Ставить нужно одним способом: `omp plugin link` **или** копия файла. Одновременно
не надо — расширение загрузится дважды. После установки перезапустить `omp`.

### Сегмент статус-строки

Сегмент `status` ставит hook-статус в общий ряд статус-строки. Без него при
`statusLine.showHookStatus: true` (дефолт) статус всё равно показывается, но
отдельным элементом. В `~/.omp/agent/config.yml`:

```yaml
statusLine:
  preset: custom
  leftSegments: ["vim", "model", "mode", "path", "git", "pr"]
  rightSegments: ["session_name", "token_total", "cost", "context_pct", "status"]
```

## Совместимость и конфликты имён

- OMP 19.1.0; проверено на маршруте `cline-pass`.
- Команда называется `/cache-monitor`, потому что `/cache` уже занимает
  `ubranch/omp-cache-control`. Оба расширения можно держать включёнными: они
  регистрируют разные команды и разные ключи статуса.
- Статус публикуется только в TUI; в `--mode json`/`--print` вызовы UI
  безвредны и ничего не показывают.

## Связанные документы

- Шпаргалка по режимам, `/cache-monitor` и диагностике:
  https://metapeka.github.io/docs-omp-debian-availability/wiki/guide.html
- Пресеты `cache-safe`/`quality`/`throughput`, wrapper `omp-mode` и история
  решений — репозиторий https://github.com/metapeka/docs-omp-debian-availability
  (`presets/`, `docs/plan-cache-modes.md`).

## Лицензия

MIT, см. `LICENSE`.
