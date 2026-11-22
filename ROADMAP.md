# Roadmap: omp-cache-monitor

Дата: 2026-11-22. Версия: 0.5.0. GitHub: private.
Цель: довести расширение до релиза, которому можно доверять по цифрам,
установке и поведению на всех переходах сессии.

## Принципы

- Сначала корректность метрик и lifecycle, потом публикация.
- Один файл расширения `index.ts`, без runtime-зависимостей.
- Любая задача — отдельный worktree `feat/<slug>` от `main`; merge только
  `--ff-only`, worktree и ветка удаляются после merge.
- Публикация npm/marketplace и смена видимости репозитория — только по
  явному решению владельца.
- Один агент — один worktree. Параллельные правки одного файла запрещены.

## Текущее состояние

| Что | Состояние |
|---|---|
| Версия | 0.5.0: причина мисса, `saved` и `miss premium` в `/cache-monitor` |
| GitHub | `metapeka/omp-cache-monitor`, private, `main` |
| Установка | `omp plugin link` на боевой чекаут; боевой чекаут — 0.5.0 после merge ветки `feat/cache-economics` |
| Проверки | `npm test` 31/31, typecheck; ранее (0.4.0) — загрузка OMP, TUI, `/new` и resume |
| Постоянные тесты | `test/extension.test.mjs`, 31 тест, `npm test` |
| CI | GitHub Actions, зелёный (`npm ci`, `npm test`, `typecheck`) |
| Рынок/конкуренты | `docs/research/cache-extensions.md` (2026-11-22) |
| Инструкции агенту | `AGENTS.md` + глобальный `~/.omp/agent/AGENTS.md` |
| Context guard | `omp-agent-workflow` 0.3.0, linked; warning 35/50, auto 60, `/handoff` |
| Automatic handoff | `/handoff-new`, marker, supervisor; 19 тестов, e2e пройден в Orca |
| Yoda workflow | `~/projects/omp-agent-workflow/docs/yoda-workflow.md` — отдельный продукт |
| npm / marketplace | не публиковались |
| Английский README | нет |

## Конкурентные приоритеты (2026-11-22)

Полный разбор — `docs/research/cache-extensions.md`, раздел 8.

Что тянем:

- Mode-aware статус и `/cache-monitor` — наша ниша; не размывать в дашборд.
- Warning-политику — причину мисса: простой (idle) или перезапись префикса
  (готово в 0.5.0).
- Resume/history — tree/compaction и границы resume.
- Zero-deps/read-only — не тащить warming/optimizer.
- Тесты/CI — каждое поведение с тестом.

Что забираем:

| Приоритет | Идея | Откуда | Решение |
|---|---|---|---|
| P1 | Причина мисса: idle / model switch / rewrite | `catitw` | В warnings 0.5.0: idle/rewrite per-turn. |
| P1 | `cache saved` и `miss premium` в `$` | `pi-cache-hit-monitor`, `omp-cache-meter` | В `/cache-monitor` 0.5.0; `≥` при неизвестных исторических ценах. |
| P2 | TTL / expiry countdown | `omp-cache-meter`, `ubranch`, `pi-custom-footer` | Только data-gated; на `cline-pass` — скрывать. |
| P2 | `/compact` payback | `omp-cache-meter` | После P1, когда есть цены и оценка summary. |
| P2 | История последних N запросов | `omp-cache-meter`, `pi-cache-hit-monitor` | Ring buffer/панель, не ломая статус. |
| P2 | Powerline-интеграция | `pi-powerline-footer` | Пример/доки через `customItems`. |
| P3 | Cold-cache budget | `pi-cache-guard` | Отдельный слой, рядом с warming. |
| P3 | Warming/optimizer/multi-session | `ubranch`, optimizers, Tern | Не наша read-only ниша сейчас. |

## Этап 0. Гигиена репозитория

| Задача | Статус |
|---|---|
| Сделать GitHub-репозиторий private | готово |
| Добавить `ROADMAP.md` и ссылку из HANDOFF | готово |
| Добавить `AGENTS.md` и глобальные правила | готово |
| Защитить `main` | не включаем при прямом ff-merge; включить при переходе на PR-поток |
| Завести метки/милстоуны GitHub | опционально |

## Этап 1. Контур качества (блокирует остальное)

### 1.1. Постоянный harness — готово

- `test/extension.test.mjs` импортирует реальный `index.ts` через Node 22
  `--experimental-strip-types` и подменяет `pi`/`ctx`.
- Покрыто: формула hit, спарклайн и усечение до 12, `saved` и `miss premium`,
  включая ходы без цен и `≥` после resume, сброс на `/new`, смена эпохи,
  причина мисса (idle/rewrite/без timestamp), пороги warnings, non-TUI no-op,
  restore после resume, границы эпохи в журнале, cache warming/компакция в
  суммах без ходов, отсутствие двойного счёта.
- `npm test` — 31/31, детерминированно, без сети и модели.

### 1.2. Типы — готово

- `@oh-my-pi/pi-coding-agent@19.1.0` — источник типов для `index.ts`;
  `@earendil-works/pi-coding-agent` — установленный runtime.
- devDependencies: `@oh-my-pi/pi-coding-agent@19.1.0`, `typescript@7.0.2`,
  `@types/node@22.20.5`; `tsconfig.json` с `NodeNext`/`ES2022`/`strict`/`noEmit`.
- `npm run typecheck` проходит; tarball по-прежнему 4 файла, devDependencies
  в него не попадают.

### 1.3. CI — готово

- `.github/workflows/ci.yml`: push/PR в `main`, Node 22, `npm ci`,
  `npm test`, `npm run typecheck`; `actions/checkout@v7`,
  `actions/setup-node@v7`; без секретов и вызовов модели.
- Прогон на GitHub зелёный; deprecated Node 20 в actions больше не всплывает.
- Защита `main` не включена: работа идёт прямыми ff-merge. Включить при
  переходе на PR-поток.

## Этап 2. Корректность lifecycle

### 2.1. Восстановление после resume — готово

API подтверждён: `session_start` содержит
`reason: "startup" | "reload" | "new" | "resume" | "fork"` и
`previousSessionFile`, а `ctx.sessionManager.getEntries()` отдаёт записи сессии.

- На `session_start` при `resume`/`fork`/`reload`/`startup` с непустой историей
  восстановить `last`, `prevPrompt` и тренд по последним assistant-сообщениям.
- Суммы сессии считать по всем usage-несущим записям:
  assistant-сообщения, `usage` (cache warming), `compaction.usage`,
  `branch_summary.usage`.
- Не считать compaction/cache-warming ходами и не подмешивать их в тренд.
- Первый ход после resume не сравнивать с прошлым префиксом: новая эпоха,
  без ложного warning.
- Критерий: после перезапуска/resume `/cache-monitor` показывает те же суммы,
  что OMP `/session` и JSONL; `/new` по-прежнему обнуляет.

Реализовано в 0.4.0: `aggregateEntries()` читает журнал на `session_start`
(все причины; пустой журнал у новой сессии) и восстанавливает суммы, ходы,
тренд, последний ход и пере-оплату. `/cache-monitor` пересчитывает суммы по
журналу, ходы/тренд/live-цены не пересобирает — поэтому повторная команда
заменяет, а не удваивает. Цены прошлых моделей в журнале отсутствуют:
восстановленная пере-оплата остаётся в токенах, `last.reBillCost` — `null`;
пере-оплата последнего хода перед resume консервативно не восстанавливается,
потому что граница resume не журналируется; более ранние границы resume тоже
не отмечены, поэтому их оценка приблизительная.

### 2.2. Compaction и cache warming — готово

- Учитывать `session_compact.compactionEntry.usage` в стоимости сессии.
- Учитывать `UsageEntry` (`kind: "cache_warm"`) в токенах и стоимости.
- Если live-события для usage entry нет, пересчитывать суммы по
  `getEntries()` при вызове `/cache-monitor`.
- Критерий: стоимость сессии совпадает с native `/session` после компакции
  и cache warming.

Реализовано в 0.4.0: `usage` (любой kind) и `model_usage` (в OMP 19.1:
cache warming, title/composer и др.), `compaction.usage` и
`branch_summary.usage` добавляют только стоимость, не токены hit/ходы/тренд.
Ограничение: смена набора инструментов не журналируется, поэтому после
resume её нельзя восстановить как границу эпохи.

## Этап 2.5. P1 из конкурентного анализа — готово (P1)

- **Причина мисса в warning**: простой (idle) или перезапись префикса,
  per-turn; смена модели/thinking/tools остаётся границей эпохи и не
  предупреждает.
- **`cache saved` и `miss premium`** в `/cache-monitor`: сколько сэкономлено
  на cache-read против полной цены и сколько переплачено на miss premium.
  При неизвестных исторических ценах — `≥` или пропуск, без выдуманных чисел.
- Тесты на оба поведения, обновить README/HANDOFF.
- Критерий: warning объясняет причину, отчёт показывает saved/miss premium в
  деньгах и не врёт после resume.

Реализовано в 0.5.0: `turn_end` читает `message.timestamp` и считает простой
между завершёнными ходами; канонический промах печатает `простой N мин` при
разрыве ≥ 5 минут (эмпирический порог, не TTL провайдера) либо
`перезапись префикса`. `lastTurnAt` сбрасывается на границе эпохи, поэтому
простой через неё новому префиксу не приписывается; без timestamp причина —
перезапись, а ход без timestamp разрывает цепочку простоя.
`saved` и `miss premium` считаются одним helper `cacheDeltaCost` по
`model.cost`; `saved` входит в строку хода и в итог сессии, `miss premium` —
отдельной частью перед трендом. После resume восстановленный `cacheRead` не
оценивается: `saved` считает только live-часть и показывает `≥`. Тестов 31,
typecheck зелёный; `epochCause` удалён.

## Этап 2.6. Context guard / handoff — готово (P1)

Практическая политика для 1M-моделей (`deepseek-v4.1-flash-1017`,
`glm-5.3`, `qwen3.8-max`, `kimi-k3`): 1M — технический максимум, не
эффективный бюджет. Для кодинга держим soft-бюджет 250k, компактим на
400–500k, жёстко останавливаемся на 600k. Точную границу надо мерить на
своих задачах (needle/recall + replay), а не брать из каталога.

| Контекст | Действие |
|---|---|
| < 25% (≤250k) | Работаем нормально, ничего не делаем. |
| 25–35% (250–350k) | Watch: не читать гигантские файлы, не тащить лишние логи. |
| 35–50% (350–500k) | Warning + предложить `/handoff`; компакция на фазовой границе. |
| 50–60% (500–600k) | Компакция на ближайшей безопасной границе (после хода, без tool in flight). |
| > 60% (600k+) | Форсировать handoff/compact. |

- Native OMP auto-compaction по умолчанию срабатывает на
  `contextWindow - 16 384`, то есть на **98.4%** окна (≈1.03M для 1 048 576,
  ≈984k для 1 000 000) — слишком поздно. Для 1M-моделей выставить
  `compaction.modelOverrides` с
  `reserveTokens: 500000` (триггер ~549k) или 600000 (триггер ~449k).
- Слово-триггер: **`HANDOFF`**. Семантика: «сохрани цель, решения,
  изменённые файлы, проверки и следующие шаги, затем сожми». Команда
  `/handoff` вызывает `ctx.compact(instructions)`; native `/compact` остаётся.
- `context_pct` уже есть в native status line; свой процент не дублируем.
  Наш guard — только warning/команда, не второй сегмент.
- Авто-компакцию не делаем посреди tool-loop или незавершённого edit;
  только после `turn_end`, когда `ctx.isIdle()`.
- Критерий: warning на 35%, предложение на 50%, авто-компакция на 60% только
  в безопасной точке; `/handoff` сохраняет решения и следующие шаги; тесты
  на `getContextUsage()`.

Реализовано в `omp-agent-workflow` 0.3.0: warning 35/50, авто-компакция на 60%
после `turn_end`/`agent_end` при `ctx.isIdle()` и без очереди, команда
`/handoff`; 19 тестов и typecheck. Пороги переопределяются через
`OMP_CONTEXT_WARN`, `OMP_CONTEXT_SUGGEST`, `OMP_CONTEXT_AUTO` (число или
`off`). Расширение установлено через `omp plugin link`.

## Этап 2.7. Handoff в новую сессию — clean window — готово (P1)

Компакция остаётся аварийным предохранителем, но для длинной работы
предпочтителен управляемый перенос в новую сессию: меньше потерь, чище
префикс, понятная точка старта.

- `/handoff-new`: команда, которая после обновления `HANDOFF.md`/`STATE.md`
  вызывает `ctx.newSession({ parentSession })` и оставляет старую сессию
  родителем.
- OMP 19.1 даёт `newSession` только в `ExtensionCommandContext`; из
  event-handler (turn_end/agent_end) новую сессию начать нельзя. Поэтому это
  команда, а не авто-событие.
- Новая сессия стартует с чистым окном и читает `HANDOFF.md`; summary
  компакции не является заменой state-файлу.
- Кэш: новая сессия холодная, но префикс можно сделать маленьким (только
  нужные файлы/решения), поэтому это может быть дешевле, чем большой
  compacted prefix. Модель/thinking/tools не менять без причины.
- Критерий: `/handoff-new` создаёт новую сессию, старая остаётся в истории,
  state читается, дублирующей активной сессии нет.

Реализовано в `omp-agent-workflow` 0.3.0: `/handoff-new` ждёт idle, проверяет
`HANDOFF.md`, вызывает `ctx.newSession` и добавляет custom message
«прочитай HANDOFF.md и продолжай». В реальном TUI новая сессия открылась.

### Cache-monitor как инструмент решения

- Показывать в `/cache-monitor` рекомендацию: `handoff` на границе задачи при
  context ≥ 50% или высоком miss cost; `compact` — если задача одна и длинная.
- Не запускать новую сессию автоматически без команды/супервизора.

## Этап 2.8. Supervisor для unattended — готово (P2, e2e)

- Внешний watchdog (shell-скрипт или Orca bot), а не отдельный LLM-надзиратель
  на первом этапе: он смотрит marker/context/idle и вызывает `/handoff-new`
  или перезапускает OMP с новой сессией.
- Проверяет: новая сессия стартовала, старая остановлена, `HANDOFF.md`
  прочитан, нет двух активных сессий.
- Авто-компакция остаётся fallback на 60–75%; supervisor не должен работать
  без бюджета, stop-условий и лога решений.
- Критерий: при отсутствии владельца агент доходит до границы задачи,
  делает handoff и продолжает; при ошибке — останавливается и пишет причину.

Реализовано в `omp-agent-workflow` 0.3.0: `bin/omp-handoff-supervisor.mjs`
читает session info и marker, отправляет `/handoff-new` через
`orca terminal send`, затем continuation prompt. Есть `--dry-run`.

E2E в реальном Orca-терминале пройден: supervisor отправил `/handoff-new`,
новая сессия стартовала и прочитала `HANDOFF.md`. Cooldown 300 с и
stale-marker guard (`sessionFile`) не дают уйти в цикл повторных handoff.

## Этап 2.9. Yoda workflow mode — режимы готовы, оркестратор дизайн

- Режимы: `manual`, `assisted`, `yoda`, `yoda-supervised`.
- Оркестратор — main; implementer/verifier/reviewer/scout — subagent'ы;
  supervisor — внешний watchdog для смены сессии.
- `yoda` без supervisor умеет только компакцию; `yoda-supervised` делает
  clean-window handoff через `/handoff-new`.
- Конфиг: `workflow.mode`, пороги, бюджеты, stop-gates.
- Полный дизайн: `~/projects/omp-agent-workflow/docs/yoda-workflow.md`.
- Критерий: режим переключается конфигом, цикл проходит N задач с тестами,
  handoff на границе, stop-gate останавливает работу.

Реализовано в `omp-agent-workflow` 0.3.0: `OMP_WORKFLOW_MODE` =
`manual`/`assisted`/`yoda`/`yoda-supervised`; `yoda` даёт handoff на 55% и
auto-compaction fallback 70%, `manual` выключает оба, `assisted` — прежнее
поведение (auto 60, без handoff). Оркестратор/subagent-петля ещё дизайн.

## Этап 3. TTL: data-gated (P2)

Проверено:

- `omp models --json` для `cline-pass/deepseek-v4.1-flash-1017` отдаёт
  `promptCache: null` — провайдер не декларирует TTL.
- OMP хранит `CACHE_TTL_MS` как эвристику (5 минут, дефолт Anthropic) и
  модельные `promptCache`-оценки, а не точное время истечения от провайдера.
- Native-сегмент `cache` уже существует; в текущем `statusLine` он не включён.

Решение: **P2, data-gated, не показывать countdown на `cline-pass`**. Это была
бы догадка, а не метрика. Если добавляем: lifetime из `model.promptCache` или
`cache_control.ttl`, время последнего запроса/записи, остаток `~mm:ss`;
данных нет — скрыть или `n/a`. Native OMP `cache`-сегмент уже показывает
warm/cold и причину инвалидации, поэтому TTL не должен дублировать его.

## Этап 4. Релиз-кандидат

### 4.1. Английский README

- Решить формат: `README.md` на английском + `README.ru.md`, либо двуязычный.
- Обновить установку: private GitHub требует авторизации; npm — после публикации.
- Критерий: команды проверены, текст без обещаний несуществующего TTL.

### 4.2. Пакет и установка из tarball

- Добавить `repository`, `homepage`, `bugs`, `engines` в `package.json`.
- `npm pack --dry-run`: в tarball только `index.ts`, `README.md`, `LICENSE`,
  `package.json`.
- Установить tarball в чистый OMP-профиль и проверить `/cache-monitor`.
- Критерий: установка из tarball работает без `plugin link`.

### 4.3. Тег и GitHub release

- `CHANGELOG.md`, тег `v0.5.0` после этапа 2.5, private GitHub release.
- Проверить `omp plugin install github:metapeka/omp-cache-monitor` под
  авторизованным аккаунтом.
- Критерий: чистая машина/профиль ставит плагин из GitHub.

## Этап 5. Публикация (только по решению владельца)

- npm publish.
- Marketplace-каталог с `.omp-plugin/marketplace.json`.
- Смена репозитория на public.
- Анонс и публичная инструкция.

## Порядок и зависимости

1. Этап 1 — тесты и CI. Без него не мержим поведенческие изменения.
2. Этап 2 — resume и полный учёт usage. Это ядро корректности.
3. Этап 2.5 — готово: причина мисса (idle/rewrite) и saved/miss premium.
4. Этап 2.6 — готово: context guard и `/handoff` в `omp-agent-workflow`.
5. Этап 2.7 — готово: `/handoff-new`, state, `newSession`.
6. Этап 2.8 — готово (e2e в Orca): supervisor.
7. Этап 2.9 — режимы готовы; оркестратор — дизайн в `omp-agent-workflow`.
8. Этап 3 — TTL, только data-gated, без реализации на догадках.
9. Этап 4 — английский README, пакет, установка, тег.
10. Этап 5 — публикация, только после явного разрешения.

## Агенты

| Агент | Задача | Тип |
|---|---|---|
| `TestHarness` | 1.1: постоянный harness и `npm test` | task |
| `Typecheck` | 1.2: типы и `npm run typecheck` | task |
| `CI` | 1.3: GitHub Actions и защита `main` | task |
| `ResumeImplementer` | 2.1–2.2: восстановление и полный учёт usage | task |
| `CacheEconomics` | 2.5: готово, причина мисса, saved/miss premium | task |
| `ContextGuard` | 2.6: готово в `omp-agent-workflow` 0.3.0, 19 тестов | task |
| `HandoffNew` | 2.7: готово в `omp-agent-workflow` 0.3.0 | task |
| `Supervisor` | 2.8: готово, e2e в Orca пройден | task, опция |
| `YodaOrchestrator` | 2.9: режимы, план/state, оркестрация | task |
| `Reviewer` | ревью каждого поведенческого PR | reviewer |
| `DocsEnglish` | 4.1: английский README | task |
| `ReleaseCheck` | 4.2–4.3: tarball, тег, установка | task |
| `ReleasePublisher` | 5: npm/marketplace/public | task, только по разрешению |

Правила: агент работает в своём worktree, не трогает `main`, не мержит сам;
интеграцию и финальную проверку делает основной агент.

## Критерии готовности

- `npm test` и typecheck зелёные в CI.
- Resume, compaction и cache warming не занижают и не удваивают суммы.
- `/cache-monitor` и `/session` сходятся по токенам и стоимости.
- Нет ложных warning на первом ходе после resume/компакции.
- Tarball ставится в чистый профиль.
- Английский README и установка проверены.
- npm/marketplace/public — только после отдельного решения.

## Риски

- Внутренний API OMP меняется между версиями; фиксируем 19.1.0 и проверяем
  обновления тестами.
- `getEntries()` может включать чужие ветки и fork-родителя; для стоимости
  это ок, для тренда нужно брать только assistant-ходы.
- Cache warming и compaction могут не приходить live-событием; спасает
  пересчёт по записям при вызове команды.
- TTL у `cline-pass` не подтверждён; countdown запрещён до появления данных.
- Private GitHub усложняет установку `github:` без авторизации; npm позже.
