/**
 * CLI contract of `omp-cache-monitor costs --json` (schemaVersion 1).
 *
 * Every case runs the real `bin/omp-cache-monitor.mjs` as a child process:
 * argv in, exit code / stdout / stderr out. Fixtures are temporary session
 * JSONL files; nothing here imports the parser directly.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/omp-cache-monitor.mjs", import.meta.url));

/** ISO timestamp with a fixed minute; the hour is fixed for readability. */
function at(minute) {
	return `2026-11-26T11:${String(minute).padStart(2, "0")}:00.000Z`;
}

/** Assistant journal entry; `cost: undefined` omits the provider price. */
function assistant({
	at: timestamp = at(0),
	model = "model-a",
	input = 1000,
	cacheRead = 0,
	cacheWrite = 0,
	output = 100,
	reasoning = 0,
	cost,
} = {}) {
	const entryUsage = {
		input,
		cacheRead,
		cacheWrite,
		output,
		reasoningTokens: reasoning,
	};
	if (cost !== undefined) entryUsage.cost = { total: cost };
	return {
		type: "message",
		timestamp,
		message: { role: "assistant", model, usage: entryUsage },
	};
}

function user(text = "hi") {
	return {
		type: "message",
		timestamp: at(0),
		message: { role: "user", content: text },
	};
}

function writeSession(dir, entries, name = "session.jsonl") {
	const file = join(dir, name);
	const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
	writeFileSync(file, `${body}\n`);
	return file;
}

function run(args, env = {}) {
	return spawnSync(process.execPath, ["--experimental-strip-types", BIN, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 30_000,
	});
}

/** Exit 0, empty stderr, one parseable JSON document. */
function expectJson(result) {
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
	return JSON.parse(result.stdout);
}

describe("costs --json CLI", () => {
	let dir;
	before(() => {
		dir = mkdtempSync(join(tmpdir(), "omp-cache-monitor-costs-"));
	});
	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("prints one JSON document with schemaVersion 1 and turns in journal order", () => {
		const file = writeSession(dir, [
			user(),
			assistant({ at: at(1), cost: 0.0027 }),
			assistant({ at: at(2), input: 500, cacheRead: 500, cost: 0.5 }),
		]);
		const result = run(["costs", "--json", "--session", file]);
		const report = expectJson(result);
		assert.equal(report.schemaVersion, 1);
		assert.equal(report.session, file);
		assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		assert.deepEqual(
			report.turns.map((turn) => turn.at),
			[at(1), at(2)],
		);
		assert.ok(Math.abs(report.totals.costUsd - 0.5027) < 1e-12);
		assert.equal(report.totals.inputTokens, 1500);
		assert.equal(report.totals.cacheReadTokens, 500);
		assert.equal(report.totals.outputTokens, 200);
	});

	it("computes hitPercent from input + cacheRead only, null without a denominator", () => {
		const file = writeSession(dir, [
			assistant({ at: at(1), input: 100, cacheRead: 100, cacheWrite: 800 }),
			assistant({ at: at(2), input: 0, cacheRead: 0 }),
			assistant({ at: at(3), input: 3, cacheRead: 1 }),
		]);
		const report = expectJson(run(["costs", "--json", "--session", file]));
		assert.equal(report.turns[0].hitPercent, 50);
		assert.equal(report.turns[1].hitPercent, null);
		assert.equal(report.turns[2].hitPercent, 25);
	});

	it("keeps an absent provider price as null with a note, never as zero", () => {
		const file = writeSession(dir, [
			assistant({ at: at(1), cost: 1 }),
			assistant({ at: at(2) }),
		]);
		const report = expectJson(run(["costs", "--json", "--session", file]));
		assert.equal(report.turns[0].costUsd, 1);
		assert.equal(report.turns[1].costUsd, null);
		assert.equal(report.totals.costUsd, 1);
		assert.deepEqual(report.notes, ["cost missing"]);
		assert.equal(report.models[0].costUsd, 1);
	});

	it("reports totals.costUsd as null when no turn carries a price", () => {
		const file = writeSession(dir, [assistant({ at: at(1) })]);
		const report = expectJson(run(["costs", "--json", "--session", file]));
		assert.equal(report.totals.costUsd, null);
		assert.equal(report.models[0].costUsd, null);
	});

	it("aggregates models by name, including a null-model group", () => {
		const file = writeSession(dir, [
			assistant({ at: at(1), model: "model-a", cost: 0.1 }),
			assistant({ at: at(2), model: "model-b", cost: 0.2 }),
			assistant({ at: at(3), model: "model-a", cacheRead: 1000, cost: 0.05 }),
			assistant({ at: at(4), model: null, input: 0 }),
		]);
		const report = expectJson(run(["costs", "--json", "--session", file]));
		assert.deepEqual(
			report.models.map((model) => model.model),
			["model-a", "model-b", null],
		);
		assert.deepEqual(report.models[0], {
			model: "model-a",
			turns: 2,
			costUsd: 0.15000000000000002,
			hitPercent: 33.3,
		});
		assert.equal(report.models[1].turns, 1);
		assert.equal(report.models[2].turns, 1);
		assert.equal(report.models[2].hitPercent, null);
	});

	it("--since filters turns, totals and models but keeps the session path", () => {
		const file = writeSession(dir, [
			assistant({ at: at(0), cost: 1, model: "old" }),
			assistant({ at: at(30), cost: 2, model: "new" }),
		]);
		const report = expectJson(
			run(["costs", "--json", "--session", file, "--since", at(10)]),
		);
		assert.equal(report.session, file);
		assert.equal(report.turns.length, 1);
		assert.equal(report.turns[0].model, "new");
		assert.equal(report.totals.costUsd, 2);
		assert.deepEqual(
			report.models.map((model) => model.model),
			["new"],
		);
	});

	it("accepts an empty file as a valid empty report", () => {
		const file = join(dir, "empty.jsonl");
		writeFileSync(file, "");
		const result = run(["costs", "--json", "--session", file]);
		const report = expectJson(result);
		assert.deepEqual(report.turns, []);
		assert.deepEqual(report.models, []);
		assert.deepEqual(report.notes, []);
		assert.deepEqual(report.totals, {
			costUsd: null,
			inputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 0,
			reasoningTokens: 0,
		});
	});

	it("exits 1 without JSON when the given session file is missing", () => {
		const missing = join(dir, "does-not-exist.jsonl");
		const result = run(["costs", "--json", "--session", missing]);
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /cannot read session/);
		assert.ok(result.stderr.includes(missing));
	});

	it("exits 2 on an invalid --since, unknown flag or missing command", () => {
		const file = writeSession(dir, [assistant({ cost: 1 })]);
		for (const args of [
			["costs", "--json", "--session", file, "--since", "yesterday"],
			["costs", "--json", "--session", file, "--since", "2026-11-26"],
			["costs", "--json", "--session", file, "--bogus"],
			["costs", "--session"],
			[],
			["wat"],
		]) {
			const result = run(args);
			assert.equal(result.status, 2, `argv: ${args.join(" ")}`);
			assert.equal(result.stdout, "");
			assert.notEqual(result.stderr, "");
		}
	});

	it("finds the newest session under OMP_SESSIONS_DIR and ignores changes.jsonl", () => {
		const root = join(dir, "sessions");
		const older = join(root, "project-old");
		const newer = join(root, "project-new");
		const nested = join(newer, "nested");
		mkdirSync(older, { recursive: true });
		mkdirSync(nested, { recursive: true });

		const rootFile = join(root, "root.jsonl");
		writeFileSync(rootFile, `${JSON.stringify(assistant({ cost: 1 }))}\n`);
		const oldFile = writeSession(older, [assistant({ cost: 2 })], "old.jsonl");
		const newFile = writeSession(newer, [assistant({ cost: 3 })], "new.jsonl");
		const changes = join(older, "changes.jsonl");
		writeFileSync(changes, "{}\n");
		const deep = writeSession(nested, [assistant({ cost: 4 })], "deep.jsonl");

		const stamp = (file, seconds) => {
			const time = new Date(1_700_000_000_000 + seconds * 1000);
			utimesSync(file, time, time);
		};
		stamp(rootFile, 1);
		stamp(oldFile, 2);
		stamp(newFile, 3);
		stamp(changes, 4);
		stamp(deep, 5);

		const report = expectJson(
			run(["costs", "--json"], { OMP_SESSIONS_DIR: root }),
		);
		assert.equal(report.session, newFile);
		assert.equal(report.totals.costUsd, 3);
	});

	it("exits 1 when OMP_SESSIONS_DIR has no session files", () => {
		const empty = join(dir, "no-sessions");
		mkdirSync(empty, { recursive: true });
		const result = run(["costs", "--json"], { OMP_SESSIONS_DIR: empty });
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /no session files/);
	});

	it("does not count model_usage service calls", () => {
		const file = writeSession(dir, [
			assistant({ at: at(1), cost: 0.1 }),
			{
				type: "model_usage",
				timestamp: at(2),
				purpose: "compaction",
				usage: { input: 5000, cacheRead: 0, cost: { total: 9 } },
			},
		]);
		const report = expectJson(run(["costs", "--json", "--session", file]));
		assert.equal(report.turns.length, 1);
		assert.equal(report.totals.costUsd, 0.1);
		assert.equal(report.totals.inputTokens, 1000);
	});

	it("ignores unknown fields and unparseable lines", () => {
		const entry = assistant({ at: at(1), cost: 0.1 });
		entry.extra = { nested: true };
		entry.message.extra = "kept-out";
		entry.message.usage.extraTokens = 42;
		const file = join(dir, "unknown.jsonl");
		writeFileSync(file, `not json\n${JSON.stringify(entry)}\n{}\n`);
		const result = run(["costs", "--json", "--session", file]);
		const report = expectJson(result);
		assert.equal(report.turns.length, 1);
		assert.equal(report.turns[0].inputTokens, 1000);
		assert.equal(report.totals.costUsd, 0.1);
	});

	it("notes cold prefixes, model switches and cache writes deterministically", () => {
		const file = writeSession(dir, [
			assistant({ at: at(0), model: "model-a", cacheRead: 500, cost: 0.1 }),
			assistant({ at: at(1), model: "model-a", cacheRead: 0, cost: 0.1 }),
			assistant({ at: at(2), model: "model-a", cacheRead: 0, cost: 0.1 }),
			assistant({
				at: at(3),
				model: "model-b",
				cacheRead: 0,
				cacheWrite: 1000,
				cost: 0.1,
			}),
		]);
		const report = expectJson(run(["costs", "--json", "--session", file]));
		assert.deepEqual(report.notes, [
			"cold prefix",
			"cold prefix after model switch",
			"cacheWrite > 0",
		]);
	});

	it("skips a turn without a timestamp and notes it", () => {
		const broken = assistant({ at: at(0), cost: 1 });
		delete broken.timestamp;
		const file = writeSession(dir, [broken, assistant({ at: at(1), cost: 2 })]);
		const report = expectJson(run(["costs", "--json", "--session", file]));
		assert.equal(report.turns.length, 1);
		assert.equal(report.totals.costUsd, 2);
		assert.deepEqual(report.notes, ["timestamp missing: turn skipped"]);
	});

	it("accepts --session=FILE and prints a human summary without --json", () => {
		const file = writeSession(dir, [
			assistant({ at: at(1), cost: 0.25 }),
			assistant({ at: at(2), input: 100, cacheRead: 900 }),
		]);
		const result = run(["costs", `--session=${file}`]);
		assert.equal(result.status, 0);
		assert.equal(result.stderr, "");
		assert.match(result.stdout, /^session: /);
		assert.match(result.stdout, /turns: 2\n/);
		assert.match(result.stdout, /cost: \$0\.2500\n/);
		assert.match(result.stdout, /cache hit: 45%\n/);
	});

	it("is executable and runs through its own shebang", () => {
		const source = readFileSync(BIN, "utf8");
		assert.equal(
			source.split("\n")[0],
			"#!/usr/bin/env -S node --experimental-strip-types",
		);
		assert.notEqual(statSync(BIN).mode & 0o111, 0);
		const file = writeSession(dir, [assistant({ at: at(1), cost: 0.5 })]);
		const result = spawnSync(BIN, ["costs", "--json", "--session", file], {
			encoding: "utf8",
			env: process.env,
			timeout: 30_000,
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.equal(JSON.parse(result.stdout).totals.costUsd, 0.5);
	});
});
