#!/usr/bin/env -S node --experimental-strip-types
/**
 * `omp-cache-monitor costs --json` — read-only session cost report.
 *
 * Thin argv/stdout layer over `lib/costs.ts`: one JSON document on stdout and
 * nothing else. Exit codes are part of the contract: 0 ok, 1 no or unreadable
 * session, 2 bad arguments. No network, no writes.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";

import {
	buildCostsReport,
	cacheHitPercent,
	latestSessionFile,
	parseIsoTimestamp,
	sessionsDirectory,
} from "../lib/costs.ts";

const USAGE = `Usage: omp-cache-monitor costs --json [--session FILE] [--since ISO8601]

Read-only report of an OMP session (schemaVersion 1): assistant turns,
provider costs, cache-hit share per turn and per model, and notes.

Options:
  --json             print the JSON contract (schemaVersion 1)
  --session FILE     session JSONL; default: newest in OMP_SESSIONS_DIR
                     or ~/.omp/agent/sessions
  --since ISO8601    keep turns at or after the timestamp
  -h, --help         this help

Exit codes: 0 ok, 1 no/unreadable session, 2 bad arguments.
`;

function fail(message, code) {
	process.stderr.write(`omp-cache-monitor: ${message}\n`);
	return code;
}

/** `--flag value` and `--flag=value`; `null` when the value is missing. */
function optionValue(argv, index, name) {
	const argument = argv[index] ?? "";
	const prefix = `${name}=`;
	if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), next: index };
	const value = argv[index + 1];
	// A following flag is a forgotten value, not a file name.
	if (value === undefined || value.startsWith("--")) return null;
	return { value, next: index + 1 };
}

function humanReport(report) {
	const { totals } = report;
	const cost =
		totals.costUsd === null ? "n/a" : `$${totals.costUsd.toFixed(4)}`;
	const hit = cacheHitPercent(totals.inputTokens, totals.cacheReadTokens);
	const hitText = hit === null ? "n/a" : `${hit}%`;
	return [
		`session: ${report.session}`,
		`turns: ${report.turns.length}`,
		`cost: ${cost}`,
		`cache hit: ${hitText}`,
		"",
	].join("\n");
}

function main(argv) {
	if (argv.length === 0) {
		process.stderr.write(USAGE);
		return 2;
	}
	if (argv[0] === "-h" || argv[0] === "--help") {
		process.stdout.write(USAGE);
		return 0;
	}
	if (argv[0] !== "costs") {
		process.stderr.write(`omp-cache-monitor: unknown command: ${argv[0]}\n${USAGE}`);
		return 2;
	}

	let json = false;
	let session = null;
	let since = null;
	for (let index = 1; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "-h" || argument === "--help") {
			process.stdout.write(USAGE);
			return 0;
		}
		if (argument === "--json") {
			json = true;
			continue;
		}
		if (argument === "--session" || argument.startsWith("--session=")) {
			const parsed = optionValue(argv, index, "--session");
			if (parsed === null || parsed.value.length === 0) {
				return fail("--session needs a file path", 2);
			}
			session = parsed.value;
			index = parsed.next;
			continue;
		}
		if (argument === "--since" || argument.startsWith("--since=")) {
			const parsed = optionValue(argv, index, "--since");
			if (parsed === null || parseIsoTimestamp(parsed.value) === null) {
				return fail(`invalid --since (ISO-8601 expected): ${parsed?.value ?? ""}`, 2);
			}
			since = parsed.value;
			index = parsed.next;
			continue;
		}
		return fail(`unknown argument: ${argument}`, 2);
	}

	let sessionPath;
	if (session === null) {
		const directory = sessionsDirectory();
		const latest = latestSessionFile(directory);
		if (latest === null) {
			return fail(`no session files in ${directory}`, 1);
		}
		sessionPath = latest;
	} else {
		sessionPath = resolve(session);
		let stats;
		try {
			stats = statSync(sessionPath);
		} catch {
			return fail(`cannot read session: ${sessionPath}`, 1);
		}
		if (!stats.isFile()) return fail(`not a file: ${sessionPath}`, 1);
	}

	let report;
	try {
		report = buildCostsReport(sessionPath, { since });
	} catch (error) {
		return fail(
			`cannot read session: ${sessionPath} (${error instanceof Error ? error.message : String(error)})`,
			1,
		);
	}

	process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : humanReport(report));
	return 0;
}

process.exitCode = main(process.argv.slice(2));
