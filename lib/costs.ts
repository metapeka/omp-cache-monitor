/**
 * Read-only costs report over an OMP session JSONL (`costs --json`, v1).
 *
 * The contract is the request from `omp-agent-workflow`
 * (`docs/research/cache-monitor-costs-api.md`): assistant turn usage, provider
 * `usage.cost.total`, cache-hit share, per-model aggregates and deterministic
 * notes. The extension contract (`index.ts`) is untouched: this module is a
 * separate reader with its own hit formula (`cacheWrite` is excluded from the
 * denominator, as the request specifies).
 *
 * Source is only `type === "message"` with `message.role === "assistant"` and a
 * `usage` object. `model_usage`, `usage`, `compaction` and `branch_summary`
 * entries are service calls: they are not turns and are not counted here (the
 * extension's `/cache-monitor costs` counts them; this report deliberately does
 * not, so that dialog turns and background spend never mix).
 *
 * The file is read linearly in 1 MiB chunks, never whole: sessions are
 * 10–20 MB. Nothing is written, no network is used, no price is estimated.
 */
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

/** Breaking change of the JSON shape bumps this and the CHANGELOG. */
export const SCHEMA_VERSION = 1 as const;

const CHUNK_SIZE = 1 << 20;
/** Journal of plugin/file changes, not a session. */
const CHANGES_FILE = "changes.jsonl";

const NOTE_COST_MISSING = "cost missing";
const NOTE_TIMESTAMP_MISSING = "timestamp missing: turn skipped";
const NOTE_COLD_PREFIX = "cold prefix";
const NOTE_COLD_MODEL_SWITCH = "cold prefix after model switch";
const NOTE_CACHE_WRITE = "cacheWrite > 0";

/** ISO-8601 timestamp with an explicit zone; local-time strings are refused. */
const ISO_TIMESTAMP =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface CostsTurn {
	/** `entry.timestamp`, normalized to UTC ISO-8601. */
	at: string;
	/** `message.model`; `null` when the journal has no model. */
	model: string | null;
	/** Provider `usage.cost.total`; `null` when absent, never estimated. */
	costUsd: number | null;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	/** `cacheRead / (input + cacheRead)` 0–100 at 0.1 resolution; `null` without a denominator. */
	hitPercent: number | null;
}

export interface CostsTotals {
	/** Sum of known turn costs; `null` when no turn carries a price. */
	costUsd: number | null;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
}

export interface CostsModel {
	/** `null` groups turns whose journal entry has no model. */
	model: string | null;
	turns: number;
	costUsd: number | null;
	hitPercent: number | null;
}

export interface CostsReport {
	schemaVersion: typeof SCHEMA_VERSION;
	generatedAt: string;
	/** Absolute path of the session file. */
	session: string;
	totals: CostsTotals;
	/** Turns in journal order, after the `--since` filter. */
	turns: CostsTurn[];
	/** Per-model aggregate, in order of first appearance. */
	models: CostsModel[];
	/** Deterministic diagnostics; consecutive duplicates are collapsed. */
	notes: string[];
}

export interface BuildCostsOptions {
	/** ISO-8601 lower bound: keep turns with `at >= since`. */
	since?: string | null;
	/** Override for deterministic tests; defaults to now. */
	generatedAt?: string;
}

interface TurnDraft {
	at: string;
	atMs: number;
	model: string | null;
	costUsd: number | null;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
}

interface ModelTotals {
	turns: number;
	costUsd: number;
	costKnown: boolean;
	inputTokens: number;
	cacheReadTokens: number;
}

/** Field of an external object without `any`; `undefined` when absent. */
function field(source: unknown, key: string): unknown {
	if (typeof source === "object" && source !== null && key in source) {
		return (source as Record<string, unknown>)[key];
	}
	return undefined;
}

/** Token count from usage: a finite number, otherwise 0. */
function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * `cacheRead / (input + cacheRead)` as percent with 0.1 resolution.
 *
 * The denominator excludes `cacheWrite`: this is the request's definition,
 * which differs from the extension's `input + cacheRead + cacheWrite`. No
 * denominator (`<= 0`) is `null`, not 0.
 */
export function cacheHitPercent(input: number, cacheRead: number): number | null {
	const total = input + cacheRead;
	if (!(total > 0)) return null;
	return Math.round((cacheRead / total) * 1000) / 10;
}

/** Epoch milliseconds of a full ISO-8601 timestamp; `null` when not one. */
export function parseIsoTimestamp(value: string): number | null {
	if (!ISO_TIMESTAMP.test(value)) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * Lines of a UTF-8 file without loading it whole; a multi-byte character is
 * never split across chunks. Open and read errors are thrown: the CLI turns
 * them into exit 1, so a truncated answer is never printed as valid JSON.
 */
export function* sessionLines(path: string): Generator<string> {
	const fd = openSync(path, "r");
	const decoder = new StringDecoder("utf8");
	const buffer = Buffer.alloc(CHUNK_SIZE);
	let carry = "";
	try {
		for (;;) {
			const read = readSync(fd, buffer, 0, buffer.length, null);
			if (read <= 0) break;
			const text = carry + decoder.write(buffer.subarray(0, read));
			let start = 0;
			for (;;) {
				const newline = text.indexOf("\n", start);
				if (newline < 0) break;
				yield text.slice(start, newline);
				start = newline + 1;
			}
			carry = text.slice(start);
		}
		const tail = carry + decoder.end();
		if (tail.length > 0) yield tail;
	} finally {
		closeSync(fd);
	}
}

/** Assistant journal entry with a usage object; anything else is `null`. */
function assistantEntry(line: string): Record<string, unknown> | null {
	// Cheap pre-filter before JSON.parse: most lines are content/tool results.
	if (!line.includes('"usage"')) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const entry = parsed as Record<string, unknown>;
	if (entry["type"] !== "message") return null;
	const message = entry["message"];
	if (typeof message !== "object" || message === null) return null;
	const record = message as Record<string, unknown>;
	if (record["role"] !== "assistant") return null;
	const usage = record["usage"];
	if (typeof usage !== "object" || usage === null) return null;
	return entry;
}

/** Turn fields of an assistant entry; `null` when the timestamp is unusable. */
function turnOf(entry: Record<string, unknown>): TurnDraft | null {
	const rawAt = field(entry, "timestamp");
	if (typeof rawAt !== "string") return null;
	const atMs = parseIsoTimestamp(rawAt);
	if (atMs === null) return null;
	const message = field(entry, "message");
	const usage = field(message, "usage");
	const model = field(message, "model");
	const rawTotal = field(field(usage, "cost"), "total");
	return {
		at: new Date(atMs).toISOString(),
		atMs,
		model: typeof model === "string" && model.length > 0 ? model : null,
		costUsd:
			typeof rawTotal === "number" && Number.isFinite(rawTotal) ? rawTotal : null,
		inputTokens: num(field(usage, "input")),
		cacheReadTokens: num(field(usage, "cacheRead")),
		cacheWriteTokens: num(field(usage, "cacheWrite")),
		outputTokens: num(field(usage, "output")),
		reasoningTokens: num(field(usage, "reasoningTokens")),
	};
}

/** Deterministic notes: a repeated consecutive note adds nothing. */
function pushNote(notes: string[], note: string): void {
	if (notes[notes.length - 1] === note) return;
	notes.push(note);
}

/**
 * Costs report of one session file.
 *
 * Throws when the file cannot be opened/read (the CLI maps that to exit 1) and
 * `RangeError` for an invalid `since` (the CLI validates it first and exits 2).
 */
export function buildCostsReport(
	sessionPath: string,
	options: BuildCostsOptions = {},
): CostsReport {
	const session = resolve(sessionPath);
	const since = options.since ?? null;
	const sinceMs = since === null ? null : parseIsoTimestamp(since);
	if (since !== null && sinceMs === null) {
		throw new RangeError(`invalid ISO-8601 timestamp: ${since}`);
	}

	const turns: CostsTurn[] = [];
	const notes: string[] = [];
	const models = new Map<string | null, ModelTotals>();
	const totals: CostsTotals = {
		costUsd: null,
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
	};
	let costKnown = false;
	let totalCost = 0;
	/** Last parseable turn, including turns filtered out by `--since`. */
	let previous: TurnDraft | null = null;

	for (const line of sessionLines(session)) {
		const entry = assistantEntry(line);
		if (entry === null) continue;
		const turn = turnOf(entry);
		if (turn === null) {
			pushNote(notes, NOTE_TIMESTAMP_MISSING);
			continue;
		}
		if (sinceMs !== null && turn.atMs < sinceMs) {
			previous = turn;
			continue;
		}

		if (turn.costUsd === null) {
			pushNote(notes, NOTE_COST_MISSING);
		} else {
			costKnown = true;
			totalCost += turn.costUsd;
		}
		// A cold prefix is a turn with no cache reads after a warm turn, or the
		// first turn of a new model. The session's first turn is cold by nature
		// and is not reported.
		if (turn.cacheReadTokens === 0 && previous !== null) {
			if (previous.model !== turn.model) {
				pushNote(notes, NOTE_COLD_MODEL_SWITCH);
			} else if (previous.cacheReadTokens > 0) {
				pushNote(notes, NOTE_COLD_PREFIX);
			}
		}
		if (turn.cacheWriteTokens > 0) pushNote(notes, NOTE_CACHE_WRITE);

		totals.inputTokens += turn.inputTokens;
		totals.cacheReadTokens += turn.cacheReadTokens;
		totals.cacheWriteTokens += turn.cacheWriteTokens;
		totals.outputTokens += turn.outputTokens;
		totals.reasoningTokens += turn.reasoningTokens;

		let modelTotals = models.get(turn.model);
		if (modelTotals === undefined) {
			modelTotals = {
				turns: 0,
				costUsd: 0,
				costKnown: false,
				inputTokens: 0,
				cacheReadTokens: 0,
			};
			models.set(turn.model, modelTotals);
		}
		modelTotals.turns += 1;
		modelTotals.inputTokens += turn.inputTokens;
		modelTotals.cacheReadTokens += turn.cacheReadTokens;
		if (turn.costUsd !== null) {
			modelTotals.costKnown = true;
			modelTotals.costUsd += turn.costUsd;
		}

		turns.push({
			at: turn.at,
			model: turn.model,
			costUsd: turn.costUsd,
			inputTokens: turn.inputTokens,
			cacheReadTokens: turn.cacheReadTokens,
			cacheWriteTokens: turn.cacheWriteTokens,
			outputTokens: turn.outputTokens,
			reasoningTokens: turn.reasoningTokens,
			hitPercent: cacheHitPercent(turn.inputTokens, turn.cacheReadTokens),
		});
		previous = turn;
	}

	totals.costUsd = costKnown ? totalCost : null;
	const modelList: CostsModel[] = [];
	for (const [model, aggregate] of models) {
		modelList.push({
			model,
			turns: aggregate.turns,
			costUsd: aggregate.costKnown ? aggregate.costUsd : null,
			hitPercent: cacheHitPercent(aggregate.inputTokens, aggregate.cacheReadTokens),
		});
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		session,
		totals,
		turns,
		models: modelList,
		notes,
	};
}

/** Session directory: `OMP_SESSIONS_DIR` when set, else `~/.omp/agent/sessions`. */
export function sessionsDirectory(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const override = env["OMP_SESSIONS_DIR"];
	if (typeof override === "string" && override.length > 0) return resolve(override);
	return join(homedir(), ".omp", "agent", "sessions");
}

/**
 * Newest session JSONL by mtime: direct files of `directory` plus files one
 * level below (OMP layout `sessions/<project>/<session>.jsonl`). Deeper
 * directories and `changes.jsonl` are ignored. Equal mtimes break by path, so
 * the result is deterministic. `null` when nothing is found.
 */
export function latestSessionFile(directory: string): string | null {
	const root = resolve(directory);
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return null;
	}
	const candidates: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (!entry.isDirectory()) {
			candidates.push(path);
			continue;
		}
		let children;
		try {
			children = readdirSync(path, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const child of children) {
			if (!child.isDirectory()) candidates.push(join(path, child.name));
		}
	}

	let best: { path: string; mtimeMs: number } | null = null;
	for (const path of candidates) {
		const name = basename(path);
		if (name === CHANGES_FILE || !name.endsWith(".jsonl")) continue;
		let stats;
		try {
			stats = statSync(path);
		} catch {
			continue;
		}
		if (!stats.isFile()) continue;
		if (
			best === null ||
			stats.mtimeMs > best.mtimeMs ||
			(stats.mtimeMs === best.mtimeMs && path > best.path)
		) {
			best = { path, mtimeMs: stats.mtimeMs };
		}
	}
	return best === null ? null : best.path;
}
