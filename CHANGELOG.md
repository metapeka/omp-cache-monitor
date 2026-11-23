# Changelog

## 0.9.1 — 2026-11-23

- **Powerline-интеграция.** Новый `docs/powerline.md`: статус
  `cache-monitor` в нативный `statusLine` OMP с `powerline-thin` и в
  `pi-powerline-footer` через `customItems` (`statusKey: "cache-monitor"`).
  Второй код не нужен: расширение уже публикует статус через
  `ctx.ui.setStatus`. Раздел добавлен в README (EN) и `docs/README.ru.md`,
  ссылки — в `docs/ui-settings.md` и `docs/omp-docs-map.md`.
- **Границы.** `statusEnabled: false` скрывает элемент, `statusShowMode`
  управляет префиксом `OMP_MODE`; настройки powerline-плагина не входят в
  `omp.settings` и не меняются этим пакетом.
- Поведение, метрики и defaults не меняются; тестов по-прежнему 68.

## 0.9.0 — 2026-11-23

- **`language: ru | en`** — девятый ключ `package.json#omp.settings`
  (`type: "enum"`, `values: ["ru","en"]`, default `ru`), группа `Reports`.
  Меняет только пользовательский вывод: метрики, токены, формат денег и
  `(changed)`/`(default)` не зависят от языка. Невалидное значение (включая
  не-строку) `normalizeConfig` откатывает к `ru`. Описания `omp.settings` в
  манифесте остаются английскими при любом языке.
- **Единый словарь строк.** Все пользовательские тексты вынесены в
  `TEXTS: Record<Language, Texts>`: отчёт (`mode:`/`turn:`/`trend:`/`session:`,
  `turns N`), history (`history (N/M):`, `history: no data`), costs
  (`session cost:`, `dialog`/`compaction`/`branch`/`other`), `settings`
  (заголовки `⚙ Status`/`⚠️ Warnings`/`📊 Reports`, подписи, `model prices:
  yes|no`, `Change:`), `help` (те же 8 строк по-английски) и оба warning-а.
- **Структурная причина промаха.** `TurnRecord.cause` теперь
  `{ kind: "idle"; minutes: number } | { kind: "rewrite" } | null`, а
  `causeText(cause, language)` рендерит `простой N мин` / `idle N min` и
  `перезапись префикса` / `prefix rewrite`. Смена языка перерисовывает уже
  записанные ходы и restore из журнала; warning использует тот же
  `causeText`.
- **`ru` (default) не меняет вывод** байт-в-байт, кроме новой строки
  `language: ru (default) — язык вывода` в `/cache-monitor settings`.
  `registerCommand.description` теперь английский:
  `Cache prefix hit rate: report, history, costs, settings, help`.
- **Тесты.** 68 тестов: новые EN-проверки отчёта, history (заголовок, пустое
  состояние, причины), costs, `settings`, `help` и warning-ов, каждая с
  `doesNotMatch(/[А-Яа-яЁё]/)`; перерисовка сохранённых причин при смене
  языка; `normalizeConfig` для `en`/`ru`/невалидных значений.
- **Документация.** README (EN) и `docs/README.ru.md` — ключ `language`,
  пример EN-вывода, пометка про английские описания манифеста;
  `docs/ui-settings.md` — 9 ключей, Phase 2 отмечена done (0.9.0);
  `ROADMAP.md`, `HANDOFF.md`, `AGENTS.md` — версия, контракт и счётчики.

## 0.8.1 — 2026-11-23

- **Сгруппированные описания настроек.** Все 8 `description` в
  `package.json#omp.settings` переписаны в формате
  `Group · what. Default/range. Why.` (`Status · …`, `Warnings · …`,
  `Reports · …`). Типы, defaults и границы не менялись; OMP показывает группу
  прямо в подвале Settings → Plugins вместе с описанием выбранной строки.
- **`/cache-monitor settings` с группами.** Вывод получил заголовки
  `⚙ Статус`, `⚠️ Предупреждения`, `📊 Отчёты`, отступ у ключей и статичную
  подпись после `—`; `(changed)`/`(default)`, `💵 цены модели` и команда
  `Изменить:` сохранены. Алиас `setting` работает как раньше.
- **`/cache-monitor help`.** Справка из 8 строк: «чем выше, тем дешевле»,
  промах = `cacheRead 0`, подкоманды одной строкой и ссылки на `README.md`,
  `docs/ui-settings.md`, `docs/omp-docs-map.md`.
- **Карта документации OMP.** Новый `docs/omp-docs-map.md` (RU): как открыть
  `omp://docs` (135 файлов), таблица «задача → файл», сайт и исходники;
  зафиксировано, что `Thinkrail` в OMP SDK/доках не встречается.
- **Роудмап фаз.** `docs/ui-settings.md` — раздел «Ограничения UI OMP»
  (плоский список, footer-description, нет групп/иконок; upstream-предложение
  `group`/`icon`) и чеклист Phase 1/1.5/2/3/4 с критериями готовности. README
  (EN) и `docs/README.ru.md` — новый пример вывода `settings`, ссылки на
  `docs/ui-settings.md` и `docs/omp-docs-map.md`.
- Поведение и метрики не меняются, defaults прежние. Тестов 60, typecheck
  зелёный, `npm pack --dry-run` — 4 файла.

## 0.8.0 — 2026-11-23

- **Настройки плагина.** В `package.json` → `omp.settings` объявлены 8 ключей:
  `statusEnabled`, `statusShowMode`, `warningsEnabled`, `lowHitPercent`,
  `idleMinutes`, `minPromptTokens`, `historySize`, `showMoney`. OMP показывает
  их в Settings → Plugins и в `omp plugin config list/set`; runtime читает их
  через `getPluginSettings` на старте сессии и перед командами. Любая ошибка
  внутреннего API — defaults, поэтому поведение без настроек побайтово
  совпадает с 0.7.0.
- **`/cache-monitor settings` (алиас `setting`).** Перечитывает настройки и
  печатает значения с пометкой `(changed)`/`(default)`, наличие цен модели и
  команду изменения.
- **`/cache-monitor help` (алиас `?`).** Статическая справка: что значит `↺`,
  подкоманды, где открыть настройки, ссылка на README.
- **Пороги и окна из настроек.** `lowHitPercent` заменяет жёсткие 50%,
  `idleMinutes` — 5-минутную эвристику (в warning и restore), `minPromptTokens`
  — порог 4000, `historySize` — окно истории и делитель `история (N/M):`.
  `warningsEnabled=false` глушит все warning, `statusEnabled=false` не трогает
  статус-строку, `statusShowMode=false` убирает префикс `OMP_MODE`.
- **`showMoney=false`.** В дефолтном отчёте и history исчезают `saved` и деньги
  `miss premium`, токены остаются (`miss premium: 3000 tok` /
  `miss premium 3000 tok`); `/cache-monitor costs` по-прежнему показывает
  деньги.
- **Документация.** Новый `docs/ui-settings.md` (RU) с таблицей ключей,
  командами, Phase 2/3 и рисками; разделы Settings в README (EN) и
  `docs/README.ru.md`. Тестов 60.

## 0.7.0 — 2026-11-23

- **`/cache-monitor costs` (алиас `cost`).** Подкоманда печатает фактическую
  разбивку стоимости сессии по типам записей журнала: `диалог`, `компакция`,
  `ветка`, `usage:<kind>` и `model_usage:<purpose>` (префиксы срезаны).
  Заголовок — `стоимость сессии: $X`, `диалог` всегда первым, остальные
  строки по убыванию стоимости. Дефолтный `/cache-monitor` и `history` не
  меняются.
- **Только `cost.total`, без оценок.** Сумма и строки берутся из
  `usage.cost.total` записей; live-ход добавляет только диалог. Если у
  бакета цена неизвестна, он печатается как `?` (цена 0) или `≥$X` (часть
  известна), а заголовок получает `≥`. Пустой журнал — остаётся live-карта;
  команду можно звать повторно — карта заменяется снимком журнала, а `/new`
  очищает её.

## 0.6.0 — 2026-11-22

- **`/cache-monitor history`.** Подкоманда (алиас `hist`) печатает последние 8
  завершённых ходов: hit, `prompt`, `saved`, `miss premium` и причину
  канонического промаха (`простой N мин` / `перезапись префикса`). Строки идут
  от старого к новому; дефолтный `/cache-monitor` без аргумента не меняется.
- **Неизвестные деньги — `?`.** В истории `saved ?` и `miss premium ? (N tok)`
  показывают восстановленные из журнала ходы, для которых цена модели не
  сохранилась. Деньги по-прежнему не выдумываются; `miss premium` печатается
  только при `reBilled > 0`.
- **Restore из журнала.** На resume история восстанавливается по последним 8
  assistant-сообщениям: причина не приписывается первому ходу эпохи, простой
  считается по `message.timestamp`, а `reBilled` последней записи не
  показывается — граница resume не журналируется. `/new` очищает историю,
  `/clear` и переходы по дереву её сохраняют.

## 0.5.0 — 2026-11-22

- **Причина мисса в warning — per-turn.** Канонический промах теперь объясняется
  простоем между завершёнными ходами (`простой N мин` при разрыве ≥ 5 минут по
  `message.timestamp`) либо `перезапись префикса`. Порог 5 минут — эмпирическая
  эвристика, не объявленный TTL провайдера. Простой через границу эпохи новому
  префиксу не приписывается; без timestamp причина — `перезапись префикса`, а
  ход без timestamp разрывает цепочку простоя. Мёртвый `epochCause` удалён.
- **`saved` и `miss premium` в `/cache-monitor`.** Экономия на чтении кэша
  (`cacheRead * (inputPrice - cacheReadPrice)`) показывается в строке хода и в
  итоге сессии; пере-оплата (`reBilled * (inputPrice - cacheReadPrice)`)
  переименована в `miss premium` и печатается отдельной частью перед трендом.
  Обе метрики используют один helper `cacheDeltaCost` и цены `model.cost`.
- **Ограничение resume.** Цены прошлых моделей в журнале не хранятся, поэтому
  восстановленный `cacheRead` в `saved` не оценивается: после resume деньги
  считаются только по live-ходам, а сумма помечается `≥`. `miss premium` после
  resume, как и раньше, восстанавливается в токенах без выдуманных денег.
