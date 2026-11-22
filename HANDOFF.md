# Передача: cache-monitor

Дата: 2026-11-22. Репозиторий: `omp-cache-monitor`, ветка `main`; состояние —
последний коммит, где менялся этот файл (`git log -1 -- HANDOFF.md`).
Это продолжение работы, начатой в docs-репозитории
`docs-omp-debian-availability` (там же пресеты, `omp-mode` и публичная вики).

## Что уже готово

| Что | Состояние |
|---|---|
| Расширение `index.ts` | v0.4.0, 633 строки, контракт ниже |
| Пакет | `package.json` (`omp.extensions` + `pi.extensions`), MIT, README |
| Установка на машине | `omp plugin list` — `omp-cache-monitor@0.4.0` и `omp-agent-workflow@0.2.0` |
| Проверки | `npm test` 22/22, typecheck, TUI hit совпал с JSONL (9.9% → 98.1%), `/new` сбрасывает суммы, resume восстанавливает суммы/тренд, фоновые вызовы добавляют только стоимость, предупреждение молчит на первом ходе эпохи, non-TUI чистый, загрузка в OMP exit 0; `/handoff` и warning 35/50 проверены в TUI; `/handoff-new` открыл новую сессию; supervisor dry-run проверен |
| Ревью | 2 major (сброс после `/new`, ложный warning после компакции) исправлены, ре-ревью «ок» |
| Ревью v0.4 | фоновый usage отделён от hit/ходов; граница resume не даёт ложной пере-оплаты |
| Публикация | GitHub: `metapeka/omp-cache-monitor` (private, `main`); npm, marketplace — нет |

## Контракт v0.4 (v0.3 + resume и полный учёт usage; не менять без решения владельца)

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
- `/cache-monitor` дополнительно печатает `тренд:` — последние 12 хитов
  (`▁`…`█`, `·` — n/a) и `мисс N tok ($X)` за сессию (`≥$X` — часть ходов без цен).
- На `/new` суммы и тренд обнуляются; resume/fork восстанавливают их из
  журнала. `/clear` и переходы по дереву суммы сохраняют.
- На `session_start` (startup/reload/new/resume/fork) состояние читается из
  `ctx.sessionManager.getEntries()`: суммы, ходы, тренд (последние 12),
  последний ход и пере-оплаченные токены. У новой сессии журнал пуст.
- `usage`/`model_usage` (cache warming, title/composer и другие off-transcript
  вызовы) и `compaction`/`branch_summary` usage добавляют только стоимость, не
  токены hit, ходы или тренд. `/cache-monitor` перед печатью пересчитывает
  стоимость по журналу; ходы и live-цены при этом не пересобираются.
- Границы эпохи в журнале (`model_change`, `thinking_level_change`,
  `compaction`, `branch_summary`) сбрасывают сравнение пере-оплаты. Первый ход
  после resume — новая эпоха, без warning.
- Цены прошлых моделей не хранятся: пере-оплата после resume восстанавливается
  в токенах, `last.reBillCost` остаётся `null`, деньги не выдумываются (`≥` при
  частично известной сумме). Пере-оплата последнего хода перед resume
  консервативно не восстанавливается: граница resume не журналируется; более
  ранние границы resume тоже не отмечены, поэтому их оценка приблизительная.
- Без `any`, без новых зависимостей, UI-вызовы в try/catch, реестр настроек — ленивым импортом.

## Где что лежит

| Часть | Репозиторий/путь |
|---|---|
| Продукт (код, пакет) | этот репозиторий; GitHub — https://github.com/metapeka/omp-cache-monitor |
| План развития | `ROADMAP.md` |
| Исследование конкурентов | `docs/research/cache-extensions.md` |
| Инструкции агенту | `AGENTS.md`; глобальные — `~/.omp/agent/AGENTS.md` |
| Агентский context guard | `/home/db1/projects/omp-agent-workflow` (linked plugin) |
| Yoda workflow | `~/projects/omp-agent-workflow/docs/yoda-workflow.md` — отдельный продукт |
| Automatic handoff plan | `~/projects/omp-agent-workflow/docs/handoff-auto-plan.md` |
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

Полный план с этапами, критериями и назначением агентов — `ROADMAP.md`.
Кратко: этапы 1–2 (тесты/CI и resume/compaction accounting) готовы; следующий
P1 — причина мисса и `cache saved`/`miss premium` (этап 2.5), затем английский
README и установка из tarball; npm/marketplace/public — только после отдельного
решения. TTL на `cline-pass` не делаем: провайдер не декларирует lifetime;
TTL — data-gated P2.

## Ограничения

- npm, marketplace и новые remote — **только с явного разрешения владельца**;
  GitHub-пуш в `metapeka/omp-cache-monitor` разрешён.
- Номер upstream-бага: can1357/oh-my-pi#20128 (`getThinkingLevel` → `undefined`
  на моделях `off|auto`); не «чинить» его в обход — используется fallback.
- OMP 19.1.0, проверено на маршруте `cline-pass`.
- В журнале нет цен прошлых моделей, поэтому деньги за восстановленную
  пере-оплату не считаются (только токены и `≥` для частично известной суммы).
- Смена набора инструментов в журнал не пишется: после resume её нельзя
  восстановить как границу эпохи, защищает только live-сравнение.
- `getEntries()` может содержать чужие ветки: суммы по ним совпадают с native
  `/session`, тренд строится только по assistant-сообщениям в порядке журнала.
