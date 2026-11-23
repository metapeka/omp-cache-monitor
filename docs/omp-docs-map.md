# Карта документации OMP (omp-docs-map)

Короткий навигатор по встроенной документации OMP для задач
`omp-cache-monitor`. Проверено на OMP 19.1.0.

## Как открыть

- В агентской сессии: `read omp://docs` — список из 135 файлов,
  `read omp://docs/<file>.md` — конкретный файл (например,
  `read omp://docs/settings.md`).
- Публичный сайт: <https://omp.sh/docs>.
- Исходники документации: <https://github.com/can1357/oh-my-pi/tree/main/docs>.
- Отдельной команды `omp docs` **нет** — только внутренние `omp://`-ресурсы,
  сайт и исходники.

## Задача → файл

| Задача | Файл |
|---|---|
| Extension API, события, `pi.on`, `registerCommand` | `extensions.md` |
| Загрузка и discovery расширений (subpath, линковка, порядок) | `extension-loading.md` |
| Настройки: схема, слои, приоритеты, CLI | `settings.md`, `config-usage.md` |
| Plugin manager, installer, манифест, настройки плагина | `plugin-manager-installer-plumbing.md`, `marketplace.md` |
| TUI, оверлеи, статус-строка, рендерер | `tui.md`, `tui-core-renderer.md`, `tui-runtime-internals.md` |
| `statusLine` и `powerline-thin` | `settings.md` (раздел Appearance and terminal) |
| SDK и RPC-режим | `sdk.md`, `rpc.md` |
| Skills и готовые примеры расширений | `skills/authoring-extensions.md`, `skills/examples/hello-extension/README.md` |
| Сессии: resume, switch, export/share/fork | `session.md`, `session-operations-export-share-fork-resume.md` |

Пример чтения по задаче «как OMP мержит настройки плагина»:

```text
read omp://docs/settings.md
read omp://docs/config-usage.md
read omp://docs/plugin-manager-installer-plumbing.md
```

## Что проверено

- `Thinkrail` в OMP SDK и документации **не встречается**; это не
  документация OMP и не источник терминов для плагина.
- Групп, иконок и заголовков в схеме плагинных настроек нет — только плоский
  список с `description` выбранной строки в подвале. Подробности и обход
  через порядок ключей — [`ui-settings.md`](ui-settings.md).
- Конкурентный анализ и заимствования — [`research/cache-extensions.md`](research/cache-extensions.md).
