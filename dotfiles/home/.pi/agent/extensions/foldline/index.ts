/**
 * Foldline — a shared shell for every Pi tool execution.
 *
 * Pi's renderer hooks are per tool, but the UI draws all agent tools (built-ins,
 * MCP, subagents, extensions) through ToolExecutionComponent. Wrapping that
 * component gives them one shell without re-registering any tool; bash rows
 * additionally use the tokenizer in bash-highlighter.ts.
 *
 * On top of the frame, the calls between two pieces of assistant text fold into
 * one summary line (`▸ 5 calls · bash×3 · thinking×2 · 1.2s`): click it for
 * one row per call, click a row for the framed box. A step that only thinks and
 * calls tools contributes a `thinking` row instead of pi's `Thinking...` label,
 * so folded replies stay one line per group.
 *
 * The folding rules live in tool-groups.ts, the wording in tool-summary.ts.
 * Settings: `foldline.groupTools` in ~/.pi/agent/settings.json (default true).
 *
 * The wrapper strips only SGR background colors: foreground colors, highlighting,
 * hyperlinks and image sequences stay intact.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
	AssistantMessageComponent,
	getAgentDir,
	ToolExecutionComponent,
	type ExtensionAPI,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, truncateToWidth, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatBashCallHighlighted } from "./bash-highlighter.ts";
import {
	configureGroups,
	disposeGroupBoundaries,
	groupSummaryFor,
	installGroupBoundaries,
	isBlankLine,
	needsLeadingBlank,
	noteBoundary,
	noteCarrier,
	noteHeaderDrawn,
	noteRenderedLines,
	noteSetExpanded,
	noteTailCarrier,
	planFor,
	releaseCarrier,
	requestGroupRender,
	resetSessionState,
	tickSpinner,
	toggleGroup,
} from "./tool-groups.ts";
import {
	formatGroupLine,
	formatThoughtRow,
	formatDuration,
	formatToolRow,
	groupGutter,
	GUTTER_CELLS,
	spinnerFrame,
	summarizeArgs,
	summarizeResult,
	type ColorTheme,
	type ToolStatus,
} from "./tool-summary.ts";

/** Stable key: /reload can still find a patch installed before the rename. */
const FOLDLINE_PATCH = Symbol.for("pi.toolbox.render-patch");
const MAX_REMEMBERED_STATUSES = 4096;

interface FoldlineConfig {
	/** Fold a segment's calls into one summary line. */
	groupTools: boolean;
}

const DEFAULT_CONFIG: FoldlineConfig = { groupTools: true };

function loadConfig(): FoldlineConfig {
	let raw: unknown;
	try {
		const settings = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8"));
		raw = (settings as { foldline?: unknown })?.foldline;
	} catch {
		// Missing or malformed settings keep the default.
	}
	const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	return {
		groupTools: typeof record.groupTools === "boolean" ? record.groupTools : DEFAULT_CONFIG.groupTools,
	};
}

/** Colors before session_start: a row still has to render, just without paint. */
const FALLBACK_THEME = { fg: (_color: string, text: string) => text } as unknown as Theme;

type ToolExecutionLike = {
	toolName?: string;
	toolCallId?: string;
	args?: unknown;
	isPartial?: boolean;
	expanded?: boolean;
	result?: { isError?: boolean; durationMs?: number; content?: unknown; details?: unknown };
	setExpanded?(expanded: boolean): void;
	ui?: { requestRender?(): void };
	__foldlineBody?: BodyGeometry;
	__foldlineHits?: FoldlineHit[];
	__foldlineGrouped?: boolean;
	/** The box body is ours (write preview), so clicks must not be translated. */
	__foldlineCustom?: boolean;
};

type Render = (this: ToolExecutionLike, width: number) => string[];
type CallRenderer = (args: any, theme: Theme, context: any) => unknown;
type GetCallRenderer = (this: ToolExecutionLike) => CallRenderer | undefined;
type HandleMouse = (this: ToolExecutionLike, event: any) => unknown;
type SetExpanded = (this: ToolExecutionLike, expanded: boolean) => void;

type FoldlinePatch = {
	originalRender: Render;
	originalGetCallRenderer?: GetCallRenderer;
	originalHandleMouse?: HandleMouse;
	originalSetExpanded?: SetExpanded;
	/** Our wrappers, so disposal restores only what is still on top. */
	renderWrapper?: Render;
	callRendererWrapper?: GetCallRenderer;
	handleMouseWrapper?: HandleMouse;
	setExpandedWrapper?: SetExpanded;
	/** A wrapper left under another extension's: pass through instead of drawing. */
	disposed?: boolean;
	theme?: Theme;
	statuses: Map<string, ToolStatus>;
	config: FoldlineConfig;
};

type PatchedPrototype = {
	render: Render;
	getCallRenderer?: GetCallRenderer;
	handleMouse?: HandleMouse;
	setExpanded?: SetExpanded;
};

/** Where the box's source rows sit in our output, so clicks can be translated. */
interface BodyGeometry {
	/** First content row (inside the border) in our lines. */
	contentTop: number;
	/** Last content row in our lines. */
	bottom: number;
	/** The same content's first row index in the original render output. */
	sourceStart: number;
	sourceWidth: number;
	sourceHeight: number;
	/** Column of the source's first cell in our lines. */
	left: number;
}

interface FoldlineHit {
	y: number;
	kind: "header" | "row";
}

interface ThoughtHit {
	y: number;
	/** -1 is the group header. */
	run: number;
}

interface ThoughtBody {
	run: number;
	top: number;
	bottom: number;
}

const STATUS_DEDUPE = Symbol.for("pi.foldline.status-dedupe");
const TOOL_OUTPUT_STATUS = /^Tool output: (?:expanded|collapsed)$/;

/**
 * pi's `showStatus` appends a Spacer + ThemedText pair to the chat. Its
 * "already showing this status" check only looks at the last two children, so
 * a ctrl+o before each new tool appends another pair; every pair renders the
 * latest `lastStatusMessage`, producing a column of identical status lines.
 *
 * Prune older `Tool output: …` pairs whenever a new one is added, keeping the
 * just-added pair as the single live status line.
 */
function isToolOutputStatus(child: unknown): boolean {
	const candidate = child as { build?: unknown; setText?: unknown; render?: unknown };
	if (typeof candidate?.build !== "function" || typeof candidate.setText !== "function" || typeof candidate.render !== "function") {
		return false;
	}
	try {
		const rendered = (candidate.render as (width: number) => string[])(200).join("\n");
		return TOOL_OUTPUT_STATUS.test(stripVTControlCharacters(rendered).trim());
	} catch {
		return false;
	}
}

function pruneToolOutputStatuses(container: Container, keep: unknown): void {
	const remove = new Set<unknown>();
	container.children.forEach((child, index) => {
		if (child === keep || !isToolOutputStatus(child)) return;
		remove.add(child);
		const previous = container.children[index - 1];
		if (previous instanceof Spacer) remove.add(previous);
	});
	if (remove.size === 0) return;
	container.children = container.children.filter((child) => !remove.has(child));
}

function installStatusDedupe(): void {
	const prototype = Container.prototype as unknown as { addChild: (child: unknown) => void; [STATUS_DEDUPE]?: true };
	if (prototype[STATUS_DEDUPE]) return;
	const originalAddChild = prototype.addChild;
	prototype.addChild = function addChildWithStatusDedupe(this: Container, child: unknown): void {
		originalAddChild.call(this, child);
		try {
			if (isToolOutputStatus(child)) pruneToolOutputStatuses(this, child);
		} catch {
			// Status cleanup must never take the TUI down with it.
		}
	};
	prototype[STATUS_DEDUPE] = true;
}

/** >0 while a click of ours runs: pi's box toggle must not read as ctrl+o. */
let pointerDepth = 0;

function asPointer<T>(fn: () => T): T {
	pointerDepth++;
	try {
		return fn();
	} finally {
		pointerDepth--;
	}
}

/**
 * Strip background SGR parameters, keep all other styling.
 *
 * theme.bg() emits 48;5;n / 48;2;r;g;b followed by 49, and third-party renderers
 * may mix foreground and background in one SGR, so parse the parameter list
 * instead of deleting a whole escape.
 */
function removeBackgroundSgr(text: string): string {
	return text.replace(/\x1b\[([0-9;]*)m/g, (_sequence, rawParams: string) => {
		const params = rawParams === "" ? [0] : rawParams.split(";").map(Number);
		const kept: number[] = [];

		for (let i = 0; i < params.length; i++) {
			const param = params[i];

			// Extended background: 48;5;n or 48;2;r;g;b.
			if (param === 48) {
				if (params[i + 1] === 5) i += 2;
				else if (params[i + 1] === 2) i += 4;
				continue;
			}

			// 49 is the default background reset; the 40-47 and 100-107
			// ranges are the normal and bright background palettes.
			if (param === 49 || (param >= 40 && param <= 47) || (param >= 100 && param <= 107)) {
				continue;
			}

			kept.push(param);
		}

		return kept.length > 0 ? `\x1b[${kept.join(";")}m` : "";
	});
}

function borderColorFor(status: ToolStatus): string {
	return status === "running" ? "dim" : status === "success" ? "success" : "error";
}

function getStatus(component: ToolExecutionLike, patch: FoldlinePatch): ToolStatus {
	// A component reports partial output until the final tool result has been
	// installed. Prefer that lifecycle state so a result event cannot turn the
	// border green a frame before the UI receives tool_execution_end.
	if (component.isPartial === true) return "running";

	if (component.result && component.isPartial === false) {
		return component.result.isError ? "error" : "success";
	}

	if (component.toolCallId) {
		const remembered = patch.statuses.get(component.toolCallId);
		if (remembered) return remembered;
	}

	// Fallbacks for current pi internals: the lifecycle map covers component shapes
	// without these fields, and restored sessions may predate this extension.
	if (!component.result) return "running";
	return component.result.isError ? "error" : "success";
}

/**
 * A rounded transparent frame. `label` is already styled and sits in the top
 * border after a `─`: `╭─ thinking ─────╮`.
 */
function frameToolLines(
	lines: string[],
	width: number,
	colorName: string,
	theme: Theme | undefined,
	label?: string,
): string[] {
	if (width <= 0) return [];
	if (width < 2) {
		return lines.map((line) => truncateToWidth(removeBackgroundSgr(line), Math.max(1, width), ""));
	}

	const innerWidth = width - 2;
	const border = (text: string) =>
		theme?.fg(colorName as Parameters<Theme["fg"]>[0], text) ??
		(colorName === "error" ? `\x1b[31m${text}\x1b[39m` : `\x1b[38;5;245m${text}\x1b[39m`);

	let top: string;
	if (label) {
		const shown = visibleWidth(label) > innerWidth - 3
			? truncateToWidth(label, Math.max(1, innerWidth - 3), "…")
			: label;
		const pad = Math.max(0, innerWidth - 1 - visibleWidth(shown));
		top = `${border("╭─")}${shown}${border(`${"─".repeat(pad)}╮`)}`;
	} else {
		top = border(`╭${"─".repeat(innerWidth)}╮`);
	}
	const bottom = border(`╰${"─".repeat(innerWidth)}╯`);

	const body = lines.map((line) => {
		let content = removeBackgroundSgr(line);
		if (visibleWidth(content) > innerWidth) {
			content = truncateToWidth(content, innerWidth, "");
		}
		content += " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
		return `${border("│")}${content}${border("│")}`;
	});

	return [top, ...body, bottom];
}

function clipToWidth(line: string, width: number, ellipsis = "…"): string {
	return visibleWidth(line) <= width ? line : truncateToWidth(line, width, ellipsis);
}

// ── Tool rows and boxes ─────────────────────────────────────────────────────

/** `~` for a home path keeps a border label about the file, not the user. */
function shortenHome(path: string): string {
	const home = homedir();
	return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The border title on a standalone box: `edit ~/app.ts  +4/-2`. */
function standaloneLabel(tool: ToolExecutionLike, status: ToolStatus, theme: ColorTheme): string {
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

/** Visual lines of a written file shown while the box is folded. */
const WRITE_PREVIEW_LINES = 10;
const WRITE_TAB = "   ";
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

interface WritePreview {
	content: string;
	lines: string[];
}

const writePreviews = new WeakMap<object, WritePreview>();

/** Plain content preview for a successful write; the border carries the path. */
function writePreviewLines(tool: ToolExecutionLike, width: number, theme: ColorTheme): string[] | undefined {
	if (tool.toolName !== "write" || tool.isPartial || tool.result?.isError) return undefined;
	const args = tool.args as { content?: unknown } | undefined;
	if (!args || typeof args.content !== "string") return undefined;
	const raw = args.content;

	let preview = writePreviews.get(args);
	if (!preview || preview.content !== raw) {
		const content = raw.replace(/\r/g, "").replace(/\t/g, WRITE_TAB).replace(CONTROL_CHARS, " ");
		const lines = content.split("\n");
		while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		preview = { content: raw, lines };
		writePreviews.set(args, preview);
	}

	const total = preview.lines.length;
	const budget = tool.expanded ? total : Math.min(WRITE_PREVIEW_LINES, total);
	const max = Math.max(1, width - 2);
	const clip = (line: string) => truncateToWidth(line, max, "…");
	const shown = preview.lines.slice(0, budget).map((line) => clip(` ${theme.fg("toolOutput", line)}`));
	if (!tool.expanded && total > shown.length) {
		const more = total - shown.length;
		shown.push(
			clip(` ${theme.fg("muted", `... (${more} more ${more === 1 ? "line" : "lines"}, ${total} total, ctrl+o to expand)`)}`),
		);
	}
	// One blank row on each side keeps the body from touching the border,
	// matching the padding pi's own tool boxes use.
	return ["", ...(shown.length > 0 ? shown : [" "]), ""];
}

/**
 * pi's read/write/edit renderers start with the tool title (`read`,
 * `write <path>`, `edit <path>`). The border now carries that title, so drop
 * the duplicate while keeping the original row count for click translation.
 */
function stripInnerTitle(tool: ToolExecutionLike, lines: string[]): { lines: string[]; dropped: number } {
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

/**
 * A standalone box: a pinned tool, or every tool when grouping is off. The
 * border carries the title; a successful write uses our compact preview so
 * pi's inner `write <path>` title does not repeat it.
 */
function renderStandalone(tool: ToolExecutionLike, width: number, patch: FoldlinePatch): string[] {
	tool.__foldlineHits = [];
	tool.__foldlineBody = undefined;
	tool.__foldlineGrouped = false;
	tool.__foldlineCustom = false;

	// Keep the spacer owned by ToolExecutionComponent outside the frame. The
	// remaining lines are the actual tool call/result content.
	const rawLines = patch.originalRender.call(tool, Math.max(1, width - 2));
	if (rawLines.length === 0) return [];

	const leadingSpacer = rawLines[0] === "" ? [rawLines[0]] : [];
	const status = getStatus(tool, patch);
	const theme = (patch.theme ?? FALLBACK_THEME) as ColorTheme;
	// A successful write gets our own compact preview: pi's native box repeats
	// the path as an inner title, which the border already carries.
	const custom = status === "running" || tool.result?.isError
		? undefined
		: writePreviewLines(tool, width, theme);
	const sourceLines = custom ?? (leadingSpacer.length > 0 ? rawLines.slice(1) : rawLines);
	const stripped = custom === undefined ? stripInnerTitle(tool, sourceLines) : { lines: sourceLines, dropped: 0 };
	const contentLines = stripped.lines;
	if (contentLines.length === 0) return leadingSpacer;

	const framed = frameToolLines(
		contentLines,
		width,
		borderColorFor(status),
		patch.theme,
		standaloneLabel(tool, status, theme),
	);
	const contentTop = leadingSpacer.length + 1;

	tool.__foldlineBody = {
		contentTop,
		bottom: contentTop + contentLines.length - 1,
		sourceStart: leadingSpacer.length + stripped.dropped,
		sourceWidth: Math.max(1, width - 2),
		sourceHeight: sourceLines.length,
		left: 1,
	};
	tool.__foldlineCustom = custom !== undefined;

	return [...leadingSpacer, ...framed];
}

/**
 * The grouped view. The leading spacer pi puts above every tool is dropped:
 * inside a group it would separate the header from its rows.
 */
function renderGrouped(tool: ToolExecutionLike, width: number, patch: FoldlinePatch): string[] {
	const plan = planFor(tool as any);
	if (plan.pinned) return renderStandalone(tool, width, patch);

	const theme = (patch.theme ?? FALLBACK_THEME) as ColorTheme;
	const lines: string[] = [];
	const hits: FoldlineHit[] = [];

	if (plan.header) {
		const summary = groupSummaryFor(tool);
		if (summary) {
			const active = summary.running !== undefined || summary.thinkingLive;
			if (active) tickSpinner();
			const spinner = active ? spinnerFrame() : undefined;
			// One blank above the summary, matching the blank the next message
			// brings with it. The rows under the summary stay tight. A user
			// message already ends on one, so it does not get a second.
			if (needsLeadingBlank()) lines.push("");
			lines.push(clipToWidth(formatGroupLine(summary, theme, plan.header === "open", spinner), width));
			hits.push({ y: lines.length - 1, kind: "header" });
			noteHeaderDrawn(tool);
		}
	}

	// An opened call keeps its row: the box hangs under it, so the row is also
	// the target that folds it back.
	if (plan.row || plan.full) {
		const status = getStatus(tool, patch);
		const spinner = status === "running" ? spinnerFrame() : undefined;
		if (spinner) tickSpinner();
		const row = formatToolRow(tool, status, theme, Math.max(1, width - GUTTER_CELLS), spinner);
		lines.push(clipToWidth(groupGutter(theme) + row, width));
		hits.push({ y: lines.length - 1, kind: "row" });
	}

	let body: BodyGeometry | undefined;
	if (plan.full) {
		// Gutter, one space, then the frame — the box hangs under its row rather
		// than butting into the rail.
		const boxWidth = Math.max(4, width - GUTTER_CELLS - 1);
		const rawLines = patch.originalRender.call(tool, Math.max(1, boxWidth - 2));
		const sourceStart = rawLines[0] === "" ? 1 : 0;
		const rawContent = rawLines.slice(sourceStart);
		const stripped = stripInnerTitle(tool, rawContent);
		const contentLines = stripped.lines;

		if (contentLines.length > 0) {
			const status = getStatus(tool, patch);
			// The row above carries args and timing; the border carries the name.
			const boxLabel = ` ${theme.fg("toolTitle", tool.toolName ?? "tool")} `;
			const framed = frameToolLines(contentLines, boxWidth, borderColorFor(status), patch.theme, boxLabel);
			const framedTop = lines.length;
			for (const line of framed) lines.push(`${groupGutter(theme)} ${line}`);
			body = {
				contentTop: framedTop + 1,
				bottom: framedTop + framed.length - 2,
				sourceStart: sourceStart + stripped.dropped,
				sourceWidth: Math.max(1, boxWidth - 2),
				sourceHeight: rawContent.length,
				left: GUTTER_CELLS + 2,
			};
		}
	}

	tool.__foldlineHits = hits;
	tool.__foldlineBody = body;
	tool.__foldlineGrouped = true;
	tool.__foldlineCustom = false;
	return lines;
}

// ── Thinking rows ───────────────────────────────────────────────────────────

interface ThinkingState {
	/** Runs the reader has opened. */
	open: Set<number>;
	signature?: { blocks: number; chars: number };
	runs: readonly string[];
	/** When the thinking text last grew during the current stream. */
	lastGrowthAt?: number;
}

/** How long after its last token a thinking run still counts as arriving. */
const THOUGHT_LIVE_MS = 1500;

function thinkingLive(component: { isStreaming?: boolean }, now = Date.now()): boolean {
	if (component.isStreaming !== true) return false;
	const at = thinkingStateOf(component as object).lastGrowthAt;
	return at !== undefined && now - at < THOUGHT_LIVE_MS;
}

const thinkingOf = new WeakMap<object, ThinkingState>();

function thinkingStateOf(component: object): ThinkingState {
	let state = thinkingOf.get(component);
	if (!state) {
		state = { open: new Set(), runs: [] };
		thinkingOf.set(component, state);
	}
	return state;
}

/** The message's thinking, one entry per *run* (consecutive thinking blocks). */
function thinkingRunsOf(component: { lastMessage?: { content?: unknown } }): readonly string[] {
	const message = component.lastMessage;
	if (!message || !Array.isArray(message.content)) return [];
	const content = message.content as Array<{ type?: unknown; thinking?: unknown }>;

	let blocks = 0;
	let chars = 0;
	for (const block of content) {
		if (block?.type === "thinking" && typeof block.thinking === "string") {
			blocks++;
			chars += block.thinking.length;
		}
	}

	const state = thinkingStateOf(component);
	if (state.signature?.blocks === blocks && state.signature?.chars === chars) return state.runs;
	// Only a live stream grows; a restored session hands over the whole text at
	// once, and must not start a spinner.
	if (chars > (state.signature?.chars ?? 0) && (component as { isStreaming?: boolean }).isStreaming === true) {
		state.lastGrowthAt = Date.now();
	}

	const runs: string[] = [];
	for (let i = 0; i < content.length; i++) {
		if (content[i]?.type !== "thinking") continue;
		const parts: string[] = [];
		for (; i < content.length && content[i]?.type === "thinking"; i++) {
			const text = content[i].thinking;
			if (typeof text === "string" && text.trim()) parts.push(text.trim());
		}
		i--;
		if (parts.length > 0) runs.push(parts.join("\n\n"));
	}
	state.signature = { blocks, chars };
	state.runs = runs;
	return runs;
}

/** The thinking body: wrapped, framed, and sitting under its row like a tool box. */
function renderThinkingBody(text: string, width: number, theme: ColorTheme): string[] {
	const boxWidth = Math.max(6, width - GUTTER_CELLS - 1);
	const contentWidth = Math.max(4, boxWidth - 4);
	const wrapped: string[] = [];
	for (const paragraph of text.split(/\n+/)) {
		const flat = paragraph.replace(/\s+/g, " ").trim();
		if (!flat) continue;
		for (const line of wrapTextWithAnsi(flat, contentWidth)) wrapped.push(line);
	}
	if (wrapped.length === 0) return [];

	const content = wrapped.map((line) => ` ${theme.fg("thinkingText", line)}`);
	const label = ` ${theme.fg("warning", "thinking")} `;
	return frameToolLines(content, boxWidth, "borderMuted", theme as Theme, label)
		.map((line) => `${groupGutter(theme)} ${line}`);
}

/**
 * One row per thinking run, plus the framed body of the runs the reader opened.
 * The same rows serve a carrier inside a group and a message that has text of
 * its own, so thinking looks the same wherever it appears.
 */
function renderThoughts(
	component: object,
	runs: readonly string[],
	width: number,
	patch: FoldlinePatch,
	header?: string,
): string[] {
	const theme = (patch.theme ?? FALLBACK_THEME) as ColorTheme;
	const state = thinkingStateOf(component);
	const live = thinkingLive(component as { isStreaming?: boolean });
	if (live) tickSpinner();
	const lines: string[] = [];
	const hits: ThoughtHit[] = [];
	const bodies: ThoughtBody[] = [];

	if (header) {
		// The group summary opens the block: one blank above it, rows tight below.
		if (needsLeadingBlank()) lines.push("");
		lines.push(clipToWidth(header, width));
		hits.push({ y: lines.length - 1, run: -1 });
		noteHeaderDrawn(component);
	}

	runs.forEach((run, index) => {
		hits.push({ y: lines.length, run: index });
		// Only the newest run is still growing; earlier ones are settled.
		const spinner = live && index === runs.length - 1 ? spinnerFrame() : undefined;
		lines.push(formatThoughtRow(run, theme, width, spinner));
		if (!state.open.has(index)) return;
		const body = renderThinkingBody(run, width, theme);
		if (body.length === 0) return;
		const top = lines.length;
		lines.push(...body);
		bodies.push({ run: index, top, bottom: lines.length - 1 });
	});

	Object.assign(component, { __foldlineThoughtHits: hits, __foldlineThoughtBodies: bodies });
	return lines;
}

function renderCarrier(component: object, plan: ReturnType<typeof noteCarrier>, width: number, patch: FoldlinePatch): string[] {
	if (!plan.rows) {
		Object.assign(component, { __foldlineThoughtHits: [], __foldlineThoughtBodies: [] });
		return [];
	}
	const theme = (patch.theme ?? FALLBACK_THEME) as ColorTheme;
	const summary = plan.header ? groupSummaryFor(component) : undefined;
	const active = summary ? summary.running !== undefined || summary.thinkingLive : thinkingLive(component as { isStreaming?: boolean });
	if (active) tickSpinner();
	const header = summary ? formatGroupLine(summary, theme, true, active ? spinnerFrame() : undefined) : undefined;
	return renderThoughts(component, plan.runs, width, patch, header);
}

function toggleThought(component: object, run: number): void {
	const state = thinkingStateOf(component);
	if (state.open.has(run)) state.open.delete(run);
	else state.open.add(run);
}

/** Split the message's leading spacer rows from its first real line. */
function splitLeadingBlanks(lines: string[]): { index: number; rest: string[] } {
	let index = 0;
	while (index < lines.length && isBlankLine(lines[index])) index++;
	return { index, rest: lines.slice(index) };
}

/**
 * Put thinking rows where pi would have put its thinking: after the message's
 * leading spacer, with one blank row between them and the text. A message with
 * no text of its own gets no trailing blank.
 */
function insertThoughtRows(component: object, lines: string[], rows: string[]): string[] {
	if (rows.length === 0) return lines;
	const { index, rest } = splitLeadingBlanks(lines);
	// pi has no spacer above a thinking-only message; add the one the previous
	// component did not leave, so the first thought is not glued to the prompt.
	const leading = index === 0 && needsLeadingBlank() ? [""] : [];
	// The rows' hit geometry was measured before the message's leading spacer
	// moved them down; shift it so a click still lands on the row it sees.
	const shift = index + leading.length;
	if (shift > 0) {
		const hits = (component as { __foldlineThoughtHits?: ThoughtHit[] }).__foldlineThoughtHits ?? [];
		for (const hit of hits) hit.y += shift;
		const bodies = (component as { __foldlineThoughtBodies?: ThoughtBody[] }).__foldlineThoughtBodies ?? [];
		for (const body of bodies) {
			body.top += shift;
			body.bottom += shift;
		}
	}
	return [...lines.slice(0, index), ...leading, ...rows, ...(rest.length > 0 ? [""] : []), ...rest];
}

/**
 * The tail thought is a group row, so it sits tight under the last tool row.
 * The message's own leading spacer becomes the blank before its text instead
 * of a gap above the row.
 */
function insertTailRows(lines: string[], rows: string[]): string[] {
	if (rows.length === 0) return lines;
	const { rest } = splitLeadingBlanks(lines);
	// Hits were measured from row zero; stripping the spacer keeps them aligned.
	return [...rows, ...(rest.length > 0 ? [""] : []), ...rest];
}

/** The visible shape of an assistant step, as far as folding is concerned. */
interface AssistantShape {
	hasText: boolean;
	hasToolCall: boolean;
	/** A truncated, aborted or errored step draws pi's own notice. */
	broken: boolean;
}

function shapeOf(message: { content?: unknown; stopReason?: unknown }): AssistantShape | undefined {
	if (!Array.isArray(message.content)) return undefined;
	let hasText = false;
	let hasToolCall = false;
	for (const block of message.content as Array<{ type?: unknown; text?: unknown }>) {
		if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) hasText = true;
		if (block?.type === "toolCall") hasToolCall = true;
	}
	return {
		hasText,
		hasToolCall,
		broken: message.stopReason === "length" || message.stopReason === "error" || message.stopReason === "aborted",
	};
}

/**
 * Draw a non-carrier step's thinking at the tail of the group it follows.
 * Returns undefined when there is no group to join, so the caller can fall
 * back to a regular message-local thinking row.
 */
function renderTail(
	component: any,
	lines: string[],
	width: number,
	patch: FoldlinePatch,
	runs: readonly string[],
): string[] | undefined {
	if (runs.length === 0) return undefined;
	const tail = noteTailCarrier(
		component,
		runs,
		thinkingLive(component),
		(component as { isStreaming?: boolean }).isStreaming === true,
	);
	if (tail.runs.length === 0) return undefined;
	const rows = tail.rows ? renderThoughts(component, tail.runs, width, patch) : [];
	const out = tail.rows ? insertTailRows(lines, rows) : lines;
	noteBoundary(component, false);
	return out;
}

/**
 * A message with text, or with no tool calls, is a boundary: the tools after
 * it start a new group. Its thinking may still join the group it follows as a
 * tail. A message that only thinks and calls tools is a carrier: its thinking
 * becomes rows inside the current group.
 */
function decorateAssistant(
	component: any,
	lines: string[],
	width: number,
	patch: FoldlinePatch,
): string[] {
	if (!patch.config.groupTools) {
		releaseCarrier(component);
		return lines;
	}
	const message = component.lastMessage as { content?: unknown; stopReason?: unknown } | undefined;
	if (!message) return lines;
	const shape = shapeOf(message);
	if (!shape) return lines;

	const runs = thinkingRunsOf(component);
	const { hasText, hasToolCall, broken } = shape;
	const carrier = !hasText && hasToolCall && !broken;

	if (!carrier) {
		const tail = broken ? undefined : renderTail(component, lines, width, patch, runs);
		if (tail) return tail;
		releaseCarrier(component);
		noteBoundary(component, false);
		if (runs.length === 0) return lines;
		return insertThoughtRows(component, lines, renderThoughts(component, runs, width, patch));
	}

	if (runs.length === 0) {
		releaseCarrier(component);
		return lines;
	}
	return renderCarrier(component, noteCarrier(component, runs, thinkingLive(component)), width, patch);
}

// ── Assistant component patch ───────────────────────────────────────────────

// Keys stay in the pre-rename `pi.toolbox` namespace so a hot reload can still
// find and dispose wrappers installed by an older build.
const ASSISTANT_WRAPPER = Symbol.for("pi.toolbox.assistant-render");
const ASSISTANT_MOUSE = Symbol.for("pi.toolbox.assistant-mouse");
const ASSISTANT_DECORATED = Symbol.for("pi.toolbox.assistant-decorated");
const ASSISTANT_UPDATE = Symbol.for("pi.toolbox.assistant-update");
const WRAPPER_DISPOSED = Symbol.for("pi.toolbox.wrapper-disposed");

type AssistantKind = "render" | "handleMouse" | "updateContent";

const assistantWrappers: Array<{ proto: any; kind: AssistantKind; wrapper: any; original: any }> = [];
let assistantDisposed = false;

function installAssistantPatch(patch: FoldlinePatch): void {
	const proto = AssistantMessageComponent.prototype as any;

	// pi builds its thinking label/body as children in updateContent, and reads
	// `hideThinkingBlock` there. Force it to omit thinking while our rows carry
	// it, regardless of the user's own hideThinkingBlock setting.
	const currentUpdate = proto.updateContent;
	if (
		typeof currentUpdate === "function" &&
		!(currentUpdate[ASSISTANT_UPDATE] && !currentUpdate[WRAPPER_DISPOSED])
	) {
		const originalUpdate = currentUpdate;
		const wrappedUpdate = function (this: any, message: any, isStreaming?: boolean): void {
			if (assistantDisposed || !patch.config.groupTools) {
				originalUpdate.call(this, message, isStreaming);
				return;
			}
			const hide = this.hideThinkingBlock;
			const label = this.hiddenThinkingLabel;
			this.hideThinkingBlock = true;
			this.hiddenThinkingLabel = "";
			try {
				originalUpdate.call(this, message, isStreaming);
			} finally {
				this.hideThinkingBlock = hide;
				this.hiddenThinkingLabel = label;
			}
		};
		wrappedUpdate[ASSISTANT_UPDATE] = true;
		wrappedUpdate[WRAPPER_DISPOSED] = false;
		proto.updateContent = wrappedUpdate;
		assistantWrappers.push({ proto, kind: "updateContent", wrapper: wrappedUpdate, original: originalUpdate });
	}

	const currentRender = proto.render;
	if (!(currentRender?.[ASSISTANT_WRAPPER] && !currentRender?.[WRAPPER_DISPOSED])) {
		const originalRender = currentRender;
		const wrapped = function (this: any, width: number): string[] {
			if (assistantDisposed) return originalRender.call(this, width);
			const lines = originalRender.call(this, width);
			// Re-wrapped after another extension's renderer: our rows are already
			// in these lines, and a second pass would draw them twice.
			if (this[ASSISTANT_DECORATED] === lines) return lines;
			let out: string[];
			try {
				out = decorateAssistant(this, lines, width, patch);
			} catch {
				out = lines;
			}
			this[ASSISTANT_DECORATED] = out;
			noteRenderedLines(out);
			return out;
		};
		wrapped[ASSISTANT_WRAPPER] = true;
		wrapped[WRAPPER_DISPOSED] = false;
		proto.render = wrapped;
		assistantWrappers.push({ proto, kind: "render", wrapper: wrapped, original: originalRender });
	}

	const currentMouse = proto.handleMouse;
	if (
		typeof currentMouse === "function" &&
		!(currentMouse[ASSISTANT_MOUSE] && !currentMouse[WRAPPER_DISPOSED])
	) {
		const originalMouse = currentMouse;
		const wrapped = function (this: any, event: any): unknown {
			if (assistantDisposed) return originalMouse.call(this, event);
			const click = event?.type === "click" && (event.button === "left" || event.button === 0);
			const y = typeof event?.y === "number" ? event.y : undefined;
			if (click && y !== undefined) {
				const hit = (this.__foldlineThoughtHits as ThoughtHit[] | undefined)?.find((entry) => entry.y === y);
				if (hit) {
					if (hit.run < 0) toggleGroup(this);
					else toggleThought(this, hit.run);
					requestGroupRender();
					return { handled: true };
				}
				const body = (this.__foldlineThoughtBodies as ThoughtBody[] | undefined)?.find(
					(entry) => y >= entry.top && y <= entry.bottom,
				);
				if (body) {
					toggleThought(this, body.run);
					requestGroupRender();
					return { handled: true };
				}
			}
			return originalMouse.call(this, event);
		};
		wrapped[ASSISTANT_MOUSE] = true;
		wrapped[WRAPPER_DISPOSED] = false;
		proto.handleMouse = wrapped;
		assistantWrappers.push({ proto, kind: "handleMouse", wrapper: wrapped, original: originalMouse });
	}
}

/**
 * `/reload` emits session_shutdown before the new module loads. Restore each
 * wrapper that is still on top; one another extension covered stays in the
 * chain as a pass-through, so their wrapper is never torn out from underneath.
 */
function disposeAssistantPatch(): void {
	assistantDisposed = true;
	for (const { proto, kind, wrapper, original } of assistantWrappers) {
		if (proto[kind] === wrapper) proto[kind] = original;
		else wrapper[WRAPPER_DISPOSED] = true;
	}
	assistantWrappers.length = 0;
}

// ── Tool component patch ────────────────────────────────────────────────────

function installPatch(): FoldlinePatch {
	const prototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
	const existing = Reflect.get(prototype, FOLDLINE_PATCH) as FoldlinePatch | undefined;
	if (existing) return existing;

	const originalGetCallRenderer = prototype.getCallRenderer;
	const patch: FoldlinePatch = {
		originalRender: prototype.render,
		originalGetCallRenderer,
		originalHandleMouse: prototype.handleMouse,
		originalSetExpanded: prototype.setExpanded,
		statuses: new Map(),
		config: DEFAULT_CONFIG,
	};

	Reflect.set(prototype, FOLDLINE_PATCH, patch);

	// Keep Pi's normal Bash renderer alive for its elapsed-time state, but
	// replace only the displayed call component with the standalone tokenizer.
	if (originalGetCallRenderer) {
		const callRendererWrapper = function foldlineGetCallRenderer(this: ToolExecutionLike): CallRenderer | undefined {
			if (patch.disposed) return patch.originalGetCallRenderer?.call(this);
			const originalRenderer = patch.originalGetCallRenderer?.call(this);
			if (this.toolName !== "bash") return originalRenderer;

			return (args, theme, context) => {
				try {
					originalRenderer?.(args, theme, context);
				} catch {
					// A third-party Bash renderer must not prevent the highlighted
					// fallback from being displayed.
				}

				const previous = context?.lastComponent as { setText?: (text: string) => void } | undefined;
				const text = previous && typeof previous.setText === "function"
					? (previous as Text)
					: new Text("", 0, 0);
				text.setText(formatBashCallHighlighted(args, theme));
				return text;
			};
		};
		prototype.getCallRenderer = callRendererWrapper;
		patch.callRendererWrapper = callRendererWrapper;
	}

	const renderWrapper = function foldlineRender(this: ToolExecutionLike, width: number): string[] {
		if (patch.disposed) return patch.originalRender.call(this, width);
		let lines: string[];
		try {
			lines = patch.config.groupTools ? renderGrouped(this, width, patch) : renderStandalone(this, width, patch);
		} catch {
			// A malformed tool result must not take the transcript down with it.
			this.__foldlineHits = [];
			this.__foldlineBody = undefined;
			this.__foldlineGrouped = false;
			lines = patch.originalRender.call(this, width);
		}
		noteRenderedLines(lines);
		return lines;
	};
	prototype.render = renderWrapper;
	patch.renderWrapper = renderWrapper;

	const setExpandedWrapper = function foldlineSetExpanded(this: ToolExecutionLike, expanded: boolean): void {
		if (patch.disposed) {
			patch.originalSetExpanded?.call(this, expanded);
			return;
		}
		patch.originalSetExpanded?.call(this, expanded);
		noteSetExpanded(this as any, expanded, pointerDepth > 0);
	};
	prototype.setExpanded = setExpandedWrapper;
	patch.setExpandedWrapper = setExpandedWrapper;

	const handleMouseWrapper = function foldlineHandleMouse(this: ToolExecutionLike, event: any): unknown {
		if (patch.disposed) return patch.originalHandleMouse?.call(this, event);
		const y = typeof event?.y === "number" ? event.y : undefined;
		const click = event?.type === "click" && (event.button === "left" || event.button === 0);

		const hits = this.__foldlineHits;
		if (click && y !== undefined && hits && hits.length > 0) {
			const hit = hits.find((entry) => entry.y === y);
			if (hit?.kind === "header") {
				toggleGroup(this);
				this.ui?.requestRender?.();
				return { handled: true };
			}
			if (hit?.kind === "row") {
				asPointer(() => this.setExpanded?.(!this.expanded));
				this.ui?.requestRender?.();
				return { handled: true };
			}
		}

		const body = this.__foldlineBody;
		// Our write preview has no pi layout underneath it: any click on the box
		// (border included) flips the preview between truncated and full.
		if (click && this.__foldlineCustom && body && y !== undefined && y >= body.contentTop - 1 && y <= body.bottom + 1) {
			asPointer(() => this.setExpanded?.(!this.expanded));
			this.ui?.requestRender?.();
			return { handled: true };
		}

		// Inside the box, translate back into the coordinates pi's own rows were
		// rendered at; whatever the content does not take (a click on the border,
		// or on a row no sub-component owns) toggles the box.
		if (body && y !== undefined && typeof event?.x === "number" && y >= body.contentTop && y <= body.bottom) {
			const translated = {
				...event,
				x: event.x - body.left,
				y: y - body.contentTop + body.sourceStart,
				width: body.sourceWidth,
				height: body.sourceHeight,
			};
			let handled: unknown;
			try {
				handled = asPointer(() => patch.originalHandleMouse?.call(this, translated));
			} catch {
				// A sub-component whose layout is stale must not swallow the click.
			}
			if (handled !== undefined) return handled;
		}

		if (click && body && y !== undefined && y >= body.contentTop - 1 && y <= body.bottom + 1) {
			asPointer(() => this.setExpanded?.(!this.expanded));
			this.ui?.requestRender?.();
			return { handled: true };
		}

		// A grouped component drew its own rows; there is no pi layout underneath
		// them to hand a stray click to.
		if (this.__foldlineGrouped) return undefined;
		return asPointer(() => patch.originalHandleMouse?.call(this, event));
	};
	prototype.handleMouse = handleMouseWrapper;
	patch.handleMouseWrapper = handleMouseWrapper;

	return patch;
}

function rememberStatus(patch: FoldlinePatch, toolCallId: string, status: ToolStatus): void {
	patch.statuses.delete(toolCallId);
	patch.statuses.set(toolCallId, status);
	while (patch.statuses.size > MAX_REMEMBERED_STATUSES) {
		const oldest = patch.statuses.keys().next().value;
		if (oldest === undefined) break;
		patch.statuses.delete(oldest);
	}
}

/**
 * `/reload` emits session_shutdown before the new module loads. Restore what
 * is still on top and mark the rest as pass-through, then drop the symbol so
 * the new module installs a fresh patch and fresh group state.
 */
function disposePatch(patch: FoldlinePatch): void {
	patch.disposed = true;
	const prototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
	if (prototype.render === patch.renderWrapper) prototype.render = patch.originalRender;
	if (patch.originalGetCallRenderer && prototype.getCallRenderer === patch.callRendererWrapper) {
		prototype.getCallRenderer = patch.originalGetCallRenderer;
	}
	if (patch.originalHandleMouse && prototype.handleMouse === patch.handleMouseWrapper) {
		prototype.handleMouse = patch.originalHandleMouse;
	}
	if (patch.originalSetExpanded && prototype.setExpanded === patch.setExpandedWrapper) {
		prototype.setExpanded = patch.originalSetExpanded;
	}
	if (Reflect.get(prototype, FOLDLINE_PATCH) === patch) Reflect.deleteProperty(prototype, FOLDLINE_PATCH);
}

// ── Entry point ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	installStatusDedupe();
	const patch = installPatch();
	const config = loadConfig();
	// `/reload` re-runs this entry point on top of the existing prototype patch.
	patch.config = config;
	configureGroups({ enabled: config.groupTools });
	installGroupBoundaries();
	installAssistantPatch(patch);

	pi.on("session_start", async (_event, ctx) => {
		patch.theme = ctx.ui.theme;
	});

	// Another extension may restyle a message after this load without calling
	// down; put the boundary hooks back on top before a reply starts rather
	// than at its first tool, when half the calls have already joined a group.
	pi.on("before_agent_start", async () => {
		installGroupBoundaries();
		installAssistantPatch(patch);
	});

	pi.on("tool_execution_start", async (event) => {
		rememberStatus(patch, event.toolCallId, "running");
	});

	pi.on("tool_execution_update", async (event) => {
		rememberStatus(patch, event.toolCallId, "running");
	});

	pi.on("tool_result", async (event) => {
		rememberStatus(patch, event.toolCallId, event.isError ? "error" : "success");
	});

	pi.on("tool_execution_end", async (event) => {
		rememberStatus(patch, event.toolCallId, event.isError ? "error" : "success");
	});

	pi.on("session_shutdown", async (event) => {
		// Only a reload replaces this module, and quit ends the process. A new,
		// resumed or forked session keeps the same module: tearing the hooks down
		// there left the next transcript with pi's native thinking and no groups.
		if (event.reason === "reload" || event.reason === "quit") {
			disposeAssistantPatch();
			disposeGroupBoundaries();
			disposePatch(patch);
			return;
		}
		resetSessionState();
		patch.statuses.clear();
		// Another extension may have wrapped a component during the switch.
		installGroupBoundaries();
		installAssistantPatch(patch);
	});
}
