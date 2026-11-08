/**
 * Copy-friendly frame for a submitted user message.
 *
 * The message keeps Pi's Markdown rendering, but the frame owns the surface:
 * a theme-colored rounded top rule carrying the label, a tighter left margin,
 * and a bottom rule. Content rows have no vertical frame characters, so
 * selecting them copies the message text without side decorations.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isBlankLine, isImageLine, removeBackgroundSgr, stripLeadingSpaces, trimTrailingSpaces } from "./ansi.ts";
import { MESSAGE_END, MESSAGE_START, MESSAGE_TEXT } from "./markers.ts";

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

function buildTopRule(width: number, theme: FrameTheme | undefined, rawLabel: string): string | undefined {
	if (width < 2) return undefined;

	const inner = width - 2;
	const label = rawLabel.trim();
	if (!label) return border(theme, `╭${"─".repeat(inner)}╮`);

	const labelText = ` ${label} `;
	const labelWidth = visibleWidth(labelText);
	if (labelWidth + 1 > inner) return border(theme, `╭${"─".repeat(inner)}╮`);

	const fill = Math.max(0, inner - labelWidth - 1);
	const styled = paint(theme, "accent", bold(theme, labelText));
	return `${border(theme, "╭─")}${styled}${border(theme, `${"─".repeat(fill)}╮`)}`;
}

export function frameUserMessage(
	lines: readonly string[],
	width: number,
	originalPad: number,
	theme: FrameTheme | undefined,
	config: FrameConfig,
): string[] {
	if (width < 8 || lines.length === 0) return [...lines];

	const top = buildTopRule(width, theme, config.label);
	if (top === undefined) return [...lines];

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

	const bottomRule = border(theme, `╰${"─".repeat(Math.max(0, width - 2))}╯`);
	const topLine = `${zoned.head}${top}${MESSAGE_START}${markedText ? "" : MESSAGE_TEXT}`;
	const bottomLine = `${zoned.tail}${bottomRule}${MESSAGE_END}`;
	const vertical: string[] = [];
	for (let i = 0; i < padY; i++) vertical.push("");

	return [topLine, ...vertical, ...markedContent, ...vertical, bottomLine];
}
