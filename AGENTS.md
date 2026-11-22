# omp-cache-monitor — инструкции агенту

## Роль

Ты поддерживаешь `omp-cache-monitor` — OMP-расширение для hit rate кэша префикса,
команды `/cache-monitor`, epoch-aware предупреждений и resume. Продукт
read-only: не греет кэш, не меняет промпты, не тратит деньги.

## Сначала прочитай

1. `HANDOFF.md` — текущее состояние, контракт, проверки, ограничения.
2. `ROADMAP.md` — этапы, приоритеты, агенты.
3. `docs/research/cache-extensions.md` — конкуренты и что заимствуем.
4. `README.md` — пользовательский контракт.
5. `index.ts` и `test/extension.test.mjs` — реализация и тесты.

## Текущее состояние

- Версия `0.6.0`, private GitHub `metapeka/omp-cache-monitor`, `main`.
- `omp plugin link` → боевой чекаут; `omp plugin list` — 0.6.0 после merge
  `feat/cache-history` и `omp-agent-workflow` 0.3.0 (context guard, handoff,
  supervisor, modes).
- `npm test` — 37 тестов; `npm run typecheck`; CI зелёный.
- Установка одна: `omp plugin link` **или** копия файла, не оба.

## Нельзя

- Публиковать npm/marketplace и менять видимость репозитория без явного
  разрешения владельца; GitHub-пуш в `main` разрешён.
- Править боевой линкованный чекаут под эксперимент: для задач — worktree.
- Переключать `omp plugin link` на ветку: он всегда смотрит на `main`.
- Добавлять runtime-зависимости, `any`, фейковый TTL, warming, optimizer.
- Менять контракт v0.6 без решения владельца.
- Коммитить секреты, логи сессий, `node_modules`, временные файлы.

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
orca worktree rm --worktree path:/home/db1/orca/workspaces/omp-cache-monitor/<slug> \
  --delete-branch
```

- Один агент — один worktree; не редактировать один файл параллельно.
- Коммит — через `commit` namespace, не `git add`/`git commit`.
- Поведенческое изменение — только с тестом; docs обновлять в том же
  worktree.
- После merge — проверить `omp plugin list`, TUI и `/cache-monitor`.

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
  2.8 (история 8 ходов), 3 (TTL data-gated), 4 (release), 5 (publication).
- `docs/research/cache-extensions.md` — рынок и что заимствуем.
- `HANDOFF.md` — точка продолжения.
- `~/projects/omp-agent-workflow/docs/yoda-workflow.md` — режимы
  `manual`/`assisted`/`yoda`/`yoda-supervised`, оркестратор и subagent'ы.
- `~/projects/omp-agent-workflow/docs/handoff-auto-plan.md` — план handoff.
- `~/projects/omp-agent-workflow` — context guard, `/handoff`, `/handoff-new`,
  supervisor; 15 тестов, typecheck; установлен через `omp plugin link`.
