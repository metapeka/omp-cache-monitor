/**
 * Deterministic harness for index.ts: no network, no model, no OMP runtime.
 *
 * The real extension is imported (Node 22 strips the type-only import), the
 * `pi` registration surface and the `ctx` passed to every handler are faked,
 * and events are fired in the same order OMP fires them.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import cacheMonitor from "../index.ts";

const MODEL = {
	id: "model-a",
	provider: "test",
	cost: { input: 3, cacheRead: 0.3 },
};

/** Faked `pi`: records handlers/commands, exposes mutable tools and thinking. */
function install() {
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
	cacheMonitor(pi);
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

async function turn(extension, ctx, turnUsage, turnIndex = 1) {
	await fire(extension, "turn_end", ctx, { message: { usage: turnUsage }, turnIndex });
}

async function command(extension, ctx) {
	const definition = extension.commands.get("cache-monitor");
	assert.ok(definition, "expected /cache-monitor to be registered");
	await definition.handler(undefined, ctx);
}

function spark(text) {
	const match = /тренд: (\S+)/.exec(text);
	return match ? match[1] : null;
}

/** Journal entry for an assistant turn (the fixture shape `getEntries()` returns). */
function assistantEntry(turnUsage) {
	return {
		type: "message",
		message: { role: "assistant", provider: "test", model: "model-a", usage: turnUsage },
	};
}

/** Journal entry for off-transcript usage, e.g. cache warming. */
function usageEntry(turnUsage, kind = "cache_warm") {
	return { type: "usage", kind, usage: turnUsage };
}

async function started({ mode, agentKind, model, ui, entries = [], reason = "startup" } = {}) {
	const extension = install();
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
			/ход: ↺ 75% · in 1000 · cacheRead 3000 · cacheWrite 0 · \$0\.0100/,
		);
		assert.match(out.text, /сессия: \$0\.0100, ходов 1, ↺ 75%/);
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
		assert.match(out, /пере-оплата: 3000 tok \(\$0\.0081\)/);
		assert.match(
			out,
			/сессия: \$0\.0700, ходов 2, ↺ 11\.1%, мисс 3000 tok \(\$0\.0081\)/,
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
		assert.match(out, /пере-оплата: 3000 tok ·/);
		assert.match(
			out,
			/сессия: \$0\.0900, ходов 3, ↺ 15\.4%, мисс 6000 tok \(≥\$0\.0081\)/,
		);
	});

	it("does not count a miss when the prefix was fully cached", async () => {
		const { extension, ctx, notifications } = await started();
		await turn(extension, ctx, usage(0, 0, 5000, 0.05));
		await turn(extension, ctx, usage(0, 5000, 0, 0.02));

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(out, /ход: ↺ 100%/);
		assert.doesNotMatch(out, /пере-оплата/);
		assert.doesNotMatch(out, /мисс/);
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
		assert.doesNotMatch(fresh, /пере-оплата/);
		assert.doesNotMatch(fresh, /мисс/);
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
	it("restores totals, trend, last turn and re-billed tokens from the journal", async () => {
		const entries = [
			assistantEntry(usage(0, 0, 5000, 0.05)),
			assistantEntry(usage(3000, 1000, 0, 0.02)),
			usageEntry(usage(100, 200, 0, 0.001)),
			{ type: "compaction", usage: usage(0, 300, 0, 0.002) },
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(
			out,
			/ход: ↺ 25% · in 3000 · cacheRead 1000 · cacheWrite 0 · \$0\.0200/,
		);
		// The journal has no historical prices: tokens restore, money is omitted.
		assert.match(out, /пере-оплата: 3000 tok/);
		assert.doesNotMatch(out, /\$0\.0081/);
		assert.equal(spark(out), "▁▃");
		assert.match(
			out,
			/сессия: \$0\.0730, ходов 2, ↺ 15\.6%, мисс 3000 tok$/,
		);
	});

	it("counts cache warming and compaction usage in totals but not turns or trend", async () => {
		const entries = [
			assistantEntry(usage(0, 100, 0, 0.01)),
			usageEntry(usage(500, 500, 0, 0.02)),
			{ type: "branch_summary", usage: usage(0, 0, 200, 0.03) },
			{ type: "compaction", usage: usage(100, 0, 0, 0.04) },
		];
		const { extension, ctx, notifications } = await started({ entries, reason: "resume" });

		await command(extension, ctx);
		const out = notifications.at(-1).text;
		assert.match(out, /сессия: \$0\.1000, ходов 1, ↺ 42\.9%/);
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
		assert.match(out, /сессия: \$0\.2000, ходов 4, ↺ 0%, мисс 5000 tok/);
		assert.doesNotMatch(out, /пере-оплата/);
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
