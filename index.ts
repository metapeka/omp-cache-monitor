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

/** Язык пользовательских строк; метрики и формат чисел от него не зависят. */
type Language = "ru" | "en";

/**
 * Причина канонического промаха в структурном виде: хранится в записи, поэтому
 * смена `language` перерисовывает и старые ходы.
 */
type Cause = { kind: "idle"; minutes: number } | { kind: "rewrite" };

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
	cause: Cause | null;
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
/** Стоимость последнего хода — отдельный ключ; hit-строка не меняется. */
const COST_STATUS_KEY = "cache-monitor-cost";
const PLUGIN_NAME = "omp-cache-monitor";

/** Пресет — набор значений остальных ключей; `custom` — defaults + explicit. */
type Preset = "balanced" | "quiet" | "verbose" | "custom";

/** Настройки плагина; значения и границы объявлены в `package.json#omp.settings`. */
type Config = {
	preset: Preset;
	statusEnabled: boolean;
	statusShowMode: boolean;
	statusShowCost: boolean;
	warningsEnabled: boolean;
	lowHitPercent: number;
	idleMinutes: number;
	minPromptTokens: number;
	warnCanonicalMiss: boolean;
	minPrevPromptTokens: number;
	oncePerEpoch: boolean;
	historySize: number;
	trendSize: number;
	showMoney: boolean;
	language: Language;
};

/** Параметры восстановления из журнала; подмножество настроек. */
type AggregateOptions = Pick<
	Config,
	| "historySize"
	| "trendSize"
	| "minPromptTokens"
	| "minPrevPromptTokens"
	| "idleMinutes"
>;

/** Значения по умолчанию; они же — контракт прежнего вывода без настроек. */
const DEFAULT_CONFIG: Config = {
	preset: "balanced",
	statusEnabled: true,
	statusShowMode: true,
	statusShowCost: false,
	warningsEnabled: true,
	lowHitPercent: 50,
	idleMinutes: 5,
	minPromptTokens: 4000,
	warnCanonicalMiss: true,
	minPrevPromptTokens: 2048,
	oncePerEpoch: true,
	historySize: 8,
	trendSize: 12,
	showMoney: true,
	language: "ru",
};

/** Значения пресетов поверх defaults; `balanced`/`custom` ничего не меняют. */
const PRESET_VALUES: Record<Exclude<Preset, "custom" | "balanced">, Partial<Config>> = {
	quiet: { statusShowMode: false, warningsEnabled: false, statusShowCost: false },
	verbose: {
		lowHitPercent: 60,
		idleMinutes: 3,
		minPromptTokens: 2000,
		historySize: 12,
		trendSize: 20,
		statusShowCost: true,
		minPrevPromptTokens: 1024,
		oncePerEpoch: false,
	},
};

/** Настройки из OMP; `settings` задают тесты вместо чтения loader'а. */
type PluginSource = { settings?: Readonly<Record<string, unknown>> };

/**
 * Bool: boolean, а также строки `"true"`/`"false"` (так их хранит
 * `omp plugin config set`); остальное — fallback (значение пресета).
 */
function configBool(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const text = value.trim().toLowerCase();
		if (text === "true") return true;
		if (text === "false") return false;
	}
	return fallback;
}

/**
 * Число: конечное число или числовая строка (CLI пишет строки) →
 * round → clamp в [min, max]; всё остальное — fallback.
 */
function configNumber(value: unknown, fallback: number, min: number, max: number): number {
	const numeric =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: Number.NaN;
	if (!Number.isFinite(numeric)) return fallback;
	return Math.min(max, Math.max(min, Math.round(numeric)));
}

/** База: defaults + значения пресета; `language` пресет не меняет. */
function presetBase(preset: Preset): Config {
	if (preset === "quiet" || preset === "verbose") {
		return { ...DEFAULT_CONFIG, ...PRESET_VALUES[preset], preset };
	}
	return { ...DEFAULT_CONFIG, preset };
}

/**
 * Привести сырые настройки OMP к валидному `Config`, не доверяя их форме.
 * Сначала выбирается пресет, затем валидный explicit-ключ перекрывает его;
 * невалидный explicit-ключ откатывается к значению пресета, а не к default.
 */
export function normalizeConfig(raw: unknown): Config {
	const settings: Record<string, unknown> =
		raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	// Известные пресеты — как есть; отсутствующий/невалидный — `balanced`.
	const rawPreset = settings.preset;
	const preset: Preset =
		rawPreset === "quiet" || rawPreset === "verbose" || rawPreset === "custom"
			? rawPreset
			: "balanced";
	const base = presetBase(preset);
	return {
		preset,
		statusEnabled: configBool(settings.statusEnabled, base.statusEnabled),
		statusShowMode: configBool(settings.statusShowMode, base.statusShowMode),
		statusShowCost: configBool(settings.statusShowCost, base.statusShowCost),
		warningsEnabled: configBool(settings.warningsEnabled, base.warningsEnabled),
		lowHitPercent: configNumber(settings.lowHitPercent, base.lowHitPercent, 1, 100),
		idleMinutes: configNumber(settings.idleMinutes, base.idleMinutes, 1, 240),
		minPromptTokens: configNumber(
			settings.minPromptTokens,
			base.minPromptTokens,
			0,
			1_000_000,
		),
		warnCanonicalMiss: configBool(settings.warnCanonicalMiss, base.warnCanonicalMiss),
		minPrevPromptTokens: configNumber(
			settings.minPrevPromptTokens,
			base.minPrevPromptTokens,
			0,
			1_000_000,
		),
		oncePerEpoch: configBool(settings.oncePerEpoch, base.oncePerEpoch),
		historySize: configNumber(settings.historySize, base.historySize, 1, 50),
		trendSize: configNumber(settings.trendSize, base.trendSize, 1, 50),
		showMoney: configBool(settings.showMoney, base.showMoney),
		language: settings.language === "en" ? "en" : "ru",
	};
}

/** Подпись, формат и справка одного языка: единственное место пользовательских строк. */
type Texts = {
	report: {
		mode: string;
		noPreset: string;
		turn: string;
		noData: string;
		trend: string;
		session: string;
		/** Слово перед числом ходов: `ходов 3` / `turns 3`. */
		turns: string;
	};
	history: { title: string; empty: string };
	cost: {
		title: string;
		empty: string;
		dialog: string;
		compaction: string;
		branch: string;
		other: string;
	};
	settings: {
		title: string;
		preset: string;
		status: string;
		warnings: string;
		reports: string;
		/** Статичная подпись строки `settings` по ключу настройки. */
		labels: Record<string, string>;
		prices: string;
		yes: string;
		no: string;
		change: string;
	};
	help: string;
	cause: { idle: (minutes: number) => string; rewrite: string };
	warning: {
		miss: (cacheWrite: number, prompt: number, cause: string) => string;
		reBilled: (tokens: number, cost: number | null) => string;
		lowHit: (
			hit: string,
			input: number,
			cacheRead: number,
			cacheWrite: number,
			prompt: number,
		) => string;
		/** Один раз за процесс: где найти настройки и что значит preset. */
		onboarding: string;
	};
};

/** Тексты обоих языков; `ru` — прежний вывод байт-в-байт. */
const TEXTS: Record<Language, Texts> = {
	ru: {
		report: {
			mode: "режим:",
			noPreset: "без пресета",
			turn: "ход:",
			noData: "ход: нет данных",
			trend: "тренд:",
			session: "сессия:",
			turns: "ходов",
		},
		history: { title: "история", empty: "история: нет данных" },
		cost: {
			title: "стоимость сессии:",
			empty: "стоимость: нет данных",
			dialog: "диалог",
			compaction: "компакция",
			branch: "ветка",
			other: "прочее",
		},
		settings: {
			title: "⚙ настройки cache-monitor",
			preset: "🎛 Пресет",
			status: "⚙ Статус",
			warnings: "⚠️ Предупреждения",
			reports: "📊 Отчёты",
			labels: {
				preset: "набор значений",
				statusEnabled: "↺ N% в статус-строке",
				statusShowMode: "префикс OMP_MODE",
				statusShowCost: "стоимость хода отдельным сегментом",
				warningsEnabled: "toast о промахах",
				lowHitPercent: "порог низкого hit",
				idleMinutes: "«простой N мин», не TTL",
				minPromptTokens: "не шуметь на мелких промптах",
				warnCanonicalMiss: "warning о каноническом промахе",
				minPrevPromptTokens: "порог предыдущего промпта",
				oncePerEpoch: "один warning за эпоху",
				historySize: "окно /cache-monitor history",
				trendSize: "точек в спарклайне",
				showMoney: "$ в saved/miss premium",
				language: "язык вывода",
			},
			prices: "💵 цены модели:",
			yes: "да",
			no: "нет",
			change: "Изменить:",
		},
		help: [
			"cache-monitor — hit rate кэша префикса.",
			"↺ N% — доля prompt, прочитанная из кэша; чем выше, тем дешевле ход. ↺ … до первого хода, n/a без знаменателя.",
			"Промах — cacheRead 0; причина — в warning и history, переплата — в отчёте и history.",
			"/cache-monitor — отчёт; history — последние ходы; costs — разбивка денег.",
			"settings — настройки; help — эта справка.",
			"Настройки: Settings → Plugins → omp-cache-monitor или omp plugin config set omp-cache-monitor <key> <value>.",
			"Применяются к новой сессии; settings перечитывает сразу.",
			"Документация: README.md, docs/ui-settings.md, docs/omp-docs-map.md.",
		].join("\n"),
		cause: {
			idle: (minutes) => `простой ${minutes} мин`,
			rewrite: "перезапись префикса",
		},
		warning: {
			miss: (cacheWrite, prompt, cause) =>
				`Кэш префикса: промах (cacheRead 0, cacheWrite ${cacheWrite}, prompt ${prompt}) — причина: ${cause}.`,
			reBilled: (tokens, cost) =>
				` Пере-оплачено ≈ ${tokens} tok${cost === null ? "" : ` ($${cost.toFixed(4)})`}.`,
			lowHit: (hit, input, cacheRead, cacheWrite, prompt) =>
				`Кэш префикса: hit ${hit} (input ${input}, cacheRead ${cacheRead}, cacheWrite ${cacheWrite}, prompt ${prompt}). ` +
				"Префикс изменился или кэш не читается — проверьте модель, thinking, режим и MCP.",
			onboarding:
				"Настройки: /cache-monitor settings (или Settings → Plugins → omp-cache-monitor). preset — набор значений: balanced, quiet, verbose, custom.",
		},
	},
	en: {
		report: {
			mode: "mode:",
			noPreset: "no preset",
			turn: "turn:",
			noData: "turn: no data",
			trend: "trend:",
			session: "session:",
			turns: "turns",
		},
		history: { title: "history", empty: "history: no data" },
		cost: {
			title: "session cost:",
			empty: "cost: no data",
			dialog: "dialog",
			compaction: "compaction",
			branch: "branch",
			other: "other",
		},
		settings: {
			title: "⚙ cache-monitor settings",
			preset: "🎛 Preset",
			status: "⚙ Status",
			warnings: "⚠️ Warnings",
			reports: "📊 Reports",
			labels: {
				preset: "value bundle",
				statusEnabled: "↺ N% in the status line",
				statusShowMode: "OMP_MODE prefix",
				statusShowCost: "turn cost as a separate segment",
				warningsEnabled: "miss warning toasts",
				lowHitPercent: "low-hit threshold",
				idleMinutes: '"idle N min", not TTL',
				minPromptTokens: "skip small prompts",
				warnCanonicalMiss: "canonical-miss warning",
				minPrevPromptTokens: "previous-prompt floor",
				oncePerEpoch: "one warning per epoch",
				historySize: "/cache-monitor history window",
				trendSize: "sparkline points",
				showMoney: "$ in saved/miss premium",
				language: "output language",
			},
			prices: "💵 model prices:",
			yes: "yes",
			no: "no",
			change: "Change:",
		},
		help: [
			"cache-monitor — prefix-cache hit rate.",
			"↺ N% — share of the prompt read from cache; higher is cheaper. ↺ … before the first turn, n/a with no denominator.",
			"Miss — cacheRead 0; cause is in warnings and history, re-billing in the report and history.",
			"/cache-monitor — report; history — recent turns; costs — cost breakdown.",
			"settings — current settings; help — this help.",
			"Settings: Settings → Plugins → omp-cache-monitor or omp plugin config set omp-cache-monitor <key> <value>.",
			"Applied to new sessions; settings re-reads immediately.",
			"Docs: README.md, docs/ui-settings.md, docs/omp-docs-map.md.",
		].join("\n"),
		cause: {
			idle: (minutes) => `idle ${minutes} min`,
			rewrite: "prefix rewrite",
		},
		warning: {
			miss: (cacheWrite, prompt, cause) =>
				`Prefix cache: miss (cacheRead 0, cacheWrite ${cacheWrite}, prompt ${prompt}) — cause: ${cause}.`,
			reBilled: (tokens, cost) =>
				` Re-billed ≈ ${tokens} tok${cost === null ? "" : ` ($${cost.toFixed(4)})`}.`,
			lowHit: (hit, input, cacheRead, cacheWrite, prompt) =>
				`Prefix cache: hit ${hit} (input ${input}, cacheRead ${cacheRead}, cacheWrite ${cacheWrite}, prompt ${prompt}). ` +
				"Prefix changed or cache is not being read — check model, thinking, mode and MCP.",
			onboarding:
				"Settings: /cache-monitor settings (or Settings → Plugins → omp-cache-monitor). preset is a value bundle: balanced, quiet, verbose, custom.",
		},
	},
};

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

/** Подпись бакета для отчёта: имена языка и срезанные префиксы. */
function costLabel(key: string, texts: Texts): string {
	if (key === "dialog") return texts.cost.dialog;
	if (key === "compaction") return texts.cost.compaction;
	if (key === "branch_summary") return texts.cost.branch;
	const trimmed = key.startsWith("usage:")
		? key.slice("usage:".length)
		: key.startsWith("model_usage:")
			? key.slice("model_usage:".length)
			: key;
	return trimmed === "?" || trimmed === "" ? texts.cost.other : trimmed;
}

/** `диалог` всегда первым; дальше по убыванию известной стоимости и подписи. */
function compareCostBuckets(
	a: [string, CostBucket],
	b: [string, CostBucket],
	texts: Texts,
): number {
	if (a[0] === "dialog") return -1;
	if (b[0] === "dialog") return 1;
	if (b[1].cost !== a[1].cost) return b[1].cost - a[1].cost;
	const left = costLabel(a[0], texts);
	const right = costLabel(b[0], texts);
	if (left !== right) return left < right ? -1 : 1;
	return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** Одна строка бакета: известная цена `$X`, иначе `?` или нижняя граница `≥$X`. */
function costLine(key: string, bucket: CostBucket, texts: Texts): string {
	const label = costLabel(key, texts);
	if (!bucket.missing) return `${label}: $${bucket.cost.toFixed(4)}`;
	if (bucket.cost > 0) return `${label}: ≥$${bucket.cost.toFixed(4)}`;
	return `${label}: ?`;
}

/**
 * Отчёт `/cache-monitor costs`: заголовок и строки бакетов. Сумма — только
 * известные `cost.total`; если хоть один бакет неполон, заголовок `≥$X`.
 */
function costReport(costs: Map<string, CostBucket>, language: Language): string {
	const texts = TEXTS[language];
	if (costs.size === 0) return texts.cost.empty;
	let total = 0;
	let missing = false;
	for (const bucket of costs.values()) {
		total += bucket.cost;
		if (bucket.missing) missing = true;
	}
	const lines = [`${texts.cost.title} ${missing ? "≥" : ""}$${total.toFixed(4)}`];
	const sorted = [...costs].sort((a, b) => compareCostBuckets(a, b, texts));
	for (const [key, bucket] of sorted) lines.push(costLine(key, bucket, texts));
	return lines.join("\n");
}

/** Канонический промах: префикс переписан целиком, кэш не прочитан. */
function isCanonicalMiss(
	prevPrompt: number | null,
	usage: TurnUsage,
	prompt: number,
	minPromptTokens: number,
	minPrevPromptTokens: number,
): boolean {
	return (
		prevPrompt !== null &&
		prevPrompt >= minPrevPromptTokens &&
		usage.cacheRead === 0 &&
		usage.cacheWrite > 0 &&
		prompt >= minPromptTokens
	);
}

/** Причина канонического промаха: простой или перезапись префикса. */
function missCause(idleMs: number | null, idleMinutes: number): Cause {
	return idleMs !== null && idleMs >= idleMinutes * 60_000
		? { kind: "idle", minutes: Math.round(idleMs / 60000) }
		: { kind: "rewrite" };
}

/** Текст причины на языке вывода; старые записи перерисовываются при смене. */
function causeText(cause: Cause, language: Language): string {
	const texts = TEXTS[language];
	return cause.kind === "idle" ? texts.cause.idle(cause.minutes) : texts.cause.rewrite;
}

/** Одна строка `/cache-monitor history`: деньги только по известным ценам. */
function historyLine(
	record: TurnRecord,
	index: number,
	showMoney: boolean,
	language: Language,
): string {
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
	if (record.cause !== null) parts.push(causeText(record.cause, language));
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
function aggregateEntries(
	entries: readonly unknown[],
	options: AggregateOptions = DEFAULT_CONFIG,
): SessionAggregate {
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
				!firstOfEpoch &&
				isCanonicalMiss(
					prevPrompt,
					usage,
					prompt,
					options.minPromptTokens,
					options.minPrevPromptTokens,
				)
					? missCause(idleMs, options.idleMinutes)
					: null;

			result.turns += 1;
			addUsageTotals(result, usage);
			// У последнего хода пере-оплату не показываем: граница resume не
			// журналируется, поэтому его сравнение с прошлым префиксом не
			// доказано. Сумма по сессии учитывает только ходы с продолжением.
			result.last = { ...usage, hit, reBilled: null, reBillCost: null, savedCost: null };
			result.trend.push(hit);
			if (result.trend.length > options.trendSize) result.trend.shift();
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
			if (result.history.length > options.historySize) result.history.shift();

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
function setStatus(ctx: ExtensionContext, text: string, key: string = STATUS_KEY): void {
	try {
		ctx.ui.setStatus(key, text);
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
	/** Онбординг показываем один раз за процесс, на первом каноническом промахе. */
	let onboardingHintShown = false;
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
		while (trendHits.length > config.trendSize) trendHits.shift();
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
			// Стоимость — отдельный сегмент: hit-строка остаётся прежней.
			if (config.statusShowCost) {
				setStatus(ctx, `$${usage.cost.toFixed(4)}`, COST_STATUS_KEY);
			}
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
			isCanonicalMiss(
				comparePrompt,
				usage,
				prompt,
				config.minPromptTokens,
				config.minPrevPromptTokens,
			)
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
		if (trendHits.length > config.trendSize) trendHits.shift();

		const turnIndex = num(field(event, "turnIndex"));
		const canWarn =
			config.warningsEnabled &&
			mainTui &&
			!freshEpoch &&
			turnIndex >= 1 &&
			prompt >= config.minPromptTokens;
		if (!canWarn) return;
		const texts = TEXTS[config.language];

		// Канонический промах: префикс переписан целиком, кэш не прочитан.
		if (
			config.warnCanonicalMiss &&
			(!config.oncePerEpoch || !epochWarned.has("canonical-miss")) &&
			isCanonicalMiss(
				comparePrompt,
				usage,
				prompt,
				config.minPromptTokens,
				config.minPrevPromptTokens,
			)
		) {
			epochWarned.add("canonical-miss");
			const reason = causeText(missCause(idleMs, config.idleMinutes), config.language);
			const costText =
				reBilled !== null && reBilled > 0
					? texts.warning.reBilled(reBilled, reBillCost)
					: "";
			const missText = texts.warning.miss(usage.cacheWrite, prompt, reason) + costText;
			const hint = onboardingHintShown ? "" : `\n${texts.warning.onboarding}`;
			onboardingHintShown = true;
			notify(ctx, missText + hint, "warning");
		}

		// Низкий hit — не обязательно промах, но признак смены префикса.
		if (
			hit !== null &&
			hit < config.lowHitPercent &&
			(!config.oncePerEpoch || !epochWarned.has("low-hit"))
		) {
			epochWarned.add("low-hit");
			notify(
				ctx,
				texts.warning.lowHit(
					hitPercentText(hit),
					usage.input,
					usage.cacheRead,
					usage.cacheWrite,
					prompt,
				),
				"warning",
			);
		}
	});

	/** Строка `/cache-monitor settings`: группы, значения, источник и наличие цен модели. */
	const settingsReport = (ctx: ExtensionContext): string => {
		const texts = TEXTS[config.language];
		const values: Record<string, string> = {
			preset: config.preset,
			statusEnabled: String(config.statusEnabled),
			statusShowMode: String(config.statusShowMode),
			statusShowCost: String(config.statusShowCost),
			warningsEnabled: String(config.warningsEnabled),
			lowHitPercent: String(config.lowHitPercent),
			idleMinutes: String(config.idleMinutes),
			minPromptTokens: String(config.minPromptTokens),
			warnCanonicalMiss: String(config.warnCanonicalMiss),
			minPrevPromptTokens: String(config.minPrevPromptTokens),
			oncePerEpoch: String(config.oncePerEpoch),
			historySize: String(config.historySize),
			trendSize: String(config.trendSize),
			showMoney: String(config.showMoney),
			language: config.language,
		};
		// OMP не умеет группы в схеме плагина: группы кодируются порядком ключей
		// и префиксом в description, а команда повторяет их явными заголовками.
		const groups: { title: string; rows: string[] }[] = [
			{
				title: texts.settings.preset,
				rows: ["preset"],
			},
			{
				title: texts.settings.status,
				rows: ["statusEnabled", "statusShowMode", "statusShowCost"],
			},
			{
				title: texts.settings.warnings,
				rows: [
					"warningsEnabled",
					"lowHitPercent",
					"idleMinutes",
					"minPromptTokens",
					"warnCanonicalMiss",
					"minPrevPromptTokens",
					"oncePerEpoch",
				],
			},
			{
				title: texts.settings.reports,
				rows: ["historySize", "trendSize", "showMoney", "language"],
			},
		];
		const prices = cacheDeltaCost(ctx.model, 0) !== null ? texts.settings.yes : texts.settings.no;
		const lines = [texts.settings.title];
		for (const group of groups) {
			lines.push(group.title);
			for (const key of group.rows) {
				const source = configuredKeys.has(key) ? "changed" : "default";
				lines.push(
					`  ${key}: ${values[key]} (${source}) — ${texts.settings.labels[key]}`,
				);
			}
		}
		lines.push(`${texts.settings.prices} ${prices}`);
		lines.push(`${texts.settings.change} omp plugin config set omp-cache-monitor <key> <value>`);
		return lines.join("\n");
	};

	pi.registerCommand("cache-monitor", {
		description: "Cache prefix hit rate: report, history, costs, settings, help",
		handler: async (args, ctx) => {
			const subcommand = args.trim().toLowerCase();
			// Команда видит свежие настройки; новый сеанс читает их сам.
			await refreshConfig(ctx);
			const texts = TEXTS[config.language];
			if (subcommand === "settings" || subcommand === "setting") {
				notify(ctx, settingsReport(ctx), "info");
				return;
			}
			if (subcommand === "help" || subcommand === "?") {
				notify(ctx, texts.help, "info");
				return;
			}
			if (subcommand === "costs" || subcommand === "cost") {
				// Cache warming и компакция могли не прийти событиями хода.
				const aggregate = recomputeTotals(ctx);
				// Журнал пуст (тесты/первый ход) — остаётся live-карта; иначе
				// карта заменяется снимком журнала, так что повтор идемпотентен.
				if (aggregate) costs = new Map(aggregate.costs);
				notify(ctx, costReport(costs, config.language), "info");
				return;
			}
			// Cache warming и компакция могли не прийти событиями хода.
			recomputeTotals(ctx);
			if (subcommand === "history" || subcommand === "hist") {
				const text =
					history.length === 0
						? texts.history.empty
						: `${texts.history.title} (${history.length}/${config.historySize}):\n${history
								.map((record, index) =>
									historyLine(record, index, config.showMoney, config.language),
								)
								.join("\n")}`;
				notify(ctx, text, "info");
				return;
			}
			const modelLabel = ctx.model
				? `${String(field(ctx.model, "provider") ?? "?")}/${String(field(ctx.model, "id") ?? "?")}`
				: "?";
			const thinking = await thinkingLevel();

			const parts = [
				`${texts.report.mode} ${mode || texts.report.noPreset}`,
				modelLabel,
				`thinking ${thinking}`,
			];
			if (last) {
				const savedTurn =
					config.showMoney && last.savedCost !== null && last.savedCost > 0
						? ` · saved $${last.savedCost.toFixed(4)}`
						: "";
				parts.push(
					`${texts.report.turn} ↺ ${hitPercentText(last.hit)} · in ${last.input} · ` +
						`cacheRead ${last.cacheRead} · cacheWrite ${last.cacheWrite} · ` +
						`$${last.cost.toFixed(4)}${savedTurn}`,
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
				parts.push(texts.report.noData);
			}
			if (trendHits.length > 0) {
				parts.push(`${texts.report.trend} ${trendHits.map(sparkLevel).join("")}`);
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
				`${texts.report.session} $${sessionCost.toFixed(4)}, ${texts.report.turns} ${turns}, ↺ ${hitPercentText(sessionHit)}` +
					`${sessionSavedPart}${sessionMissPart}`,
			);

			notify(ctx, parts.join(" · "), "info");
		},
	});
}
