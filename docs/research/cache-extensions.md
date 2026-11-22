# Cache extensions: рынок и сравнение с omp-cache-monitor

Дата: 2026-11-22. Версия продукта: 0.6.0 (сверка рынка — на 0.4.0; наши
возможности обновлены после этапов 2.5 и 2.8).
Методика: README, package-страницы и исходники; GitHub API (звёзды, последний
коммит), npm (версия, загрузки). Ничего не устанавливалось и не запускалось.
Непроверенная совместимость помечена `[INFERENCE]`.

## TL;DR

- Официального каталога OMP-плагинов нет. У PI есть официальный каталог
  `pi.dev/packages`.
- Сильнейший конкурент overall — `omp-cache-meter` (TTL, rebuild cost,
  `/compact` payback, история, панель, Tern).
- Ближайший конкурент по статусу/алертам — `catitw/omp-cache-hit-rate-extension`,
  но он не устанавливается как пакет и не имеет команды/стоимости/resume.
- Сильнейший PI-конкурент по метрикам — `@narumitw/pi-cache-hit-monitor`.
- Наша ниша: дешёвый read-only статус с `OMP_MODE`, `/cache-monitor` с
  `saved`/`miss premium` и историей 8 ходов, epoch-aware warnings с причиной
  (простой/rewrite) и корректным resume; без TTL/warming/дашборда.

## 1. Официальные каталоги

| Экосистема | Что есть | Cache-расширения | Установка |
|---|---|---|---|
| OMP | Механизм marketplace есть, официального каталога OMP нет: `.omp-plugin/marketplace.json` и `.claude-plugin/marketplace.json` в `can1357/oh-my-pi` — 404, `omp.sh/plugins` — 404. `omp plugin marketplace list` локально: «No marketplaces configured». Официальные доки ссылаются на `anthropics/claude-plugins-official`, где cache-плагинов нет. | Официального cache-расширения нет; всё в GitHub/npm. | `omp plugin marketplace add <owner/repo>`, затем `omp plugin install <name>@<marketplace>`; либо `omp plugin install github:...` / npm. |
| PI | Официальный npm-backed каталог `https://pi.dev/packages`: 5 367 пакетов на 2026-11-22, автопоиск по keyword `pi-package`, без отдельной cache-категории. | Пять близких пакетов имеют страницы в каталоге. | `pi install npm:<package>`; git/local/`pi -e` тоже поддерживаются. |
| GitHub | Основная площадка сообщества; звёзды и последний коммит ниже. | Много расширений, качество и активность сильно различаются. | По README репозитория. |

Вывод: «официальный маркетплейс OMP» пока не существует; «официальный
маркетплейс PI» — это каталог `pi.dev/packages`, а не курируемая витрина.

## 2. OMP: ближайшие конкуренты

| Проект | Активность | Что делает | Пересечение и вывод |
|---|---|---|---|
| **[andreiverdes/agent-cache-meter](https://github.com/andreiverdes/agent-cache-meter)** (npm `omp-cache-meter`) | 4★, push 2026-11-10, npm 0.1.1, ~640 загрузок/мес | Виджет над composer: read/write/uncached, hit rate, TTL-countdown, warm/expiring/cold/after-compact; стоимость пересборки; окупаемость `/compact`; `/cache` panel и `/cache settings`; история последних 8 запросов; Tern; отдельный Claude Code статус. Формула `read/(read+write+uncached)`. Тестирован на OMP 18.12.6. | **Самый сильный конкурент overall.** Больше метрик, TTL, экономика компакции, история, панель. У нас нет TTL/панели/`/compact`-ROI; история 8 ходов есть в `/cache-monitor history`, плюс `OMP_MODE`, строгая warning-политика, `./cache-monitor`, resume без выдуманных цен, zero-deps single-file. |
| **[catitw/omp-cache-hit-rate-extension](https://github.com/catitw/omp-cache-hit-rate-extension)** | 0★, один push 2026-10-09 | Статус `cache <session>% · turn <turn>% ↑ · ▁▂…` (10 ходов, семантические бэнды 88–100%); warm→cold alert с причиной (модель/idle/перезапись); TUI only; ключ `cache-hit-rate`. Нет команды, стоимости, TTL, resume. `package.json` private без `omp.extensions`, установка только копированием. | **Ближе всего по статусу и alert'ам** (~80% этой поверхности). Мы выигрываем установкой, `/cache-monitor`, моделью/thinking/режимом, стоимостью, re-billed токенами, resume, 12-точечным трендом и строгой warning-политикой. Он выигрывает семантическими бэндами и явной причиной «idle/model/rewrite». |
| **[ubranch/omp-cache-control](https://github.com/ubranch/omp-cache-control)** | 3★, push 2026-10-16, 1 runtime dep `@smithy/core`, pin OMP 18.8.7 | Статус — только оценка TTL `~29:50` (ключ `prompt-cache`); cache-read % в `/cache warm`; платный idle-warming; команды `/cache`, `/cache on/off`, `/cache warm on/off/now`; адаптеры провайдеров. | Пересечение только по cache-read % и имени `/cache`. Это TTL/warming-продукт, не отчёт. Мы сознательно не делаем TTL/warming на `cline-pass`; `/cache` не занимаем. |
| **[EF-FlowCode/omp-cache-optimizer](https://github.com/EF-FlowCode/omp-cache-optimizer)** (npm `omp-cache-optimizer`) | 7★, push 2026-10-29, npm 2.1.0, ~465 загрузок/мес | Footer cache hit rate, recent-N, write tokens, режимы session/total/process, persisted shards; `/cache-optimizer` + doctor/compat/stats/config/fix/rollback; стабильный `prompt_cache_key`, long retention, warming decision. | Пересечение по footer hit rate и истории. Это оптимизатор/доктор, а не read-only статус; у нас нет active optimization и persisted shards. |
| **[NEURAX-FX/omp-responses-cache](https://github.com/NEURAX-FX/omp-responses-cache)** | 1★, push 2026-11-14 | Диагностика OpenAI Responses: `prompt_cache_key`, стабильный tool-loop контекст, хеши, raw usage. Нет статуса/UI/hit %. | Не пересекается с UI; источник идей для диагностики ключей. |
| **[anatoli-tsinovoy/omp-cache-miss-oof](https://github.com/anatoli-tsinovoy/omp-cache-miss-oof)** | 0★, push 2026-09-23 | Звук при каноническом warm→cold миссе; тот же детектор 2048/`cacheRead=0`/`cacheWrite>0`; восстанавливает baseline из ветки. | UI не пересекается; подтверждает канонический детектор. |
| **[blingdivinity/omp-cache-warmer](https://github.com/blingdivinity/omp-cache-warmer)** | 4★, push 2026-11-20 | launchd/systemd daemon, prefix-pin, miss-guard, live-warm; README прямо говорит «currently unrecommended». | Warming/пиннинг, не монитор. |
| **[getpipher/agent-statusline](https://github.com/getpipher/agent-statusline)** (successor `omp-statusline`) | 0★, 2026-11-22, npm 0.2.5, ~660 загрузок/мес | Ledger REPO/DAY/7DAY/30DAY по сессиям, квоты, версии; cache hit только в `/sl`-отчёте, не в статусе. | Tangential; идея disk-ledger и учёта субагентов. |

Соседние, но не cache-мониторы: `ankitg12/omp-extensions` (16 пакетов,
`agent-cost-guard-omp`), `gitrealname/omp-extensions-public` (нужен `open-sdk`),
`AppVerk/av-marketplace` и `sethforprivacy/omp-plugins` (каталоги без cache),
`mcbarlowe/omp-deck` (web-cockpit), `shaftoe/awesome-pi-coding-agent` (индекс).

## 3. PI: ближайшие конкуренты

| Пакет | Версия / загрузки / коммит | Что делает | Пересечение и вывод |
|---|---|---|---|
| **[@narumitw/pi-cache-hit-monitor](https://pi.dev/packages/@narumitw/pi-cache-hit-monitor)** | 0.1.4, ~788/мес, 2026-11-21 | Виджет над редактором: `hit = cR/(in+cR+cW)`, `Δ`, `loss`, `uncached`, `eligible`, `re-billed`, `cache saved`, `miss premium`, `start gap`; 8 запросов тренда; weighted active-branch totals, включая compaction/branch-summary/warming; restore после start/compaction/tree; `/cache-hit-monitor` show/hide; TUI+RPC. 1 dep. | **Функционально сильнее нас по набору метрик** (`Δ`, `loss`, `uncached`, `eligible`, `start gap`, RPC). `saved`/`miss premium` теперь есть и у нас. Нет `OMP_MODE`, нашего warning-политики и `/cache-monitor`-отчёта. OMP-совместимость не заявлена — `[INFERENCE]`. |
| **[@giladbarnea/pi-custom-footer](https://pi.dev/packages/@giladbarnea/pi-custom-footer)** | 0.1.18, ~2 814/мес, 2026-11-22 | Header/footer: context, cache hit session + last message, `hit`/`miss` с причиной (idle/model switch) и стоимостью, `warm for 26m` (TTL), cost/turn, skills, quota; обновление на forks/compaction. | Сильнее по TTL, причине мисса, context/skills/quota; нет команд и `OMP_MODE`. OMP — `[INFERENCE]`. |
| **[pi-cache-optimizer](https://pi.dev/packages/pi-cache-optimizer)** | 2.10.7, ~15.3K/мес, 2026-11-21 | Оптимизация hit rate: стабильные промпты, `prompt_cache_key`, long retention, proxy-compat warnings, warming decision; footer stats session/total/process; persisted shards; `/cache-optimizer` + doctor/stats/fix/rollback. 0 runtime deps. | Самый массовый PI-инструмент. Это optimizer/doctor, не read-only монитор; у нас нет активной оптимизации, а история 8 есть только в `/cache-monitor`. |
| **[@nilskluewer/pi-cache-guard](https://pi.dev/packages/@nilskluewer/pi-cache-guard)** | 0.6.2, ~1 540/мес, npm 2026-11-10 | TTL-countdown с progress bar, cold-cache cost warning, budget-диалог перед дорогой отправкой, `/cache-guard` (budget/history/handoff/placement), история, auto-handoff. | Сильнее по защите от холодной отправки; у нас warning только после факта. OMP — `[INFERENCE]`. |
| **[@mrclrchtr/supi-cache](https://pi.dev/packages/@mrclrchtr/supi-cache)** | 12.0.0, ~2.2K/мес, deprecated | `/supi-cache-history`, `/supi-cache-forensics`, tool `cache_forensics`: per-turn input/cacheRead/cacheWrite/hit, hotspots, idle drops, корреляция с tool-shape; cross-session. | Сильнее по cross-session forensics; per-turn история 8 есть и у нас, live-UI нет. Заменён на `@mrclrchtr/supi-debug`. |

Соседние: `pi-powerline-footer` (478★, сегмент `cache_read` с
`cacheRead/(input+cacheRead+cacheWrite)` и `customItems` — через него можно
показывать наш статус), `pi-zentui` (есть OMP-порт), `pi-tps-stats` (TPS/TTFT +
cache usage), `@caph42/pi-ccline` (делегирует в `ccline`).

## 4. Матрица возможностей

| Возможность | Наш 0.6.0 | catitw | omp-cache-meter | ubranch | pi-cache-hit-monitor | pi-custom-footer |
|---|---|---|---|---|---|---|
| Формула с `cacheWrite` | да | да | да | да | да | да |
| Turn + session hit | да | да | да | частично | да | да |
| Trend / sparkline | да, 12 | да, 10 | нет (таблица 8) | нет | да, 8 | нет |
| История / forensics | да: 8 ходов в `/cache-monitor` | нет (тренд 10) | last 8 + панель/Tern | process-local ledger | нет (тренд 8) | нет |
| Статус-строка | да, `OMP_MODE ↺ N%` | да | виджет над composer | только TTL | виджет | footer/header |
| Команда-отчёт | `/cache-monitor`, `history` | нет | `/cache`, `/cache settings` | `/cache`, `/cache warm` | `/cache-hit-monitor` toggle | нет |
| Стоимость хода/сессии | да + saved/miss premium | нет | да + rebuild/payback | только warm cost | да + saved/miss premium | да |
| Warning-политика | canonical miss + low-hit + причина (простой/rewrite), раз на эпоху | warm→cold + причина | состояния warm/cold | нет | epoch reset, без toast | miss cause/cost |
| Resume / история | resume из журнала, история 8, деньги `≥`/`?` | сброс | branch rebuild + history | process-local ledger | restore start/compact/tree | forks/compaction |
| TTL / warming | нет | нет | TTL + mirror warming | TTL + paid warming | нет | TTL `warm for 26m` |
| Model / thinking / mode | все три | нет | model/tier, без mode | model косвенно | model/provider | model/thinking |
| Runtime deps | 0 | 0 | 0 | 1 | 1 | 0 |
| Установка | npm/git | ручное копирование | npm/git | github | npm | npm |
| Тесты / CI | 37 + CI | нет | нет данных | regression suite | нет данных | тесты в README |

## 5. Что совпадает, чем мы лучше, чем хуже

### Совпадает

- Каноническая формула `cacheRead/(input+cacheRead+cacheWrite)` — у всех
  серьёзных реализаций.
- Turn/session hit и сброс сравнения на compaction/смену модели/ветку.
- Идея re-billed токенов и стоимости мисса — у `pi-cache-hit-monitor`,
  `pi-custom-footer`, `omp-cache-meter`, у нас.
- TUI-статус и предупреждения о промахе — у `catitw`, `omp-cache-meter`, у нас.
- Trend/sparkline — у `catitw` (10), `pi-cache-hit-monitor` (8), у нас (12).

### Мы лучше

- **`OMP_MODE`/пресеты**: ни один конкурент не связывает статус с режимом
  `cache-safe`/`quality`/`throughput`.
- **Одна команда `/cache-monitor`** с режимом, моделью, thinking, последним
  ходом, стоимостью, `saved`/`miss premium`, трендом, сессией и историей
  8 ходов — такой комбинации нет ни у кого.
- **Строгая warning-политика**: canonical miss + low-hit, по одному на эпоху,
  не на первом ходе, prompt ≥ 4000, только TUI main, с причиной
  `простой N мин` / `перезапись префикса`. У `catitw` причина есть только для
  warm→cold; у остальных либо нет, либо другие правила.
- **Resume без выдуманных цен**: восстанавливаем токены/тренд/суммы/историю,
  но не придумываем историческую стоимость; `saved`/`miss premium` после
  resume помечаются `≥`/`?`, фоновые вызовы добавляют только cost.
- **Zero runtime deps, один файл `index.ts`, 37 тестов и CI** — у `catitw` тоже
  zero-deps, но нет устанавливаемого пакета; у `omp-cache-meter` zero-deps, но
  многомодульный проект.
- **Read-only**: не греем кэш, не меняем промпты, не тратим деньги.

### Мы хуже / чего у нас нет

- **TTL/expiry countdown** — `omp-cache-meter`, `ubranch`, `pi-custom-footer`,
  `pi-cache-guard`, native OMP `cache`-сегмент.
- **Warming** — `ubranch` (paid idle), `omp-cache-warmer`, `pi-cache-optimizer`;
  native OMP тоже умеет.
- **Экономика сверх saved/miss premium**: rebuild cost, `/compact` payback
  (сознательно не делаем — будет врать без TTL), cold-send budget —
  `omp-cache-meter`, `pi-cache-guard`; `saved`/`miss premium` уже сделаны в
  0.5.0.
- **Панель/forensics/cross-session**: `omp-cache-meter` (last 8 + Tern),
  `supi-cache` (per-turn/cross-session), `getpipher` (ledger), optimizer
  (persisted shards). История 8 ходов уже есть в `/cache-monitor history`; нет
  панели, cross-session и persist-слоя.
- **Виджет/размещение/RPC/JSON**: `omp-cache-meter`, `pi-cache-hit-monitor`,
  `pi-custom-footer`; у нас только статус-строка + команда.
- **Активная оптимизация**: `pi-cache-optimizer`, `omp-cache-optimizer`,
  `omp-cache-warmer`.
- **Multi-session/multi-agent**: Tern-панель `omp-cache-meter`, ledger
  `getpipher`.

## 6. Позиционирование

Наш продукт — **дешёвый read-only статус + отчёт для OMP**: одна строка
`OMP_MODE ↺ N%`, одна команда с моделью/thinking/стоимостью/`saved`/
`miss premium`/трендом, строгая epoch-aware warning-политика с причиной и
корректный resume. Это не дашборд и не warmer.

- Если нужна **экономика кэша** (TTL, rebuild, `/compact`, история) — сильнее
  `omp-cache-meter`, затем `pi-cache-hit-monitor`/`pi-custom-footer`.
- Если нужно **не дать кэшу остыть** — `ubranch`, `omp-cache-warmer`, native
  OMP warming.
- Если нужно **поднять hit rate** — `pi-cache-optimizer`/`omp-cache-optimizer`.
- Если нужен **компактный статус с режимом и отчётом** — наша ниша пока
  свободна.

## 7. Что из этого стоит учесть

- TTL на `cline-pass` не делаем: `promptCache: null`, authoritative expiry нет.
  Идея `omp-cache-meter` с `cache_control.ttl` + `model.promptCache` применима
  только там, где провайдер/каталог реально дают tier.
- `cache saved`/`miss premium` сделаны в 0.5.0 (цены `model.cost`, `≥` после
  resume). `/compact` payback **не делаем**: при живом кэше removed-токены не
  оплачивались бы каждый ход, поэтому «окупится за N ходов» будет врать.
  Корректная оценка возможна только с TTL/вероятностью мисса, которых на
  `cline-pass` нет.
- `pi-powerline-footer` умеет поднимать чужие `ctx.ui.setStatus` через
  `customItems` — потенциальная интеграция нашего статуса без нового кода.
- `supi-cache` deprecated; не рассматривать как живой ориентир.

## 8. Что подсмотреть и что тянуть

### Наши стороны, которые надо тянуть

| Сторона | Почему это наше | Следующий шаг |
|---|---|---|
| Mode-aware статус | `OMP_MODE` есть только у нас; конкуренты показывают cache в отрыве от режима. | Держать `OMP_MODE` в статусе и `/cache-monitor`; не заменять компактную строку большим дашбордом. |
| `/cache-monitor` как отчёт | Одна команда: режим, модель, thinking, ход, стоимость, `saved`/`miss premium`, тренд, сессия, история 8. Такой комбинации нет. | Сделано в 0.5.0; история — в 0.6.0; держать компактным, не превращать в дашборд. |
| Warning-политика | Строже `catitw`: canonical miss + low-hit, раз на эпоху, не на первом ходе. | Сделано в 0.5.0: причина `простой N мин` / `перезапись префикса`, TTL-порог не выдумывается. |
| Resume | Восстанавливаем суммы/тренд/историю, не выдумываем исторические цены. | Покрыто тестами (`≥`/`?`, tree/clear, границы эпохи); сохранять консерватизм. |
| Zero-deps / read-only | Нет warming, нет платных запросов, один `index.ts`. | Сохранять; warming/optimizer — отдельные продукты. |
| Тесты и CI | 37 тестов, typecheck, GitHub Actions. | Не мержить поведение без теста. |

### Кандидаты у конкурентов

| Идея | Откуда | Что даёт | Цена/риск | Приоритет |
|---|---|---|---|---|
| Причина мисса: idle / model switch / rewrite | `catitw` | Понятнее, почему кэш сломался; меньше ложных тревог. | Сделано в 0.5.0: `простой N мин` (эвристика 5 мин) / `перезапись префикса`; без TTL-обещания. | **Сделано** |
| `cache saved` и `miss premium` в `$` | `pi-cache-hit-monitor`, `omp-cache-meter` | Показывает не только %, но и деньги. | Сделано в 0.5.0: `cacheRead`/`reBilled × (input − cacheRead)`, `≥` после resume. | **Сделано** |
| TTL / expiry countdown | `omp-cache-meter`, `ubranch`, `pi-custom-footer`, `pi-cache-guard` | Видно, когда кэш остынет. | На `cline-pass` lifetime нет; дизайн и чеклист для будущих провайдеров — `ROADMAP.md` этап 3. На текущем провайдере не показываем. | **P2, ждёт провайдера** |
| `/compact` payback | `omp-cache-meter` | Показывает, окупается ли компакция на холодном кэше. | **Не делаем**: с живым кэшем допущение о повторной оплате removed-токенов ложно, цифра будет врать. | **Не делаем** |
| История последних N запросов / панель | `omp-cache-meter`, `pi-cache-hit-monitor` | Разбор регрессий, а не только последний ход. | История 8 сделана в 0.6.0 без нового UI; панель/cross-session — отдельный слой. | **История 8 — сделано; панель — P2** |
| Интеграция с powerline | `pi-powerline-footer` | Наш `ctx.ui.setStatus` можно поднять в чужой powerline через `customItems`. | Почти без кода; только документация/пример. | **P2** |
| Cold-cache budget / подтверждение дорогой отправки | `pi-cache-guard` | Не даёт случайно переплатить за холодный префикс. | Нужна оценка до запроса и UI-подтверждение; рядом с warming. | **P3** |
| Активная оптимизация / warming / daemon | `pi-cache-optimizer`, `ubranch`, `omp-cache-warmer` | Поднимает hit rate и греет кэш. | Меняет промпты/тратит деньги; выходит из read-only ниши. | **P3 / не делаем** |
| Multi-session / Tern / ledger | `omp-cache-meter`, `getpipher` | Видно все сессии и агенты. | Отдельный продукт, persist-слой, TUI-интеграция. | **P3 / не сейчас** |
| `supi-cache` forensics | `supi-cache` | История и расследования регрессий. | Пакет deprecated; per-turn история 8 уже есть, cross-session/панель — нет. | **Не берём как зависимость** |

### TTL простыми словами

TTL — это сколько времени провайдер держит префикс в кэше после последнего
запроса. Если вернуться позже, кэш уже остыл, и следующий запрос заново
оплачивает весь префикс по полной цене, а не по цене cache-read.

Чтобы добавить TTL, нужно: (1) знать lifetime — `model.promptCache` из каталога
или `cache_control.ttl` из фактического запроса; (2) запомнить время последнего
запроса/записи в кэш; (3) считать остаток и показывать `~mm:ss`; (4) если данных
нет — скрывать TTL или писать `n/a`, но не показывать догадку. На
`cline-pass/deepseek-v4.1-flash-1017` сейчас `promptCache: null`, поэтому
честного countdown нет; native OMP `cache`-сегмент уже показывает warm/cold и
причину инвалидации. Поэтому TTL — P2 и только при появлении данных, а не
обязательная фича v0.4.

## Источники

- OMP marketplace docs: https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md
- OMP marketplace 404: `.omp-plugin/marketplace.json`, `.claude-plugin/marketplace.json`, `omp.sh/plugins`
- PI catalog: https://pi.dev/packages
- `omp-cache-meter`: https://github.com/andreiverdes/agent-cache-meter
- `catitw`: https://github.com/catitw/omp-cache-hit-rate-extension
- `ubranch`: https://github.com/ubranch/omp-cache-control
- `EF-FlowCode`: https://github.com/EF-FlowCode/omp-cache-optimizer
- `pi-cache-hit-monitor`: https://pi.dev/packages/@narumitw/pi-cache-hit-monitor
- `pi-custom-footer`: https://pi.dev/packages/@giladbarnea/pi-custom-footer
- `pi-cache-optimizer`: https://pi.dev/packages/pi-cache-optimizer
- `pi-cache-guard`: https://pi.dev/packages/@nilskluewer/pi-cache-guard
- `supi-cache`: https://pi.dev/packages/@mrclrchtr/supi-cache
- Предыдущее исследование сохранено в истории проекта; этот файл — его
  обновлённая и проверенная версия.
