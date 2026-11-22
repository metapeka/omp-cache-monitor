# Roadmap: omp-cache-monitor

Дата: 2026-11-22. Версия: 0.4.0. GitHub: private.
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
| Версия | 0.4.0: resume-восстановление, полный учёт cache warming/компакции |
| GitHub | `metapeka/omp-cache-monitor`, private, `main` |
| Установка | `omp plugin link` на боевой чекаут; `omp plugin list` — 0.4.0 |
| Проверки | `npm test` 22/22, typecheck, загрузка OMP, TUI, `/new` и resume |
| Постоянные тесты | `test/extension.test.mjs`, 22 теста, `npm test` |
| CI | GitHub Actions, зелёный (`npm ci`, `npm test`, `typecheck`) |
| Рынок/конкуренты | `docs/research/cache-extensions.md` (2026-11-22) |
| npm / marketplace | не публиковались |
| Английский README | нет |

## Конкурентные приоритеты (2026-11-22)

Полный разбор — `docs/research/cache-extensions.md`, раздел 8.

Что тянем:

- Mode-aware статус и `/cache-monitor` — наша ниша; не размывать в дашборд.
- Warning-политику — добавить причину мисса: idle > TTL, смена модели,
  перезапись префикса.
- Resume/history — tree/compaction и границы resume.
- Zero-deps/read-only — не тащить warming/optimizer.
- Тесты/CI — каждое поведение с тестом.

Что забираем:

| Приоритет | Идея | Откуда | Решение |
|---|---|---|---|
| P1 | Причина мисса: idle / model switch / rewrite | `catitw` | В warnings, после текущей epoch-логики. |
| P1 | `cache saved` и `miss premium` в `$` | `pi-cache-hit-monitor`, `omp-cache-meter` | В `/cache-monitor`; `≥` при неизвестных исторических ценах. |
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
| Защитить `main` | не включаем при прямом ff-merge; включить при переходе на PR-поток |
| Завести метки/милстоуны GitHub | опционально |

## Этап 1. Контур качества (блокирует остальное)

### 1.1. Постоянный harness — готово

- `test/extension.test.mjs` импортирует реальный `index.ts` через Node 22
  `--experimental-strip-types` и подменяет `pi`/`ctx`.
- Покрыто: формула hit, спарклайн и усечение до 12, накопление `мисс`,
  включая ходы без цен, сброс на `/new`, смена эпохи, пороги warnings,
  non-TUI no-op, restore после resume, границы эпохи в журнале,
  cache warming/компакция в суммах без ходов, отсутствие двойного счёта.
- `npm test` — 22/22, детерминированно, без сети и модели.

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

## Этап 2.5. P1 из конкурентного анализа

- **Причина мисса в warning**: idle > TTL, смена модели, перезапись префикса.
  Сейчас `epochCause` знает модель/thinking/tools/компакцию, но не idle и не
  перезапись.
- **`cache saved` и `miss premium`** в `/cache-monitor`: сколько сэкономлено
  на cache-read против полной цены и сколько переплачено на miss premium.
  При неизвестных исторических ценах — `≥` или пропуск, без выдуманных чисел.
- Тесты на оба поведения, обновить README/HANDOFF.
- Критерий: warning объясняет причину, отчёт показывает saved/miss premium в
  деньгах и не врёт после resume.

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

- `CHANGELOG.md`, тег `v0.5.x` после этапа 2.5, private GitHub release.
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
3. Этап 2.5 — P1 cache economics: причина мисса и saved/miss premium.
4. Этап 3 — TTL, только data-gated, без реализации на догадках.
5. Этап 4 — английский README, пакет, установка, тег.
6. Этап 5 — публикация, только после явного разрешения.

## Агенты

| Агент | Задача | Тип |
|---|---|---|
| `TestHarness` | 1.1: постоянный harness и `npm test` | task |
| `Typecheck` | 1.2: типы и `npm run typecheck` | task |
| `CI` | 1.3: GitHub Actions и защита `main` | task |
| `ResumeImplementer` | 2.1–2.2: восстановление и полный учёт usage | task |
| `CacheEconomics` | 2.5: причина мисса, saved/miss premium | task |
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
