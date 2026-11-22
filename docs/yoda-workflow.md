# Yoda workflow: режимы и оркестрация

Дата: 2026-11-22. Статус: дизайн, не реализовано.
Цель: агент сам двигается по глобальному плану, сам тестирует и делает
handoff, но не выходит за рамки, которые требуют решения владельца.

## Режимы

| Режим | Что делает | Авто-компакция | Авто-новая сессия |
|---|---|---|---|
| `manual` | warnings, `/handoff` вручную | нет | нет |
| `assisted` | warnings + авто-компакция | 60% | нет |
| `yoda` | цикл по плану, handoff на границе задачи | fallback 70% | через supervisor |
| `yoda-supervised` | то же + supervisor сам меняет сессию | fallback 70% | да |

`yoda` без supervisor может работать только на компакции. Новую сессию
из event-handler начать нельзя: OMP 19.1 даёт `ctx.newSession()` только в
`ExtensionCommandContext`. Поэтому для unattended-смены сессии нужен внешний
supervisor или команда `/handoff-new`.

## Акторы

| Актор | Ответственность | Контекст |
|---|---|---|
| **Orchestrator** (main) | читает план/state, выбирает задачу, спавнит агентов, мержит, обновляет state, решает handoff | маленький; не читает большие файлы, делегирует |
| **Implementer** (`task`) | одна задача, один worktree, код и тесты | полный контекст задачи |
| **Verifier** (`task`/reviewer) | независимо гоняет тесты/typecheck/CI, проверяет acceptance | не редактирует |
| **Reviewer** (`reviewer`) | ревью diff, риски, соответствие контракту | не редактирует |
| **Scout** (`scout`) | research, поиск API/конкурентов | read-only |
| **Supervisor** (внешний) | смотрит marker/context/idle, запускает `/handoff-new` или перезапуск, проверяет новую сессию | без LLM на первом этапе |
| **Human** | product-решения, публикация, неоднозначности | gates |

## Состояние

- `AUTOPLAN.md` — цель, non-goals, этапы, задачи (id, зависимости,
  acceptance, файлы, тесты), бюджеты, gates.
- `HANDOFF.md` — человекочитаемое состояние: сделано, решения, проверки,
  следующие шаги, риски.
- `STATE.json` — машиночитаемое: current task, branch, commit, status,
  context %, spend, last handoff, stop reason.
- Git + тесты + CI — источник истины. Summary компакции — кэш, не истина.

## Цикл

1. Orchestrator читает `AUTOPLAN.md` и `HANDOFF.md`; проверяет gate/бюджет.
2. Берёт следующую задачу с выполненными зависимостями.
3. Создаёт worktree `feat/<slug>`; спавнит Implementer с полным контекстом и
   acceptance.
4. Verifier независимо гоняет `npm test`, `npm run typecheck`, CI/TUI.
5. Reviewer смотрит diff; Orchestrator мержит `--ff-only`, удаляет worktree.
6. Обновляет `HANDOFF.md`/`STATE.json`, пишет commit и результаты проверок.
7. **Handoff decision**:
   - граница задачи и context ≥ 50% → обновить state, поставить marker,
     supervisor делает `/handoff-new`;
   - одна длинная задача и context ≥ 70% → аварийная компакция;
   - следующая задача независима и context высокий → handoff, даже если
     формально можно продолжать.
8. Supervisor видит marker, ждёт idle, запускает новую сессию с промптом
   «прочитай AUTOPLAN.md и HANDOFF.md, продолжай следующую задачу».
9. Повтор до конца плана или stop-gate.

## Кто принимает решение

Не «модель почувствовала». Решение гибридное:

- **Агент** решает, что задача завершена и какая следующая (по acceptance и
  плану).
- **Детерминированная политика** решает, когда compact/handoff: пороги,
  граница задачи, бюджет, miss cost.
- **Supervisor** исполняет смену сессии и проверяет, что не осталось двух
  активных сессий.
- **Human** решает product-развилки и публикацию.

## Конфиг

```yaml
workflow:
  mode: yoda              # manual | assisted | yoda | yoda-supervised
  context:
    warn: 35
    suggest: 50
    compact: 70
    handoff: 50           # на границе задачи
  budgets:
    maxTasksPerSession: 3
    maxSpendUsd: 5
    maxMinutes: 120
  supervisor:
    enabled: true
    idleSeconds: 30
    verifyNewSession: true
```

Эквивалент через env: `OMP_WORKFLOW_MODE`, `OMP_CONTEXT_WARN`,
`OMP_CONTEXT_SUGGEST`, `OMP_CONTEXT_AUTO`.

## Stop-gates

- Нужно продуктовое решение или меняется контракт.
- Публикация npm/marketplace, смена видимости, удаление данных.
- Две неудачные попытки на задачу или падающий CI.
- Внешний сервис/сеть/авторизация недоступны.
- Бюджет исчерпан.
- Supervisor не смог поднять новую сессию.

## Технические ограничения

- `ctx.compact()` доступен в event/command handler.
- `ctx.newSession()` — только command context; event handler не может.
- `pi.sendUserMessage()` может попросить агента написать state, но не
  запускает новую сессию.
- Tool не получает `newSession`; «магической» авто-смены сессии нет.
- Поэтому `yoda` без supervisor = цикл на компакции; `yoda-supervised` =
  полный clean-window handoff.

## Definition of done для режима

- Переключение режима меняет поведение без правки кода.
- Yoda-цикл проходит N задач, каждая с тестами/CI и обновлением state.
- На границе задачи supervisor поднимает новую сессию; старая закрыта; state
  прочитан; дублей нет.
- При stop-gate агент останавливается и пишет причину, а не «додумывает».
- Cache-monitor показывает стоимость компакции/handoff, чтобы режим можно
  было экономически проверить.
