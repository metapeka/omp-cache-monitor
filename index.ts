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
 * При resume/reload/fork суммы, тренд и последний ход восстанавливаются из
 * журнала (`ctx.sessionManager.getEntries()`). Записи cache warming и
 * компакции/ветвления учитываются в суммах, но не в ходах и тренде. Цены
 * прошлых моделей в журнале не хранятся, поэтому деньги за восстановленную
 * пере-оплату (`miss premium`) и экономию (`saved`) не выдумываются.
 *
 * Причина канонического промаха считается per-turn: простой ≥ настроенного
 * порога между завершёнными ходами (по умолчанию 5 минут, эмпирическая
 * эвристика, не TTL провайдера) либо перезапись префикса. Простой через
 * границу эпохи не считается.
 *
 * `/cache-monitor history` (алиас `hist`) печатает последние
 * `historySize` завершённых ходов (по умолчанию 8) с той же причиной, `saved`
 * и `miss premium`; при resume история восстанавливается из журнала, а
 * неизвестные цены показываются как `?`.
 * `/cache-monitor costs` (алиас `cost`) печатает фактическую разбивку стоимости
 * сессии по типам записей журнала: только `cost.total` из журнала, без оценок;
 * неизвестная цена даёт `?` или `≥`. Отчёт без аргумента не меняется.
 * `/cache-monitor settings` (алиас `setting`) перечитывает настройки из
 * `package.json#omp.settings` и печатает их значения; `/cache-monitor help`
 * (алиас `?`) — краткая справка. Настройки применяются к новой сессии, команда
 * `settings` видит свежие значения сразу.
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
	/** Экономия на чтении кэша по цене модели; `null` — цен нет или `cacheRead == 0`. */
	savedCost: number | null;
};

/** Один ход в истории `/cache-monitor history`; деньги `null` — цен нет. */
type TurnRecord = {
	hit: number | null;
	prompt: number;
	cacheRead: number;
	/** Экономия хода; `null` — цен нет или `cacheRead == 0`. */
	savedCost: number | null;
	/** Пере-оплата хода; `null` — сравнивать не с чем. */
	reBilled: number | null;
	reBillCost: number | null;
	/** Причина канонического промаха; `null` — промаха нет или первая эпоха. */
	cause: string | null;
};

/** Стоимость одного типа записи; `missing` — часть цены неизвестна. */
type CostBucket = { cost: number; missing: boolean };

/** Итог по журналу сессии: то, что можно восстановить после resume/reload. */
type SessionAggregate = {
	last: LastTurn | null;
	turns: number;
	input: number;
	cached: number;
	write: number;
	cost: number;
	/** Фактическая стоимость по типам записей журнала. */
	costs: Map<string, CostBucket>;
	reBilled: number;
	/** Хотя бы у одной восстановленной пере-оплаты нет цены модели. */
	reBillCostMissing: boolean;
	trend: (number | null)[];
	history: TurnRecord[];
};

/** Хендл настроечного реестра: `get(scope)` без зависимости от его типа. */
type RegistryHandle = { get(scope: unknown): unknown };

const STATUS_KEY = "cache-monitor";
const PLUGIN_NAME = "omp-cache-monitor";
/** Префикс предыдущего хода должен быть достаточно большим для сравнения. */
const MIN_PREV_PROMPT = 2048;
/** Сколько последних ходов держим в спарклайне. */
const TREND_POINTS = 12;

/** Настройки плагина; значения и границы объявлены в `package.json#omp.settings`. */
type Config = {
	statusEnabled: boolean;
	statusShowMode: boolean;
	warningsEnabled: boolean;
	lowHitPercent: number;
	idleMinutes: number;
	minPromptTokens: number;
	historySize: number;
	showMoney: boolean;
};

/** Параметры восстановления из журнала; подмножество настроек. */
type AggregateOptions = Pick<Config, "historySize" | "minPromptTokens" | "idleMinutes">;

/** Значения по умолчанию; они же — контракт прежнего вывода без настроек. */
const DEFAULT_CONFIG: Config = {
	statusEnabled: true,
	statusShowMode: true,
	warningsEnabled: true,
	lowHitPercent: 50,
	idleMinutes: 5,
	minPromptTokens: 4000,
	historySize: 8,
	showMoney: true,
};

/** Настройки из OMP; `settings` задают тесты вместо чтения loader'а. */
type PluginSource = { settings?: Readonly<Record<string, unknown>> };

/** Число: finite → round → clamp в [min, max]; всё остальное — default. */
function configNumber(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** Привести сырые настройки OMP к валидному `Config`, не доверяя их форме. */
export function normalizeConfig(raw: unknown): Config {
	const settings: Record<string, unknown> =
		raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	return {
		statusEnabled:
			typeof settings.statusEnabled === "boolean"
				? settings.statusEnabled
				: DEFAULT_CONFIG.statusEnabled,
		statusShowMode:
			typeof settings.statusShowMode === "boolean"
				? settings.statusShowMode
				: DEFAULT_CONFIG.statusShowMode,
		warningsEnabled:
			typeof settings.warningsEnabled === "boolean"
				? settings.warningsEnabled
				: DEFAULT_CONFIG.warningsEnabled,
		lowHitPercent: configNumber(settings.lowHitPercent, DEFAULT_CONFIG.lowHitPercent, 1, 100),
		idleMinutes: configNumber(settings.idleMinutes, DEFAULT_CONFIG.idleMinutes, 1, 240),
		minPromptTokens: configNumber(
			settings.minPromptTokens,
			DEFAULT_CONFIG.minPromptTokens,
			0,
			1_000_000,
		),
		historySize: configNumber(settings.historySize, DEFAULT_CONFIG.historySize, 1, 50),
		showMoney:
			typeof settings.showMoney === "boolean" ? settings.showMoney : DEFAULT_CONFIG.showMoney,
	};
}

/** Статическая справка `/cache-monitor help`; без обещаний TTL. */
const HELP_TEXT = [
	"cache-monitor: hit rate кэша префикса в статус-строке.",
	"↺ N% — доля prompt, прочитанная из кэша; ↺ … до первого хода, n/a без знаменателя.",
	"/cache-monitor — отчёт: режим, модель, ход, тренд, итог сессии.",
	"/cache-monitor history — последние ходы; /cache-monitor costs — разбивка стоимости.",
	"/cache-monitor settings — текущие настройки; /cache-monitor help — эта справка.",
	"Настройки: Settings → Plugins → omp-cache-monitor или omp plugin config set omp-cache-monitor <key> <value>.",
	"Применяются к новой сессии; команда settings перечитывает их сразу.",
	"Подробнее: https://github.com/metapeka/omp-cache-monitor#settings",
].join("\n");

/** Уровни спарклайна: 0–100% по возрастанию. */
const SPARK_LEVELS = "▁▂▃▄▅▆▇█";
/** Нет знаменателя — hit не определён. */
const SPARK_UNKNOWN = "·";

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

/** Один столбик тренда: 0–100% → ▁…█; `·` — hit не определён. */
function sparkLevel(hit: number | null): string {
	if (hit === null) return SPARK_UNKNOWN;
	const clamped = Math.min(100, Math.max(0, hit));
	const index = Math.min(
		SPARK_LEVELS.length - 1,
		Math.floor((clamped / 100) * SPARK_LEVELS.length),
	);
	return SPARK_LEVELS.charAt(index);
}

/**
 * Стоимость разницы цен на токены: цена нового input минус цена чтения кэша,
 * обе — `$/1M` в `model.cost`. Одна дельта обслуживает обе метрики: `saved`
 * (против полной цены input) и `miss premium` (пере-оплата). Без числовых цен
 * возвращает `null`.
 */
function cacheDeltaCost(model: unknown, tokens: number): number | null {
	const cost = field(model, "cost");
	const inputPrice = field(cost, "input");
	const cacheReadPrice = field(cost, "cacheRead");
	if (typeof inputPrice !== "number" || !Number.isFinite(inputPrice)) return null;
	if (typeof cacheReadPrice !== "number" || !Number.isFinite(cacheReadPrice)) return null;
	return (tokens / 1e6) * Math.max(0, inputPrice - cacheReadPrice);
}

/** Usage-объект записи; `null` — запись не несёт числового usage. */
function entryUsage(source: unknown): TurnUsage | null {
	if (source === null || typeof source !== "object") return null;
	const input = field(source, "input");
	const cacheRead = field(source, "cacheRead");
	const cacheWrite = field(source, "cacheWrite");
	const total = field(field(source, "cost"), "total");
	const numeric =
		typeof input === "number" ||
		typeof cacheRead === "number" ||
		typeof cacheWrite === "number" ||
		typeof total === "number";
	if (!numeric) return null;
	return {
		input: num(input),
		cacheRead: num(cacheRead),
		cacheWrite: num(cacheWrite),
		cost: num(total),
	};
}

/** Добавить usage записи в суммы; ходы и тренд не трогает. */
function addUsageTotals(target: SessionAggregate, usage: TurnUsage): void {
	target.input += usage.input;
	target.cached += usage.cacheRead;
	target.write += usage.cacheWrite;
	target.cost += usage.cost;
}

/**
 * Стоимость usage-объекта по фактическому `cost.total`. `null` — usage нет
 * вовсе; нечисловой total даёт `missing`, а деньги не выдумываются.
 */
function costBucket(source: unknown): CostBucket | null {
	if (source === null || typeof source !== "object") return null;
	const total = field(field(source, "cost"), "total");
	if (typeof total === "number" && Number.isFinite(total)) {
		return { cost: total, missing: false };
	}
	return { cost: 0, missing: true };
}

/** Прибавить стоимость к бакету типа записи; флаг `missing` накопительный. */
function addCost(
	target: Map<string, CostBucket>,
	key: string,
	bucket: CostBucket,
): void {
	const existing = target.get(key);
	if (existing) {
		existing.cost += bucket.cost;
		existing.missing = existing.missing || bucket.missing;
		return;
	}
	target.set(key, { ...bucket });
}

/** Ключ бакета фоновой записи: `usage:<kind>` / `model_usage:<purpose>`. */
function prefixedKey(prefix: string, value: unknown): string {
	return `${prefix}${typeof value === "string" ? value : "?"}`;
}

/**
 * Ключ `model_usage`. В OMP 19.1 компакция и branch-summary пишутся не
 * отдельными записями с usage, а `model_usage` с purpose `compaction:<method>`
 * или `branch-summary`; сводим их к тем же бакетам, что и журнальные типы.
 */
function modelUsageCostKey(purpose: unknown): string {
	if (typeof purpose === "string") {
		if (purpose === "branch-summary" || purpose.startsWith("branch-summary:")) {
			return "branch_summary";
		}
		if (purpose === "compaction" || purpose.startsWith("compaction:")) {
			return "compaction";
		}
	}
	return prefixedKey("model_usage:", purpose);
}

/** Подпись бакета для отчёта: русские имена и срезанные префиксы. */
function costLabel(key: string): string {
	if (key === "dialog") return "диалог";
	if (key === "compaction") return "компакция";
	if (key === "branch_summary") return "ветка";
	const trimmed = key.startsWith("usage:")
		? key.slice("usage:".length)
		: key.startsWith("model_usage:")
			? key.slice("model_usage:".length)
			: key;
	return trimmed === "?" || trimmed === "" ? "прочее" : trimmed;
}

/** `диалог` всегда первым; дальше по убыванию известной стоимости и подписи. */
function compareCostBuckets(a: [string, CostBucket], b: [string, CostBucket]): number {
	if (a[0] === "dialog") return -1;
	if (b[0] === "dialog") return 1;
	if (b[1].cost !== a[1].cost) return b[1].cost - a[1].cost;
	const left = costLabel(a[0]);
	const right = costLabel(b[0]);
	if (left !== right) return left < right ? -1 : 1;
	return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** Одна строка бакета: известная цена `$X`, иначе `?` или нижняя граница `≥$X`. */
function costLine(key: string, bucket: CostBucket): string {
	const label = costLabel(key);
	if (!bucket.missing) return `${label}: $${bucket.cost.toFixed(4)}`;
	if (bucket.cost > 0) return `${label}: ≥$${bucket.cost.toFixed(4)}`;
	return `${label}: ?`;
}

/**
 * Отчёт `/cache-monitor costs`: заголовок и строки бакетов. Сумма — только
 * известные `cost.total`; если хоть один бакет неполон, заголовок `≥$X`.
 */
function costReport(costs: Map<string, CostBucket>): string {
	if (costs.size === 0) return "стоимость: нет данных";
	let total = 0;
	let missing = false;
	for (const bucket of costs.values()) {
		total += bucket.cost;
		if (bucket.missing) missing = true;
	}
	const lines = [`стоимость сессии: ${missing ? "≥" : ""}$${total.toFixed(4)}`];
	const sorted = [...costs].sort(compareCostBuckets);
	for (const [key, bucket] of sorted) lines.push(costLine(key, bucket));
	return lines.join("\n");
}

/** Канонический промах: префикс переписан целиком, кэш не прочитан. */
function isCanonicalMiss(
	prevPrompt: number | null,
	usage: TurnUsage,
	prompt: number,
	minPromptTokens: number,
): boolean {
	return (
		prevPrompt !== null &&
		prevPrompt >= MIN_PREV_PROMPT &&
		usage.cacheRead === 0 &&
		usage.cacheWrite > 0 &&
		prompt >= minPromptTokens
	);
}

/** Причина канонического промаха: простой или перезапись префикса. */
function missCause(idleMs: number | null, idleMinutes: number): string {
	return idleMs !== null && idleMs >= idleMinutes * 60_000
		? `простой ${Math.round(idleMs / 60000)} мин`
		: "перезапись префикса";
}

/** Одна строка `/cache-monitor history`: деньги только по известным ценам. */
function historyLine(record: TurnRecord, index: number, showMoney: boolean): string {
	const parts = [
		`${index + 1}. ↺ ${hitPercentText(record.hit)} · prompt ${record.prompt}`,
	];
	if (record.cacheRead > 0 && showMoney) {
		parts.push(
			record.savedCost === null ? "saved ?" : `saved $${record.savedCost.toFixed(4)}`,
		);
	}
	if (record.reBilled !== null && record.reBilled > 0) {
		if (!showMoney) {
			parts.push(`miss premium ${record.reBilled} tok`);
		} else {
			const tokens = `(${record.reBilled} tok)`;
			parts.push(
				record.reBillCost === null
					? `miss premium ? ${tokens}`
					: `miss premium $${record.reBillCost.toFixed(4)} ${tokens}`,
			);
		}
	}
	if (record.cause !== null) parts.push(record.cause);
	return parts.join(" · ");
}

/** Запись журнала, меняющая префикс: сравнение с прошлым ходом начинается заново. */
function isEpochBoundary(type: unknown): boolean {
	return (
		type === "model_change" ||
		type === "thinking_level_change" ||
		type === "reset_boundary"
	);
}

/**
 * Свести журнал сессии к тем же метрикам, что копятся live-событиями.
 *
 * Assistant-сообщения дают токены, ходы, тренд, последний ход и историю. Записи
 * usage (cache warming, title/composer), compaction и branch_summary добавляют
 * только стоимость: их токены не должны разбавлять hit диалога. Границы эпохи
 * сбрасывают сравнение пере-оплаты. Цены прошлых моделей в журнале не
 * хранятся, поэтому `reBillCost` и `savedCost` восстановленных ходов — `null`.
 */
function aggregateEntries(entries: readonly unknown[]): SessionAggregate {
	const result: SessionAggregate = {
		last: null,
		turns: 0,
		input: 0,
		cached: 0,
		write: 0,
		cost: 0,
		costs: new Map(),
		reBilled: 0,
		reBillCostMissing: false,
		trend: [],
		history: [],
	};
	/** Prompt предыдущего assistant-сообщения внутри текущей эпохи. */
	let prevPrompt: number | null = null;
	/** Первый assistant-ход эпохи: причина промаха ему не приписывается. */
	let firstOfEpoch = true;
	/** Время предыдущего assistant-сообщения внутри эпохи; `null` — цепочки нет. */
	let lastTimestamp: number | null = null;
	/**
	 * Пере-оплата последнего assistant-сообщения. Добавляется, только когда
	 * появляется следующее сообщение или граница эпохи: самый последний ход
	 * перед resume мог быть первым ходом прошлой эпохи, а эта граница в журнал
	 * не пишется.
	 */
	let pendingReBilled: number | null = null;
	const flushPending = (): void => {
		if (pendingReBilled !== null && pendingReBilled > 0) {
			result.reBilled += pendingReBilled;
			// Историческая цена модели неизвестна: деньги не придумываем.
			result.reBillCostMissing = true;
		}
		pendingReBilled = null;
	};

	for (const entry of entries) {
		const type = field(entry, "type");

		if (type === "message") {
			const message = field(entry, "message");
			if (field(message, "role") !== "assistant") continue;
			const usageSource = field(message, "usage");
			const bucket = costBucket(usageSource);
			if (bucket) addCost(result.costs, "dialog", bucket);
			const usage = entryUsage(usageSource);
			if (!usage) continue;

			const hit = hitPercent(usage.input, usage.cacheRead, usage.cacheWrite);
			const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
			const reBilled =
				prevPrompt !== null && prevPrompt > 0
					? Math.max(0, Math.min(prevPrompt, prompt) - usage.cacheRead)
					: null;
			const rawTimestamp = field(message, "timestamp");
			const timestamp =
				typeof rawTimestamp === "number" &&
				Number.isFinite(rawTimestamp) &&
				rawTimestamp > 0
					? rawTimestamp
					: 0;
			const idleMs =
				lastTimestamp !== null && timestamp > 0
					? Math.max(0, timestamp - lastTimestamp)
					: null;
			const cause =
				!firstOfEpoch && isCanonicalMiss(prevPrompt, usage, prompt)
					? missCause(idleMs)
					: null;

			result.turns += 1;
			addUsageTotals(result, usage);
			// У последнего хода пере-оплату не показываем: граница resume не
			// журналируется, поэтому его сравнение с прошлым префиксом не
			// доказано. Сумма по сессии учитывает только ходы с продолжением.
			result.last = { ...usage, hit, reBilled: null, reBillCost: null, savedCost: null };
			result.trend.push(hit);
			if (result.trend.length > TREND_POINTS) result.trend.shift();
			// Цены прошлых моделей неизвестны: в истории они `null`, а не выдуманы.
			result.history.push({
				hit,
				prompt,
				cacheRead: usage.cacheRead,
				savedCost: null,
				reBilled,
				reBillCost: null,
				cause,
			});
			if (result.history.length > HISTORY_POINTS) result.history.shift();

			flushPending();
			pendingReBilled = reBilled;
			prevPrompt = prompt;
			firstOfEpoch = false;
			lastTimestamp = timestamp > 0 ? timestamp : null;
			continue;
		}

		if (type === "usage") {
			// `kind` произвольный: в стоимость входят все виды, но не в hit/ходы.
			const source = field(entry, "usage");
			const bucket = costBucket(source);
			if (bucket) addCost(result.costs, prefixedKey("usage:", field(entry, "kind")), bucket);
			const usage = entryUsage(source);
			if (usage) result.cost += usage.cost;
			continue;
		}

		// В OMP 19.1 cache warming, title/composer и другие off-transcript
		// вызовы пишутся как `model_usage`: стоимость входит, токены — нет.
		if (type === "model_usage") {
			const source = field(entry, "usage");
			const bucket = costBucket(source);
			if (bucket) {
				addCost(result.costs, modelUsageCostKey(field(entry, "purpose")), bucket);
			}
			const usage = entryUsage(source);
			if (usage) result.cost += usage.cost;
			continue;
		}

		if (type === "compaction" || type === "branch_summary") {
			const source = field(entry, "usage");
			const bucket = costBucket(source);
			if (bucket) addCost(result.costs, type, bucket);
			const usage = entryUsage(source);
			if (usage) result.cost += usage.cost;
			flushPending();
			prevPrompt = null;
			firstOfEpoch = true;
			lastTimestamp = null;
			continue;
		}

		if (isEpochBoundary(type)) {
			flushPending();
			prevPrompt = null;
			firstOfEpoch = true;
			lastTimestamp = null;
		}
	}

	// pendingReBilled последнего хода намеренно отбрасывается: см. выше.
	// В истории у последней записи окна `reBilled` тоже `null`: граница resume
	// не журналируется, поэтому сравнение с прошлым префиксом не доказано.
	const lastRecord = result.history[result.history.length - 1];
	if (lastRecord) lastRecord.reBilled = null;
	return result;
}

/** Записи журнала; пустой массив, если менеджер сессии недоступен. */
function sessionEntries(ctx: ExtensionContext): unknown[] {
	try {
		const entries: unknown = ctx.sessionManager.getEntries();
		return Array.isArray(entries) ? entries : [];
	} catch {
		// Контекст без sessionManager (старый OMP, нестандартный runner)
		return [];
	}
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

/**
 * Настройки плагина: `source.settings` в тестах, иначе loader OMP (global +
 * project). Внутренний subpath может переехать, поэтому любая ошибка — `{}`,
 * то есть поведение по умолчанию.
 */
async function readSettings(
	source: PluginSource,
	cwd: string,
): Promise<Readonly<Record<string, unknown>>> {
	if (source.settings !== undefined) return source.settings;
	try {
		// Динамический импорт намеренно: недоступный subpath не должен мешать
		// расширению загрузиться, а настройки нужны лишь при старте/команде.
		const mod: unknown = await import(
			"@oh-my-pi/pi-coding-agent/extensibility/plugins/loader"
		);
		const getPluginSettings = field(mod, "getPluginSettings");
		if (typeof getPluginSettings !== "function") return {};
		const raw: unknown = await Reflect.apply(getPluginSettings, undefined, [PLUGIN_NAME, cwd]);
		if (raw === null || typeof raw !== "object") return {};
		return raw as Record<string, unknown>;
	} catch {
		// loader переехал или конфиг недоступен — defaults
		return {};
	}
}

export default function cacheMonitor(pi: ExtensionAPI, source: PluginSource = {}): void {
	const mode = process.env.OMP_MODE?.trim() || "";

	let last: LastTurn | null = null;
	let prevPrompt: number | null = null;
	let turns = 0;
	let sessionInput = 0;
	let sessionCached = 0;
	let sessionWrite = 0;
	let sessionCost = 0;
	let sessionReBilled = 0;
	let sessionReBillCost = 0;
	/** Хотя бы у одного пере-оплаченного хода не было цен модели. */
	let sessionReBillCostMissing = false;
	/** Накопленная экономия на чтении кэша; растёт только по известным ценам. */
	let sessionSaved = 0;
	/** Хотя бы у одного хода с cacheRead не было цен модели (в т.ч. после resume). */
	let sessionSavedMissing = false;
	const trendHits: (number | null)[] = [];
	/** Последние завершённые ходы для `history`; окно — `config.historySize`. */
	const history: TurnRecord[] = [];
	/** Live-разбивка стоимости: диалог из `turn_end`, фон — только из журнала. */
	let costs = new Map<string, CostBucket>();

	// Состояние «эпохи» префикса: сравнение с prev действительно только внутри неё.
	let epochReady = false;
	let epochModel = "";
	let epochThinking = "?";
	let epochTools = "";
	let epochWarned = new Set<string>();
	/** Время последнего завершённого хода; `null` — timestamp не приходил. */
	let lastTurnAt: number | null = null;

	/** Ленивый (и кэшированный) резолв реестра; значение читается на каждом ходе. */
	let registryPromise: Promise<RegistryHandle | null> | null = null;
	/** Эпоха сменилась, и её первый ход ещё не завершился: не предупреждать. */
	let epochResetPending = false;

	let config: Config = DEFAULT_CONFIG;
	/** Ключи, реально пришедшие из OMP: для пометки `(changed)` в `settings`. */
	let configuredKeys = new Set<string>();

	/** Перечитать настройки; недоступный loader даёт defaults. */
	const refreshConfig = async (ctx: ExtensionContext): Promise<void> => {
		const raw = await readSettings(source, ctx.cwd);
		config = normalizeConfig(raw);
		configuredKeys = new Set(Object.keys(raw));
		// Команда видит свежее окно: старые записи сверх него не показываем.
		while (history.length > config.historySize) history.shift();
	};

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
	const resetEpoch = async (ctx: ExtensionContext): Promise<void> => {
		epochModel = String(field(ctx.model, "id") ?? "");
		epochThinking = await thinkingLevel();
		epochTools = activeToolsSignature();
		epochWarned = new Set<string>();
		prevPrompt = null;
		// Простой через границу эпохи не приписываем новому префиксу.
		lastTurnAt = null;
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
		sessionReBilled = 0;
		sessionReBillCost = 0;
		sessionReBillCostMissing = false;
		sessionSaved = 0;
		sessionSavedMissing = false;
		trendHits.length = 0;
		history.length = 0;
		costs = new Map();
	};

	/** Заменить всё восстановленное состояние снимком журнала. */
	const applyAggregate = (aggregate: SessionAggregate): void => {
		last = aggregate.last;
		turns = aggregate.turns;
		sessionInput = aggregate.input;
		sessionCached = aggregate.cached;
		sessionWrite = aggregate.write;
		sessionCost = aggregate.cost;
		sessionReBilled = aggregate.reBilled;
		// Цен прошлых моделей в журнале нет: сумма известных денег остаётся 0,
		// а флаг заставляет `/cache-monitor` показать `≥`, когда деньги появятся.
		sessionReBillCost = 0;
		sessionReBillCostMissing = aggregate.reBillCostMissing;
		// Цены прошлых моделей неизвестны: восстановленный cacheRead не оценён,
		// `saved` покажет только live-ходы и маркер `≥`.
		sessionSaved = 0;
		sessionSavedMissing = aggregate.cached > 0;
		trendHits.length = 0;
		trendHits.push(...aggregate.trend);
		history.length = 0;
		history.push(...aggregate.history);
		costs = new Map(aggregate.costs);
	};

	/**
	 * Пересчитать только суммы по журналу: cache warming и компакция не
	 * приходят событиями хода. Ходы, тренд и live-учёт пере-оплаты уже полны,
	 * поэтому их не трогаем — иначе повторный вызов команды потерял бы
	 * известные цены ходов и не добавил бы ничего нового. Возвращает снимок
	 * журнала (`null` — журнал пуст), чтобы `costs` не агрегировал дважды.
	 */
	const recomputeTotals = (ctx: ExtensionContext): SessionAggregate | null => {
		const entries = sessionEntries(ctx);
		if (entries.length === 0) return null;
		const aggregate = aggregateEntries(entries, config);
		sessionInput = aggregate.input;
		sessionCached = aggregate.cached;
		sessionWrite = aggregate.write;
		sessionCost = aggregate.cost;
		return aggregate;
	};

	/** Восстановить суммы/тренд/последний ход из непустого журнала. */
	const restoreFromEntries = (ctx: ExtensionContext): void => {
		const entries = sessionEntries(ctx);
		if (entries.length === 0) return;
		applyAggregate(aggregateEntries(entries, config));
	};

	/**
	 * Определить, сменилась ли эпоха с прошлого хода, и обновить базовую линию.
	 * `true` — эпоха сменилась: первый ход новой эпохи не сравнивается.
	 */
	const syncEpoch = async (ctx: ExtensionContext): Promise<boolean> => {
		const model = String(field(ctx.model, "id") ?? "");
		const thinking = await thinkingLevel();
		const tools = activeToolsSignature();
		if (!epochReady) {
			epochModel = model;
			epochThinking = thinking;
			epochTools = tools;
			epochReady = true;
			return false;
		}
		const changed =
			model !== epochModel || thinking !== epochThinking || tools !== epochTools;
		if (!changed) return false;
		epochModel = model;
		epochThinking = thinking;
		epochTools = tools;
		epochWarned = new Set<string>();
		prevPrompt = null;
		// Граница эпохи: простой до неё новому префиксу не принадлежит.
		lastTurnAt = null;
		return true;
	};

	pi.on("session_start", async (_event, ctx) => {
		await refreshConfig(ctx);
		if (config.statusEnabled && ctx.mode === "tui" && ctx.agent.kind === "main") {
			setStatus(ctx, config.statusShowMode && mode ? `${mode} ↺ …` : "↺ …");
		}
		resetTranscriptTotals();
		await resetEpoch(ctx);
		// Все причины старта: у новой сессии журнал пуст, у resume/reload/fork —
		// содержит восстановимые суммы и тренд.
		restoreFromEntries(ctx);
	});

	pi.on("session_compact", async (_event, ctx) => {
		await resetEpoch(ctx);
	});

	// Смена транскрипта в том же runner: `/new`, `/fork`, `/switch`/resume.
	pi.on("session_switch", async (event, ctx) => {
		await refreshConfig(ctx);
		resetTranscriptTotals();
		if (config.statusEnabled && ctx.mode === "tui" && ctx.agent.kind === "main") {
			setStatus(ctx, config.statusShowMode && mode ? `${mode} ↺ …` : "↺ …");
		}
		const reason = field(event, "reason");
		if (reason === "resume" || reason === "fork") restoreFromEntries(ctx);
		await resetEpoch(ctx);
	});

	// `/clear` и переходы по дереву: суммы сессии остаются, префикс — новый.
	pi.on("session_clear", async (_event, ctx) => {
		await resetEpoch(ctx);
	});

	pi.on("session_branch", async (_event, ctx) => {
		await resetEpoch(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await resetEpoch(ctx);
	});

	pi.on("turn_end", async (event, ctx) => {
		const message = field(event, "message");
		const raw = field(message, "usage");
		if (raw === null || typeof raw !== "object") return;
		const rawTimestamp = field(message, "timestamp");
		const timestamp =
			typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp) && rawTimestamp > 0
				? rawTimestamp
				: 0;
		const idleMs =
			lastTurnAt !== null && timestamp > 0
				? Math.max(0, timestamp - lastTurnAt)
				: null;
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
		// Live-разбивка знает только диалог: фон приходит из журнала.
		const dialogCost = costBucket(raw);
		if (dialogCost) addCost(costs, "dialog", dialogCost);

		const mainTui = ctx.mode === "tui" && ctx.agent.kind === "main";
		if (config.statusEnabled && mainTui) {
			const prefix = config.statusShowMode && mode ? `${mode} ` : "";
			setStatus(ctx, `${prefix}↺ ${hitPercentText(hit)}`);
		}

		// Предыдущий ход той же эпохи (syncEpoch может его сбросить).
		const prev = prevPrompt;
		const changed = await syncEpoch(ctx);
		// Первый ход новой эпохи не сравнивается и не предупреждает.
		const freshEpoch = changed || epochResetPending;
		epochResetPending = false;
		const comparePrompt = freshEpoch ? null : prev;
		const reBilled =
			comparePrompt !== null && comparePrompt > 0
				? Math.max(0, Math.min(comparePrompt, prompt) - usage.cacheRead)
				: null;
		const reBillCost =
			reBilled !== null && reBilled > 0 ? cacheDeltaCost(ctx.model, reBilled) : null;
		const savedCost =
			usage.cacheRead > 0 ? cacheDeltaCost(ctx.model, usage.cacheRead) : null;
		const cause =
			!freshEpoch &&
			isCanonicalMiss(comparePrompt, usage, prompt, config.minPromptTokens)
				? missCause(idleMs, config.idleMinutes)
				: null;
		history.push({
			hit,
			prompt,
			cacheRead: usage.cacheRead,
			savedCost,
			reBilled,
			reBillCost,
			cause,
		});
		if (history.length > config.historySize) history.shift();
		last = { ...usage, hit, reBilled, reBillCost, savedCost };
		prevPrompt = prompt;
		// База для простоя следующего хода. Ход без timestamp разрывает цепочку:
		// иначе следующий gap приписал бы этому ходу чужой простой.
		lastTurnAt = timestamp > 0 ? timestamp : null;

		if (reBilled !== null && reBilled > 0) {
			sessionReBilled += reBilled;
			if (reBillCost === null) sessionReBillCostMissing = true;
			else sessionReBillCost += reBillCost;
		}
		if (usage.cacheRead > 0) {
			if (savedCost === null) sessionSavedMissing = true;
			else sessionSaved += savedCost;
		}
		trendHits.push(hit);
		if (trendHits.length > TREND_POINTS) trendHits.shift();

		const turnIndex = num(field(event, "turnIndex"));
		const canWarn =
			config.warningsEnabled &&
			mainTui &&
			!freshEpoch &&
			turnIndex >= 1 &&
			prompt >= config.minPromptTokens;
		if (!canWarn) return;

		// Канонический промах: префикс переписан целиком, кэш не прочитан.
		if (
			isCanonicalMiss(comparePrompt, usage, prompt, config.minPromptTokens) &&
			!epochWarned.has("canonical-miss")
		) {
			epochWarned.add("canonical-miss");
			const reason = missCause(idleMs, config.idleMinutes);
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
		if (hit !== null && hit < config.lowHitPercent && !epochWarned.has("low-hit")) {
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

	/** Строка `/cache-monitor settings`: значения, источник и наличие цен модели. */
	const settingsReport = (ctx: ExtensionContext): string => {
		const rows: [string, string][] = [
			["statusEnabled", String(config.statusEnabled)],
			["statusShowMode", String(config.statusShowMode)],
			["warningsEnabled", String(config.warningsEnabled)],
			["lowHitPercent", String(config.lowHitPercent)],
			["idleMinutes", String(config.idleMinutes)],
			["minPromptTokens", String(config.minPromptTokens)],
			["historySize", String(config.historySize)],
			["showMoney", String(config.showMoney)],
		];
		const prices = cacheDeltaCost(ctx.model, 0) !== null ? "да" : "нет";
		return [
			"настройки cache-monitor:",
			...rows.map(
				([key, value]) => `${key}: ${value} (${configuredKeys.has(key) ? "changed" : "default"})`,
			),
			`цены модели: ${prices}`,
			"изменить: omp plugin config set omp-cache-monitor <key> <value>",
		].join("\n");
	};

	pi.registerCommand("cache-monitor", {
		description:
			"Показать режим, модель, hit rate и тренд кэша; history — история, costs — стоимость, settings — настройки, help — справка",
		handler: async (args, ctx) => {
			const subcommand = args.trim().toLowerCase();
			// Команда видит свежие настройки; новый сеанс читает их сам.
			await refreshConfig(ctx);
			if (subcommand === "settings" || subcommand === "setting") {
				notify(ctx, settingsReport(ctx), "info");
				return;
			}
			if (subcommand === "help" || subcommand === "?") {
				notify(ctx, HELP_TEXT, "info");
				return;
			}
			if (subcommand === "costs" || subcommand === "cost") {
				// Cache warming и компакция могли не прийти событиями хода.
				const aggregate = recomputeTotals(ctx);
				// Журнал пуст (тесты/первый ход) — остаётся live-карта; иначе
				// карта заменяется снимком журнала, так что повтор идемпотентен.
				if (aggregate) costs = new Map(aggregate.costs);
				notify(ctx, costReport(costs), "info");
				return;
			}
			// Cache warming и компакция могли не прийти событиями хода.
			recomputeTotals(ctx);
			if (subcommand === "history" || subcommand === "hist") {
				const text =
					history.length === 0
						? "история: нет данных"
						: `история (${history.length}/${config.historySize}):\n${history
								.map((record, index) => historyLine(record, index, config.showMoney))
								.join("\n")}`;
				notify(ctx, text, "info");
				return;
			}
			const modelLabel = ctx.model
				? `${String(field(ctx.model, "provider") ?? "?")}/${String(field(ctx.model, "id") ?? "?")}`
				: "?";
			const thinking = await thinkingLevel();

			const parts = [`режим: ${mode || "без пресета"}`, modelLabel, `thinking ${thinking}`];
			if (last) {
				const savedTurn =
					config.showMoney && last.savedCost !== null && last.savedCost > 0
						? ` · saved $${last.savedCost.toFixed(4)}`
						: "";
				parts.push(
					`ход: ↺ ${hitPercentText(last.hit)} · in ${last.input} · cacheRead ${last.cacheRead} · ` +
						`cacheWrite ${last.cacheWrite} · $${last.cost.toFixed(4)}${savedTurn}`,
				);
				if (last.reBilled !== null && last.reBilled > 0) {
					if (!config.showMoney) {
						parts.push(`miss premium: ${last.reBilled} tok`);
					} else {
						const money = last.reBillCost;
						parts.push(
							money === null
								? `miss premium: ${last.reBilled} tok`
								: `miss premium: $${money.toFixed(4)} (${last.reBilled} tok)`,
						);
					}
				}
			} else {
				parts.push("ход: нет данных");
			}
			if (trendHits.length > 0) {
				parts.push(`тренд: ${trendHits.map(sparkLevel).join("")}`);
			}
			const sessionHit = hitPercent(sessionInput, sessionCached, sessionWrite);
			const sessionSavedPart =
				config.showMoney && sessionSaved > 0
					? `, saved ${sessionSavedMissing ? "≥" : ""}$${sessionSaved.toFixed(4)}`
					: "";
			const sessionMissPart =
				sessionReBilled > 0
					? !config.showMoney
						? `, miss premium ${sessionReBilled} tok`
						: sessionReBillCostMissing
							? sessionReBillCost > 0
								? `, miss premium ≥$${sessionReBillCost.toFixed(4)} (${sessionReBilled} tok)`
								: `, miss premium ${sessionReBilled} tok`
							: `, miss premium $${sessionReBillCost.toFixed(4)} (${sessionReBilled} tok)`
					: "";
			parts.push(
				`сессия: $${sessionCost.toFixed(4)}, ходов ${turns}, ↺ ${hitPercentText(sessionHit)}` +
					`${sessionSavedPart}${sessionMissPart}`,
			);

			notify(ctx, parts.join(" · "), "info");
		},
	});
}
