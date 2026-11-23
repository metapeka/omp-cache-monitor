# omp-cache-monitor — инструкции агенту

## Роль

Ты поддерживаешь `omp-cache-monitor` — OMP-расширение для hit rate кэша префикса,
команды `/cache-monitor`, epoch-aware предупреждений и resume. Продукт
read-only: не греет кэш, не меняет промпты, не тратит деньги.

## Сначала прочитай

1. `HANDOFF.md` — текущее состояние, контракт, проверки, ограничения.
2. `ROADMAP.md` — этапы, приоритеты, агенты.
3. `docs/research/cache-extensions.md` — конкуренты и что заимствуем.
4. `README.md` — пользовательский контракт (EN), `docs/README.ru.md` — RU.
5. `docs/ui-settings.md` — настройки, команды `settings`/`help`, ограничения
   UI OMP, роудмап фаз, риски; `docs/omp-docs-map.md` — карта встроенной
   документации OMP (`omp://docs`, 135 файлов).
6. `index.ts` и `test/extension.test.mjs` — реализация и тесты.

## Текущее состояние

- Версия `0.10.0`, private GitHub `metapeka/omp-cache-monitor`, `main`.
- `omp plugin link` → боевой чекаут; `omp plugin list` — `omp-cache-monitor@0.10.0`
  и `omp-agent-workflow@0.5.7` (context guard, handoff, supervisor, modes).
- `npm test` — 84 теста; `npm run typecheck`; CI зелёный.
- Настройки: `package.json#omp.settings` (15 ключей, `Group · …` в описаниях),
  `/cache-monitor settings` (группы и подписи), `preset` + advanced-ключи,
  второй статус-ключ `cache-monitor-cost`; `language: ru|en`;
  таблица и риски — `docs/ui-settings.md`, карта документации OMP —
  `docs/omp-docs-map.md`, Powerline — `docs/powerline.md`.
- Установка одна: `omp plugin link` **или** копия файла, не оба.

## Нельзя

- Публиковать npm/marketplace и менять видимость репозитория без явного
  разрешения владельца; GitHub-пуш в `main` разрешён.
- Править боевой линкованный чекаут под эксперимент: для задач — worktree.
- Переключать `omp plugin link` на ветку: он всегда смотрит на `main`.
- Добавлять runtime-зависимости, `any`, фейковый TTL, warming, optimizer.
- Менять контракт v0.10.0 без решения владельца.
- Коммитить секреты, логи сессий, `node_modules`, временные файлы.
- Удалять ветку (`--delete-branch`, `git branch -D`) без явного разрешения
  владельца; после merge ветка остаётся ref'ом для аудита и восстановления.
- Запускать `orca worktree rm` из живой OMP-сессии: Orca может оборвать её
  SIGTERM'ом. Подтверждено 2026-11-23: `coelacanth` в 08:29 и `ui-presets`
  в 10:17 — сессия умирала через <0.2 с после старта удаления.

## Рабочий процесс

```bash
# новая задача
orca worktree create --repo name:omp-cache-monitor --name <slug> \
  --branch feat/<slug> --base-branch main --no-parent --json

# в worktree
npm test
npm run typecheck
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'        # exit 0, stderr пуст

# финал
git -C /home/db1/projects/omp-cache-monitor merge --ff-only feat/<slug>
git -C /home/db1/projects/omp-cache-monitor push
# worktree удалять из отдельного терминала или после выхода из OMP;
# ветку НЕ удалять — ref остаётся для аудита и восстановления
orca worktree rm --worktree path:/home/db1/orca/workspaces/omp-cache-monitor/<slug>

# восстановление ветки, если ref всё же удалён
git -C /home/db1/projects/omp-cache-monitor branch feat/<slug> <sha>
#   <sha> — tip из reflog (`git reflog`), лога сессии или `git fsck`

# Yoda (опционально): всегда из корня этого чекаута, свой лог supervisor'а
npm run yoda -- --resume=<session.jsonl>
#   лог: /tmp/omp-yoda-omp-cache-monitor.log (у worktree — своё имя)
```

- Один агент — один worktree; не редактировать один файл параллельно.
- Коммит — через `commit` namespace, не `git add`/`git commit`.
- Поведенческое изменение — только с тестом; docs обновлять в том же
  worktree.
- После merge — сначала `push` и проверки (`omp plugin list`, TUI,
  `/cache-monitor`), потом очистка worktree; очистку не запускать из живой
  OMP-сессии.

## Контекст и handoff

| Контекст (1M) | Действие |
|---|---|
| до 250k | Работать нормально |
| 250–350k | Watch: не читать гигантские файлы, не тащить лишние логи |
| 350–500k | Warning; предложить `HANDOFF`; сжимать на фазовой границе |
| 500–600k | Компакция на безопасной границе |
| больше 600k | Форсировать handoff/compact |

- Native OMP auto-compaction срабатывает на 98.4% окна — это аварийный
  предохранитель, не политика. Для 1M-моделей — `compaction.modelOverrides`
  с `reserveTokens: 500000`.
- `HANDOFF` — слово-триггер: обнови `HANDOFF.md` (цель, состояние, решения,
  изменённые файлы, проверки, следующие шаги), затем сожми контекст.
- `/handoff` — компакция; `/handoff-new` — новая сессия после `HANDOFF.md`.
  Supervisor запускается из `omp-agent-workflow` и реагирует на marker.
  Режим: `OMP_WORKFLOW_MODE=manual|assisted|yoda|yoda-supervised`;
  пороги: `OMP_CONTEXT_WARN`, `OMP_CONTEXT_SUGGEST`, `OMP_CONTEXT_AUTO`,
  `OMP_HANDOFF_AT`.
- Не сжимать посреди tool-loop или незавершённого edit; ждать `turn_end` и
  `ctx.isIdle()`.
- `context_pct` в native status line уже есть; свой процент не дублировать.

## Делегирование

- `scout` — только исследование, без правок.
- `task` — реализация в отдельном worktree.
- `reviewer` — ревью поведенческих изменений до merge.
- `sonic` — механические правки/сбор данных.
- Перед спавном: один worktree на агента, полный контекст задачи, критерии
  приёмки. Не перекладывать top-level план на агента.

## Формат HANDOFF

```markdown
# Передача: <тема>

Дата, ветка/коммит, состояние.
## Что готово
## Контракт / ограничения
## Где что лежит
## Проверки
## Следующие шаги
## Риски
```

## Definition of done

- Поведение проверено: `npm test`, `npm run typecheck`, нужный TUI/CLI.
- CI зелёный; worktree удалён; `main` синхронизирован с `origin/main`.
- `HANDOFF.md`/`ROADMAP.md`/`README.md` отражают реальность.
- Нет секретов, runtime-зависимостей и незакоммиченных файлов.
- В финале: что сделано, чем проверено, что осталось.

## Ссылки

- `ROADMAP.md` — этапы 2.5 (cache economics), 2.6 (context guard/handoff),
  2.8 (история 8 ходов), 2.11 (разбивка стоимости), 2.12 (настройки и
  справка), 3 (TTL data-gated), 4 (release), 5 (publication).
- `docs/ui-settings.md` — ключи `omp.settings`, `settings`/`help`, `language`,
  `preset`/advanced-ключи, статус-ключ `cache-monitor-cost`, применение к новой
  сессии, внутренний `getPluginSettings`, Phase 1–3 (done)/4.
- `docs/research/cache-extensions.md` — рынок и что заимствуем.
- `HANDOFF.md` — точка продолжения.
- `~/projects/omp-agent-workflow/docs/yoda-workflow.md` — режимы
  `manual`/`assisted`/`yoda`/`yoda-supervised`, оркестратор и subagent'ы.
- `~/projects/omp-agent-workflow/docs/handoff-auto-plan.md` — план handoff.
- `~/projects/omp-agent-workflow` — context guard, `/handoff`, `/handoff-new`,
  supervisor; 15 тестов, typecheck; установлен через `omp plugin link`.
