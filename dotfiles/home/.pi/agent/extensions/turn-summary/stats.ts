/**
 * Round timing, derived from the session log.
 *
 * Pi records two durations and nothing else: `AssistantMessage.durationMs`
 * (request start to end of stream, set in pi-ai's event stream) and
 * `ToolResultMessage.durationMs` (one `execute()`, set in pi-agent-core's
 * loop). The wall clock of a whole prompt is not stored, so it is rebuilt here:
 * a round starts at the user entry and ends at the last entry before the next
 * prompt. The difference to `model + tools` is queueing, rendering, compaction
 * and similar overhead, which is why the total is reported next to the parts.
 *
 * Everything is derived from `SessionManager.getEntries()` instead of being
 * accumulated while the turn runs, so a transcript rebuilt from disk (reload,
 * `/tree`, compaction, a different terminal width) shows exactly the numbers
 * the live session showed.
 */

interface EntryMessage {
	role?: string;
	timestamp?: number;
	durationMs?: number;
	stopReason?: string;
}

/** The subset of a session entry the timing walks. */
export interface StatsEntry {
	id?: string;
	type?: string;
	timestamp?: string;
	message?: EntryMessage;
}

/** Worst stop reason seen in a round; `ok` means every reply ended normally. */
export type RoundOutcome = "ok" | "aborted" | "error";

export interface RoundStats {
	/** Prompt to last entry, when both ends carry a usable timestamp. */
	wallMs?: number;
	/** Summed provider latency of every assistant reply in the round. */
	llmMs: number;
	/** Summed tool `execute()` time. */
	toolsMs: number;
	/** Tool results seen, including ones without a recorded duration. */
	toolCalls: number;
	/** Assistant replies in the round. */
	replies: number;
	outcome: RoundOutcome;
}

export interface RoundLookup {
	stats: RoundStats;
	/** Only the reply that ends the round carries the footer. */
	isFinal: boolean;
}

function entryTime(entry: StatsEntry): number | undefined {
	if (entry.timestamp) {
		const parsed = Date.parse(entry.timestamp);
		if (Number.isFinite(parsed)) return parsed;
	}
	const own = entry.message?.timestamp;
	return typeof own === "number" && Number.isFinite(own) ? own : undefined;
}

/**
 * Map every assistant message timestamp to the timing of its round.
 *
 * Keyed by `AssistantMessage.timestamp` rather than the entry id because the
 * component of a message that is still streaming was built without an id: the
 * message object it holds is the same object the session logged, so the
 * timestamp matches on both the live and the rebuilt path.
 */
export function indexRounds(entries: readonly StatsEntry[]): Map<number, RoundLookup> {
	const rounds = new Map<number, RoundLookup>();

	let index = 0;
	while (index < entries.length) {
		const first = entries[index];
		if (first?.type !== "message" || first.message?.role !== "user") {
			index++;
			continue;
		}

		const start = entryTime(first);
		const replies: number[] = [];
		let llmMs = 0;
		let toolsMs = 0;
		let toolCalls = 0;
		let outcome: RoundOutcome = "ok";
		let end = start;

		let next = index + 1;
		for (; next < entries.length; next++) {
			const entry = entries[next];
			if (entry?.type === "message" && entry.message?.role === "user") break;
			if (entry?.type !== "message") continue;

			const message = entry.message ?? {};
			const at = entryTime(entry);
			if (at !== undefined) end = end === undefined ? at : Math.max(end, at);

			if (message.role === "assistant") {
				if (typeof message.durationMs === "number") llmMs += message.durationMs;
				if (typeof message.timestamp === "number") replies.push(message.timestamp);
				if (message.stopReason === "error") outcome = "error";
				else if (message.stopReason === "aborted" && outcome === "ok") outcome = "aborted";
			} else if (message.role === "toolResult") {
				toolCalls++;
				if (typeof message.durationMs === "number") toolsMs += message.durationMs;
			}
		}

		const stats: RoundStats = { llmMs, toolsMs, toolCalls, replies: replies.length, outcome };
		if (start !== undefined && end !== undefined && end >= start) stats.wallMs = end - start;
		replies.forEach((timestamp, position) => {
			rounds.set(timestamp, { stats, isFinal: position === replies.length - 1 });
		});

		index = next;
	}

	return rounds;
}

/**
 * Same shape and rounding as the tool timer pi prints in the transcript
 * (`formatToolDuration`): whole seconds below a minute, then `1m 30s` and
 * `2h 3m 4s`. Sub-second remainders are dropped, so a fast step reads `0s`
 * instead of `0.4s`, and anything below one second is `<1s`.
 */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(Math.max(0, ms) / 1000));
	if (total === 0) return ms > 0 ? "<1s" : "0s";
	if (total < 60) return `${total}s`;

	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	if (minutes < 60) return `${minutes}m ${seconds}s`;

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds}s`;
}

export interface SummaryConfig {
	/** Spell out `= model ... + tools ...` behind the total. */
	breakdown: boolean;
}

/**
 * Slack allowed between the wall clock and the work it contains before a round
 * counts as resumed: queueing, rendering and compaction fit well inside it.
 */
const IDLE_LIMIT_MS = 120_000;

/**
 * `took 1m 1s (model 58s + tools 2s, 12 calls)` — the total, then what it is
 * made of in parentheses. Every label says what it measures, so the line needs
 * no legend.
 *
 * Variants are tried from most to least detailed until one fits `maxWidth`: with
 * the call count, without it, without the split, then the total alone. A round
 * that spans a resumed session (a prompt answered minutes or days later) would
 * otherwise print a wall clock like `168h 11m`, so its total falls back to the
 * busy time, which keeps the parenthetical honest.
 */
export function turnSummary(
	stats: RoundStats,
	config: SummaryConfig,
	maxWidth = Number.POSITIVE_INFINITY,
): string {
	const busyMs = stats.llmMs + stats.toolsMs;
	const resumed = stats.wallMs !== undefined && stats.wallMs > busyMs + IDLE_LIMIT_MS + busyMs * 4;
	const totalMs = stats.wallMs === undefined || resumed ? busyMs : stats.wallMs;

	const head = `took ${formatDuration(totalMs)}`;
	const outcome = stats.outcome === "ok" ? "" : stats.outcome;

	const parts: Array<{ label: string; ms: number }> = [];
	if (config.breakdown) {
		if (stats.replies > 0 && stats.llmMs > 0) parts.push({ label: "model", ms: stats.llmMs });
		if (stats.toolCalls > 0) parts.push({ label: "tools", ms: stats.toolsMs });
	}

	// A lone `model` part is left out when it is the whole story; when the total
	// is larger than the parts, the split stays so the gap is visible.
	const accounted = parts.reduce((sum, part) => sum + part.ms, 0);
	const detailed = parts.length > 1 || (parts.length === 1 && Math.abs(totalMs - accounted) > 1000);
	const equation = detailed
		? parts.map((part) => `${part.label} ${formatDuration(part.ms)}`).join(" + ")
		: "";
	const calls = parts.some((part) => part.label === "tools")
		? `${stats.toolCalls} ${stats.toolCalls === 1 ? "call" : "calls"}`
		: "";

	const variants: string[] = [];
	if (equation || calls) {
		variants.push(`${head} (${[equation, calls, outcome].filter(Boolean).join(", ")})`);
	}
	if (equation) variants.push(`${head} (${[equation, outcome].filter(Boolean).join(", ")})`);
	if (outcome) variants.push(`${head}, ${outcome}`);
	variants.push(head);

	for (const variant of variants) if (variant.length <= maxWidth) return variant;
	return head;
}
