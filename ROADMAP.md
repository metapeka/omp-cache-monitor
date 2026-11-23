# Roadmap: omp-cache-monitor

Дата: 2026-11-23. Версия: 0.10.1. GitHub: private.
Цель: довести расширение до релиза, которому можно доверять по цифрам,
установке и поведению на всех переходах сессии.

## Принципы

- Сначала корректность метрик и lifecycle, потом публикация.
- Один файл расширения `index.ts`, без runtime-зависимостей.
- Любая задача — отдельный worktree `feat/<slug>` от `main`; merge только
  `--ff-only`. Worktree удаляется после merge; ветка остаётся ref'ом для
  аудита и восстановления (удаление — только по решению владельца).
- Публикация npm/marketplace и смена видимости репозитория — только по
  явному решению владельца.
- Один агент — один worktree. Параллельные правки одного файла запрещены.

## Текущее состояние

| Что | Состояние |
|---|---|
| Версия | 0.10.1: Phase 4 + GitHub release `v0.10.1` |
| GitHub | `metapeka/omp-cache-monitor`, private, `main` |
| Установка | `omp plugin link` на боевой чекаут; `omp plugin list` — `omp-cache-monitor@0.10.1` |
| Проверки | `npm test` 85/85, typecheck, `npm pack` — 4 файла; runtime: `omp plugin config list` с 15 ключами, TUI `/cache-monitor settings`/`help` на `ru` и `en`, онбординг-подсказка |
| Постоянные тесты | `test/extension.test.mjs`, 85 тестов, `npm test` |
| CI | GitHub Actions, зелёный (`npm ci`, `npm test`, `typecheck`) |
| Рынок/конкуренты | `docs/research/cache-extensions.md` (2026-11-22) |
| Инструкции агенту | `AGENTS.md` + глобальный `~/.omp/agent/AGENTS.md` |
| Context guard | `omp-agent-workflow` 0.5.4, linked; warning 35/50, auto 60, `/handoff` |
| Automatic handoff | `/handoff-new`, marker, supervisor; 19 тестов, e2e пройден в Orca |
| Yoda workflow | `~/projects/omp-agent-workflow/docs/yoda-workflow.md` — отдельный продукт |
| npm / marketplace | не публиковались; публикация отложена владельцем 2026-11-22 — фокус на продукт |
| README | `README.md` (EN, main) + `docs/README.zh.md` (ZH) + `docs/README.ru.md` (RU) |

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
| P2 | TTL / expiry countdown | `omp-cache-meter`, `ubranch`, `pi-custom-footer` | Data-gated: на `cline-pass` lifetime нет. Дизайн и чеклист для будущих провайдеров — этап 3. |
| P2 | `/compact` payback | `omp-cache-meter` | **Не делаем**: с кэшем допущение «removed-токены платились бы каждый ход» ложно → цифра будет врать. |
| P2 | История последних N запросов | `omp-cache-meter`, `pi-cache-hit-monitor` | Готово в 0.6.0: `/cache-monitor history`, окно 8, без панели. |
| P2 | Разбивка стоимости по типам записей | `omp-cache-meter` | Готово в 0.7.0: `/cache-monitor costs`, только `cost.total`, `?`/`≥` без оценок. |
| P2 | UI/настройки и справка | `omp-cache-meter`, OMP plugin settings | Готово в 0.8.0: 8 ключей в `omp.settings`, runtime-чтение, `/cache-monitor settings` и `help`; defaults сохраняют прежний вывод. Phase 1.5 в 0.8.1: группы в описаниях и `settings`, help из 8 строк, `docs/omp-docs-map.md`. Phase 2 в 0.9.0: `language: ru\|en`, 9 ключей, единый словарь строк, EN-тесты без кириллицы. Phase 3 в 0.10.0: `preset` + 5 advanced-ключей, 15 ключей, 84 теста. Phase 4 в 0.10.1: онбординг-подсказка, скриншоты, upstream `group`/`icon` (#20253), 85 тестов. |
| P2 | Powerline-интеграция | `pi-powerline-footer` | Готово в 0.9.1: `docs/powerline.md`, нативный `statusLine`/`powerline-thin` и пример `customItems` (`statusKey: "cache-monitor"`); кода не требуется. В 0.10.0 добавлен второй элемент `cache-monitor-cost` для `statusShowCost`. |
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
  включая ходы без цен и `≥` после resume, история 8 ходов (live, окно,
  resume, `/new`/`/clear`, неизменный дефолтный отчёт), сброс на `/new`, смена
  эпохи, причина мисса (idle/rewrite/без timestamp), пороги warnings,
  non-TUI no-op, restore после resume, границы эпохи в журнале, cache
  warming/компакция в суммах без ходов, отсутствие двойного счёта.
- `npm test` — 37/37, детерминированно, без сети и модели.

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
оценивается: `saved` считает только live-часть и показывает `≥`. Тестов 37,
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

## Этап 2.8. История последних ходов — готово (P2)

- `/cache-monitor history` (алиас `hist`): последние 8 завершённых ходов —
  hit, `prompt`, `saved`, `miss premium` и причина канонического промаха.
- Read-only, zero-deps, одна notification; дефолтный отчёт без аргумента не
  меняется, статус-строка и окно тренда не задеты.
- Причина не приписывается первому ходу эпохи; деньги восстановленных ходов
  не выдумываются (`saved ?`, `miss premium ? (N tok)`), `reBilled` последней
  записи после resume не показывается.
- Окно 8; `/new` очищает, resume/fork восстанавливает, `/clear` сохраняет.
- Тесты: live-история с причинами, окно, resume с `?`, lifecycle, неизменный
  дефолтный отчёт.
- Критерий: история читается одной командой, не ломает дефолтный вывод и не
  врёт после resume.

Реализовано в 0.6.0: `TurnRecord`/`history` в live-состоянии и
`SessionAggregate`, восстановление из журнала, `missCause`/`isCanonicalMiss`
общие с warning, формат `история (N/8):`. Тестов 37.

## Этап 2.9. Supervisor для unattended — готово (P2, e2e)

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

## Этап 2.10. Yoda workflow mode — режимы готовы, оркестратор дизайн

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

## Этап 2.11. Разбивка стоимости — готово (P2)

- `/cache-monitor costs` (алиас `cost`): фактическая разбивка стоимости
  сессии по типам записей журнала — `диалог`, `компакция`, `ветка`,
  `usage:<kind>`, `model_usage:<purpose>` (префиксы срезаны).
- Источник — только `usage.cost.total`; неизвестная цена даёт `?` (цена 0)
  или `≥$X` (часть известна), заголовок получает `≥`. Оценок нет.
- Read-only, zero-deps, одна notification; дефолтный отчёт и `history` не
  меняются, статус-строка не задета.
- Повторный вызов идемпотентен (карта заменяется снимком журнала), `/new`
  очищает, resume восстанавливает из журнала.
- Тесты: журнальные бакеты и сортировка, live без журнала, идемпотентность и
  `/new`, resume против `сессия: $…`, `?`/`≥`, неизменные дефолт и история.
- Критерий: разбивка читается одной командой, не меняет прежний вывод и не
  выдумывает деньги.

Реализовано в 0.7.0: `CostBucket`/`SessionAggregate.costs`, live-бакет
`диалог` в `turn_end`, `costBucket`/`addCost`/`costReport`. Тестов 46.

## Этап 2.12. Настройки плагина и справка — Phase 1–4 готово (P2)

- Схема `package.json` → `omp.settings`: 15 ключей (`preset`,
  `statusEnabled`, `statusShowMode`, `statusShowCost`, `warningsEnabled`,
  `lowHitPercent`, `idleMinutes`, `minPromptTokens`, `warnCanonicalMiss`,
  `minPrevPromptTokens`, `oncePerEpoch`, `historySize`, `trendSize`,
  `showMoney`, `language`) с `default`, границами/enum и английскими
  `description` в формате `Group · what. Default/range. Why.` (`Preset ·`,
  `Status ·`, `Warnings ·`, `Reports ·`). OMP показывает их в
  Settings → Plugins и в `omp plugin config list/set`.
- Runtime читает настройки через `getPluginSettings(pluginName, cwd)` на
  `session_start`/`session_switch` (до restore) и перед командами; любая
  ошибка внутреннего API — defaults, без падения расширения.
- Применение: `preset` — база остальных ключей (явный ключ сильнее);
  `statusEnabled`/`statusShowMode`/`statusShowCost` — статус-строка
  (`statusShowCost` публикует второй ключ `cache-monitor-cost`);
  `warningsEnabled`/`lowHitPercent`/`minPromptTokens`/`warnCanonicalMiss`/
  `minPrevPromptTokens`/`oncePerEpoch` — предупреждения;
  `idleMinutes` — причина простоя в warning и restore;
  `historySize`/`trendSize` — live/restore-окна истории и спарклайна;
  `showMoney` — `saved` и деньги `miss premium` (токены остаются),
  `/cache-monitor costs` деньги не скрывает; `language` — язык всех
  пользовательских строк (метрики и формат не меняются).
- `/cache-monitor settings` (алиас `setting`) — группы `🎛 Пресет`,
  `⚙ Статус`, `⚠️ Предупреждения`, `📊 Отчёты` (EN `🎛 Preset`/`⚙ Status`/
  `⚠️ Warnings`/`📊 Reports`), 15 значений, `(changed)`/`(default)`,
  статичные подписи и наличие цен модели; `/cache-monitor help` (алиас `?`) —
  справка из 8 строк:
  `↺` («чем выше, тем дешевле»), промах = `cacheRead 0`, подкоманды,
  настройки и ссылки на `README.md`, `docs/ui-settings.md`,
  `docs/omp-docs-map.md`. Обе команды печатаются на языке `language`.
- Defaults сохраняют вывод 0.7.0 побайтово; старые тесты не переписаны, кроме
  точных ожиданий `settings`/`help`.
- Документация: `docs/ui-settings.md` (RU) с ограничениями UI OMP и роудмапом
  фаз, `docs/omp-docs-map.md` (карта 135 файлов встроенной документации OMP),
  разделы Settings в README (EN) и `docs/README.ru.md`.
- Критерий: настройки видны OMP, меняют поведение, не ломают прежний вывод и
  переживают недоступность внутреннего API; группа и смысл ключа читаются без
  открытия кода; `language: en` не оставляет кириллицы в выводе.

Реализовано в 0.8.0: `Config`/`DEFAULT_CONFIG`/`normalizeConfig` (named
export), `readSettings`, `AggregateOptions`; тестов 60 (46 старых + 14 новых),
typecheck зелёный, `npm pack` — 4 файла.

Phase 1.5 — в 0.8.1: сгруппированные `description`, группы и подписи в
`/cache-monitor settings`, `help` из 8 строк, `docs/omp-docs-map.md` и
чеклист фаз. Тестов 60, typecheck, `npm pack` — 4 файла; поведение и метрики
не менялись.

Phase 2 — в 0.9.0: девятый ключ `language` (`enum ["ru","en"]`, default
`ru`), `TEXTS: Record<Language, Texts>` как единственное место строк,
структурная причина `{ kind: "idle"; minutes: number } | { kind: "rewrite" }` и
`causeText(cause, language)`, английские `description` остались прежними.
Тестов 68 (60 + 8 EN/нормализация), каждая EN-проверка запрещает кириллицу;
`ru` (default) сохраняет прежний вывод, кроме строки `language` в `settings`.

Phase 3 — в 0.10.0: `preset` (`balanced`/`quiet`/`verbose`/`custom`) +
advanced-ключи (`warnCanonicalMiss`, `minPrevPromptTokens`, `oncePerEpoch`,
`trendSize`, `statusShowCost`), 15 ключей всего. Явно заданный ключ сильнее
пресета, `custom` — defaults + individual keys, `language` пресет не меняет.
`statusShowCost` публикует второй статус-ключ `cache-monitor-cost`; hit-строка
не меняется. Тестов 84 (68 + 16). Defaults без настроек и `ru`-вывод
байт-в-байт прежние (кроме новых строк `settings`). Детали — `docs/ui-settings.md`.

Phase 4 — в 0.10.1: первый канонический промах за процесс добавляет одну
строку-подсказку (`/cache-monitor settings` и `preset`, RU/EN); скриншоты
Settings → Plugins и `settings`, demo-GIF — в README (EN/ZH/RU), файлы
`docs/images/`; upstream-предложение `group`/`icon` заведено —
<https://github.com/can1357/oh-my-pi/issues/20253>, локальная копия —
`docs/upstream-settings-groups.md`. Документация: English (основной), 中文,
Русский; таблица конкурентов и Mermaid-схемы. README: логотип, badges,
сворачиваемое Contents. Тестов 85. Метрики и остальные warning-и не меняются.

**Релиз v0.10.1 выполнен** —
<https://github.com/metapeka/omp-cache-monitor/releases/tag/v0.10.1> (tarball
asset). TTL — data-gated, этап 5 (npm/marketplace) и P2 — только по решению
владельца.

## Этап 3. TTL: data-gated (P2)

Проверено:

- `omp models --json` для `cline-pass/deepseek-v4.1-flash-1017` отдаёт
  `promptCache: null` — провайдер не декларирует TTL.
- OMP хранит `CACHE_TTL_MS` как эвристику (5 минут, дефолт Anthropic) и
  модельные `promptCache`-оценки, а не точное время истечения от провайдера.
- Native-сегмент `cache` уже существует; в текущем `statusLine` он не включён.

Решение: **P2, data-gated, не показывать countdown на `cline-pass`**. Это была
бы догадка, а не метрика. Native OMP `cache`-сегмент уже показывает warm/cold и
причину инвалидации, поэтому TTL не должен дублировать его.

### Если появится провайдер с lifetime

Чеклист на будущее, чтобы фичу сделали без догадок:

1. **Источник lifetime.** Только factual: `model.promptCache.ttl` из каталога
   или `cache_control.ttl` из фактического запроса. Нет ни одного — TTL
   скрывается, не показывается `n/a` вместо цифры.
2. **Точка отсчёта.** Время последнего хода с `cacheWrite > 0`
   (`message.timestamp`); на `/clear`/смене модели/компакции таймер сбрасывается
   вместе с эпохой.
3. **Остаток.** `remaining = lastWrite + ttl - now`; `≤ 0` → `cold`. Показывать
   `~mm:ss` только при обоих известных значениях.
4. **Resume.** Timestamp берётся из журнала; если запись cacheWrite не найдена
   или TTL модели неизвестен — TTL не показывать. Остаток после рестарта не
   выдумывать.
5. **Тесты.** known lifetime; нет lifetime → скрыто; переход warm→cold; resume
   без timestamp → скрыто; сброс на границе эпохи; отсутствие второго
   статус-сегмента (native `cache` уже есть).
6. **Критерий.** Ни одной цифры без factual lifetime и timestamp; на
   `cline-pass` поведение не меняется (скрыто).

### `/compact` payback

Не делаем. Оценка «окупится за N ходов» требует допущения, что удалённые
токены иначе оплачивались бы каждый ход. При живом кэше это неверно: после
компакции платится только новый input, а старый префикс был бы cache-read.
Корректная оценка возможна только вместе с TTL/вероятностью мисса, которых на
`cline-pass` нет. Показывать такую цифру — врать.

## Этап 4. Релиз-кандидат

### 4.1. Английский README — готово

- Формат: `README.md` на английском, русская версия — `docs/README.ru.md`,
  переключатель в обоих файлах.
- Установка: отмечено, что private GitHub требует авторизации; npm не
  публиковался.
- Критерий выполнен: команды сверены с кодом, TTL не обещается.

### 4.2. Пакет и установка из tarball — готово (с оговоркой)

- `package.json`: добавлены `repository`, `homepage`, `bugs`, `engines`
  (`node >=22`).
- `npm pack --dry-run`: ровно 4 файла — `index.ts`, `README.md`, `LICENSE`,
  `package.json`; русский README лежит в `docs/` и в пакет не попадает.
- OMP 19.1 **не принимает `.tgz`** в `omp plugin install` (tar-путь
  трактуется как каталог: `ENOTDIR`; `file:` — «Invalid package name»).
  Проверка сделана эквивалентно: tarball поставлен в чистый `HOME` через
  `npm install --prefix <home>/.omp/plugins <tgz>`, OMP увидел
  `omp-cache-monitor@0.6.0`, TUI напечатал `/cache-monitor` и
  `/cache-monitor history` без `plugin link`; распакованный каталог также
  ставится через `omp plugin install <dir>`.
- Критерий уточнён: «пакет из tarball самодостаточен и грузится в чистом
  профиле»; прямой `.tgz`-install в OMP 19.1 недоступен.

### 4.3. Тег и GitHub release — готово

- `CHANGELOG.md` 0.6.0, тег `v0.6.0`, private GitHub release с tarball-ассетом.
- `github:`-сокращение в OMP 19.1 для private-репозитория даёт 404
  (неавторизованный API); рабочая установка:
  `omp plugin install git+ssh://git@github.com/metapeka/omp-cache-monitor.git`.
- Проверено в чистом `HOME`: установка из GitHub, `omp plugin list` → 0.6.0,
  TUI `/cache-monitor` работает.
- Критерий выполнен для авторизованного пользователя (SSH-ключ).

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
6. Этап 2.8 — готово: история последних 8 ходов в `/cache-monitor history`.
7. Этап 2.9 — готово (e2e в Orca): supervisor.
8. Этап 2.10 — режимы готовы; оркестратор — дизайн в `omp-agent-workflow`.
9. Этап 2.11 — готово: разбивка стоимости в `/cache-monitor costs`.
10. Этап 2.12 — готово: настройки Phase 1/1.5, Phase 2 (девятый ключ `language`, EN-вывод), Phase 3 (`preset` + 5 advanced-ключей, 15 ключей; `settings`/`help`, `docs/omp-docs-map.md`) и Phase 4 (онбординг, скриншоты, upstream `group`/`icon`, 85 тестов).
    - **Следующая:** release 0.10.1 по решению владельца; scope — `HANDOFF.md`.
11. Этап 3 — TTL, только data-gated, без реализации на догадках.
12. Этап 4 — готово (0.6.0): английский README, пакет, tarball, тег/release.
13. Этап 5 — публикация, только после явного разрешения.

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
| `TurnHistory` | 2.8: готово, история 8 ходов в `/cache-monitor` | task |
| `UiSettings` | 2.12: готово, `omp.settings` (9 ключей), группы, `settings`/`help`, `language: ru\|en`, docs/ui-settings.md, docs/omp-docs-map.md | task |
| `UiPresets` | 2.12 Phase 3: готово, `preset` + advanced-ключи (0.10.0), 15 ключей, 84 теста | task |
| `UiOnboarding` | 2.12 Phase 4: готово (0.10.1), подсказка на первом промахе, скриншоты, upstream #20253 | task |
| `Supervisor` | 2.9: готово, e2e в Orca пройден | task, опция |
| `YodaOrchestrator` | 2.10: режимы, план/state, оркестрация | task |
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
