/**
 * The edit box's body: pi's numbered diff string, rebuilt as a compact preview.
 *
 * The outer frame comes from frame.ts. This module only turns
 * `details.diff` (or the renderer's live preview) into body rows:
 *
 *   - wide boxes use `old | new` panes, narrow boxes stay unified;
 *   - long code lines wrap instead of being clipped;
 *   - a folded box shows PREVIEW_LINES rows and a ctrl+o footer;
 *   - syntax highlighting and line numbers make the change easy to scan.
 *
 * No diff is recomputed here: the host's string is authoritative, and it is
 * already what pi uses for its own renderer.
 */

import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	buildSplitRows,
	isDiffLine,
	lineNumberWidth,
	parseDiff,
	type DiffEntry,
	type DiffLine,
	type DiffMeta,
	type LineKind,
	type SplitRow,
} from "./edit-diff.ts";

export type EditPreviewTheme = {
	fg(color: string, text: string): string;
	bold?(text: string): string;
	inverse?(text: string): string;
};

export interface EditPreviewTool {
	toolName?: string;
	args?: unknown;
	result?: {
		isError?: boolean;
		details?: unknown;
	};
	callRendererComponent?: {
		preview?: unknown;
	};
	expanded?: boolean;
}

/** Diff rows shown before the box folds; ctrl+o shows the rest. */
const PREVIEW_LINES = 24;
/** Total box width at which two panes still leave readable code columns. */
const SPLIT_MIN_WIDTH = 120;
/** Below this there is no useful diff body; let pi draw its own box. */
const MIN_WIDTH = 32;
const PAD = 1;
const SEPARATOR = " │ ";
const SEPARATOR_CELLS = visibleWidth(SEPARATOR);
const TAB = "   ";
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

type DiffSide = "left" | "right";

interface Emphasis {
	start: number;
	end: number;
}

interface PreviewCache {
	diff: string;
	width: number;
	expanded: boolean;
	path: string;
	sample: string;
	lines: string[];
}

const caches = new WeakMap<object, PreviewCache>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringField(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === "string" ? field : undefined;
}

function diffFor(tool: EditPreviewTool): string | undefined {
	if (tool.result?.isError === true) return undefined;

	const fromResult = stringField(tool.result?.details, "diff");
	if (fromResult?.trim()) return fromResult;

	const preview = tool.callRendererComponent?.preview;
	if (!isRecord(preview) || "error" in preview) return undefined;
	const live = stringField(preview, "diff");
	return live?.trim() ? live : undefined;
}

function pathFor(tool: EditPreviewTool): string {
	const args = tool.args;
	return stringField(args, "path") ?? stringField(args, "file_path") ?? "";
}

function sanitize(text: string): string {
	return text.replace(CONTROL_CHARS, " ").replace(/\t/g, TAB);
}

function padToWidth(text: string, width: number): string {
	const actual = visibleWidth(text);
	if (actual === width) return text;
	if (actual > width) return truncateToWidth(text, width, "");
	return `${text}${" ".repeat(width - actual)}`;
}

function clip(text: string, width: number): string {
	if (width <= 0) return "";
	return visibleWidth(text) <= width ? text : truncateToWidth(text, width, "…");
}

function highlightLineFactory(language: string | undefined): (line: string) => string {
	const cache = new Map<string, string>();
	return (line) => {
		if (!language || !line.trim()) return line;
		const cached = cache.get(line);
		if (cached !== undefined) return cached;
		let highlighted = line;
		try {
			highlighted = highlightCode(line, language)[0] ?? line;
		} catch {
			highlighted = line;
		}
		cache.set(line, highlighted);
		return highlighted;
	};
}

function commonEdges(left: string, right: string): { prefix: number; suffix: number } {
	const max = Math.min(left.length, right.length);
	let prefix = 0;
	while (prefix < max && left[prefix] === right[prefix]) prefix++;
	let suffix = 0;
	while (suffix < max - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
	return { prefix, suffix };
}

function rawIndexAtVisible(text: string, target: number): number {
	let visible = 0;
	let index = 0;
	while (index < text.length) {
		if (text[index] === "\x1b") {
			const end = text.indexOf("m", index);
			if (end !== -1) {
				index = end + 1;
				continue;
			}
		}
		if (visible >= target) return index;
		visible++;
		index++;
	}
	return text.length;
}

function emphasize(text: string, span: Emphasis | undefined, theme: EditPreviewTheme): string {
	if (!span || span.end <= span.start) return text;
	const start = rawIndexAtVisible(text, span.start);
	const end = rawIndexAtVisible(text, span.end);
	if (end <= start) return text;
	const middle = text.slice(start, end);
	const inverted = theme.inverse?.(middle);
	const wrapped = inverted && inverted !== middle ? inverted : `\x1b[7m${middle}\x1b[27m`;
	return `${text.slice(0, start)}${wrapped}${text.slice(end)}`;
}

function codeColor(kind: LineKind): string {
	if (kind === "add") return "toolDiffAdded";
	if (kind === "remove") return "toolDiffRemoved";
	return "toolDiffContext";
}

function renderCode(
	line: DiffLine,
	theme: EditPreviewTheme,
	highlight: (line: string) => string,
	language: string | undefined,
	emphasis: Emphasis | undefined,
): string {
	const text = sanitize(line.text);
	// Context is for orientation, not a second copy of the file's syntax
	// colors. Keep it dim. Removed code is gone: red is the message, so it does
	// not get a second layer of syntax colors; added code is the new file and
	// stays highlighted.
	if (line.kind === "context") return theme.fg("toolDiffContext", text);
	if (line.kind === "remove") return theme.fg(codeColor(line.kind), text);
	if (!language) return theme.fg(codeColor(line.kind), text);
	return emphasize(highlight(text), emphasis, theme);
}

function marker(kind: LineKind): string {
	if (kind === "add") return "+";
	if (kind === "remove") return "-";
	return " ";
}

function renderPrefix(
	line: DiffLine,
	side: DiffSide,
	numberWidth: number,
	theme: EditPreviewTheme,
): { styled: string; plainWidth: number } {
	const number = side === "left" ? line.oldNumber : line.newNumber;
	const color = codeColor(line.kind);
	const markerText = theme.fg(color, marker(line.kind));
	const numberText = number === null ? " ".repeat(numberWidth) : String(number).padStart(numberWidth, " ");
	const styledNumber = theme.fg(color, numberText);
	return {
		styled: `${markerText} ${styledNumber} `,
		plainWidth: 1 + 1 + numberWidth + 1,
	};
}

function renderWrapped(
	prefix: { styled: string; plainWidth: number },
	code: string,
	width: number,
	minCodeWidth = 0,
): string[] {
	const codeWidth = Math.max(minCodeWidth, width - prefix.plainWidth);
	const wrapped = codeWidth > 0 ? wrapTextWithAnsi(code, codeWidth) : [""];
	const rows = wrapped.length > 0 ? wrapped : [""];
	return rows.map((row, index) => {
		const lead = index === 0 ? prefix.styled : " ".repeat(prefix.plainWidth);
		return padToWidth(`${lead}${row}`, width);
	});
}

function renderCell(
	line: DiffLine | undefined,
	side: DiffSide,
	width: number,
	numberWidth: number,
	theme: EditPreviewTheme,
	highlight: (line: string) => string,
	language: string | undefined,
	emphasis: Emphasis | undefined,
): string[] {
	if (!line) return [" ".repeat(Math.max(0, width))];

	const prefix = renderPrefix(line, side, numberWidth, theme);
	const code = renderCode(line, theme, highlight, language, emphasis);
	return renderWrapped(prefix, code, width);
}

function renderMeta(meta: DiffMeta, width: number, theme: EditPreviewTheme): string {
	const text = meta.kind === "skip" ? "…" : sanitize(meta.text);
	const color = meta.kind === "skip" ? "muted" : text.startsWith("@@") ? "accent" : "muted";
	return padToWidth(` ${theme.fg(color, clip(text, Math.max(1, width - 2)))}`, width);
}

function renderUnified(
	entries: readonly DiffEntry[],
	width: number,
	numberWidth: number,
	theme: EditPreviewTheme,
	highlight: (line: string) => string,
	language: string | undefined,
): string[] {
	const lines: string[] = [];
	const contentWidth = Math.max(1, width - PAD * 2);

	for (const entry of entries) {
		if (!isDiffLine(entry)) {
			lines.push(renderMeta(entry, contentWidth, theme));
			continue;
		}

		const prefix = renderPrefix(entry, entry.kind === "add" ? "right" : "left", numberWidth, theme);
		const code = renderCode(entry, theme, highlight, language, undefined);
		lines.push(...renderWrapped(prefix, code, contentWidth, 1));
	}

	return lines;
}

function splitHeader(
	leftWidth: number,
	rightWidth: number,
	theme: EditPreviewTheme,
): string {
	const label = (text: string, color: string, width: number) =>
		padToWidth(theme.fg(color, theme.bold?.(text) ?? text), width);
	return `${label("old", "toolDiffRemoved", leftWidth)}${theme.fg("muted", SEPARATOR)}${label("new", "toolDiffAdded", rightWidth)}`;
}

function renderSplit(
	rows: readonly SplitRow[],
	width: number,
	numberWidth: number,
	theme: EditPreviewTheme,
	highlight: (line: string) => string,
	language: string | undefined,
): string[] | undefined {
	const contentWidth = Math.max(1, width - PAD * 2);
	const paneBudget = contentWidth - SEPARATOR_CELLS;
	if (paneBudget < 12) return undefined;
	const leftWidth = Math.floor(paneBudget / 2);
	const rightWidth = paneBudget - leftWidth;
	if (leftWidth < 6 || rightWidth < 6) return undefined;

	const lines: string[] = [splitHeader(leftWidth, rightWidth, theme)];
	for (const row of rows) {
		if (row.meta) {
			lines.push(renderMeta(row.meta, contentWidth, theme));
			continue;
		}

		const leftText = row.left ? sanitize(row.left.text) : "";
		const rightText = row.right ? sanitize(row.right.text) : "";
		const pair =
			row.left?.kind === "remove" && row.right?.kind === "add"
				? commonEdges(leftText, rightText)
				: undefined;
		const leftEmphasis =
			pair && row.left
				? { start: pair.prefix, end: Math.max(pair.prefix, leftText.length - pair.suffix) }
				: undefined;
		const rightEmphasis =
			pair && row.right
				? { start: pair.prefix, end: Math.max(pair.prefix, rightText.length - pair.suffix) }
				: undefined;
		const left = renderCell(row.left, "left", leftWidth, numberWidth, theme, highlight, language, leftEmphasis);
		const right = renderCell(row.right, "right", rightWidth, numberWidth, theme, highlight, language, rightEmphasis);
		const height = Math.max(left.length, right.length);
		for (let index = 0; index < height; index++) {
			lines.push(
				`${padToWidth(left[index] ?? " ".repeat(leftWidth), leftWidth)}${theme.fg("muted", SEPARATOR)}${padToWidth(right[index] ?? " ".repeat(rightWidth), rightWidth)}`,
			);
		}
	}

	return lines;
}

function footer(hidden: number, total: number, width: number, theme: EditPreviewTheme): string {
	const text = `... (${hidden} more ${hidden === 1 ? "line" : "lines"}, ${total} total, ctrl+o to expand)`;
	return padToWidth(` ${theme.fg("muted", clip(text, Math.max(1, width - 2)))}`, width);
}

function renderPreview(
	diff: string,
	path: string,
	expanded: boolean,
	width: number,
	theme: EditPreviewTheme,
): string[] | undefined {
	const entries = parseDiff(diff);
	if (!entries) return undefined;

	const innerWidth = Math.max(1, width - 2);
	if (innerWidth < MIN_WIDTH) return undefined;

	let language: string | undefined;
	try {
		language = path ? getLanguageFromPath(path) : undefined;
	} catch {
		language = undefined;
	}
	const highlight = highlightLineFactory(language);
	const numberWidth = lineNumberWidth(entries);
	const rows = buildSplitRows(entries);

	const body =
		width >= SPLIT_MIN_WIDTH
			? renderSplit(rows, innerWidth, numberWidth, theme, highlight, language)
			: renderUnified(entries, innerWidth, numberWidth, theme, highlight, language);
	if (!body || body.length === 0) return undefined;

	const total = body.length;
	const shown = expanded || total <= PREVIEW_LINES ? body : body.slice(0, PREVIEW_LINES);
	const hidden = total - shown.length;
	const pad = (line: string) => padToWidth(`${" ".repeat(PAD)}${line}${" ".repeat(PAD)}`, innerWidth);

	return [
		"",
		...shown.map(pad),
		...(hidden > 0 ? [pad(footer(hidden, total, innerWidth - PAD * 2, theme))] : []),
		"",
	];
}

/**
 * Body rows for the edit box, or undefined to keep pi's own rendering.
 * The cache is per tool component: pi re-renders the whole transcript often.
 */
export function editPreviewLines(
	tool: EditPreviewTool,
	width: number,
	theme: EditPreviewTheme,
): string[] | undefined {
	if (tool.toolName !== "edit") return undefined;
	const diff = diffFor(tool);
	if (!diff) return undefined;
	const path = pathFor(tool);
	const expanded = tool.expanded === true;
	const sample = theme.fg("toolDiffAdded", "x");
	const cached = caches.get(tool);
	if (
		cached &&
		cached.diff === diff &&
		cached.width === width &&
		cached.expanded === expanded &&
		cached.path === path &&
		cached.sample === sample
	) {
		return cached.lines;
	}

	let lines: string[] | undefined;
	try {
		lines = renderPreview(diff, path, expanded, width, theme);
	} catch {
		lines = undefined;
	}
	if (!lines) return undefined;

	caches.set(tool, { diff, width, expanded, path, sample, lines });
	return lines;
}
