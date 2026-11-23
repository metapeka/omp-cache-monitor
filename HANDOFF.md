# Передача: cache-monitor

Дата: 2026-11-23. Репозиторий: `omp-cache-monitor`; 0.10.1 — Phase 4
(онбординг, скриншоты, upstream `group`/`icon`) поверх 0.10.0.
Это продолжение работы, начатой в docs-репозитории
`docs-omp-debian-availability` (там же пресеты, `omp-mode` и публичная вики).

## Следующая задача (взять первой)

**Release 0.10.1 или TTL/P2 — только по отдельному решению владельца.**
Phase 4 закрыта; новых UI-задач в очереди нет.

- Release `v0.10.1` (тег/release) — только по решению владельца; пакет и
  CHANGELOG готовы.
- TTL (этап 3) — data-gated: у провайдера `promptCache: null`, без данных не
  начинать.
- P2-бэклог — только по решению владельца.
- Проверки: `npm test`, `npm run typecheck`, `npm pack` 4 файла.

## Что уже готово

| Что | Состояние |
|---|---|
| Расширение `index.ts` | v0.10.1, контракт ниже: `preset` + advanced-ключи, второй статус-ключ `cache-monitor-cost`, онбординг на первом промахе |
| Пакет | `package.json` 0.10.1 (`omp.extensions` + `omp.settings` из 15 ключей, `pi.extensions`, repository/homepage/bugs/engines), MIT, README EN (`README.md`) + 中文 (`docs/README.zh.md`) + RU (`docs/README.ru.md`), CHANGELOG 0.10.1, `docs/ui-settings.md`, `docs/omp-docs-map.md`, `docs/powerline.md`, `docs/upstream-settings-groups.md`, `docs/release-notes-0.10.1.md`, скриншоты и demo-GIF `docs/images/` |
| Установка на машине | `omp plugin list` — `omp-cache-monitor@0.10.1` и `omp-agent-workflow@0.5.14` |
| Проверки | `npm test` 85/85, typecheck, `npm pack` — 4 файла; 0.10.1: подсказка только на первом каноническом промахе (RU/EN), скриншоты Settings → Plugins и `settings`, upstream issue #20253 |
| Ревью | v0.4/v0.5/v0.6/v0.7/v0.8/v0.8.1/v0.9/v0.10.1 — merge |
| Ревью v0.4 | фоновый usage отделён от hit/ходов; граница resume не даёт ложной пере-оплаты |
| Ревью v0.5 | reviewer: merge; исправлены пробелы покрытия — граница 5 мин, `/clear`/tree, ход без timestamp разрывает цепочку простоя |
| Ревью v0.6 | reviewer: merge; nits исправлены — убрано мёртвое поле, покрыты live-epoch gate и регистр/пробелы алиаса |
| Ревью v0.7 | reviewer: merge; nits закрыты — `/clear` retention, пустой label, compaction/branch-summary из `model_usage` сведены в общие бакеты |
| Ревью v0.8 | reviewer: merge; defaults побайтово прежние, runtime loader проверен, nits по docs исправлены |
| Ревью v0.8.1 | reviewer: merge; исправлены 404-ссылка docs, версия в ROADMAP и формулировка help про причину мисса |
| Ревью v0.10.1 | reviewer: merge; nits закрыты — новые `docs/images/*` и upstream-doc в commit, Settings → Plugins переснят на 0.10.1 |
| Ревью docs 0.10.1 | Docs3LangReview: merge with nits; исправлены «8 строк help» (EN/ZH) и ссылка на release notes в RU |
| Публикация | GitHub: `metapeka/omp-cache-monitor` (private, `main`); npm, marketplace — нет |

## Контракт v0.10.1 (v0.10.0 + онбординг; не менять без решения владельца)

- `hit = cacheRead / (input + cacheRead + cacheWrite)`; знаменатель 0 → `n/a`.
- Настройки: `package.json#omp.settings` — ровно 15 ключей (`preset`,
  `statusEnabled`, `statusShowMode`, `statusShowCost`, `warningsEnabled`,
  `lowHitPercent`, `idleMinutes`, `minPromptTokens`, `warnCanonicalMiss`,
  `minPrevPromptTokens`, `oncePerEpoch`, `historySize`, `trendSize`,
  `showMoney`, `language`) с `default`, границами/enum и английскими
  `description` в формате `Group · what. Default/range. Why.` (`Preset ·`,
  `Status ·`, `Warnings ·`, `Reports ·`). Runtime читает их динамическим
  `getPluginSettings("omp-cache-monitor", ctx.cwd)` на `session_start` (до
  restore) и перед командами; любая ошибка/недоступность API → `{}` и defaults.
  `normalizeConfig` (named export) сначала выбирает пресет
  (`quiet`/`verbose`/`custom`, иначе `balanced`), затем каждый явно заданный
  валидный ключ перекрывает значение пресета, а невалидный откатывается к
  значение пресета (не к hard default). Bool — boolean или строка
  `"true"`/`"false"` (`omp plugin config set` пишет строки), числа —
  конечное число или числовая строка → round → clamp, `language` — только
  `ru`/`en` и пресетом не меняется. Defaults (`language: "ru"`) дают вывод
  0.9.0 побайтово, кроме новых строк `settings`.
- `statusEnabled=false` — `setStatus` не вызывается (старый статус не
  чистится); `statusShowMode=false` — статус `↺ N%` без `OMP_MODE`.
  `statusShowCost=true` — на `turn_end` в main TUI публикуется второй ключ
  `cache-monitor-cost` с `$X` (4 знака); hit-строка `cache-monitor` байт-в-байт
  прежняя. На `session_start`/`session_switch` cost-ключ не публикуется, и
  старый сегмент не очищается (известное ограничение, как и у `cache-monitor`).
  `warningsEnabled=false` — ни одного warning; `warnCanonicalMiss=false` —
  только без canonical-miss (low hit остаётся); `oncePerEpoch=false` —
  warning каждого типа на каждом подходящем ходе; `lowHitPercent`,
  `minPromptTokens`, `minPrevPromptTokens`, `idleMinutes` заменяют прежние
  константы 50/4000/2048/5;
  `historySize` — live- и restore-окно и делитель `история (N/M):`;
  `trendSize` — live- и restore-окно спарклайна (refreshConfig сразу
  отрезает лишние точки).
  `showMoney=false` — в отчёте и history нет `saved` и денег `miss premium`
  (`miss premium: 3000 tok` / `miss premium 3000 tok`), `/cache-monitor costs`
  деньги показывает. `language` — `ru` (default) или `en`: только
  пользовательские строки, метрики/токены/формат денег не меняются;
  невалидное значение → `ru`. Все строки живут в `TEXTS: Record<Language,
  Texts>`; `registerCommand.description` — английский всегда.
- Причина промаха хранится структурно: `TurnRecord.cause` —
  `{ kind: "idle"; minutes: number } | { kind: "rewrite" } | null`;
  `causeText(cause, language)` даёт `простой N мин`/`idle N min` и
  `перезапись префикса`/`prefix rewrite`, поэтому смена языка перерисовывает
  старые ходы, restore из журнала и текст warning-а.
- `/cache-monitor settings` (алиас `setting`) перечитывает настройки и печатает
  группы `🎛 Пресет`/`⚙ Статус`/`⚠️ Предупреждения`/`📊 Отчёты` (EN
  `🎛 Preset`/`⚙ Status`/`⚠️ Warnings`/`📊 Reports`), 15 ключей с
  `(changed)`/`(default)`, статичные подписи после `—`,
  `💵 цены модели: да|нет` (EN `model prices: yes|no`) и команду изменения
  (EN `Change:`). `preset` печатается только здесь; отчёт, history и costs
  его не содержат. `/cache-monitor help` (алиас `?`) — справка
  из 8 строк на текущем языке: `↺` («чем выше, тем дешевле»), промах =
  `cacheRead 0`, подкоманды, Settings → Plugins, `omp plugin config`, ссылки на
  `README.md`, `docs/ui-settings.md`, `docs/omp-docs-map.md`.
  Документация: `docs/ui-settings.md` (ограничения UI OMP, роудмап фаз),
  `docs/omp-docs-map.md` (135 файлов `omp://docs`).
- Онбординг v0.10.1: первый канонический промах за процесс добавляет к
  warning одну строку — где открыть `/cache-monitor settings` и что значит
  `preset` (`balanced`/`quiet`/`verbose`/`custom`). RU/EN; один раз за
  процесс, без нового ключа настроек.
- Статус-ключи: `cache-monitor` с текстом `<OMP_MODE> ↺ N%` (без режима —
  `↺ N%`) и, при `statusShowCost`, `cache-monitor-cost` с `$X`.
- Команда `/cache-monitor` (не `/cache`: имя занято `ubranch/omp-cache-control`).
  Аргумент `history`/`hist` печатает историю, `costs`/`cost` — разбивку
  стоимости; любой другой (в т.ч. пустой) — прежний отчёт без изменений.
  `recomputeTotals` вызывается в ветке costs и в остальных ветках.
- `/cache-monitor costs` — фактическая разбивка стоимости сессии, одна
  notification: заголовок `стоимость сессии: $X` (`≥$X`, если хоть один бакет
  неполон; EN `session cost:`) и строки `label: $X` / `label: ≥$X` /
  `label: ?`. Ключи: `dialog` → `диалог`/`dialog`, `compaction` →
  `компакция`/`compaction`, `branch_summary` → `ветка`/`branch`,
  `usage:<kind>` и `model_usage:<purpose>` с префиксами срезанными (`?` →
  `прочее`/`other`). `диалог` всегда первым, остальные — по убыванию известной
  стоимости, затем по подписи текущего языка. Стоимость — только
  `usage.cost.total`; нечисловой total даёт `missing`, деньги не оцениваются.
  Карта пересобирается из журнала (идемпотентно); пустой журнал оставляет
  live-карту, `/new` очищает. Пустая карта — `стоимость: нет данных`
  (EN `cost: no data`). Дефолтный отчёт и `history` этих строк не содержат.
- `/cache-monitor history` — последние 8 завершённых ходов, одна notification:
  `история (N/8):` (EN `history (N/8):`) и строки `N. ↺ hit · prompt P
  [· saved …] [· miss premium …] [· причина]`, от старого к новому. `saved` —
  только при `cacheRead > 0` (`$X` или `?` без цены); `miss premium` — только
  при `reBilled > 0` (`$X (N tok)` или `? (N tok)`); причина — только у
  канонического промаха (`простой N мин`/`idle N min`,
  `перезапись префикса`/`prefix rewrite`), первый ход эпохи её не получает.
  Нет ходов — `история: нет данных` (EN `history: no data`).
- История живёт в окне `historySize` (default 8): live-ходы добавляются в
  `turn_end` с известными ценами, восстановленные из журнала — с
  `savedCost`/`reBillCost = null`. Причина в live и в warning считается одним
  `missCause(idleMs, idleMinutes)` (возвращает `Cause`), промах — одним
  `isCanonicalMiss(prevPrompt, usage, prompt, minPromptTokens,
  minPrevPromptTokens)` (порог предыдущего хода — `minPrevPromptTokens`,
  default 2048), текст причины — `causeText`.
- Restore истории на resume/fork: последние `historySize` assistant-сообщений;
  границы `model_change`/`thinking_level_change`/`reset_boundary`/`compaction`/
  `branch_summary` начинают новую эпоху (причина `null`, база простоя
  сброшена). `idleMs` — из `message.timestamp`; сообщение без timestamp
  разрывает цепочку. У последней записи окна `reBilled = null`: граница
  resume не журналируется.
- `/new` очищает историю; `/clear` и переходы по дереву сохраняют; resume/fork
  восстанавливают.
- Эпоха префикса сбрасывается на: старт сессии, компакцию, смену модели,
  смену thinking (live, fallback на настройки), смену набора инструментов,
  `/new`/`/fork`/`/switch` (суммы тоже), `/clear`/ветку/дерево (только сравнение).
- Предупреждения: только TUI, `agent.kind === "main"`, `warningsEnabled`, не
  первый ход эпохи, prompt ≥ `minPromptTokens` (default 4000); канонический
  промах (`prev ≥ minPrevPromptTokens && cacheRead == 0 && cacheWrite > 0`) и
  низкий hit (< `lowHitPercent`, default 50). `epochWarned` даёт один warning
  каждого типа за эпоху при `oncePerEpoch: true` (default) и на каждом
  подходящем ходе при `false`; `warnCanonicalMiss: false` отключает только
  canonical-miss, low hit остаётся.
- Причина канонического промаха — per-turn: `простой N мин`, если
  `message.timestamp` даёт разрыв ≥ `idleMinutes` (default 5 минут), иначе
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
  частью перед трендом, `тренд:` — последние `trendSize` хитов (default 12;
  `▁`…`█`, `·` — n/a) и итог сессии с `saved`/`miss premium` (`≥` — известна
  лишь часть суммы).
  На `language: en`: `mode:`, `no preset`, `turn:`, `turn: no data`, `trend:`,
  `session:`, `turns N`; `in`/`cacheRead`/`cacheWrite`/`saved`/`miss premium` —
  без изменений.
- На `/new` суммы и тренд обнуляются; resume/fork восстанавливают их из
  журнала. `/clear` и переходы по дереву суммы сохраняют.
- На `session_start` (startup/reload/new/resume/fork) состояние читается из
  `ctx.sessionManager.getEntries()`: суммы, ходы, тренд (последние
  `trendSize`), последний ход и пере-оплаченные токены. У новой сессии журнал
  пуст.
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
| Документация | `README.md` (EN), `docs/README.ru.md` (RU), `docs/ui-settings.md` (настройки/справка), `CHANGELOG.md`; в tarball входит только `README.md` |
| Релиз | https://github.com/metapeka/omp-cache-monitor/releases/tag/v0.6.0 (private, tarball-ассет); теги `v0.7.0`/`v0.8.0`/`v0.9.0`/`v0.10.x` — по решению владельца |
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
#   /cache-monitor costs → «стоимость сессии: $…» и строки бакетов
#   /cache-monitor settings → 15 ключей, группы Preset/Status/Warnings/Reports,
#                             «цены модели: да|нет»
#   omp plugin config set omp-cache-monitor language en → весь вывод по-английски
#   /cache-monitor help → справка с подкомандами и путями к настройкам
#   /new → статус ↺ …, команда: ходов 0, ↺ n/a; history: «история: нет данных»,
#          costs: «стоимость: нет данных»

# сверка с журналом сессии
# assistant usage: input/cacheRead/cacheWrite/cost → hit = cacheRead/(сумма)
```

## Возможные следующие шаги (по решению владельца)

Полный план с этапами, критериями и назначением агентов — `ROADMAP.md`.
Кратко: этапы 1–2, 2.5, 2.8, 2.11, 2.12 (Phase 1 + 1.5 + 2 + 3) и 4 (README,
пакет, tarball, тег/release 0.6.0) готовы; 0.7.0 (`/cache-monitor costs`),
0.8.0 (настройки, `settings`, `help`), 0.8.1 (группы, docs map),
0.9.0 (`language: ru|en`, EN-вывод) и 0.9.1 (`docs/powerline.md`) в `main`;
0.10.0 (`preset` + advanced-ключи, 15 ключей, 84 теста) — Phase 3;
0.10.1 — Phase 4 (онбординг на первом промахе, скриншоты, upstream issue
#20253, 85 тестов). **Phase 4 закрыта.** Тег/release `v0.10.1`, этап 5
(npm/marketplace) и P2 (панель) — только по решению владельца. TTL на
`cline-pass` не делаем: провайдер не декларирует lifetime; TTL — data-gated P2.

## Ограничения

- npm, marketplace и новые remote — **только с явного разрешения владельца**;
  GitHub-пуш в `metapeka/omp-cache-monitor` разрешён.
- Номер upstream-бага: can1357/oh-my-pi#20128 (`getThinkingLevel` → `undefined`
  на моделях `off|auto`); не «чинить» его в обход — используется fallback.
- OMP 19.1.0, проверено на маршруте `cline-pass`.
- OMP 19.1 не принимает `.tgz` в `omp plugin install`: tar-путь трактуется как
  каталог (`ENOTDIR`), `file:` — «Invalid package name». Пакет проверяется
  через `npm install --prefix <home>/.omp/plugins <tgz>` или распакованный
  каталог; `github:`-установка — отдельный путь (4.3).
- Для private-репозитория `omp plugin install github:metapeka/...` даёт 404:
  bun обращается к неавторизованному `api.github.com/.../tarball`. Рабочий
  путь — `git+ssh://git@github.com/metapeka/omp-cache-monitor.git` с SSH-ключом.
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
- История — окно `historySize` (default 8), спарклайн — `trendSize` (12), и
  только в памяти/журнале текущей сессии; между сессиями
  она не переносится и в панель/JSON не выводится. После resume деньги
  восстановленных ходов неизвестны (`saved ?`, `miss premium ? (N tok)`), а
  `reBilled` последней записи окна не восстанавливается.
- Разбивка стоимости — только по журналу: live-событие `turn_end` даёт лишь
  `диалог`, фоновые `usage`/`model_usage`/`compaction`/`branch_summary` без
  записи в журнал не видны. Если у записи нет числового `cost.total`, её
  стоимость неизвестна (`?`/`≥`), а не оценена; нестроковый `kind`/`purpose`
  попадает в `прочее`.
- Настройки читаются внутренним `getPluginSettings` из
  `@oh-my-pi/pi-coding-agent/extensibility/plugins/loader`: subpath может
  переехать между версиями OMP. Импорт динамический, любая ошибка даёт defaults,
  поэтому расширение не падает, но новые ключи без loader'а не видны. Настройки
  применяются к новой сессии; открытая сессия сама их не перечитывает — это
  делает команда `settings`.
- `statusShowCost` публикует `cache-monitor-cost` только на `turn_end` в main
  TUI: до первого хода и при `statusEnabled: false` ключа нет, а старый
  сегмент не очищается — как и у `cache-monitor`; Powerline скрывает пустой
  ключ через `hideWhenMissing`.
