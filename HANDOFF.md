# Передача: cache-monitor

Дата: 2026-11-22. Репозиторий: `omp-cache-monitor`, ветка `main`, коммит `c849901`.
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
| Публикация | **нет**: remote, npm, marketplace не трогали |

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
| Продукт (код, пакет) | этот репозиторий |
| Пресеты, `omp-mode`, план, вики | `metapeka/docs-omp-debian-availability` |
| Публичная инструкция | https://metapeka.github.io/docs-omp-debian-availability/wiki/guide.html |
| Установленная копия | `omp plugin link`, файла в `~/.omp/agent/extensions/` нет (одно из двух, не оба) |

## Проверка после изменений

```bash
# загрузка без TUI
omp --no-session --no-tools -p 'Reply with exactly: OK' --mode json   # exit 0, stderr пуст

# TUI: статус и команда(в tmux/терминале Orca)
omp --no-tools --session-dir /tmp/cm-check
#   ↺ … на старте, затем ↺ N%; /cache-monitor печатает строку
#   /new → статус ↺ …, команда: ходов 0, ↺ n/a

# сверка с журналом сессии
# assistant usage: input/cacheRead/cacheWrite/cost → hit = cacheRead/(сумма)
```

## Возможные следующие шаги (по решению владельца)

1. GitHub: создать `metapeka/omp-cache-monitor`, запушить `main`, затем
   `omp plugin install github:metapeka/omp-cache-monitor`.
2. npm: `npm publish` → `omp plugin install omp-cache-monitor`.
3. Marketplace: каталог-репозиторий с `.omp-plugin/marketplace.json`.
4. Метрики: trend/sparkline, TTL-countdown (не дублировать native-сегмент `cache`),
   стоимость мисса в отчёте, восстановление сумм после resume.
5. Локализация README на английский перед публикацией.

## Ограничения

- Публиковать и добавлять remote **только с явного разрешения владельца**.
- Номер upstream-бага: can1357/oh-my-pi#20128 (`getThinkingLevel` → `undefined`
  на моделях `off|auto`); не «чинить» его в обход — используется fallback.
- OMP 19.1.0, проверено на маршруте `cline-pass`.
