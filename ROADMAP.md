# Roadmap: omp-cache-monitor

Дата: 2026-11-22. Версия: 0.3.0. GitHub: private.
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
| Версия | 0.3.0: hit, trend, стоимость мисса за сессию, warnings, `/cache-monitor` |
| GitHub | `metapeka/omp-cache-monitor`, private, `main` |
| Установка | `omp plugin link` на боевой чекаут; `omp plugin list` — 0.3.0 |
| Проверки | разовый harness 8/8, загрузка OMP, TUI и `/new` |
| Постоянные тесты | нет |
| CI | нет |
| npm / marketplace | не публиковались |
| Английский README | нет |

## Этап 0. Гигиена репозитория

| Задача | Статус |
|---|---|
| Сделать GitHub-репозиторий private | готово |
| Добавить `ROADMAP.md` и ссылку из HANDOFF | готово |
| Защитить `main` после появления CI | ждёт этап 1.3 |
| Завести метки/милстоуны GitHub | опционально |

## Этап 1. Контур качества (блокирует остальное)

### 1.1. Постоянный harness

- Добавить `test/extension.test.mjs`, который импортирует реальный `index.ts`
  через Node 22 `--experimental-strip-types` и подменяет `pi`/`ctx`.
- Покрыть: формулу hit, спарклайн и его усечение до 12, накопление `мисс`,
  включая ходы без цен, сброс на `/new`/`/fork`/`/switch`, смену эпохи,
  пороги warnings, non-TUI no-op.
- Добавить `npm test`.
- Критерий: детерминированно, без сети и модели, exit 0.

### 1.2. Типы

- Проверить, можно ли подключить типы `@earendil-works/pi-coding-agent`
  как devDependency; если да — `tsconfig.json` и `npm run typecheck`.
- Если пакет недоступен — зафиксировать ручную проверку и не добавлять
  фиктивные типы.
- Критерий: `noEmit` проходит на `index.ts`.

### 1.3. CI

- `.github/workflows/ci.yml`: Node 22, `npm test`, `npm run typecheck`
  при наличии.
- Без секретов и вызовов модели.
- После зелёного CI включить защиту `main`.
- Критерий: push в `main` и PR не проходят с падающими тестами.

## Этап 2. Корректность lifecycle

### 2.1. Восстановление после resume

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

### 2.2. Compaction и cache warming

- Учитывать `session_compact.compactionEntry.usage` в стоимости сессии.
- Учитывать `UsageEntry` (`kind: "cache_warm"`) в токенах и стоимости.
- Если live-события для usage entry нет, пересчитывать суммы по
  `getEntries()` при вызове `/cache-monitor`.
- Критерий: стоимость сессии совпадает с native `/session` после компакции
  и cache warming.

## Этап 3. TTL: решение, а не фича

Проверено:

- `omp models --json` для `cline-pass/deepseek-v4.1-flash-1017` отдаёт
  `promptCache: null` — провайдер не декларирует TTL.
- OMP хранит `CACHE_TTL_MS` как эвристику (5 минут, дефолт Anthropic) и
  модельные `promptCache`-оценки, а не точное время истечения от провайдера.
- Native-сегмент `cache` уже существует; в текущем `statusLine` он не включён.

Решение: **не показывать countdown на `cline-pass`**. Это была бы догадка,
а не метрика. Вернуться, только если провайдер начнёт отдавать expiry или
модель получит декларированный `promptCache`.

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

- `CHANGELOG.md`, тег `v0.3.x`, private GitHub release.
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
3. Этап 3 — решение по TTL, без реализации на догадках.
4. Этап 4 — английский README, пакет, установка, тег.
5. Этап 5 — публикация, только после явного разрешения.

## Агенты

| Агент | Задача | Тип |
|---|---|---|
| `TestHarness` | 1.1: постоянный harness и `npm test` | task |
| `Typecheck` | 1.2: типы и `npm run typecheck` | task |
| `CI` | 1.3: GitHub Actions и защита `main` | task |
| `ResumeImplementer` | 2.1–2.2: восстановление и полный учёт usage | task |
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
