/**
 * One-line descriptions of a tool call: its arguments, what it produced, how
 * long it took, and the summary of a whole group of calls.
 *
 * Pure string work — no components and no pi state — so a row can be built on
 * every frame and tested without a terminal.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { highlightBashCommand } from "./bash-highlighter.ts";

export type ColorTheme = {
	fg(color: string, text: string): string;
	italic?(text: string): string;
};

/** Display names are capitalized; the tool registry still uses the raw name. */
export function displayToolName(name: string | undefined): string {
	const raw = name || "tool";
	return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function italicText(theme: ColorTheme, text: string): string {
	const styled = theme.italic?.(text);
	return styled && styled !== text ? styled : `\x1b[3m${text}\x1b[23m`;
}

export type ToolStatus = "running" | "success" | "error";

export interface ToolResultLike {
	isError?: boolean;
	durationMs?: number;
	content?: unknown;
	details?: unknown;
}

export interface ToolLike {
	toolName?: string;
	args?: unknown;
	result?: ToolResultLike;
}

export interface GroupSummary {
	count: number;
	/** Thinking runs counted in the group. */
	thoughts: number;
	/** A thinking run in the group is still arriving. */
	thinkingLive: boolean;
	/** Per-tool counts, most frequent first, ties alphabetical. */
	breakdown: Array<{ name: string; count: number }>;
	failed: number;
	/** The tool still executing, if any. */
	running?: string;
	/** Sum of the durations that are known. */
	durationMs: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The same braille spinner and cadence as pi's working indicator. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_INTERVAL_MS = 80;

export function spinnerFrame(now = Date.now()): string {
	return SPINNER_FRAMES[Math.floor(now / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length]!;
}

/** `0.3s`, `12s`, `1m20s` — short enough for a row. */
export function formatDuration(ms: number | undefined): string {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
	if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

/** The text blocks of a tool result, joined. */
function resultText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function hasImage(content: unknown): boolean {
	return Array.isArray(content) && content.some((block) => block?.type === "image");
}

/** Lines of real output, pi's own notices excluded. */
function realLines(text: string): string[] {
	return text
		.split("\n")
		.filter(
			(line) =>
				line.trim() &&
				line.trim() !== "(no output)" &&
				!(/^\[Showing /.test(line)) &&
				!(/^Command (exited with code|terminated)/.test(line)),
		);
}

function outputLines(text: string, details: unknown): number {
	const truncation = (details as { truncation?: { truncated?: unknown; totalLines?: unknown } } | undefined)?.truncation;
	if (truncation?.truncated === true && typeof truncation.totalLines === "number") return truncation.totalLines;
	return realLines(text).length;
}

/** A `codemode` script's nested calls, counted by tool. */
export interface NestedCallSummary {
	kinds: string;
	failed: number;
	total: number;
}

/**
 * The nested tool calls of a `codemode` script, from `result.details.calls`.
 * They never reach the model as separate calls, so a row is the only place a
 * glance can see what the script ran.
 */
export function summarizeNestedCalls(details: unknown): NestedCallSummary {
	const calls = (details as { calls?: unknown } | undefined)?.calls;
	if (!Array.isArray(calls) || calls.length === 0) return { kinds: "", failed: 0, total: 0 };
	const counts = new Map<string, number>();
	let failed = 0;
	for (const call of calls) {
		const record = call as { name?: unknown; status?: unknown };
		const name = typeof record?.name === "string" && record.name ? record.name : "call";
		// `mcp__server__tool` says less than its server does and eats the row.
		const key = name.startsWith("mcp__") ? (name.split("__")[1] ?? name) : name;
		counts.set(key, (counts.get(key) ?? 0) + 1);
		if (record?.status === "error" || record?.status === "cancelled") failed++;
	}
	const kinds = [...counts].map(([name, count]) => `${displayToolName(name)}×${count}`).join(" ");
	return { kinds, failed, total: calls.length };
}

/**
 * What a finished call produced, in a few words: `12 lines`, `exit 1`,
 * `3 matches`, `+4/-2`. Built-in tools only — anything else gets no note rather
 * than a wrong one.
 */
export function summarizeResult(toolName: string | undefined, result: ToolResultLike | undefined, args?: unknown): string {
	if (!result) return "";
	// A result does not change once installed, and walking a 2000-line output is
	// what makes an opened group expensive to repaint. `write`/`edit` are left
	// out because their note also reads the arguments.
	if (toolName !== "write" && toolName !== "edit") {
		const cached = resultNotes.get(result)?.get(toolName ?? "");
		if (cached !== undefined) return cached;
	}
	const note = computeResultNote(toolName, result, args);
	if (toolName !== "write" && toolName !== "edit") {
		let notes = resultNotes.get(result);
		if (!notes) {
			notes = new Map();
			resultNotes.set(result, notes);
		}
		notes.set(toolName ?? "", note);
	}
	return note;
}

const resultNotes = new WeakMap<object, Map<string, string>>();

function computeResultNote(toolName: string | undefined, result: ToolResultLike, args?: unknown): string {
	const text = resultText(result.content);
	const details = result.details;

	if (toolName === "read" && !result.isError && hasImage(result.content)) return "image";

	switch (toolName) {
		case "bash": {
			const code = /Command exited with code (\d+)/.exec(text)?.[1];
			if (result.isError) return code ? `exit ${code}` : "failed";
			const lines = outputLines(text, details);
			return lines > 0 ? plural(lines, "line") : "no output";
		}
		case "read":
			return result.isError ? "" : plural(outputLines(text, details), "line");
		case "grep": {
			if (result.isError) return "";
			const lines = outputLines(text, details);
			return lines === 0 ? "no matches" : plural(lines, "match", "matches");
		}
		case "find": {
			if (result.isError) return "";
			const lines = outputLines(text, details);
			return /^No files found/.test(text.trim()) || lines === 0 ? "no files" : plural(lines, "file");
		}
		case "ls": {
			if (result.isError) return "";
			const lines = outputLines(text, details);
			return text.trim() === "(empty directory)" || lines === 0 ? "empty" : plural(lines, "entry", "entries");
		}
		case "write": {
			const content = (args as { content?: unknown } | undefined)?.content;
			if (result.isError) return "failed";
			if (typeof content === "string") {
				const lines = content.length === 0 ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
				return plural(lines, "line");
			}
			return "written";
		}
		case "edit": {
			if (result.isError) return "failed";
			const diff = (details as { diff?: unknown } | undefined)?.diff;
			if (typeof diff !== "string" || !diff.trim()) return "applied";
			let added = 0;
			let removed = 0;
			for (const line of diff.split("\n")) {
				if (line.startsWith("+") && !line.startsWith("+++")) added++;
				else if (line.startsWith("-") && !line.startsWith("---")) removed++;
			}
			return `+${added}/-${removed}`;
		}
		case "codemode": {
			const calls = summarizeNestedCalls(details);
			return calls.failed > 0 ? plural(calls.failed, "failed call", "failed calls") : "";
		}
		default:
			return "";
	}
}

/**
 * The one-string description of a call's arguments: a shell command's first
 * line, a file's path, or the first stringish argument it can find.
 */
export function summarizeArgs(toolName: string | undefined, args: unknown, result?: ToolResultLike, maxChars = 72): string {
	if (toolName === "codemode") {
		const nested = summarizeNestedCalls(result?.details);
		if (nested.kinds) return nested.kinds;
		// A script that has not called anything yet is described by its first
		// real line; the source's opening blank line says nothing.
		const code = (args as { code?: unknown } | undefined)?.code;
		if (typeof code === "string") {
			const first = code.split("\n").find((line) => line.trim())?.trim() ?? "";
			if (first) return first.length > maxChars ? `${first.slice(0, Math.max(1, maxChars - 1))}…` : first;
		}
	}

	const { text, suffix } = argParts(toolName, args);
	if (!text) return "";
	const shown = text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
	return `${shown}${suffix}`;
}

/**
 * The first line of an argument value, plus `(+N lines)` for the rest. A row is
 * one string in the lines array the renderer returns, so a value with real
 * newlines would paint several physical rows while pi counted one.
 */
function oneLine(value: string): { text: string; suffix: string } {
	const [first, ...rest] = value.split("\n");
	return {
		text: first.trim(),
		suffix: rest.length > 0 ? ` (+${rest.length} lines)` : "",
	};
}

/** `cd <path> &&` / `cd <path>;` spends a row's cells on a path nothing reads. */
const CD_PREFIX = /^cd\s+(?:"([^"$`]+)"|'([^']+)'|([^\s;&|'"`$()]+))(\s*(?:&&|;)\s*)(?=\S)/;

function shortenCd(line: string): string {
	const match = CD_PREFIX.exec(line);
	if (!match) return line;
	const path = match[1] ?? match[2] ?? match[3] ?? "";
	const last = path.replace(/\/+$/, "").split("/").pop();
	if (!last || last === "." || last === "..") return line;
	const short = `…/${last}`;
	if (short.length >= path.length) return line;
	return `cd ${short}${match[4]}${line.slice(match[0].length)}`;
}

function argParts(toolName: string | undefined, args: unknown): { text: string; suffix: string } {
	if (!args || typeof args !== "object") return { text: "", suffix: "" };
	const record = args as Record<string, unknown>;

	const command = typeof record.command === "string" ? record.command : undefined;
	if (command) {
		const line = oneLine(command);
		return { ...line, text: shortenCd(line.text) };
	}

	// grep and find are described by their pattern; the path is context.
	if (toolName === "grep" || toolName === "find") {
		const pattern = typeof record.pattern === "string" ? record.pattern : undefined;
		if (pattern) {
			const path = typeof record.path === "string" && record.path ? ` in ${record.path}` : "";
			return oneLine(`${pattern}${path}`);
		}
	}

	for (const key of ["path", "file_path", "filePath", "pattern", "url", "query", "name"]) {
		const value = record[key];
		if (typeof value === "string" && value) return oneLine(value);
	}

	for (const value of Object.values(record)) {
		if (typeof value === "string" && value) return oneLine(value);
	}
	return { text: "", suffix: "" };
}

/** `▸ 4 calls · Bash×3  Read×1 · 1.2s` (`▾` while the group is open). */
export function formatGroupLine(summary: GroupSummary, theme: ColorTheme, open: boolean, spinner?: string): string {
	const glyph = theme.fg("accent", open ? "▾" : "▸");
	const busy = spinner ? ` ${theme.fg("accent", spinner)}` : "";
	const parts: string[] = [
		`${glyph}${busy} ${theme.fg("toolTitle", `${summary.count} ${summary.count === 1 ? "call" : "calls"}`)}`,
	];

	const breakdown = summary.breakdown.map(({ name, count }) =>
		theme.fg("muted", `${displayToolName(name)}×${count}`),
	);
	if (breakdown.length > 0) parts.push(breakdown.join(theme.fg("muted", "  ")));

	if (summary.thoughts > 0) parts.push(theme.fg("warning", `${italicText(theme, "Thinking")}×${summary.thoughts}`));
	if (summary.failed > 0) parts.push(theme.fg(open ? "muted" : "error", `${summary.failed} failed`));
	if (summary.running) parts.push(theme.fg("warning", `running ${displayToolName(summary.running)}`));
	else if (summary.durationMs > 0) parts.push(theme.fg("muted", formatDuration(summary.durationMs)));

	return ` ${parts.join(theme.fg("muted", " · "))}`;
}

/** Cells a row may take after the group's `│ ` gutter. */
const ROW_LEAD = " ";

function clipPlain(text: string, cells: number): string {
	if (cells <= 0) return "";
	return visibleWidth(text) <= cells ? text : truncateToWidth(text, cells, "…");
}

interface RowLayout {
	/** Cells available to the argument text. */
	args: number;
	/** Pad the arguments to this width before the tail; 0 means no padding. */
	padTo: number;
	/** Whether the metrics tail fits. */
	tail: boolean;
}

/**
 * Where the argument field and the metrics column go.
 *
 * The metrics column is where a thinking preview ends, so a long command's
 * ellipsis sits under the thinking ellipsis and every completed row's
 * `12 lines · 0.5s` starts at the same cell. On a narrow terminal the aligned
 * column no longer fits: the tail moves next to the command instead, and if
 * even that is too tight the tail is dropped.
 */
function layoutRow(width: number, fixed: number, tailCells: number): RowLayout {
	const available = width - fixed;
	const absoluteWidth = width + GUTTER_CELLS;
	const thinkingPreview = Math.min(
		THOUGHT_PREVIEW_CELLS,
		Math.max(0, absoluteWidth - THINKING_PREFIX_CELLS),
	);
	const metricsColumn = THINKING_PREFIX_CELLS + thinkingPreview;
	const argsStart = GUTTER_CELLS + fixed;
	const alignedArgs = metricsColumn - argsStart;
	const tailRoom = absoluteWidth - 2 - tailCells;

	if (tailCells > 0 && alignedArgs >= 10 && metricsColumn <= tailRoom) {
		return { args: alignedArgs, padTo: alignedArgs, tail: true };
	}
	if (tailCells > 0 && available - tailCells >= 10) {
		return { args: Math.min(available - tailCells, TOOL_PREVIEW_CELLS), padTo: 0, tail: true };
	}
	return { args: Math.min(available, TOOL_PREVIEW_CELLS), padTo: 0, tail: false };
}

/**
 * ` ✓ Bash cd ~/p && pnpm test  12 lines · 1.2s`
 *
 * The metrics give way before the command does: below a readable argument
 * budget the row keeps the command and drops the tail.
 */
export function formatToolRow(
	tool: ToolLike,
	status: ToolStatus,
	theme: ColorTheme,
	width: number,
	spinner?: string,
): string {
	const rawName = tool.toolName ?? "tool";
	const name = displayToolName(rawName);
	const glyph =
		status === "running"
			? theme.fg("warning", spinner ?? "…")
			: status === "error"
				? theme.fg("error", "✗")
				: theme.fg("success", "✓");
	const nameText = theme.fg("toolTitle", name);

	const note = status === "running" ? "" : summarizeResult(rawName, tool.result, tool.args);
	const duration = status === "running" ? "" : formatDuration(tool.result?.durationMs);
	const tailPlain = [note, duration].filter(Boolean).join(" · ");
	const tail = tailPlain ? `  ${theme.fg("muted", tailPlain)}` : "";
	const tailCells = tailPlain ? 2 + visibleWidth(tailPlain) : 0;

	const fixed = visibleWidth(ROW_LEAD) + visibleWidth("✓ ") + visibleWidth(name) + 1;
	const layout = layoutRow(width, fixed, tailCells);
	if (layout.args < 4) return clipPlain(`${ROW_LEAD}${glyph} ${nameText}`, width);

	let argText = summarizeArgs(rawName, tool.args, tool.result);
	// The `(+N lines)` marker is the first thing a narrow row can lose.
	const overflow = argText.match(/ \(\+\d+ lines\)$/)?.[0];
	if (overflow) {
		if (visibleWidth(argText) > layout.args) argText = argText.slice(0, -overflow.length);
	}
	const shown = clipPlain(argText, layout.args);
	let colored: string;
	if (status !== "error" && rawName === "bash" && shown) {
		try {
			colored = highlightBashCommand(shown, (token, value) => theme.fg(token, value));
		} catch {
			colored = theme.fg("toolOutput", shown);
		}
	} else {
		colored = shown ? theme.fg("toolOutput", shown) : "";
	}

	const args = ` ${colored}`;
	const pad =
		layout.padTo > 0 ? " ".repeat(Math.max(0, layout.padTo - visibleWidth(colored))) : "";
	return clipPlain(`${ROW_LEAD}${glyph} ${nameText}${args}${pad}${layout.tail ? tail : ""}`, width);
}

/**
 * Fallback argument cap when there is no aligned metrics column to fill (a
 * narrow terminal, or a tool name long enough to crowd the thinking column).
 */
export const TOOL_PREVIEW_CELLS = 56;

/**
 * Cells a thinking preview may take even on a wide terminal. A thought is the
 * context for the calls under it, not a paragraph: the whole line would read as
 * prose wedged into the transcript. Click the row to read it in full.
 */
export const THOUGHT_PREVIEW_CELLS = 56;

/** One thinking run as a row, the same shape as a tool row: label, then a preview. */
export function formatThoughtRow(
	text: string,
	theme: ColorTheme,
	width: number,
	spinner?: string,
	standalone = false,
): string {
	const glyph = spinner ? spinner : "✓";
	const labelText = `${glyph} Thinking`;
	const label = `${theme.fg(spinner ? "warning" : "success", glyph)} ${theme.fg("warning", italicText(theme, "Thinking"))}`;
	const lead = standalone ? " " : `${groupGutter(theme)} `;
	const available = width - visibleWidth(lead) - visibleWidth(labelText) - 2;
	const budget = Math.min(THOUGHT_PREVIEW_CELLS, available);
	const flat = text.replace(/\s+/g, " ").trim();
	const preview = budget > 1 && flat ? clipPlain(flat, budget) : "";
	const body = preview ? `  ${theme.fg("thinkingText", preview)}` : "";
	return clipPlain(`${lead}${label}${body}`, width);
}

/** The `│` that runs down the left of an open group, under its `▾`. */
export function groupGutter(theme: ColorTheme): string {
	return ` ${theme.fg("borderMuted", "│")}`;
}

/** Cells `groupGutter` takes. */
export const GUTTER_CELLS = 2;

/** `✓ Thinking` / `⠋ Thinking` are both one status cell plus the word. */
const THINKING_LABEL_CELLS = visibleWidth("✓ Thinking");
/** Absolute column where a thinking row's preview starts. */
const THINKING_PREFIX_CELLS = GUTTER_CELLS + 1 + THINKING_LABEL_CELLS + 2;
