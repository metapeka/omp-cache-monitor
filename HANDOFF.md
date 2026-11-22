# Передача: cache-monitor

Дата: 2026-11-22. Репозиторий: `omp-cache-monitor`, ветка `main`; состояние —
последний коммит, где менялся этот файл (`git log -1 -- HANDOFF.md`).
Это продолжение работы, начатой в docs-репозитории
`docs-omp-debian-availability` (там же пресеты, `omp-mode` и публичная вики).

## Что уже готово

| Что | Состояние |
|---|---|
| Расширение `index.ts` | v0.2.0, 370 строк, контракт ниже |
| Пакет | `package.json` (`omp.extensions` + `pi.extensions`), MIT, README |
| Установка на машине | `omp plugin link /home/db1/projects/omp-cache-monitor`, в `omp plugin list` — `omp-cache-monitor@0.2.0` |
| Проверки | TUI hit совпал с JSONL (9.9% → 98.1%), `/new` сбрасывает суммы, предупреждение молчит на первом ходе эпохи, non-TUI чистый |
| Ревью | 2 major (сброс после `/new`, ложный warning после компакции) исправлены, ре-ревью «ок» |
| Публикация | GitHub: `metapeka/omp-cache-monitor` (public, `main`); npm, marketplace — нет |

## Контракт v0.2 (не менять без решения владельца)

- `hit = cacheRead / (input + cacheRead + cacheWrite)`; знаменатель 0 → `n/a`.
- Статус-ключ `cache-monitor`, текст `<OMP_MODE> ↺ N%` (без режима — `↺ N%`).
- Команда `/cache-monitor` (не `/cache`: имя занято `ubranch/omp-cache-control`).
- Эпоха префикса сбрасывается на: старт сессии, компакцию, смену модели,
  смену thinking (live, fallback на настройки), смену набора инструментов,
  `/new`/`/fork`/`/switch` (суммы тоже), `/clear`/ветку/дерево (только сравнение).
- Предупреждения: только TUI, `agent.kind === "main"`, не первый ход эпохи,
  prompt ≥ 4000; канонический промах (`prev ≥ 2048 && cacheRead == 0 && cacheWrite > 0`)
  и низкий hit (< 50%), по одному на эпоху.
- Пере-оплата: `reBilled = max(0, min(prevPrompt, curPrompt) - cacheRead)`;
  деньги считаются в момент хода и сохраняются в `last`.
- Без `any`, без новых зависимостей, UI-вызовы в try/catch, реестр настроек — ленивым импортом.

## Где что лежит

| Часть | Репозиторий/путь |
|---|---|
| Продукт (код, пакет) | этот репозиторий; GitHub — https://github.com/metapeka/omp-cache-monitor |
| Пресеты, `omp-mode`, план, вики | `metapeka/docs-omp-debian-availability` |
| Публичная инструкция | https://metapeka.github.io/docs-omp-debian-availability/wiki/guide.html |
| Установленная копия | `omp plugin link` → `/home/db1/projects/omp-cache-monitor`; файла в `~/.omp/agent/extensions/` нет (одно из двух, не оба) |

## Схема работы (не смешивать)

Один боевой чекаут и одноразовые worktree под задачу. `omp plugin link` всегда
указывает на боевой чекаут и **никогда** не переключается на ветки.

| Роль | Путь | Ветка | Правило |
|---|---|---|---|
| Боевой | `/home/db1/projects/omp-cache-monitor` | `main` | это то, что установлено; код приходит сюда только merge; отсюда релизы |
| Задача | `/home/db1/orca/workspaces/omp-cache-monitor/<slug>` | `feat/<slug>` | создаётся под задачу, удаляется после merge |

Причина: линкованный каталог — это живая сессия OMP. Правка в нём немедленно
меняет работающий OMP, поэтому эксперименты держим снаружи, а `main` остаётся
известным хорошим.

```bash
# новая задача
orca worktree create --repo name:omp-cache-monitor --name <slug> \
  --branch feat/<slug> --base-branch main --no-parent --activate

# финал
git -C /home/db1/projects/omp-cache-monitor merge --ff-only feat/<slug>
orca worktree rm --worktree branch:feat/<slug>
```

`--no-parent` обязателен: иначе Orca записывает `parentWorktreeId` от активного
worktree (даже чужого репозитория) и работа уезжает в чужой проект в сайдбаре.
`--branch` обязателен: дефолт Orca — `metapeka/<name>`, в публичной истории
такой префикс ничего не значит.

## Проверка после изменений

```bash
# код ветки — без пере-линковки; --no-extensions обязателен, иначе плагин
# загрузится дважды (линкованный + этот файл)
omp --no-extensions -e ./index.ts --no-session --no-tools --mode json \
  -p 'Reply with exactly: OK'                                    # exit 0, stderr пуст

# загрузка без TUI из боевого чекаута
omp --no-session --no-tools -p 'Reply with exactly: OK' --mode json   # exit 0, stderr пуст

# TUI: статус и команда(в tmux/терминале Orca)
omp --no-tools --session-dir /tmp/cm-check
#   ↺ … на старте, затем ↺ N%; /cache-monitor печатает строку
#   /new → статус ↺ …, команда: ходов 0, ↺ n/a

# сверка с журналом сессии
# assistant usage: input/cacheRead/cacheWrite/cost → hit = cacheRead/(сумма)
```

## Возможные следующие шаги (по решению владельца)

1. npm: `npm publish` → `omp plugin install omp-cache-monitor`.
2. Marketplace: каталог-репозиторий с `.omp-plugin/marketplace.json`.
3. Метрики: trend/sparkline, TTL-countdown (не дублировать native-сегмент `cache`),
   стоимость мисса в отчёте, восстановление сумм после resume.
4. Локализация README на английский перед публикацией.

## Ограничения

- npm, marketplace и новые remote — **только с явного разрешения владельца**;
  GitHub-пуш в `metapeka/omp-cache-monitor` разрешён.
- Номер upstream-бага: can1357/oh-my-pi#20128 (`getThinkingLevel` → `undefined`
  на моделях `off|auto`); не «чинить» его в обход — используется fallback.
- OMP 19.1.0, проверено на маршруте `cline-pass`.
