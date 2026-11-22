/**
 * cache-monitor — hit rate кэша префикса в статус-строке и команда `/cache-monitor`.
 *
 * Ничего не меняет в настройках и запросах: только читает usage завершённого
 * хода (`turn_end.message.usage`) и публикует статус. Считает hit как
 * `cacheRead / (input + cacheRead + cacheWrite)`.
 *
 * Предупреждения учитывают «эпоху» префикса: старт сессии, смену модели,
 * смену thinking (live-уровень, при `undefined` — сконфигурированный),
 * смену набора активных инструментов и компакцию
 * сбрасывают сравнение с предыдущим ходом, поэтому старые числа не приписываются
 * новому префиксу.
 *
 * Установка: `omp plugin link <каталог>` либо копия в `~/.omp/agent/extensions/`
 * (одно из двух). Сегмент `status` ставит статус в общий ряд; без него при
 * `statusLine.showHookStatus` (дефолт) он показывается отдельным элементом.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** usage одного хода; все поля читаются защищённо из события. */
type TurnUsage = {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
};

/** Последний завершённый ход для `/cache-monitor`. */
type LastTurn = TurnUsage & {
	hit: number | null;
	reBilled: number | null;
	/** Стоимость пере-оплаты по цене модели этого хода; `null` — цен нет. */
	reBillCost: number | null;
};

/** Хендл настроечного реестра: `get(scope)` без зависимости от его типа. */
type RegistryHandle = { get(scope: unknown): unknown };

const STATUS_KEY = "cache-monitor";
/** Мелочь на первом ходе ни о чём не говорит. */
const MIN_PROMPT = 4000;
/** Префикс предыдущего хода должен быть достаточно большим для сравнения. */
const MIN_PREV_PROMPT = 2048;

/** Поле внешнего объекта без `any`: guard проверяет форму, индекс — один общий случай. */
function field(source: unknown, key: string): unknown {
	if (source !== null && typeof source === "object" && key in source) {
		return (source as Record<string, unknown>)[key];
	}
	return undefined;
}

/** Число из события: провайдер обязан прислать число, остальное считаем нулём. */
function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Процент кэша от всего prompt; `null` — знаменателя нет. */
function hitPercent(input: number, cacheRead: number, cacheWrite: number): number | null {
	const total = input + cacheRead + cacheWrite;
	if (total <= 0) return null;
	return Math.round((cacheRead / total) * 1000) / 10;
}

/** Процент с `%` (целые без дробной части, остальные — один знак) либо `n/a`. */
function hitPercentText(hit: number | null): string {
	if (hit === null) return "n/a";
	return `${Number.isInteger(hit) ? String(hit) : hit.toFixed(1)}%`;
}

/**
 * Стоимость пере-оплаченных токенов: цена нового input минус цена чтения кэша,
 * обе — `$/1M` в `model.cost`. Без числовых цен возвращает `null`.
 */
function rebillCost(model: unknown, tokens: number): number | null {
	const cost = field(model, "cost");
	const inputPrice = field(cost, "input");
	const cacheReadPrice = field(cost, "cacheRead");
	if (typeof inputPrice !== "number" || !Number.isFinite(inputPrice)) return null;
	if (typeof cacheReadPrice !== "number" || !Number.isFinite(cacheReadPrice)) return null;
	return (tokens / 1e6) * (inputPrice - cacheReadPrice);
}

/** `setStatus` не должен ронять обработчик в режимах без UI. */
function setStatus(ctx: ExtensionContext, text: string): void {
	try {
		ctx.ui.setStatus(STATUS_KEY, text);
	} catch {
		// UI контекст может не поддерживать статус-строку
	}
}

/** `notify` не должен ронять обработчик в режимах без UI. */
function notify(ctx: ExtensionContext, text: string, level: "info" | "warning"): void {
	try {
		ctx.ui.notify(text, level);
	} catch {
		// UI контекст может не поддерживать уведомления
	}
}

/** Ленивый резолв хендла реестра настроек; ошибка не должна ломать расширение. */
async function resolveRegistryHandle(): Promise<RegistryHandle | null> {
	try {
		// Динамический импорт намеренно: статический импорт недоступного subpath
		// не даст расширению загрузиться целиком, а реестр нужен лишь для справки.
		const mod: unknown = await import("@oh-my-pi/pi-coding-agent/config/registry");
		const lookupFn = field(mod, "lookup");
		if (typeof lookupFn !== "function") return null;
		const handle: unknown = Reflect.apply(lookupFn, undefined, ["defaultThinkingLevel"]);
		if (handle === null || typeof handle !== "object") return null;
		if (typeof field(handle, "get") !== "function") return null;
		return handle as RegistryHandle;
	} catch {
		// subpath переехал или реестр недоступен — деградируем до «?»
		return null;
	}
}

export default function cacheMonitor(pi: ExtensionAPI): void {
	const mode = process.env.OMP_MODE?.trim() || "";

	let last: LastTurn | null = null;
	let prevPrompt: number | null = null;
	let turns = 0;
	let sessionInput = 0;
	let sessionCached = 0;
	let sessionWrite = 0;
	let sessionCost = 0;

	// Состояние «эпохи» префикса: сравнение с prev действительно только внутри неё.
	let epochReady = false;
	let epochModel = "";
	let epochThinking = "?";
	let epochTools = "";
	let epochCause: string | null = null;
	let epochWarned = new Set<string>();

	/** Ленивый (и кэшированный) резолв реестра; значение читается на каждом ходе. */
	let registryPromise: Promise<RegistryHandle | null> | null = null;
	/** Эпоха сменилась, и её первый ход ещё не завершился: не предупреждать. */
	let epochResetPending = false;

	/** Signature активных инструментов: отсортированные имена. */
	const activeToolsSignature = (): string => {
		try {
			return [...pi.getActiveTools()].sort().join(",");
		} catch {
			return "";
		}
	};

	/**
	 * Текущий thinking level: сначала live-значение (`/effort` меняет его, не
	 * настройки), затем configured `defaultThinkingLevel` из реестра; `?` при
	 * недоступности обоих (известный баг `undefined` на моделях off|auto).
	 */
	const thinkingLevel = async (): Promise<string> => {
		try {
			const live: unknown = pi.getThinkingLevel();
			if (typeof live === "string" && live) return live;
		} catch {
			// live-аксессор недоступен — идём в реестр
		}
		if (!registryPromise) registryPromise = resolveRegistryHandle();
		const handle = await registryPromise;
		if (!handle) return "?";
		try {
			const value = handle.get(pi.pi.settings);
			if (typeof value === "string" && value) return value;
		} catch {
			// реестр недоступен — оставляем «?»
		}
		return "?";
	};

	/** Пересобрать базовую линию эпохи и сбросить сравнение. */
	const resetEpoch = async (ctx: ExtensionContext, cause: string | null): Promise<void> => {
		epochModel = String(field(ctx.model, "id") ?? "");
		epochThinking = await thinkingLevel();
		epochTools = activeToolsSignature();
		epochCause = cause;
		epochWarned = new Set<string>();
		prevPrompt = null;
		epochResetPending = true;
		epochReady = true;
	};

	/** Начать новый транскрипт: прошлые суммы и последний ход к нему не относятся. */
	const resetTranscriptTotals = (): void => {
		last = null;
		turns = 0;
		sessionInput = 0;
		sessionCached = 0;
		sessionWrite = 0;
		sessionCost = 0;
	};

	/**
	 * Определить, сменилась ли эпоха с прошлого хода, и обновить базовую линию.
	 * Возвращает причину смены или `null`.
	 */
	const syncEpoch = async (ctx: ExtensionContext): Promise<string | null> => {
		const model = String(field(ctx.model, "id") ?? "");
		const thinking = await thinkingLevel();
		const tools = activeToolsSignature();
		if (!epochReady) {
			epochModel = model;
			epochThinking = thinking;
			epochTools = tools;
			epochReady = true;
			return null;
		}
		let cause: string | null = null;
		if (model !== epochModel) cause = "смена модели";
		else if (thinking !== epochThinking) cause = "смена thinking";
		else if (tools !== epochTools) cause = "смена набора инструментов";
		if (cause === null) return null;
		epochModel = model;
		epochThinking = thinking;
		epochTools = tools;
		epochCause = cause;
		epochWarned = new Set<string>();
		prevPrompt = null;
		return cause;
	};

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode === "tui" && ctx.agent.kind === "main") {
			setStatus(ctx, mode ? `${mode} ↺ …` : "↺ …");
		}
		await resetEpoch(ctx, null);
	});

	pi.on("session_compact", async (_event, ctx) => {
		await resetEpoch(ctx, "компакция");
	});

	// Смена транскрипта в том же runner: `/new`, `/fork`, `/switch`.
	pi.on("session_switch", async (_event, ctx) => {
		resetTranscriptTotals();
		if (ctx.mode === "tui" && ctx.agent.kind === "main") {
			setStatus(ctx, mode ? `${mode} ↺ …` : "↺ …");
		}
		await resetEpoch(ctx, null);
	});

	// `/clear` и переходы по дереву: суммы сессии остаются, префикс — новый.
	pi.on("session_clear", async (_event, ctx) => {
		await resetEpoch(ctx, null);
	});

	pi.on("session_branch", async (_event, ctx) => {
		await resetEpoch(ctx, null);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await resetEpoch(ctx, null);
	});

	pi.on("turn_end", async (event, ctx) => {
		const raw = field(field(event, "message"), "usage");
		if (raw === null || typeof raw !== "object") return;
		const usage: TurnUsage = {
			input: num(field(raw, "input")),
			cacheRead: num(field(raw, "cacheRead")),
			cacheWrite: num(field(raw, "cacheWrite")),
			cost: num(field(field(raw, "cost"), "total")),
		};
		const hit = hitPercent(usage.input, usage.cacheRead, usage.cacheWrite);
		const prompt = usage.input + usage.cacheRead + usage.cacheWrite;

		turns += 1;
		sessionInput += usage.input;
		sessionCached += usage.cacheRead;
		sessionWrite += usage.cacheWrite;
		sessionCost += usage.cost;

		const mainTui = ctx.mode === "tui" && ctx.agent.kind === "main";
		if (mainTui) {
			const text = mode ? `${mode} ↺ ${hitPercentText(hit)}` : `↺ ${hitPercentText(hit)}`;
			setStatus(ctx, text);
		}

		// Предыдущий ход той же эпохи (syncEpoch может его сбросить).
		const prev = prevPrompt;
		const changed = await syncEpoch(ctx);
		// Первый ход новой эпохи не сравнивается и не предупреждает.
		const freshEpoch = changed !== null || epochResetPending;
		epochResetPending = false;
		const comparePrompt = freshEpoch ? null : prev;
		const reBilled =
			comparePrompt !== null && comparePrompt > 0
				? Math.max(0, Math.min(comparePrompt, prompt) - usage.cacheRead)
				: null;
		const reBillCost =
			reBilled !== null && reBilled > 0 ? rebillCost(ctx.model, reBilled) : null;
		last = { ...usage, hit, reBilled, reBillCost };
		prevPrompt = prompt;

		const turnIndex = num(field(event, "turnIndex"));
		const canWarn = mainTui && !freshEpoch && turnIndex >= 1 && prompt >= MIN_PROMPT;
		if (!canWarn) return;

		// Канонический промах: префикс переписан целиком, кэш не прочитан.
		if (
			comparePrompt !== null &&
			comparePrompt >= MIN_PREV_PROMPT &&
			usage.cacheRead === 0 &&
			usage.cacheWrite > 0 &&
			!epochWarned.has("canonical-miss")
		) {
			epochWarned.add("canonical-miss");
			const reason = epochCause ?? "неизвестно";
			const costText =
				reBilled !== null && reBilled > 0
					? ` Пере-оплачено ≈ ${reBilled} tok${reBillCost === null ? "" : ` ($${reBillCost.toFixed(4)})`}.`
					: "";
			notify(
				ctx,
				`Кэш префикса: промах (cacheRead 0, cacheWrite ${usage.cacheWrite}, prompt ${prompt}) — причина: ${reason}.${costText}`,
				"warning",
			);
		}

		// Низкий hit — не обязательно промах, но признак смены префикса.
		if (hit !== null && hit < 50 && !epochWarned.has("low-hit")) {
			epochWarned.add("low-hit");
			notify(
				ctx,
				`Кэш префикса: hit ${hitPercentText(hit)} (input ${usage.input}, cacheRead ${usage.cacheRead}, ` +
					`cacheWrite ${usage.cacheWrite}, prompt ${prompt}). ` +
					"Префикс изменился или кэш не читается — проверьте модель, thinking, режим и MCP.",
				"warning",
			);
		}
	});

	pi.registerCommand("cache-monitor", {
		description: "Показать режим, модель и hit rate кэша префикса",
		handler: async (_args, ctx) => {
			const modelLabel = ctx.model
				? `${String(field(ctx.model, "provider") ?? "?")}/${String(field(ctx.model, "id") ?? "?")}`
				: "?";
			const thinking = await thinkingLevel();

			const parts = [`режим: ${mode || "без пресета"}`, modelLabel, `thinking ${thinking}`];
			if (last) {
				parts.push(
					`ход: ↺ ${hitPercentText(last.hit)} · in ${last.input} · cacheRead ${last.cacheRead} · ` +
						`cacheWrite ${last.cacheWrite} · $${last.cost.toFixed(4)}`,
				);
				if (last.reBilled !== null && last.reBilled > 0) {
					const money = last.reBillCost;
					parts.push(
						`пере-оплата: ${last.reBilled} tok${money === null ? "" : ` ($${money.toFixed(4)})`}`,
					);
				}
			} else {
				parts.push("ход: нет данных");
			}
			const sessionHit = hitPercent(sessionInput, sessionCached, sessionWrite);
			parts.push(
				`сессия: $${sessionCost.toFixed(4)}, ходов ${turns}, ↺ ${hitPercentText(sessionHit)}`,
			);

			notify(ctx, parts.join(" · "), "info");
		},
	});
}
