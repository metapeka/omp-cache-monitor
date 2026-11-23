# Powerline-интеграция

`omp-cache-monitor` публикует статус через
`ctx.ui.setStatus("cache-monitor", …)`. Это позволяет вынести hit rate в
Powerline-строку без второго кода и без runtime-зависимостей.

Текст статуса:

```text
cache-safe ↺ 98%
↺ 98%
↺ …
↺ n/a
```

- `OMP_MODE` добавляется только при `statusShowMode: true` и заданном
  `OMP_MODE`.
- До первого хода — `↺ …`; при нулевом знаменателе — `↺ n/a`.
- При `statusEnabled: false` статус не публикуется, и Powerline-элемент
  скрывается (`hideWhenMissing`).

## Вариант 1 — нативная статус-строка OMP

Сторонний плагин не нужен. OMP уже умеет powerline-разделители, а сегмент
`status` собирает статусы расширений, включая `cache-monitor`. В
`~/.omp/agent/config.yml`:

```yaml
statusLine:
  preset: custom
  separator: powerline-thin
  leftSegments: ["vim", "model", "mode", "path", "git", "pr"]
  rightSegments: ["session_name", "token_total", "cost", "context_pct", "status"]
```

`showHookStatus: true` (дефолт) показывает статус и без сегмента `status`, но
отдельным элементом. Для чистого Powerline-ряда нужен именно `status`.

## Вариант 2 — `pi-powerline-footer`

Внешний плагин `pi-powerline-footer` читает статусы расширений через
`customItems`. Наш ключ — `cache-monitor`. Это сторонний пакет: его
совместимость с конкретной версией OMP проверяйте отдельно; нативный вариант
выше от него не зависит.

Установка (опционально, сторонний пакет):

```bash
omp plugin install npm:pi-powerline-footer
```

Конфигурация Powerline — в его settings-файле
(`$PI_CODING_AGENT_DIR/settings.json`, по умолчанию
`~/.pi/agent/settings.json`; OMP-настройки в `~/.omp/agent/config.yml` — это
другой файл):

```json
{
  "powerline": {
    "preset": "default",
    "customItems": [
      {
        "id": "cache",
        "statusKey": "cache-monitor",
        "position": "right",
        "hideWhenMissing": true,
        "excludeFromExtensionStatuses": true
      }
    ]
  }
}
```

- `statusKey` должен быть ровно `cache-monitor` — это ключ нашего
  `ctx.ui.setStatus`.
- `prefix` не нужен: в тексте уже есть `↺`.
- `excludeFromExtensionStatuses: true` убирает дубль из агрегатного сегмента
  `extension_statuses`.
- `position` можно поставить в `secondary`, если основной ряд переполнен.
- `color`/`selfColorize` не обязательны: наш статус не содержит ANSI.

## Проверка

1. В TUI выполнить `/cache-monitor` — команда должна ответить, а в статус-строке
   появиться `↺ N%` (или `OMP_MODE ↺ N%`).
2. Для нативного варианта — проверить, что `status` есть в
   `statusLine.rightSegments` или `leftSegments`.
3. Для `pi-powerline-footer` — открыть `/powerline` и убедиться, что элемент
   `cache` показывает тот же текст, что и статус-строка.
4. `statusEnabled: false` должен скрывать элемент; `statusShowMode: false`
   оставляет `↺ N%` без режима.

Интеграция не меняет метрики, не добавляет запросов и не трогает настройки
OMP. Это только отображение уже опубликованного статуса.
