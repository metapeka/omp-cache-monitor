# omp-cache-monitor 0.11.0 — `costs --json`

Дата: 2026-11-27. Предыдущий релиз: [v0.10.1](https://github.com/metapeka/omp-cache-monitor/releases/tag/v0.10.1).

## Что нового

Read-only CLI для стоимости сессии — вход для экономики handoff в
`omp-agent-workflow` 0.6:

```bash
omp-cache-monitor costs --json [--session FILE] [--since ISO8601]
```

- Один JSON-документ в stdout, `schemaVersion: 1`; stderr пуст, exit 0.
- `totals`: `costUsd`, input/cacheRead/cacheWrite/output/reasoning tokens;
  `turns[]` — хронологические ходы с моделью, фактическим
  `usage.cost.total` и `hitPercent = cacheRead / (input + cacheRead)`;
  `models[]` — агрегат по моделям; `notes[]` — холодный префикс, смена
  модели, отсутствие цены.
- Считаются только `type: "message"` + `message.role: "assistant"`;
  служебные `model_usage` (title-fork, extract) не попадают в диалог.
- Нет цены — `null` с note, не выдуманный 0; `--since` фильтрует ходы,
  totals и models.
- Поиск сессии: `--session FILE`, иначе самый свежий `*.jsonl` в
  `OMP_SESSIONS_DIR` или `~/.omp/agent/sessions`.
- Exit codes: 0 — отчёт, 1 — нет сессии/файл не читается, 2 — аргументы.

Без `--json` печатается короткая человекочитаемая сводка.

## Установка

```bash
npm link                       # bin в PATH
# или без установки:
node bin/omp-cache-monitor.mjs costs --json --session <file>
```

Плагин `omp plugin link` bin в PATH не добавляет — это отдельный шаг.

## Совместимость

- Расширение `/cache-monitor`, 15 настроек и контракт 0.10.1 не менялись.
- Runtime-зависимостей нет; Node ≥ 22.
- `npm pack` — 6 файлов: `index.ts`, `bin/`, `lib/`, `README.md`,
  `LICENSE`, `package.json`.

## Проверки

- `npm run verify` — 104 теста (85 extension + 19 costs), `tsc --noEmit`.
- Установка из tarball: `node_modules/.bin/omp-cache-monitor costs --json`
  на реальной сессии — exit 0, stderr пуст.
- Загрузка расширения `omp --no-extensions -e ./index.ts` — exit 0.

История изменений — [CHANGELOG](../CHANGELOG.md).
