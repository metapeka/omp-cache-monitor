# Передача: cache-monitor

Дата: 2026-11-22. Репозиторий: `omp-cache-monitor`, ветка `main`; состояние —
последний коммит, где менялся этот файл (`git log -1 -- HANDOFF.md`).
Это продолжение работы, начатой в docs-репозитории
`docs-omp-debian-availability` (там же пресеты, `omp-mode` и публичная вики).

## Что уже готово

| Что | Состояние |
|---|---|
| Расширение `index.ts` | v0.6.0, 824 строки, контракт ниже |
| Пакет | `package.json` (`omp.extensions` + `pi.extensions`), MIT, README, CHANGELOG |
| Установка на машине | `omp plugin list` — `omp-cache-monitor@0.6.0` и `omp-agent-workflow@0.5.0` |
| Проверки | `npm test` 37/37 (включая историю 8 ходов), typecheck; загрузка OMP, TUI: `/cache-monitor history` напечатал `история (1/8): 1. ↺ 12.2% · prompt 5267 · saved $0.0002`, дефолтный отчёт совпал по hit/saved; ранее (0.5.0) — `saved $0.0008`, статус hit 56.5% совпал с командой, TUI hit совпал с JSONL, фоновые вызовы добавляют только стоимость, non-TUI чистый |
| Ревью | v0.4/v0.5 — merge |
| Ревью v0.4 | фоновый usage отделён от hit/ходов; граница resume не даёт ложной пере-оплаты |
| Ревью v0.5 | reviewer: merge; исправлены пробелы покрытия — граница 5 мин, `/clear`/tree, ход без timestamp разрывает цепочку простоя |
| Ревью v0.6 | reviewer: merge; nits исправлены — убрано мёртвое поле, покрыты live-epoch gate и регистр/пробелы алиаса |
| Публикация | GitHub: `metapeka/omp-cache-monitor` (private, `main`); npm, marketplace — нет |

## Контракт v0.6 (v0.5 + история 8 ходов; не менять без решения владельца)

- `hit = cacheRead / (input + cacheRead + cacheWrite)`; знаменатель 0 → `n/a`.
- Статус-ключ `cache-monitor`, текст `<OMP_MODE> ↺ N%` (без режима — `↺ N%`).
- Команда `/cache-monitor` (не `/cache`: имя занято `ubranch/omp-cache-control`).
  Аргумент `history`/`hist` печатает историю; любой другой (в т.ч. пустой) —
  прежний отчёт без изменений. `recomputeTotals` вызывается в обеих ветках.
- `/cache-monitor history` — последние 8 завершённых ходов, одна notification:
  `история (N/8):` и строки `N. ↺ hit · prompt P [· saved …] [· miss premium …]
  [· причина]`, от старого к новому. `saved` — только при `cacheRead > 0`
  (`$X` или `?` без цены); `miss premium` — только при `reBilled > 0`
  (`$X (N tok)` или `? (N tok)`); причина — только у канонического промаха
  (`простой N мин` / `перезапись префикса`), первый ход эпохи её не получает.
  Нет ходов — `история: нет данных`.
- История живёт в окне 8: live-ходы добавляются в `turn_end` с известными
  ценами, восстановленные из журнала — с `savedCost`/`reBillCost = null`.
  Причина в live и в warning считается одним `missCause(idleMs)`, промах —
  одним `isCanonicalMiss(prevPrompt, usage, prompt)` (пороги `MIN_PREV_PROMPT`,
  `MIN_PROMPT`, `IDLE_GAP_MS`).
- Restore истории на resume/fork: последние 8 assistant-сообщений; границы
  `model_change`/`thinking_level_change`/`reset_boundary`/`compaction`/
  `branch_summary` начинают новую эпоху (причина `null`, база простоя
  сброшена). `idleMs` — из `message.timestamp`; сообщение без timestamp
  разрывает цепочку. У последней записи окна `reBilled = null`: граница
  resume не журналируется.
- `/new` очищает историю; `/clear` и переходы по дереву сохраняют; resume/fork
  восстанавливают.
- Эпоха префикса сбрасывается на: старт сессии, компакцию, смену модели,
  смену thinking (live, fallback на настройки), смену набора инструментов,
  `/new`/`/fork`/`/switch` (суммы тоже), `/clear`/ветку/дерево (только сравнение).
- Предупреждения: только TUI, `agent.kind === "main"`, не первый ход эпохи,
  prompt ≥ 4000; канонический промах (`prev ≥ 2048 && cacheRead == 0 && cacheWrite > 0`)
  и низкий hit (< 50%), по одному на эпоху.
- Причина канонического промаха — per-turn: `простой N мин`, если
  `message.timestamp` даёт разрыв ≥ `IDLE_GAP_MS` (5 минут), иначе
  `перезапись префикса`. Порог — эмпирический, не TTL провайдера. `lastTurnAt`
  сбрасывается в `resetEpoch` и при смене эпохи, поэтому простой через границу
  не приписывается новому префиксу; без timestamp причина — перезапись.
- `miss premium`: `reBilled = max(0, min(prevPrompt, curPrompt) - cacheRead)`;
  `saved = cacheRead * (inputPrice - cacheReadPrice)`,
  `miss premium = reBilled * (inputPrice - cacheReadPrice)`, цены `$/1M` из
  `model.cost`, дельта не меньше нуля. Обе метрики считает `cacheDeltaCost`;
  деньги сохраняются в `last.savedCost`/`last.reBillCost` в момент хода.
- `/cache-monitor` печатает `saved` в строке хода (при известной цене и
  `cacheRead > 0`), `miss premium: $X (N tok)` (или `N tok` без цен) отдельной
  частью перед трендом, `тренд:` — последние 12 хитов (`▁`…`█`, `·` — n/a) и
  итог сессии с `saved`/`miss premium` (`≥` — известна лишь часть суммы).
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
- Цены прошлых моделей не хранятся: `miss premium` после resume
  восстанавливается в токенах, `last.reBillCost` и `last.savedCost` остаются
  `null`, деньги не выдумываются (`≥` при частично известной сумме).
  Восстановленный `cacheRead` не оценивается: `sessionSaved = 0`, а
  `sessionSavedMissing = aggregate.cached > 0`; live-ходы добавляют только
  известную часть. `miss premium` последнего хода перед resume консервативно
  не восстанавливается: граница resume не журналируется; более ранние границы
  resume тоже не отмечены, поэтому их оценка приблизительная.
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

Yoda запускается только через проектный лаунчер — он всегда стартует из корня
этого чекаута и пишет supervisor в отдельный лог:

```bash
npm run yoda -- --resume=<session.jsonl>
# supervisor: /tmp/omp-yoda-omp-cache-monitor.log
# worktree:   /tmp/omp-yoda-<slug>.log
```

Прямой `~/projects/omp-agent-workflow/bin/omp-yoda` из чужого каталога даёт
supervisor на чужой `--dir` и общий `/tmp/omp-yoda-supervisor.log`; так не
запускать.

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
#   /cache-monitor history → «история (N/8):» и строки ходов
#   /new → статус ↺ …, команда: ходов 0, ↺ n/a; history: «история: нет данных»

# сверка с журналом сессии
# assistant usage: input/cacheRead/cacheWrite/cost → hit = cacheRead/(сумма)
```

## Возможные следующие шаги (по решению владельца)

Полный план с этапами, критериями и назначением агентов — `ROADMAP.md`.
Кратко: этапы 1–2 (тесты/CI и resume/compaction accounting), 2.5 (причина
мисса, `saved`/`miss premium`) и 2.8 (история 8 ходов) готовы; следующий —
английский README и установка из tarball (этап 4); npm/marketplace/public —
только после отдельного решения. TTL на `cline-pass` не делаем: провайдер не
декларирует lifetime; TTL — data-gated P2.

## Ограничения

- npm, marketplace и новые remote — **только с явного разрешения владельца**;
  GitHub-пуш в `metapeka/omp-cache-monitor` разрешён.
- Номер upstream-бага: can1357/oh-my-pi#20128 (`getThinkingLevel` → `undefined`
  на моделях `off|auto`); не «чинить» его в обход — используется fallback.
- OMP 19.1.0, проверено на маршруте `cline-pass`.
- В журнале нет цен прошлых моделей, поэтому деньги за восстановленную
  пере-оплату и `saved` не считаются: только токены и `≥` для частично
  известной суммы; `saved` после resume растёт только по live-ходам.
- Простой определяется по `message.timestamp`; провайдер/раннер без timestamp
  даёт причину `перезапись префикса`, а не выдуманный idle. Порог 5 минут —
  эвристика, не TTL.
- Смена набора инструментов в журнал не пишется: после resume её нельзя
  восстановить как границу эпохи, защищает только live-сравнение.
- `getEntries()` может содержать чужие ветки: суммы по ним совпадают с native
  `/session`, тренд строится только по assistant-сообщениям в порядке журнала.
- История — окно 8 и только в памяти/журнале текущей сессии; между сессиями
  она не переносится и в панель/JSON не выводится. После resume деньги
  восстановленных ходов неизвестны (`saved ?`, `miss premium ? (N tok)`), а
  `reBilled` последней записи окна не восстанавливается.
