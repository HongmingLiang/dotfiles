/**
 * Standalone box labels and pi renderer-title stripping.
 *
 * The border carries the tool name and path, so a tool renderer's own first
 * title row is removed from the body. This applies to read/write/edit and to
 * the generic fallback shapes they can produce.
 */

import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import {
	formatDuration,
	summarizeArgs,
	summarizeResult,
	type ColorTheme,
	type ToolResultLike,
	type ToolStatus,
} from "./tool-summary.ts";

export interface TitledTool {
	toolName?: string;
	args?: unknown;
	result?: ToolResultLike;
}

/** `~` for a home path keeps a border label about the file, not the user. */
function shortenHome(path: string): string {
	const home = homedir();
	return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The border title on a standalone box: `edit ~/app.ts  +4/-2`. */
export function standaloneLabel(tool: TitledTool, status: ToolStatus, theme: ColorTheme): string {
	const name = tool.toolName;
	if (!name) return "";
	const args = shortenHome(summarizeArgs(name, tool.args, tool.result));
	const note = status === "running" ? "" : summarizeResult(name, tool.result, tool.args);
	const duration = status === "running" ? "" : formatDuration(tool.result?.durationMs);
	const tailPlain = [note, duration].filter(Boolean).join(" · ");
	const parts = [theme.fg("toolTitle", name)];
	if (args) parts.push(theme.fg("toolOutput", args));
	const tail = tailPlain ? `  ${theme.fg("muted", tailPlain)}` : "";
	return ` ${parts.join(" ")}${tail} `;
}

/**
 * pi's read/write/edit renderers start with the tool title (`read`,
 * `write <path>`, `edit <path>`). The border now carries that title, so drop
 * the duplicate while keeping the original row count for click translation.
 */
export function stripInnerTitle(tool: TitledTool, lines: string[]): { lines: string[]; dropped: number } {
	const name = tool.toolName;
	if (!name) return { lines, dropped: 0 };
	// A background-filled padding row is still blank for this scan: only the
	// tool's own title text matters, not the box styling above it.
	const blank = (line: string) => stripVTControlCharacters(line).trim() === "";
	let index = 0;
	while (index < lines.length && blank(lines[index])) index++;
	if (index >= lines.length) return { lines, dropped: 0 };
	const plain = stripVTControlCharacters(lines[index]).trim();
	// A bare tool name is a title for every built-in (`ls`, `grep`, `find`, …).
	// read/write/edit also put the path on that line. Avoid the generic
	// fallback's `read path="…"` / wrapped `edit path="…" oldText="…"` lines:
	// dropping half of those would mangle the remaining rows.
	const isTitle =
		plain === name ||
		(name === "read" && plain.startsWith("read ") && !plain.includes("=")) ||
		/^(?:edit|write)\s+\S+$/.test(plain);
	if (!isTitle) return { lines, dropped: 0 };
	let end = index + 1;
	if (end < lines.length && blank(lines[end])) end++;
	return { lines: [...lines.slice(0, index), ...lines.slice(end)], dropped: end - index };
}
