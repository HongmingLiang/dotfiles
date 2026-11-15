/**
 * Copy-friendly frame for a submitted user message.
 *
 * The message keeps Pi's Markdown rendering, but the frame owns the surface:
 * a theme-colored heavy top rule carrying the label, a tighter left margin,
 * and a bottom rule. Content rows have no vertical frame characters, so
 * selecting them copies the message text without side decorations.
 *
 * The label carries the send time and, once the session has been answered by
 * more than one model, the provider/model that answered each message:
 *
 *   ━━ User · 14:32 ━━━━━━━━━━━━━━━━ [Copy] ━━
 *   ━━ User · 02-13 14:35 · openai/gpt-5 ━━ [Copy] ━━
 *
 * Segments are dropped model-first, then time, as the terminal narrows.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isBlankLine, isImageLine, removeBackgroundSgr, stripLeadingSpaces, trimTrailingSpaces } from "./ansi.ts";
import { MESSAGE_END, MESSAGE_START, MESSAGE_TEXT, messageLabelMarker } from "./markers.ts";

export interface FrameTheme {
	fg(color: any, text: string): string;
	bg?(color: any, text: string): string;
	bold?(text: string): string;
}

export interface FrameConfig {
	/** Text inside the top rule. */
	label: string;
	/** Columns between the frame edge and the message body. */
	paddingX: number;
	/** Blank rows between each rule and the body. */
	paddingY: number;
}

export interface CopyRange {
	/** Row local to the component. The copy chip lives on the top rule. */
	row: number;
	start: number;
	width: number;
}

export interface UserMessageFrameResult {
	lines: string[];
	copy?: CopyRange;
}

export interface FrameRenderOptions {
	includeMarkers?: boolean;
	copyLabel?: string;
	copyDone?: boolean;
	/** Preformatted send time, e.g. `14:32`, `02-13 09:12`, or `2025-12-31 09:12`. */
	time?: string;
	/** Preformatted `provider/model`, set only for a multi-model session. */
	model?: string;
}

/**
 * Heavy straight rule: one stroke, no corners, no side rails. The rounded
 * `╭─╮` set read too light next to the message body, and any corner glyph
 * forced a full box; a single line keeps both frames copy-friendly.
 */
const RULE = {
	horizontal: "━",
} as const;

function rule(count: number): string {
	return RULE.horizontal.repeat(Math.max(0, count));
}

export const DEFAULT_FRAME_CONFIG: FrameConfig = {
	label: "User",
	paddingX: 2,
	paddingY: 1,
};

/** Terminal prompt-zone markers (OSC 133) sit on Pi's padding rows. */
const OSC133_RE = /\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

function extractPromptZones(lines: readonly string[]): {
	lines: string[];
	head: string;
	tail: string;
} {
	const zones: string[] = [];
	const cleaned = lines.map((line) =>
		line.replace(OSC133_RE, (sequence) => {
			zones.push(sequence);
			return "";
		}),
	);
	return {
		lines: cleaned,
		head: zones[0] ?? "",
		tail: zones.slice(1).join(""),
	};
}

function paint(theme: FrameTheme | undefined, color: string, text: string): string {
	if (!theme) return text;
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function bold(theme: FrameTheme | undefined, text: string): string {
	if (!theme?.bold) return text;
	try {
		return theme.bold(text);
	} catch {
		return text;
	}
}

/** The frame follows the active theme's highlighted border color. */
export function paintBorder(theme: FrameTheme | undefined, text: string): string {
	return paint(theme, "borderAccent", text);
}

function border(theme: FrameTheme | undefined, text: string): string {
	return paintBorder(theme, text);
}

function buildTopRule(
	width: number,
	theme: FrameTheme | undefined,
	rawLabel: string,
	copyLabel: string,
	copyDone: boolean,
	meta: { time?: string; model?: string },
): { text: string; label?: string; copy?: CopyRange } | undefined {
	if (width < 2) return undefined;

	const label = rawLabel.trim();
	if (!label) return { text: border(theme, rule(width)) };

	// The chip has a fixed width so "Copy" and "Done" do not move the hit area.
	const copyText = ` [${copyLabel.slice(0, 4).padEnd(4, " ")}] `;
	const copyWidth = visibleWidth(copyText);

	const compose = (parts: readonly string[]): string => ` ${parts.join(" · ")} `;
	const parts = [label, meta.time, meta.model].filter(
		(part): part is string => typeof part === "string" && part.length > 0,
	);

	// Keep one rule cell between the label and the chip: shed the model first,
	// then the time, so the label itself survives the longest.
	let labelText = compose(parts);
	while (parts.length > 1 && visibleWidth(labelText) + copyWidth + 5 > width) {
		parts.pop();
		labelText = compose(parts);
	}

	const labelWidth = visibleWidth(labelText);
	const labelStyled = paint(theme, "accent", bold(theme, labelText));
	const fillWithCopy = width - 2 - labelWidth - copyWidth - 2;
	if (fillWithCopy >= 1) {
		const copyStyled = paint(theme, copyDone ? "success" : "borderAccent", bold(theme, copyText));
		return {
			text: `${border(theme, rule(2))}${labelStyled}${border(theme, rule(fillWithCopy))}${copyStyled}${border(theme, rule(2))}`,
			label: labelText.trim(),
			copy: { row: 0, start: 2 + labelWidth + fillWithCopy, width: copyWidth },
		};
	}

	// Without a chip the label still needs two rule cells on each side.
	if (labelWidth + 4 > width) return { text: border(theme, rule(width)) };

	return {
		text: `${border(theme, rule(2))}${labelStyled}${border(theme, rule(width - 2 - labelWidth))}`,
		label: labelText.trim(),
	};
}

export function frameUserMessage(
	lines: readonly string[],
	width: number,
	originalPad: number,
	theme: FrameTheme | undefined,
	config: FrameConfig,
	options: FrameRenderOptions = {},
): UserMessageFrameResult {
	if (width < 8 || lines.length === 0) return { lines: [...lines] };

	const top = buildTopRule(
		width,
		theme,
		config.label,
		options.copyLabel ?? "Copy",
		options.copyDone === true,
		{ time: options.time, model: options.model },
	);
	if (top === undefined) return { lines: [...lines] };

	const padX = Math.max(0, Math.min(config.paddingX, Math.floor((width - 1) / 2)));
	const padY = Math.max(0, Math.min(config.paddingY, 3));

	const zoned = extractPromptZones(lines);
	const normalized = zoned.lines.map((raw) => {
		const withoutBackground = removeBackgroundSgr(raw);
		return stripLeadingSpaces(trimTrailingSpaces(withoutBackground), Math.max(0, originalPad));
	});

	// Pi adds a blank row above and below the Markdown. The frame supplies its
	// own vertical padding, so only interior blank lines are preserved.
	let start = 0;
	let end = normalized.length;
	while (start < end && isBlankLine(normalized[start])) start++;
	while (end > start && isBlankLine(normalized[end - 1])) end--;
	const body = normalized.slice(start, end);

	const content = (body.length > 0 ? body : [""]).map((line) => {
		if (isBlankLine(line)) return "";
		if (isImageLine(line)) return `${" ".repeat(padX)}${line}`;
		return `${" ".repeat(padX)}${truncateToWidth(line, Math.max(1, width - padX * 2), "")}`;
	});

	let markedText = false;
	const markedContent = content.map((line) => {
		if (markedText || isBlankLine(line)) return line;
		markedText = true;
		return `${line}${MESSAGE_TEXT}`;
	});

	const includeMarkers = options.includeMarkers !== false;
	const bottomRule = border(theme, rule(width));
	const labelMarker = messageLabelMarker(top.label ?? "");
	const topLine = includeMarkers
		? `${zoned.head}${top.text}${MESSAGE_START}${labelMarker}${markedText ? "" : MESSAGE_TEXT}`
		: `${zoned.head}${top.text}`;
	const bottomLine = includeMarkers
		? `${zoned.tail}${bottomRule}${MESSAGE_END}`
		: `${zoned.tail}${bottomRule}`;
	const vertical: string[] = [];
	for (let i = 0; i < padY; i++) vertical.push("");

	return {
		lines: [topLine, ...vertical, ...markedContent, ...vertical, bottomLine],
		copy: top.copy,
	};
}
