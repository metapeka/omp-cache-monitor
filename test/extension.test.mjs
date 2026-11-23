/**
 * Deterministic harness for index.ts: no network, no model, no OMP runtime.
 *
 * The real extension is imported (Node 22 strips the type-only import), the
 * `pi` registration surface and the `ctx` passed to every handler are faked,
 * and events are fired in the same order OMP fires them.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import cacheMonitor, { normalizeConfig } from "../index.ts";

const MODEL = {
	id: "model-a",
	provider: "test",
	cost: { input: 3, cacheRead: 0.3 },
};

/** Faked `pi`: records handlers/commands, exposes mutable tools and thinking. */
function install(options = { settings: {} }) {
	const handlers = new Map();
	const commands = new Map();
	const state = { thinking: "high", tools: ["read"] };
	const pi = {
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		getActiveTools: () => state.tools,
		getThinkingLevel: () => state.thinking,
		pi: { settings: {} },
	};
	cacheMonitor(pi, options);
	return { handlers, commands, state };
}

/** Faked `ctx`: UI calls are recorded instead of rendered. */
function context({ mode = "tui", agentKind = "main", model = MODEL, ui, entries = [] } = {}) {
	const statuses = [];
	const notifications = [];
	const ctx = {
		mode,
		agent: { kind: agentKind },
		model,
		sessionManager: {
			getEntries() {
				return entries;
			},
		},
		ui: ui ?? {
			setStatus(key, text) {
				statuses.push({ key, text });
			},
			notify(text, level) {
				notifications.push({ text, level });
			},
		},
	};
	return { ctx, statuses, notifications };
}

async function fire(extension, name, ctx, event = {}) {
	const handlers = extension.handlers.get(name) ?? [];
	assert.ok(handlers.length > 0, `expected a "${name}" handler`);
	for (const handler of handlers) await handler(event, ctx);
}

function usage(input, cacheRead, cacheWrite, total = 0) {
	return { input, cacheRead, cacheWrite, cost: { total } };
}

async function turn(extension, ctx, turnUsage, turnIndex = 1, timestamp) {
	const message = { usage: turnUsage };
	if (timestamp !== undefined) message.timestamp = timestamp;
	await fire(extension, "turn_end", ctx, { message, turnIndex });
}

async function command(extension, ctx, args = "") {
	const definition = extension.commands.get("cache-monitor");
	assert.ok(definition, "expected /cache-monitor to be registered");
	await definition.handler(args, ctx);
}

function spark(text) {
	const match = /тренд: (\S+)/.exec(text);
	return match ? match[1] : null;
}

/** Journal entry for an assistant turn (the fixture shape `getEntries()` returns). */
function assistantEntry(turnUsage, timestamp) {
	const message = {
		role: "assistant",
		provider: "test",
		model: "model-a",
		usage: turnUsage,
	};
	if (timestamp !== undefined) message.timestamp = timestamp;
	return { type: "message", message };
}

/** Journal entry for off-transcript usage, e.g. cache warming. */
function usageEntry(turnUsage, kind = "cache_warm") {
	return { type: "usage", kind, usage: turnUsage };
}

/** OMP 19.1 off-transcript usage entry (title/composer/cache warming). */
function modelUsageEntry(turnUsage, purpose = "title-fork") {
	return { type: "model_usage", purpose, usage: turnUsage };
}

async function started({
	mode,
	agentKind,
	model,
	ui,
	entries = [],
	reason = "startup",
	settings,
} = {}) {
	const extension = install(settings === undefined ? undefined : { settings });
	const view = context({ mode, agentKind, model, ui, entries });
	await fire(extension, "session_start", view.ctx, { reason });
	return { extension, ...view };
}

beforeEach(() => {
	delete process.env.OMP_MODE;
});

afterEach(() => {
	delete process.env.OMP_MODE;
});

describe("status line and hit formula", () => {
	it("computes cacheRead/(input+cacheRead+cacheWrite) and formats it", async () => {
		const { extension, ctx, statuses } = await started();
		assert.deepEqual(statuses, [{ key: "cache-monitor", text: "↺ …" }]);

		await turn(extension, ctx, usage(1000, 3000, 0, 0.01));
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "↺ 75%" });

		// Rounds to one decimal when the integer percent is not exact.
		await turn(extension, ctx, usage(8, 1, 0));
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "↺ 11.1%" });

		// cacheWrite counts in the denominator: 500 / (0+500+500).
		await turn(extension, ctx, usage(0, 500, 500));
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "↺ 50%" });

		// Zero denominator: hit is undefined.
		await turn(extension, ctx, usage(0, 0, 0));
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "↺ n/a" });
	});

	it("prefixes the status with OMP_MODE when set", async () => {
		process.env.OMP_MODE = "cache-safe";
		const { extension, ctx, statuses, notifications } = await started();
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "cache-safe ↺ …" });

		await turn(extension, ctx, usage(1000, 3000, 0));
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "cache-safe ↺ 75%" });

		await command(extension, ctx);
		assert.match(notifications.at(-1).text, /^режим: cache-safe · /);
	});

	it("reports the last turn and session totals in /cache-monitor", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(1000, 3000, 0, 0.01));

		await command(extension, ctx);
		const out = notifications.at(-1);
		assert.equal(out.level, "info");
		assert.match(out.text, /^режим: без пресета · test\/model-a · thinking high · /);
		assert.match(
			out.text,
			/ход: ↺ 75% · in 1000 · cacheRead 3000 · cacheWrite 0 · \$0\.0100 · saved \$0\.0081 · тренд:/,
		);
		assert.match(out.text, /сессия: \$0\.0100, ходов 1, ↺ 75%, saved \$0\.0081$/);
		assert.equal(spark(out.text), "▇");
	});

	it("says there is no last-turn data before the first turn", async () => {
		const { extension, ctx, notifications } = await started();
		await command(extension, ctx);
		assert.equal(
			notifications.at(-1).text,
			"режим: без пресета · test/model-a · thinking high · ход: нет данных · " +
				"сессия: $0.0000, ходов 0, ↺ n/a",
		);
	});
});

describe("trend sparkline", () => {
	it("maps hits to levels and uses · for an unknown hit", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(100, 0, 0)); // 0%
		await turn(extension, ctx, usage(1, 1, 0)); // 50%
		await turn(extension, ctx, usage(0, 100, 0)); // 100%
		await turn(extension, ctx, usage(0, 0, 0)); // n/a

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.equal(spark(out), "▁▅█·");
		assert.match(out, /ход: ↺ n\/a/);
	});

	it("keeps only the last 12 hits", async () => {
		const { extension, ctx, notifications } = await started();
		for (let i = 1; i <= 13; i += 1) {
			const odd = i % 2 === 1;
			await turn(extension, ctx, odd ? usage(100, 0, 0) : usage(0, 100, 0));
		}

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		// Turns 2..13: 100, 0, 100, 0, … — turn 1 fell off the front.
		assert.equal(spark(out), "█▁█▁█▁█▁█▁█▁");
	});
});

describe("session miss accounting", () => {
	it("accumulates re-billed tokens and their cost", async () => {
		const { extension, ctx, notifications } = await started();
		// First turn of the epoch has nothing to compare with.
		await turn(extension, ctx, usage(0, 0, 5000, 0.05));
		// Prefix grew to 5000, this turn kept only 1000 cached out of 4000.
		await turn(extension, ctx, usage(3000, 1000, 0, 0.02));

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(out, /ход: ↺ 25%/);
		assert.match(out, /· saved \$0\.0027 · miss premium: \$0\.0081 \(3000 tok\) ·/);
		assert.match(
			out,
			/сессия: \$0\.0700, ходов 2, ↺ 11\.1%, saved \$0\.0027, miss premium \$0\.0081 \(3000 tok\)$/,
		);
		assert.doesNotMatch(out, /≥/);
	});

	it("marks the session miss with ≥ when some turns have no price", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000, 0.05));
		await turn(extension, ctx, usage(3000, 1000, 0, 0.02));

		// Same model id, but the provider stopped reporting cost: epoch unchanged.
		ctx.model = { id: "model-a", provider: "test" };
		await turn(extension, ctx, usage(3000, 1000, 0, 0.02));

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(out, /miss premium: 3000 tok ·/);
		assert.match(
			out,
			/сессия: \$0\.0900, ходов 3, ↺ 15\.4%, saved ≥\$0\.0027, miss premium ≥\$0\.0081 \(6000 tok\)$/,
		);
	});

	it("does not count a miss when the prefix was fully cached", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000, 0.05));
		await turn(extension, ctx, usage(0, 5000, 0, 0.02));

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(out, /ход: ↺ 100%/);
		assert.match(out, /saved \$0\.0135/);
		assert.doesNotMatch(out, /miss premium/);
	});
});

describe("cache saved and miss premium", () => {
	it("computes saved per turn and per session from the price delta", async () => {
		const { extension, ctx, notifications } = await started();
		// MODEL.cost: input 3, cacheRead 0.3 → delta 2.7 $/1M.
		await turn(extension, ctx, usage(1000, 3000, 0, 0.01), 1);
		await turn(extension, ctx, usage(2000, 2000, 0, 0.02), 2);

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		// 2000 tok * 2.7 / 1e6 = 0.0054; 5000 tok за сессию = 0.0135.
		assert.match(
			out,
			/ход: ↺ 50% · in 2000 · cacheRead 2000 · cacheWrite 0 · \$0\.0200 · saved \$0\.0054 · miss premium: \$0\.0054 \(2000 tok\) · тренд:/,
		);
		assert.match(
			out,
			/сессия: \$0\.0300, ходов 2, ↺ 62\.5%, saved \$0\.0135, miss premium \$0\.0054 \(2000 tok\)$/,
		);
	});

	it("shows saved as ≥ after resume and estimates only live known prices", async () => {
		// Restored cacheRead has no model price: it must not be estimated.
		const entries = [assistantEntry(usage(0, 5000, 0, 0.01))];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		const live = usage(0, 3000, 0, 0.01);
		entries.push(assistantEntry(live));
		await turn(extension, ctx, live, 2);
		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(
			out,
			/ход: ↺ 100% · in 0 · cacheRead 3000 · cacheWrite 0 · \$0\.0100 · saved \$0\.0081/,
		);
		assert.doesNotMatch(out, /miss premium/);
		assert.match(out, /сессия: \$0\.0200, ходов 2, ↺ 100%, saved ≥\$0\.0081$/);
	});

	it("omits saved and shows miss premium in tokens without model prices", async () => {
		const model = { id: "model-a", provider: "test" };
		const { extension, ctx, notifications } = await started({ model });
		await turn(extension, ctx, usage(0, 0, 5000, 0.05), 1);
		await turn(extension, ctx, usage(3000, 1000, 0, 0.02), 2);

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(
			out,
			/ход: ↺ 25% · in 3000 · cacheRead 1000 · cacheWrite 0 · \$0\.0200 · miss premium: 3000 tok · тренд:/,
		);
		assert.doesNotMatch(out, /saved/);
		assert.match(out, /сессия: \$0\.0700, ходов 2, ↺ 11\.1%, miss premium 3000 tok$/);
	});
});

describe("turn history", () => {
	const START = 2_000_000;

	it("lists the last turns with hits, money and miss causes, oldest first", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(1000, 3000, 0, 0.01), 1, START);
		await turn(extension, ctx, usage(3000, 1000, 0, 0.02), 2, START + 60_000);
		await turn(
			extension,
			ctx,
			usage(0, 0, 5000, 0.03),
			3,
			START + 60_000 + 6 * 60_000,
		);
		await turn(
			extension,
			ctx,
			usage(0, 0, 5000, 0.03),
			4,
			START + 60_000 + 6 * 60_000 + 60_000,
		);

		await command(extension, ctx, "history");
		const out = notifications.at(-1);
		assert.equal(out.level, "info");
		assert.equal(
			out.text,
			"история (4/8):\n" +
				"1. ↺ 75% · prompt 4000 · saved $0.0081\n" +
				"2. ↺ 25% · prompt 4000 · saved $0.0027 · miss premium $0.0081 (3000 tok)\n" +
				"3. ↺ 0% · prompt 5000 · miss premium $0.0108 (4000 tok) · простой 6 мин\n" +
				"4. ↺ 0% · prompt 5000 · miss premium $0.0135 (5000 tok) · перезапись префикса",
		);
	});

	it("keeps the last 8 turns with numbering from 1", async () => {
		const { extension, ctx, notifications } = await started();
		for (let i = 1; i <= 10; i += 1) {
			await turn(extension, ctx, usage(1000 - i * 10, i * 10, 0), i);
		}

		await command(extension, ctx, "hist");
		const lines = notifications.at(-1).text.split("\n");
		assert.equal(lines[0], "история (8/8):");
		assert.equal(lines.length, 9);
		// Turns 1–2 fell off the front; hits are 3%…10%.
		assert.match(lines[1], /^1\. ↺ 3%/);
		assert.match(lines[8], /^8\. ↺ 10%/);

		// Case and surrounding whitespace are normalized.
		await command(extension, ctx, " HISTORY ");
		assert.equal(notifications.at(-1).text, lines.join("\n"));
	});

	it("gives no cause to the first live turn of a new epoch", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		ctx.model = { id: "model-b", provider: "test", cost: MODEL.cost };
		await turn(extension, ctx, usage(0, 0, 5000), 2);
		await turn(extension, ctx, usage(0, 0, 5000), 3);

		await command(extension, ctx, "history");
		const lines = notifications.at(-1).text.split("\n");
		assert.equal(lines[1], "1. ↺ 0% · prompt 5000");
		assert.equal(lines[2], "2. ↺ 0% · prompt 5000");
		assert.equal(
			lines[3],
			"3. ↺ 0% · prompt 5000 · miss premium $0.0135 (5000 tok) · перезапись префикса",
		);
	});

	it("restores history from the journal without inventing money or the resume gap", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.05), START),
			assistantEntry(usage(0, 0, 5000, 0.05), START + 6 * 60_000),
			assistantEntry(usage(2000, 3000, 0, 0.02), START + 7 * 60_000),
			{ type: "model_change", provider: "test", modelId: "model-b" },
			assistantEntry(usage(0, 0, 5000, 0.05)),
			assistantEntry(usage(0, 0, 5000, 0.05)),
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx, "history");
		const lines = notifications.at(-1).text.split("\n");
		assert.equal(lines[0], "история (5/8):");
		// The first turn of an epoch gets no cause, even on a full rewrite.
		assert.equal(lines[1], "1. ↺ 0% · prompt 5000");
		assert.equal(
			lines[2],
			"2. ↺ 0% · prompt 5000 · miss premium ? (5000 tok) · простой 6 мин",
		);
		assert.equal(lines[3], "3. ↺ 60% · prompt 5000 · saved ? · miss premium ? (2000 tok)");
		assert.equal(lines[4], "4. ↺ 0% · prompt 5000");
		// The last journaled turn has no proven comparison: no miss premium.
		assert.equal(lines[5], "5. ↺ 0% · prompt 5000 · перезапись префикса");
		assert.doesNotMatch(lines[4], /miss premium/);
		assert.doesNotMatch(lines[5], /miss premium/);
	});

	it("clears history on /new, restores it on resume and keeps it on /clear", async () => {
		const live = await started();
		await turn(live.extension, live.ctx, usage(100, 300, 0), 1, START);
		await command(live.extension, live.ctx, "history");
		const before = live.notifications.at(-1).text;
		assert.match(before, /^история \(1\/8\):/);

		await fire(live.extension, "session_clear", live.ctx);
		await command(live.extension, live.ctx, "history");
		assert.equal(live.notifications.at(-1).text, before);

		await fire(live.extension, "session_switch", live.ctx, { reason: "new" });
		await command(live.extension, live.ctx, "history");
		assert.equal(live.notifications.at(-1).text, "история: нет данных");

		const entries = [
			assistantEntry(usage(100, 300, 0)),
			assistantEntry(usage(0, 400, 0)),
		];
		const resumed = await started({ entries, reason: "resume" });
		await command(resumed.extension, resumed.ctx, "history");
		assert.match(resumed.notifications.at(-1).text, /^история \(2\/8\):/);
	});

	it("keeps the default report free of history", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(1000, 3000, 0, 0.01));

		await command(extension, ctx);
		assert.match(notifications.at(-1).text, /^режим: /);
		assert.doesNotMatch(notifications.at(-1).text, /история/);

		// An unknown argument keeps the old report, exactly as before.
		await command(extension, ctx, "unknown");
		assert.match(notifications.at(-1).text, /^режим: /);
		assert.doesNotMatch(notifications.at(-1).text, /история/);
	});
});

describe("miss cause", () => {
	const START = 1_000_000;

	it("names idle time when the gap between turns is long", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000), 1, START);
		await turn(extension, ctx, usage(0, 0, 5000), 2, START + 6 * 60_000);

		const miss = notifications.find((n) => /промах/.test(n.text));
		assert.ok(miss, "expected a canonical-miss warning");
		assert.match(miss.text, /причина: простой 6 мин\./);
	});

	it("shows the settings hint once, on the first canonical miss", async () => {
		const first = await started({ settings: { oncePerEpoch: false } });
		await turn(first.extension, first.ctx, usage(0, 0, 5000), 1, START);
		await turn(first.extension, first.ctx, usage(0, 0, 5000), 2, START + 60_000);
		await turn(first.extension, first.ctx, usage(0, 0, 5000), 3, START + 120_000);

		const misses = first.notifications.filter((n) => /промах/.test(n.text));
		assert.equal(misses.length, 2);
		assert.match(misses[0].text, /\/cache-monitor settings/);
		assert.match(misses[0].text, /preset — набор значений/);
		assert.doesNotMatch(misses[1].text, /\/cache-monitor settings/);

		const english = await started({ settings: { language: "en", oncePerEpoch: false } });
		await turn(english.extension, english.ctx, usage(0, 0, 5000), 1, START);
		await turn(english.extension, english.ctx, usage(0, 0, 5000), 2, START + 60_000);
		const enMiss = english.notifications.find((n) => /Prefix cache: miss/.test(n.text));
		assert.ok(enMiss, "expected an English canonical-miss warning");
		assert.match(enMiss.text, /Settings: \/cache-monitor settings/);
		assert.match(enMiss.text, /preset is a value bundle/);
	});

	it("falls back to prefix rewrite for a short gap or a missing timestamp", async () => {
		const short = await started();
		await turn(short.extension, short.ctx, usage(0, 0, 5000), 1, START);
		await turn(short.extension, short.ctx, usage(0, 0, 5000), 2, START + 60_000);
		const shortMiss = short.notifications.find((n) => /промах/.test(n.text));
		assert.ok(shortMiss, "expected a canonical-miss warning for a 1-minute gap");
		assert.match(shortMiss.text, /причина: перезапись префикса\./);

		const timeless = await started();
		await turn(timeless.extension, timeless.ctx, usage(0, 0, 5000), 1);
		await turn(timeless.extension, timeless.ctx, usage(0, 0, 5000), 2);
		const timelessMiss = timeless.notifications.find((n) => /промах/.test(n.text));
		assert.ok(timelessMiss, "expected a canonical-miss warning without timestamps");
		assert.match(timelessMiss.text, /причина: перезапись префикса/);
	});

	it("uses the 5-minute threshold inclusively", async () => {
		const atThreshold = await started();
		await turn(atThreshold.extension, atThreshold.ctx, usage(0, 0, 5000), 1, START);
		await turn(
			atThreshold.extension,
			atThreshold.ctx,
			usage(0, 0, 5000),
			2,
			START + 5 * 60_000,
		);
		const thresholdMiss = atThreshold.notifications.find((n) => /промах/.test(n.text));
		assert.ok(thresholdMiss, "expected a canonical-miss warning at 5 minutes");
		assert.match(thresholdMiss.text, /причина: простой 5 мин\./);

		const below = await started();
		await turn(below.extension, below.ctx, usage(0, 0, 5000), 1, START);
		await turn(
			below.extension,
			below.ctx,
			usage(0, 0, 5000),
			2,
			START + 5 * 60_000 - 1,
		);
		const belowMiss = below.notifications.find((n) => /промах/.test(n.text));
		assert.ok(belowMiss, "expected a canonical-miss warning just below 5 minutes");
		assert.match(belowMiss.text, /причина: перезапись префикса\./);
	});

	it("does not carry idle time across a timestamp-less turn", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000), 1, START);
		// The middle turn breaks the idle chain: the next gap is unknown.
		await turn(extension, ctx, usage(0, 0, 5000), 2);
		await turn(extension, ctx, usage(0, 0, 5000), 3, START + 6 * 60_000);

		const miss = notifications.find((n) => /промах/.test(n.text));
		assert.ok(miss, "expected a canonical-miss warning after the untimed turn");
		assert.match(miss.text, /причина: перезапись префикса\./);
	});

	it("does not attribute an idle gap across an epoch boundary", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000), 1, START);

		// Model switch after 30 minutes: the first turn of the epoch is silent.
		ctx.model = { id: "model-b", provider: "test", cost: MODEL.cost };
		await turn(extension, ctx, usage(0, 0, 5000), 2, START + 30 * 60_000);
		assert.equal(notifications.length, 0);

		// The next 1-minute gap belongs to the new prefix: rewrite, not idle.
		await turn(
			extension,
			ctx,
			usage(0, 0, 5000),
			3,
			START + 30 * 60_000 + 60_000,
		);
		const miss = notifications.find((n) => /промах/.test(n.text));
		assert.ok(miss, "expected a canonical-miss warning inside the new epoch");
		assert.match(miss.text, /причина: перезапись префикса/);
	});
});

describe("session lifecycle", () => {
	it("resets last turn, trend and session totals on /new", async () => {
		const { extension, ctx, statuses, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000, 0.05), 1);
		await turn(extension, ctx, usage(3000, 1000, 0, 0.02), 2);

		await fire(extension, "session_switch", ctx, { reason: "new" });
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "↺ …" });

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.equal(
			out,
			"режим: без пресета · test/model-a · thinking high · ход: нет данных · " +
				"сессия: $0.0000, ходов 0, ↺ n/a",
		);

		// The fresh transcript starts a fresh epoch: no re-billing either.
		await turn(extension, ctx, usage(100, 300, 0));
		await command(extension, ctx);
		const fresh = notifications.at(-1).text;
		assert.match(fresh, /ходов 1, ↺ 75%/);
		assert.equal(spark(fresh), "▇");
		assert.doesNotMatch(fresh, /miss premium/);
	});

	it("keeps saved and miss premium across /clear and tree navigation", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000, 0.05), 1);
		await turn(extension, ctx, usage(3000, 1000, 0, 0.02), 2);

		await command(extension, ctx);
		const before = notifications.at(-1).text;
		assert.match(before, /saved \$0\.0027, miss premium \$0\.0081 \(3000 tok\)/);

		// /clear and tree navigation reset the prefix comparison, not the sums.
		await fire(extension, "session_clear", ctx);
		await command(extension, ctx);
		assert.equal(notifications.at(-1).text, before);

		await fire(extension, "session_tree", ctx);
		await command(extension, ctx);
		assert.equal(notifications.at(-1).text, before);
	});

	it("does not warn on the first turn of a new epoch", async () => {
		const { extension, ctx, notifications } = await started();
		// Cold start: nothing to compare against.
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		assert.equal(notifications.length, 0);

		// Model switch: a full prefix rewrite is expected.
		ctx.model = { id: "model-b", provider: "test", cost: MODEL.cost };
		await turn(extension, ctx, usage(0, 0, 5000), 5);
		assert.equal(notifications.length, 0);

		// Same epoch again: the canonical miss is real, plus the low hit.
		await turn(extension, ctx, usage(0, 0, 5000), 6);
		assert.equal(notifications.length, 2);
		assert.equal(notifications[0].level, "warning");
		assert.match(notifications[0].text, /промах \(cacheRead 0/);
		assert.match(notifications[1].text, /hit 0%/);

		// Thinking change opens a new epoch.
		extension.state.thinking = "low";
		await turn(extension, ctx, usage(0, 0, 5000), 7);
		assert.equal(notifications.length, 2);

		// So does a change of the active tool set.
		extension.state.tools = ["grep", "read"];
		await turn(extension, ctx, usage(0, 0, 5000), 8);
		assert.equal(notifications.length, 2);

		// Inside the new epoch the warnings come back.
		await turn(extension, ctx, usage(0, 0, 5000), 9);
		assert.equal(notifications.length, 4);
	});
});

describe("resume restoration", () => {
	it("restores totals, trend and re-billed tokens, but not the last turn's miss", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.05)),
			assistantEntry(usage(3000, 1000, 0, 0.02)),
			assistantEntry(usage(0, 5000, 0, 0.01)),
			usageEntry(usage(100, 200, 0, 0.001)),
			{ type: "compaction", usage: usage(0, 300, 0, 0.002) },
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(
			out,
			/ход: ↺ 100% · in 0 · cacheRead 5000 · cacheWrite 0 · \$0\.0100/,
		);
		// The last turn before resume has no journaled epoch boundary: its
		// re-bill is conservatively not shown.
		assert.doesNotMatch(out, /miss premium:/);
		assert.equal(spark(out), "▁▃█");
		// The earlier miss (A→B) is restored in tokens; money is not invented.
		assert.doesNotMatch(out, /\$0\.0081/);
		assert.match(
			out,
			/сессия: \$0\.0830, ходов 3, ↺ 42\.9%, miss premium 3000 tok$/,
		);
	});

	it("counts every background usage kind in totals but not turns or trend", async () => {
		const entries = [
			assistantEntry(usage(0, 100, 0, 0.01)),
			usageEntry(usage(500, 500, 0, 0.02), "cache_warm"),
			usageEntry(usage(10, 0, 0, 0.005), "other"),
			modelUsageEntry(usage(20, 0, 0, 0.005), "title-fork"),
			{ type: "branch_summary", usage: usage(0, 0, 200, 0.03) },
			{ type: "compaction", usage: usage(100, 0, 0, 0.04) },
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		// Background calls add cost, not dialog tokens: the only turn is 100%.
		assert.match(out, /сессия: \$0\.1100, ходов 1, ↺ 100%/);
		assert.equal(spark(out), "█");
	});

	it("does not double count a turn that is both live and already in the journal", async () => {
		const entries = [assistantEntry(usage(0, 0, 5000, 0.05))];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		const live = usage(1000, 3000, 0, 0.01);
		entries.push(assistantEntry(live));
		await turn(extension, ctx, live, 2);
		// Cache warming lands after the turn, without a turn event of its own.
		entries.push(usageEntry(usage(0, 0, 0, 0.001)));

		await command(extension, ctx);
		const first = notifications.at(-1).text;
		assert.match(first, /сессия: \$0\.0610, ходов 2, ↺ 33\.3%/);

		// A second recompute replaces the same journal totals instead of adding them.
		await command(extension, ctx);
		assert.equal(notifications.at(-1).text, first);
	});

	it("does not warn on the first turn after resume", async () => {
		const entries = [assistantEntry(usage(0, 0, 5000, 0.05))];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		// A full prefix rewrite right after resume is a new epoch: no warning.
		await turn(extension, ctx, usage(0, 0, 5000), 2);
		assert.equal(notifications.length, 0);

		// The next turn in the same epoch is a real canonical miss plus low hit.
		await turn(extension, ctx, usage(0, 0, 5000), 3);
		assert.equal(notifications.length, 2);
		assert.match(notifications[0].text, /промах \(cacheRead 0/);
		assert.match(notifications[1].text, /hit 0%/);
	});

	it("uses model and thinking changes in the journal as epoch boundaries", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.05)),
			{ type: "model_change", provider: "test", modelId: "model-b" },
			assistantEntry(usage(0, 0, 5000, 0.05)),
			assistantEntry(usage(0, 0, 5000, 0.05)),
			{ type: "thinking_level_change", thinkingLevel: "low" },
			assistantEntry(usage(0, 0, 5000, 0.05)),
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		// Only the pair inside the model-change epoch contributes re-billed tokens.
		assert.match(out, /сессия: \$0\.2000, ходов 4, ↺ 0%, miss premium 5000 tok/);
		assert.doesNotMatch(out, /miss premium:/);
	});

	it("still zeroes totals on /new even if the previous journal is visible", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.05)),
			usageEntry(usage(100, 0, 0, 0.001)),
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		// OMP starts the new session with a fresh journal.
		entries.length = 0;
		await fire(extension, "session_switch", ctx, { reason: "new" });
		await command(extension, ctx);
		assert.equal(
			notifications.at(-1).text,
			"режим: без пресета · test/model-a · thinking high · ход: нет данных · " +
				"сессия: $0.0000, ходов 0, ↺ n/a",
		);
	});
});

describe("warning thresholds", () => {
	it("stays quiet for a prompt below 4000 tokens", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 2000), 1);
		await turn(extension, ctx, usage(0, 0, 2000), 2);
		assert.equal(notifications.length, 0);
	});

	it("stays quiet on turnIndex 0 even with a big prompt", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000), 0);
		await turn(extension, ctx, usage(0, 0, 5000), 0);
		assert.equal(notifications.length, 0);

		await turn(extension, ctx, usage(0, 0, 5000), 1);
		assert.equal(notifications.length, 2);
	});

	it("warns about a low hit once per epoch", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		// Prompt 4000, hit 25%: low hit, but cacheRead is not zero.
		await turn(extension, ctx, usage(3000, 1000, 0), 2);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].text, /hit 25%/);

		await turn(extension, ctx, usage(3000, 1000, 0), 3);
		assert.equal(notifications.length, 1);
	});

	it("stays silent for sub-agents", async () => {
		const { extension, ctx, statuses, notifications } = await started({ agentKind: "sub" });
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		await turn(extension, ctx, usage(0, 0, 5000), 2);
		assert.equal(statuses.length, 0);
		assert.equal(notifications.length, 0);
	});

	it("does not throw and does not touch the UI without a TUI", async () => {
		const calls = { status: 0, notify: 0 };
		const ui = {
			setStatus() {
				calls.status += 1;
				throw new Error("no status line");
			},
			notify() {
				calls.notify += 1;
				throw new Error("no notifications");
			},
		};
		const { extension, ctx } = await started({ mode: "print", ui });

		await turn(extension, ctx, usage(0, 0, 5000), 1);
		await turn(extension, ctx, usage(0, 0, 5000), 2);
		// The command itself still publishes (and its notify failure is contained).
		await command(extension, ctx);

		assert.deepEqual(calls, { status: 0, notify: 1 });
	});
});

describe("cost breakdown", () => {
	/** Header value and the `≥` marker of a cost report. */
	function reportTotal(text) {
		const match = /^стоимость сессии: (≥)?\$([\d.]+)$/m.exec(text);
		assert.ok(match, `expected a session cost header in:\n${text}`);
		return { missing: match[1] === "≥", value: Number(match[2]) };
	}

	/** Sum of the known bucket values; `?` lines contribute nothing. */
	function bucketTotal(text) {
		let sum = 0;
		for (const line of text.split("\n").slice(1)) {
			const match = /: ≥?\$([\d.]+)$/.exec(line);
			if (match) sum += Number(match[1]);
		}
		return sum;
	}

	it("breaks journal cost down by entry type and sums to the header", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.5)),
			usageEntry(usage(0, 0, 0, 0.1), "cache_warm"),
			usageEntry(usage(0, 0, 0, 0.06), "recall"),
			modelUsageEntry(usage(0, 0, 0, 0.02), "composer"),
			modelUsageEntry(usage(0, 0, 0, 0.001), "title"),
			modelUsageEntry(usage(0, 0, 0, 0.02), "compaction:auto"),
			modelUsageEntry(usage(0, 0, 0, 0.01), "branch-summary"),
			{ type: "compaction", usage: usage(0, 0, 0, 0.03) },
			{ type: "branch_summary", usage: usage(0, 0, 0, 0.04) },
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx, "costs");
		const out = notifications.at(-1);
		assert.equal(out.level, "info");
		assert.equal(
			out.text,
			"стоимость сессии: $0.7810\n" +
				"диалог: $0.5000\n" +
				"cache_warm: $0.1000\n" +
				"recall: $0.0600\n" +
				"ветка: $0.0500\n" +
				"компакция: $0.0500\n" +
				"composer: $0.0200\n" +
				"title: $0.0010",
		);
		const total = reportTotal(out.text);
		assert.equal(total.missing, false);
		assert.equal(bucketTotal(out.text).toFixed(4), total.value.toFixed(4));
		// Journal keys are labels, not internal prefixes.
		assert.doesNotMatch(out.text, /usage:/);
	});

	it("reports a live turn without a journal and accepts the cost alias", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(1000, 3000, 0, 0.0123));

		await command(extension, ctx, " costs ");
		assert.equal(
			notifications.at(-1).text,
			"стоимость сессии: $0.0123\nдиалог: $0.0123",
		);

		// Alias, case and whitespace are normalized.
		await command(extension, ctx, "COST");
		assert.equal(
			notifications.at(-1).text,
			"стоимость сессии: $0.0123\nдиалог: $0.0123",
		);
	});

	it("keeps costs across /clear and tree navigation", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(1000, 3000, 0, 0.02));
		await command(extension, ctx, "costs");
		const before = notifications.at(-1).text;

		await fire(extension, "session_clear", ctx);
		await command(extension, ctx, "costs");
		assert.equal(notifications.at(-1).text, before);

		await fire(extension, "session_tree", ctx);
		await command(extension, ctx, "costs");
		assert.equal(notifications.at(-1).text, before);
	});

	it("shows an empty kind or purpose as прочее", async () => {
		const entries = [usageEntry(usage(0, 0, 0, 0.05), "")];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx, "costs");
		assert.equal(notifications.at(-1).text, "стоимость сессии: $0.0500\nпрочее: $0.0500");
	});

	it("is idempotent and clears on /new, even after a non-empty journal", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.02)),
			usageEntry(usage(0, 0, 0, 0.001)),
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx, "costs");
		const first = notifications.at(-1).text;
		assert.equal(first, "стоимость сессии: $0.0210\nдиалог: $0.0200\ncache_warm: $0.0010");

		// A second call replaces the journal snapshot instead of adding to it.
		await command(extension, ctx, "costs");
		assert.equal(notifications.at(-1).text, first);

		// OMP starts the new session with a fresh journal.
		entries.length = 0;
		await fire(extension, "session_switch", ctx, { reason: "new" });
		await command(extension, ctx, "costs");
		assert.equal(notifications.at(-1).text, "стоимость: нет данных");

		// The fresh transcript starts from a live dialog bucket only.
		await turn(extension, ctx, usage(1000, 3000, 0, 0.03));
		await command(extension, ctx, "costs");
		assert.equal(
			notifications.at(-1).text,
			"стоимость сессии: $0.0300\nдиалог: $0.0300",
		);
	});

	it("restores the map on resume and matches the default session total", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.05)),
			usageEntry(usage(0, 0, 0, 0.02), "cache_warm"),
			modelUsageEntry(usage(0, 0, 0, 0.01), "title"),
			{ type: "compaction", usage: usage(0, 0, 0, 0.03) },
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx, "costs");
		const breakdown = notifications.at(-1).text;
		assert.equal(
			breakdown,
			"стоимость сессии: $0.1100\n" +
				"диалог: $0.0500\n" +
				"компакция: $0.0300\n" +
				"cache_warm: $0.0200\n" +
				"title: $0.0100",
		);

		await command(extension, ctx);
		const report = notifications.at(-1).text;
		const session = /\$([\d.]+), ходов/.exec(report);
		assert.ok(session, `expected session totals in:\n${report}`);
		assert.equal(reportTotal(breakdown).value.toFixed(4), Number(session[1]).toFixed(4));
	});

	it("marks a missing price with ? and a partial sum with ≥", async () => {
		const unknown = await started({
			entries: [
				assistantEntry(usage(0, 0, 1000, 0.02)),
				usageEntry({ input: 5 }, "warm"),
			],
			reason: "resume",
		});
		await command(unknown.extension, unknown.ctx, "costs");
		assert.equal(
			unknown.notifications.at(-1).text,
			"стоимость сессии: ≥$0.0200\nдиалог: $0.0200\nwarm: ?",
		);

		const partial = await started({
			entries: [
				assistantEntry(usage(0, 0, 1000, 0.02)),
				usageEntry(usage(0, 0, 0, 0.005), "warm"),
				usageEntry({ input: 5 }, "warm"),
			],
			reason: "resume",
		});
		await command(partial.extension, partial.ctx, "costs");
		assert.equal(
			partial.notifications.at(-1).text,
			"стоимость сессии: ≥$0.0250\nдиалог: $0.0200\nwarm: ≥$0.0050",
		);
		assert.equal(reportTotal(partial.notifications.at(-1).text).missing, true);

		// An assistant message without cost.total makes the dialog bucket unknown.
		const dialog = await started({
			entries: [assistantEntry({ input: 100, cacheRead: 0, cacheWrite: 0, cost: {} })],
			reason: "resume",
		});
		await command(dialog.extension, dialog.ctx, "costs");
		assert.equal(
			dialog.notifications.at(-1).text,
			"стоимость сессии: ≥$0.0000\nдиалог: ?",
		);
	});

	it("falls back to прочее and breaks cost ties by label", async () => {
		const entries = [
			usageEntry(usage(0, 0, 0, 0.001), "beta"),
			modelUsageEntry(usage(0, 0, 0, 0.001), "alpha"),
			{ type: "usage", usage: usage(0, 0, 0, 0.001) },
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx, "costs");
		assert.equal(
			notifications.at(-1).text,
			"стоимость сессии: $0.0030\n" +
				"alpha: $0.0010\n" +
				"beta: $0.0010\n" +
				"прочее: $0.0010",
		);
	});

	it("keeps the default report and history free of the breakdown", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(1000, 3000, 0, 0.01));

		await command(extension, ctx);
		assert.match(notifications.at(-1).text, /^режим: /);
		assert.doesNotMatch(notifications.at(-1).text, /стоимость сессии:/);

		await command(extension, ctx, "history");
		assert.match(notifications.at(-1).text, /^история \(1\/8\):/);
		assert.doesNotMatch(notifications.at(-1).text, /стоимость сессии:/);
	});
});

describe("plugin settings", () => {
	const DEFAULTS = {
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

	it("normalizes numbers by rounding, clamping and falling back", () => {
		const config = normalizeConfig({
			statusEnabled: "yes",
			statusShowMode: false,
			warningsEnabled: null,
			lowHitPercent: 500,
			idleMinutes: 0,
			minPromptTokens: 499.4,
			historySize: 3.6,
			showMoney: "no",
		});
		assert.deepEqual(config, {
			preset: "balanced",
			statusEnabled: true,
			statusShowMode: false,
			statusShowCost: false,
			warningsEnabled: true,
			lowHitPercent: 100,
			idleMinutes: 1,
			minPromptTokens: 499,
			warnCanonicalMiss: true,
			minPrevPromptTokens: 2048,
			oncePerEpoch: true,
			historySize: 4,
			trendSize: 12,
			showMoney: true,
			language: "ru",
		});
	});

	it("accepts only ru and en for language", () => {
		assert.equal(normalizeConfig({ language: "en" }).language, "en");
		assert.equal(normalizeConfig({ language: "ru" }).language, "ru");
		assert.equal(normalizeConfig({ language: "de" }).language, "ru");
		assert.equal(normalizeConfig({ language: 1 }).language, "ru");
	});

	it("accepts CLI string values for booleans and numbers", () => {
		const config = normalizeConfig({
			statusShowCost: "true",
			warningsEnabled: "FALSE",
			lowHitPercent: "60",
			trendSize: "20",
			minPrevPromptTokens: "1024",
		});
		assert.equal(config.statusShowCost, true);
		assert.equal(config.warningsEnabled, false);
		assert.equal(config.lowHitPercent, 60);
		assert.equal(config.trendSize, 20);
		assert.equal(config.minPrevPromptTokens, 1024);

		// Валидная строка сильнее пресета; пустая и нечисловая — откат к пресету.
		const preset = normalizeConfig({ preset: "verbose", trendSize: "7" });
		assert.equal(preset.lowHitPercent, 60);
		assert.equal(preset.trendSize, 7);
		assert.equal(normalizeConfig({ preset: "verbose", trendSize: "" }).trendSize, 20);
		assert.equal(normalizeConfig({ preset: "verbose", trendSize: "abc" }).trendSize, 20);
		assert.equal(normalizeConfig({ preset: "verbose", oncePerEpoch: "yes" }).oncePerEpoch, false);
	});

	it("falls back to defaults for invalid values and shapes", () => {
		assert.deepEqual(normalizeConfig(undefined), DEFAULTS);
		assert.deepEqual(normalizeConfig("text"), DEFAULTS);
		assert.deepEqual(
			normalizeConfig({
				statusEnabled: 1,
				statusShowMode: "yes",
				warningsEnabled: "no",
				lowHitPercent: Number.NaN,
				idleMinutes: Number.POSITIVE_INFINITY,
				minPromptTokens: "many",
				historySize: null,
				showMoney: 0,
			}),
			DEFAULTS,
		);
	});

	it("does not publish a status when statusEnabled is false", async () => {
		const settings = { statusEnabled: false };
		const { extension, ctx, statuses } = await started({ settings });
		assert.equal(statuses.length, 0);

		await turn(extension, ctx, usage(1000, 3000, 0));
		assert.equal(statuses.length, 0);

		await fire(extension, "session_switch", ctx, { reason: "new" });
		assert.equal(statuses.length, 0);
	});

	it("omits the OMP_MODE prefix when statusShowMode is false", async () => {
		process.env.OMP_MODE = "cache-safe";
		const { extension, ctx, statuses } = await started({
			settings: { statusShowMode: false },
		});
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "↺ …" });

		await turn(extension, ctx, usage(1000, 3000, 0));
		assert.deepEqual(statuses.at(-1), { key: "cache-monitor", text: "↺ 75%" });
	});

	it("emits no warnings when warningsEnabled is false", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { warningsEnabled: false },
		});
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		await turn(extension, ctx, usage(0, 0, 5000), 2);
		assert.equal(notifications.length, 0);
	});

	it("uses lowHitPercent instead of a fixed 50%", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { lowHitPercent: 10 },
		});
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		// 25% is above the configured threshold: silent.
		await turn(extension, ctx, usage(3000, 1000, 0), 2);
		assert.equal(notifications.length, 0);

		// 5% is below 10%: warned.
		await turn(extension, ctx, usage(3800, 200, 0), 3);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].text, /hit 5%/);
	});

	it("uses idleMinutes for the miss cause", async () => {
		const START = 3_000_000;
		const { extension, ctx, notifications } = await started({
			settings: { idleMinutes: 1 },
		});
		await turn(extension, ctx, usage(0, 0, 5000), 1, START);
		await turn(extension, ctx, usage(0, 0, 5000), 2, START + 2 * 60_000);

		const miss = notifications.find((n) => /промах/.test(n.text));
		assert.ok(miss, "expected a canonical-miss warning");
		assert.match(miss.text, /причина: простой 2 мин\./);
	});

	it("uses minPromptTokens as the warning floor", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { minPromptTokens: 10000 },
		});
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		await turn(extension, ctx, usage(0, 0, 5000), 2);
		assert.equal(notifications.length, 0);
	});

	it("uses historySize for the live and restored windows", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { historySize: 3 },
		});
		for (let i = 1; i <= 5; i += 1) {
			await turn(extension, ctx, usage(1000 - i * 10, i * 10, 0), i);
		}

		await command(extension, ctx, "history");
		const lines = notifications.at(-1).text.split("\n");
		assert.equal(lines[0], "история (3/3):");
		assert.equal(lines.length, 4);
		assert.match(lines[1], /^1\. ↺ 3%/);
		assert.match(lines[3], /^3\. ↺ 5%/);

		const entries = [1, 2, 3, 4, 5].map((i) =>
			assistantEntry(usage(1000 - i * 10, i * 10, 0)),
		);
		const resumed = await started({
			settings: { historySize: 3 },
			entries,
			reason: "resume",
		});
		await command(resumed.extension, resumed.ctx, "history");
		assert.match(resumed.notifications.at(-1).text, /^история \(3\/3\):/);
	});

	it("hides saved and miss-premium money when showMoney is false", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { showMoney: false },
		});
		await turn(extension, ctx, usage(0, 0, 5000, 0.05), 1);
		await turn(extension, ctx, usage(3000, 1000, 0, 0.02), 2);

		await command(extension, ctx);
		const report = notifications.at(-1).text;
		assert.doesNotMatch(report, /saved/);
		assert.doesNotMatch(report, /miss premium[^·]*\$/);
		assert.match(report, /miss premium: 3000 tok/);
		assert.match(report, /сессия: \$0\.0700, ходов 2, ↺ 11\.1%, miss premium 3000 tok$/);

		await command(extension, ctx, "history");
		const history = notifications.at(-1).text;
		assert.doesNotMatch(history, /saved/);
		assert.doesNotMatch(history, /\$/);
		assert.match(history, /^2\. ↺ 25% · prompt 4000 · miss premium 3000 tok$/m);

		await command(extension, ctx, "costs");
		assert.match(notifications.at(-1).text, /^стоимость сессии: \$0\.0700$/m);
	});

	it("prints default settings with their source", async () => {
		const { extension, ctx, notifications } = await started();
		await command(extension, ctx, "settings");
		const out = notifications.at(-1).text;
		assert.equal(
			out,
			"⚙ настройки cache-monitor\n" +
				"🎛 Пресет\n" +
				"  preset: balanced (default) — набор значений\n" +
				"⚙ Статус\n" +
				"  statusEnabled: true (default) — ↺ N% в статус-строке\n" +
				"  statusShowMode: true (default) — префикс OMP_MODE\n" +
				"  statusShowCost: false (default) — стоимость хода отдельным сегментом\n" +
				"⚠️ Предупреждения\n" +
				"  warningsEnabled: true (default) — toast о промахах\n" +
				"  lowHitPercent: 50 (default) — порог низкого hit\n" +
				"  idleMinutes: 5 (default) — «простой N мин», не TTL\n" +
				"  minPromptTokens: 4000 (default) — не шуметь на мелких промптах\n" +
				"  warnCanonicalMiss: true (default) — warning о каноническом промахе\n" +
				"  minPrevPromptTokens: 2048 (default) — порог предыдущего промпта\n" +
				"  oncePerEpoch: true (default) — один warning за эпоху\n" +
				"📊 Отчёты\n" +
				"  historySize: 8 (default) — окно /cache-monitor history\n" +
				"  trendSize: 12 (default) — точек в спарклайне\n" +
				"  showMoney: true (default) — $ в saved/miss premium\n" +
				"  language: ru (default) — язык вывода\n" +
				"💵 цены модели: да\n" +
				"Изменить: omp plugin config set omp-cache-monitor <key> <value>",
		);
		assert.match(out, /^🎛 Пресет$/m);
		assert.match(out, /^⚙ Статус$/m);
		assert.match(out, /^⚠️ Предупреждения$/m);
		assert.match(out, /^📊 Отчёты$/m);
		assert.match(out, /— ↺ N% в статус-строке$/m);
		assert.match(out, /— \$ в saved\/miss premium$/m);
	});

	it("marks changed keys and reports missing model prices", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { lowHitPercent: 10, showMoney: false },
		});
		await command(extension, ctx, "setting");
		const out = notifications.at(-1).text;
		assert.match(out, /^  lowHitPercent: 10 \(changed\) — порог низкого hit$/m);
		assert.match(out, /^  showMoney: false \(changed\) — \$ в saved\/miss premium$/m);
		assert.match(out, /^  statusEnabled: true \(default\) — ↺ N% в статус-строке$/m);
		assert.match(out, /^💵 цены модели: да$/m);

		const noPrices = await started({
			model: { id: "model-a", provider: "test" },
			settings: {},
		});
		await command(noPrices.extension, noPrices.ctx, "settings");
		assert.match(noPrices.notifications.at(-1).text, /^💵 цены модели: нет$/m);
	});

	it("prints help with the commands and settings entry points", async () => {
		const { extension, ctx, notifications } = await started();
		await command(extension, ctx, "help");
		const out = notifications.at(-1).text;
		assert.match(out, /\/cache-monitor — отчёт; history — последние ходы; costs — разбивка денег\./);
		assert.match(out, /settings — настройки; help — эта справка\./);
		assert.match(out, /чем выше, тем дешевле/);
		assert.match(out, /Settings → Plugins → omp-cache-monitor/);
		assert.match(out, /omp plugin config/);
		assert.match(out, /docs\/omp-docs-map\.md/);
		assert.equal(out.split("\n").length, 8);

		await command(extension, ctx, "?");
		assert.equal(notifications.at(-1).text, out);
	});

	it("re-reads settings before a command", async () => {
		const settings = { lowHitPercent: 10 };
		const { extension, ctx, notifications } = await started({ settings });
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		await turn(extension, ctx, usage(3000, 1000, 0), 2);
		assert.equal(notifications.length, 0);

		settings.lowHitPercent = 6;
		await command(extension, ctx, "settings");
		assert.match(notifications.at(-1).text, /^  lowHitPercent: 6 \(changed\) — порог низкого hit$/m);

		await turn(extension, ctx, usage(3800, 200, 0), 3);
		assert.match(notifications.at(-1).text, /hit 5%/);
	});
});

describe("presets and advanced keys", () => {
	const BALANCED = {
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

	it("resolves each preset to its exact values", () => {
		assert.deepEqual(normalizeConfig({ preset: "balanced" }), BALANCED);
		assert.deepEqual(normalizeConfig({ preset: "quiet" }), {
			...BALANCED,
			preset: "quiet",
			statusShowMode: false,
			warningsEnabled: false,
			statusShowCost: false,
		});
		assert.deepEqual(normalizeConfig({ preset: "verbose" }), {
			...BALANCED,
			preset: "verbose",
			lowHitPercent: 60,
			idleMinutes: 3,
			minPromptTokens: 2000,
			historySize: 12,
			trendSize: 20,
			statusShowCost: true,
			minPrevPromptTokens: 1024,
			oncePerEpoch: false,
		});
		assert.deepEqual(normalizeConfig({ preset: "custom" }), { ...BALANCED, preset: "custom" });
	});

	it("falls back to balanced for missing or invalid presets", () => {
		assert.deepEqual(normalizeConfig({}), BALANCED);
		assert.deepEqual(normalizeConfig({ preset: "BALANCED" }), BALANCED);
		assert.deepEqual(normalizeConfig({ preset: "loud" }), BALANCED);
		assert.deepEqual(normalizeConfig({ preset: 1 }), BALANCED);
	});

	it("lets an explicit key beat the preset and an invalid key fall back to it", () => {
		assert.equal(
			normalizeConfig({ preset: "quiet", statusShowMode: true }).statusShowMode,
			true,
		);
		assert.equal(
			normalizeConfig({ preset: "quiet", statusShowMode: "yes" }).statusShowMode,
			false,
		);
		assert.equal(normalizeConfig({ preset: "verbose", trendSize: "20" }).trendSize, 20);
		assert.equal(
			normalizeConfig({ preset: "verbose", minPrevPromptTokens: Number.NaN })
				.minPrevPromptTokens,
			1024,
		);
		assert.equal(normalizeConfig({ preset: "verbose", language: "en" }).language, "en");
		assert.equal(normalizeConfig({ preset: "quiet", language: "de" }).language, "ru");
	});

	it("treats custom as defaults plus explicit keys", () => {
		assert.deepEqual(
			normalizeConfig({ preset: "custom", statusShowMode: false, trendSize: 4 }),
			{ ...BALANCED, preset: "custom", statusShowMode: false, trendSize: 4 },
		);
	});

	it("clamps and falls back for advanced numeric keys", () => {
		assert.equal(normalizeConfig({ trendSize: 999 }).trendSize, 50);
		assert.equal(normalizeConfig({ trendSize: 0 }).trendSize, 1);
		assert.equal(normalizeConfig({ minPrevPromptTokens: 2_000_000 }).minPrevPromptTokens, 1_000_000);
		assert.equal(normalizeConfig({ minPrevPromptTokens: -5 }).minPrevPromptTokens, 0);
		assert.equal(
			normalizeConfig({ preset: "verbose", minPrevPromptTokens: null }).minPrevPromptTokens,
			1024,
		);
	});

	it("disables only the canonical-miss toast with warnCanonicalMiss", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { warnCanonicalMiss: false },
		});
		await turn(extension, ctx, usage(0, 0, 5000), 1);
		await turn(extension, ctx, usage(0, 0, 5000), 2);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].text, /hit 0%/);
		assert.doesNotMatch(notifications[0].text, /промах/);
	});

	it("uses minPrevPromptTokens as the previous-prompt floor", async () => {
		const high = await started({ settings: { minPrevPromptTokens: 6000 } });
		await turn(high.extension, high.ctx, usage(0, 0, 5000), 1);
		await turn(high.extension, high.ctx, usage(0, 0, 5000), 2);
		assert.equal(high.notifications.filter((n) => /промах/.test(n.text)).length, 0);

		const low = await started({ settings: { minPrevPromptTokens: 1000 } });
		await turn(low.extension, low.ctx, usage(0, 0, 5000), 1);
		await turn(low.extension, low.ctx, usage(0, 0, 5000), 2);
		assert.equal(low.notifications.filter((n) => /промах/.test(n.text)).length, 1);
	});

	it("applies minPrevPromptTokens when restoring causes from the journal", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000), 1_000),
			assistantEntry(usage(0, 0, 5000), 2_000),
		];
		const restored = await started({ entries, reason: "resume" });
		await command(restored.extension, restored.ctx, "history");
		assert.match(restored.notifications.at(-1).text, /перезапись префикса/);

		const raised = await started({
			entries,
			reason: "resume",
			settings: { minPrevPromptTokens: 6000 },
		});
		await command(raised.extension, raised.ctx, "history");
		assert.doesNotMatch(raised.notifications.at(-1).text, /перезапись префикса/);
	});

	it("does not publish the cost key on session switch", async () => {
		const { extension, ctx, statuses } = await started({
			settings: { statusShowCost: true },
		});
		await turn(extension, ctx, usage(1000, 3000, 0, 0.0123));
		statuses.length = 0;
		await fire(extension, "session_switch", ctx, { reason: "resume" });
		assert.deepEqual(statuses, [{ key: "cache-monitor", text: "↺ …" }]);
	});

	it("warns once per epoch by default and on every turn with oncePerEpoch=false", async () => {
		const once = await started();
		for (let i = 1; i <= 3; i += 1) {
			await turn(once.extension, once.ctx, usage(0, 0, 5000), i);
		}
		assert.equal(once.notifications.filter((n) => /промах/.test(n.text)).length, 1);

		const every = await started({ settings: { oncePerEpoch: false } });
		for (let i = 1; i <= 3; i += 1) {
			await turn(every.extension, every.ctx, usage(0, 0, 5000), i);
		}
		assert.equal(every.notifications.filter((n) => /промах/.test(n.text)).length, 2);
	});

	it("uses trendSize for the live sparkline and trims on refresh", async () => {
		const settings = { trendSize: 5 };
		const { extension, ctx, notifications } = await started({ settings });
		for (let i = 1; i <= 7; i += 1) {
			await turn(extension, ctx, usage(1000 - i * 10, i * 10, 0), i);
		}
		await command(extension, ctx);
		assert.equal(spark(notifications.at(-1).text).length, 5);

		settings.trendSize = 2;
		await command(extension, ctx, "settings");
		await command(extension, ctx);
		assert.equal(spark(notifications.at(-1).text).length, 2);
	});

	it("uses trendSize when restoring from the journal", async () => {
		const entries = [1, 2, 3, 4, 5, 6, 7].map((i) =>
			assistantEntry(usage(1000 - i * 10, i * 10, 0)),
		);
		const { extension, ctx, notifications } = await started({
			settings: { trendSize: 3 },
			entries,
			reason: "resume",
		});
		await command(extension, ctx);
		assert.equal(spark(notifications.at(-1).text).length, 3);
	});

	it("publishes cost as a separate status key only when statusShowCost is on", async () => {
		const off = await started();
		await turn(off.extension, off.ctx, usage(1000, 3000, 0, 0.0123));
		assert.equal(off.statuses.filter((s) => s.key === "cache-monitor-cost").length, 0);
		assert.deepEqual(off.statuses.at(-1), { key: "cache-monitor", text: "↺ 75%" });

		const on = await started({ settings: { statusShowCost: true } });
		await turn(on.extension, on.ctx, usage(1000, 3000, 0, 0.0123));
		assert.deepEqual(on.statuses[0], { key: "cache-monitor", text: "↺ …" });
		assert.deepEqual(on.statuses.at(-2), { key: "cache-monitor", text: "↺ 75%" });
		assert.deepEqual(on.statuses.at(-1), { key: "cache-monitor-cost", text: "$0.0123" });
	});

	it("keeps cost out of the status when status is off or the agent is not main TUI", async () => {
		const disabled = await started({
			settings: { statusEnabled: false, statusShowCost: true },
		});
		await turn(disabled.extension, disabled.ctx, usage(1000, 3000, 0, 0.5));
		assert.equal(disabled.statuses.length, 0);

		const nonTui = await started({ mode: "json", settings: { statusShowCost: true } });
		await turn(nonTui.extension, nonTui.ctx, usage(1000, 3000, 0, 0.5));
		assert.equal(nonTui.statuses.length, 0);

		const sub = await started({ agentKind: "sub", settings: { statusShowCost: true } });
		await turn(sub.extension, sub.ctx, usage(1000, 3000, 0, 0.5));
		assert.equal(sub.statuses.length, 0);
	});

	it("prints all 15 settings rows, the preset group and the changed marker", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { preset: "quiet" },
		});
		await command(extension, ctx, "settings");
		const out = notifications.at(-1).text;
		const rows = out.split("\n").filter((line) => /^  \w+: /.test(line));
		assert.equal(rows.length, 15);
		assert.match(out, /^🎛 Пресет$/m);
		assert.match(out, /^  preset: quiet \(changed\) — набор значений$/m);
		assert.match(out, /^  statusShowMode: false \(default\) — префикс OMP_MODE$/m);
		assert.match(
			out,
			/^  statusShowCost: false \(default\) — стоимость хода отдельным сегментом$/m,
		);
		assert.match(
			out,
			/^  warnCanonicalMiss: true \(default\) — warning о каноническом промахе$/m,
		);
		assert.match(out, /^  minPrevPromptTokens: 2048 \(default\) — порог предыдущего промпта$/m);
		assert.match(out, /^  oncePerEpoch: true \(default\) — один warning за эпоху$/m);
		assert.match(out, /^  trendSize: 12 \(default\) — точек в спарклайне$/m);
	});
});

describe("english output", () => {
	const START = 4_000_000;
	const CYRILLIC = /[А-Яа-яЁё]/;

	it("renders the default report in English", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { language: "en" },
		});

		await command(extension, ctx);
		let out = notifications.at(-1).text;
		assert.equal(
			out,
			"mode: no preset · test/model-a · thinking high · turn: no data · " +
				"session: $0.0000, turns 0, ↺ n/a",
		);
		assert.doesNotMatch(out, CYRILLIC);

		await turn(extension, ctx, usage(1000, 3000, 0, 0.01));
		await command(extension, ctx);
		out = notifications.at(-1).text;
		assert.match(
			out,
			/turn: ↺ 75% · in 1000 · cacheRead 3000 · cacheWrite 0 · \$0\.0100 · saved \$0\.0081/,
		);
		assert.match(out, /trend: ▇/);
		assert.match(out, /session: \$0\.0100, turns 1, ↺ 75%, saved \$0\.0081$/);
		assert.doesNotMatch(out, CYRILLIC);
	});

	it("renders history headers, causes and the empty state in English", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { language: "en" },
		});
		await turn(extension, ctx, usage(0, 0, 5000), 1, START);
		await turn(extension, ctx, usage(0, 0, 5000), 2, START + 6 * 60_000);
		await turn(extension, ctx, usage(0, 0, 5000), 3, START + 7 * 60_000);

		await command(extension, ctx, "history");
		const out = notifications.at(-1).text;
		assert.equal(
			out,
			"history (3/8):\n" +
				"1. ↺ 0% · prompt 5000\n" +
				"2. ↺ 0% · prompt 5000 · miss premium $0.0135 (5000 tok) · idle 6 min\n" +
				"3. ↺ 0% · prompt 5000 · miss premium $0.0135 (5000 tok) · prefix rewrite",
		);
		assert.doesNotMatch(out, CYRILLIC);

		await fire(extension, "session_switch", ctx, { reason: "new" });
		await command(extension, ctx, "history");
		assert.equal(notifications.at(-1).text, "history: no data");
		assert.doesNotMatch(notifications.at(-1).text, CYRILLIC);
	});

	it("redraws stored miss causes when the language changes", async () => {
		const settings = { language: "ru" };
		const { extension, ctx, notifications } = await started({ settings });
		await turn(extension, ctx, usage(0, 0, 5000), 1, START);
		await turn(extension, ctx, usage(0, 0, 5000), 2, START + 6 * 60_000);

		await command(extension, ctx, "history");
		assert.match(notifications.at(-1).text, /· простой 6 мин/);

		settings.language = "en";
		await command(extension, ctx, "history");
		const out = notifications.at(-1).text;
		assert.match(out, /· idle 6 min/);
		assert.doesNotMatch(out, CYRILLIC);
	});

	it("renders costs labels and the empty state in English", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.05)),
			{ type: "compaction", usage: usage(0, 0, 0, 0.03) },
			{ type: "branch_summary", usage: usage(0, 0, 0, 0.01) },
			usageEntry(usage(0, 0, 0, 0.001), ""),
		];
		const { extension, ctx, notifications } = await started({
			settings: { language: "en" },
			entries,
			reason: "resume",
		});

		await command(extension, ctx, "costs");
		const out = notifications.at(-1).text;
		assert.equal(
			out,
			"session cost: $0.0910\n" +
				"dialog: $0.0500\n" +
				"compaction: $0.0300\n" +
				"branch: $0.0100\n" +
				"other: $0.0010",
		);
		assert.doesNotMatch(out, CYRILLIC);

		const empty = await started({ settings: { language: "en" } });
		await command(empty.extension, empty.ctx, "costs");
		assert.equal(empty.notifications.at(-1).text, "cost: no data");
		assert.doesNotMatch(empty.notifications.at(-1).text, CYRILLIC);
	});

	it("prints settings in English", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { language: "en" },
		});
		await command(extension, ctx, "settings");
		const out = notifications.at(-1).text;
		assert.equal(
			out,
			"⚙ cache-monitor settings\n" +
				"🎛 Preset\n" +
				"  preset: balanced (default) — value bundle\n" +
				"⚙ Status\n" +
				"  statusEnabled: true (default) — ↺ N% in the status line\n" +
				"  statusShowMode: true (default) — OMP_MODE prefix\n" +
				"  statusShowCost: false (default) — turn cost as a separate segment\n" +
				"⚠️ Warnings\n" +
				"  warningsEnabled: true (default) — miss warning toasts\n" +
				"  lowHitPercent: 50 (default) — low-hit threshold\n" +
				'  idleMinutes: 5 (default) — "idle N min", not TTL\n' +
				"  minPromptTokens: 4000 (default) — skip small prompts\n" +
				"  warnCanonicalMiss: true (default) — canonical-miss warning\n" +
				"  minPrevPromptTokens: 2048 (default) — previous-prompt floor\n" +
				"  oncePerEpoch: true (default) — one warning per epoch\n" +
				"📊 Reports\n" +
				"  historySize: 8 (default) — /cache-monitor history window\n" +
				"  trendSize: 12 (default) — sparkline points\n" +
				"  showMoney: true (default) — $ in saved/miss premium\n" +
				"  language: en (changed) — output language\n" +
				"💵 model prices: yes\n" +
				"Change: omp plugin config set omp-cache-monitor <key> <value>",
		);
		assert.doesNotMatch(out, CYRILLIC);
	});

	it("prints help in English", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { language: "en" },
		});
		await command(extension, ctx, "help");
		const out = notifications.at(-1).text;
		assert.equal(
			out,
			"cache-monitor — prefix-cache hit rate.\n" +
				"↺ N% — share of the prompt read from cache; higher is cheaper. ↺ … before the first turn, n/a with no denominator.\n" +
				"Miss — cacheRead 0; cause is in warnings and history, re-billing in the report and history.\n" +
				"/cache-monitor — report; history — recent turns; costs — cost breakdown.\n" +
				"settings — current settings; help — this help.\n" +
				"Settings: Settings → Plugins → omp-cache-monitor or omp plugin config set omp-cache-monitor <key> <value>.\n" +
				"Applied to new sessions; settings re-reads immediately.\n" +
				"Docs: README.md, docs/ui-settings.md, docs/omp-docs-map.md.",
		);
		assert.doesNotMatch(out, CYRILLIC);

		await command(extension, ctx, "?");
		assert.equal(notifications.at(-1).text, out);
	});

	it("prints both warnings in English", async () => {
		const { extension, ctx, notifications } = await started({
			settings: { language: "en" },
		});
		await turn(extension, ctx, usage(0, 0, 5000), 1, START);
		await turn(extension, ctx, usage(0, 0, 5000), 2, START + 6 * 60_000);

		const texts = notifications.map((n) => n.text);
		assert.equal(
			texts[0],
			"Prefix cache: miss (cacheRead 0, cacheWrite 5000, prompt 5000) — " +
				"cause: idle 6 min. Re-billed ≈ 5000 tok ($0.0135).\n" +
				"Settings: /cache-monitor settings (or Settings → Plugins → omp-cache-monitor). " +
				"preset is a value bundle: balanced, quiet, verbose, custom.",
		);
		assert.equal(
			texts[1],
			"Prefix cache: hit 0% (input 0, cacheRead 0, cacheWrite 5000, prompt 5000). " +
				"Prefix changed or cache is not being read — check model, thinking, mode and MCP.",
		);
		assert.equal(texts.length, 2);
		for (const text of texts) assert.doesNotMatch(text, CYRILLIC);
	});
});
