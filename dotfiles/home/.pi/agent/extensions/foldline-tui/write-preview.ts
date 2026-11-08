/**
 * The write box's content preview.
 *
 * pi's native write renderer already highlights source, but its inner title
 * repeats the path that Foldline TUI puts in the border. This module keeps the
 * compact preview while preserving that highlighting.
 */

import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ColorTheme } from "./tool-summary.ts";

export interface WritePreviewTool {
	toolName?: string;
	isPartial?: boolean;
	args?: unknown;
	result?: {
		isError?: boolean;
	};
	expanded?: boolean;
}

/** Visual lines of a written file shown while the box is folded. */
const WRITE_PREVIEW_LINES = 10;
const WRITE_TAB = "   ";
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

interface WritePreview {
	content: string;
	language?: string;
	sample?: string;
	lines: string[];
	/** Highlighted lines, only when the highlighter returned a matching count. */
	highlighted?: string[];
	/** Last wrapped body, invalidated by width, expansion and content changes. */
	rendered?: {
		width: number;
		expanded: boolean;
		lines: string[];
	};
}

const writePreviews = new WeakMap<object, WritePreview>();

/** Content preview for a successful write; the border carries the path. */
export function writePreviewLines(
	tool: WritePreviewTool,
	width: number,
	theme: ColorTheme,
): string[] | undefined {
	if (tool.toolName !== "write" || tool.isPartial || tool.result?.isError) return undefined;
	const args = tool.args as { content?: unknown; path?: unknown; file_path?: unknown } | undefined;
	if (!args || typeof args.content !== "string") return undefined;
	const raw = args.content;
	const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : "";
	let language: string | undefined;
	try {
		language = path ? getLanguageFromPath(path) : undefined;
	} catch {
		language = undefined;
	}
	const sample = theme.fg("toolTitle", "x");

	let preview = writePreviews.get(args);
	if (!preview || preview.content !== raw || preview.language !== language || preview.sample !== sample) {
		const content = raw.replace(/\r/g, "").replace(/\t/g, WRITE_TAB).replace(CONTROL_CHARS, " ");
		const lines = content.split("\n");
		while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		let highlighted: string[] | undefined;
		if (language && lines.length > 0) {
			try {
				const result = highlightCode(lines.join("\n"), language);
				if (result.length === lines.length) highlighted = result;
			} catch {
				highlighted = undefined;
			}
		}
		preview = { content: raw, language, sample, lines, ...(highlighted ? { highlighted } : {}) };
		writePreviews.set(args, preview);
	}

	const expanded = tool.expanded === true;
	const cached = preview.rendered;
	if (cached && cached.width === width && cached.expanded === expanded) {
		return cached.lines;
	}

	const total = preview.lines.length;
	const budget = expanded ? total : Math.min(WRITE_PREVIEW_LINES, total);
	const max = Math.max(1, width - 2);
	const clip = (line: string) => truncateToWidth(line, max, "…");
	const source = preview.highlighted ?? preview.lines;
	const shown = source.slice(0, budget).flatMap((line) => {
		const painted = preview.highlighted ? line : theme.fg("toolOutput", line);
		const rows = wrapTextWithAnsi(painted, Math.max(1, max - 1));
		return (rows.length > 0 ? rows : [""]).map((row) => ` ${row}`);
	});
	if (!expanded && total > budget) {
		const more = total - budget;
		shown.push(
			clip(` ${theme.fg("muted", `... (${more} more ${more === 1 ? "line" : "lines"}, ${total} total, ctrl+o to expand)`)}`),
		);
	}
	// One blank row on each side keeps the body from touching the border,
	// matching the padding pi's own tool boxes use.
	const lines = ["", ...(shown.length > 0 ? shown : [" "]), ""];
	preview.rendered = { width, expanded, lines };
	return lines;
}
