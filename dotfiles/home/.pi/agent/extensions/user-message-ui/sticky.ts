/**
 * Sticky header for the most recent submitted prompt.
 *
 * Fullscreen mode owns the viewport. Once a user message has scrolled above
 * the top edge, its first readable row is pinned to that edge as a one-line
 * bar. Clicking the bar scrolls back to the message's top rule.
 *
 * The message component writes zero-width markers into its rendered lines;
 * the frame compositor finds them, paints the bar, and strips the markers
 * before the frame reaches the terminal.
 */

import { compositeTuiLine, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isImageLine, plainText } from "./ansi.ts";
import type { FrameTheme } from "./frame.ts";
import {
	MESSAGE_START,
	MESSAGE_TEXT,
	stripMessageMarkers,
	stripMessageMarkersFromLines,
} from "./markers.ts";
import type { SgrMousePacket } from "./mouse.ts";

export interface StickyConfig {
	enabled: boolean;
	label: string;
	hint: string;
	minHintWidth: number;
	background: string;
	/** Extra columns added around the scroll viewport, clamped to the screen. */
	extraWidth: number;
}

export interface StickyState {
	visible: boolean;
	row: number;
	height: number;
	x: number;
	width: number;
	jumpRow: number;
	text: string;
	layout: unknown;
}

export const stickyState: StickyState = {
	visible: false,
	row: -1,
	height: 0,
	x: 0,
	width: 0,
	jumpRow: 0,
	text: "",
	layout: undefined,
};

export function resetStickyState(): void {
	stickyState.visible = false;
	stickyState.row = -1;
	stickyState.height = 0;
	stickyState.x = 0;
	stickyState.width = 0;
	stickyState.jumpRow = 0;
	stickyState.text = "";
	stickyState.layout = undefined;
}

interface StickyInfo {
	row: number;
	x: number;
	width: number;
	jumpRow: number;
	text: string;
}

/** Find the scroll box by identity, falling back to the first content-bearing box. */
function findScrollBox(root: unknown, scrollView: unknown): any {
	let fallback: any;
	const visit = (node: any): any => {
		if (!node) return undefined;
		if (scrollView && node.scrollView === scrollView) return node;
		if (!fallback && Array.isArray(node.scrollContentLines) && node.scrollContentLines.length > 0) {
			fallback = node;
		}
		for (const child of node.children ?? []) {
			const hit = visit(child);
			if (hit) return hit;
		}
		return undefined;
	};
	return visit(root) ?? fallback;
}

function computeSticky(tui: any, layout: any): StickyInfo | undefined {
	const scrollView = layout?.primaryScrollView ?? tui?.getPrimaryScrollView?.();
	const box = findScrollBox(layout?.root, scrollView);
	const lines = box?.scrollContentLines as readonly string[] | undefined;
	const clip = box?.clip;
	if (!box || !Array.isArray(lines) || !clip || clip.width <= 0 || clip.height <= 0) return undefined;

	const view = box.scrollView ?? scrollView;
	const scrollTop = Math.max(0, Math.floor(Number(view?.scrollTop ?? 0)));
	if (scrollTop <= 0) return undefined;

	// The nearest user message at or above the viewport edge is the prompt the
	// reader is currently inside or has just passed.
	let start = -1;
	for (let i = Math.min(scrollTop, lines.length - 1); i >= 0; i--) {
		if ((lines[i] ?? "").includes(MESSAGE_START)) {
			start = i;
			break;
		}
	}
	if (start < 0) return undefined;

	let textRow = -1;
	const scanEnd = Math.min(lines.length - 1, start + 4_000);
	for (let i = start; i <= scanEnd; i++) {
		const line = lines[i] ?? "";
		if (i > start && line.includes(MESSAGE_START)) break;
		if (line.includes(MESSAGE_TEXT)) {
			textRow = i;
			break;
		}
	}
	if (textRow < 0 || textRow >= scrollTop) return undefined;

	const text = plainText(stripMessageMarkers(lines[textRow] ?? "")) || "user message";
	const scrollbar = box.scrollView?.isScrollbarVisible === true && clip.width > 1;

	return {
		row: clip.y,
		x: clip.x,
		width: scrollbar ? Math.max(1, clip.width - 1) : clip.width,
		jumpRow: start,
		text,
	};
}

function color(theme: FrameTheme | undefined, token: string, text: string): string {
	if (!theme) return text;
	try {
		return theme.fg(token, text);
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

function paintBand(
	theme: FrameTheme | undefined,
	token: string,
	line: string,
	width: number,
): string {
	if (!token || !theme?.bg) return line;
	const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
	try {
		return theme.bg(token, padded);
	} catch {
		return line;
	}
}

function renderBarLines(
	text: string,
	width: number,
	theme: FrameTheme | undefined,
	config: StickyConfig,
): string[] {
	const label = color(theme, "accent", bold(theme, config.label));
	const hintText = width >= config.minHintWidth ? config.hint : "";
	const hint = hintText ? ` ${color(theme, "muted", hintText)} ` : "";

	if (width < 12) {
		const plain = truncateToWidth(`${config.label}  ${text}`, width, "…");
		return [paintBand(theme, config.background, plain, width)];
	}

	const labelLead = ` ${label}`;
	const labelPadding = " ".repeat(
		Math.max(0, width - visibleWidth(labelLead) - visibleWidth(hint)),
	);
	const labelLine = `${labelLead}${labelPadding}${hint}`;

	const textLead = " ";
	const body = truncateToWidth(text, Math.max(1, width - visibleWidth(textLead)), "…");
	const textLine = `${textLead}${color(theme, "text", body)}${" ".repeat(
		Math.max(0, width - visibleWidth(textLead) - visibleWidth(body)),
	)}`;

	return [
		paintBand(theme, config.background, labelLine, width),
		paintBand(theme, config.background, textLine, width),
	];
}

export function renderStickyScreen(
	tui: any,
	screen: string[],
	layout: any,
	terminalWidth: number,
	theme: FrameTheme | undefined,
	config: StickyConfig,
): string[] {
	const stripped = stripMessageMarkersFromLines(screen);
	const info = config.enabled ? computeSticky(tui, layout) : undefined;

	stickyState.layout = layout;
	if (!info || info.row < 0 || info.row >= stripped.length || info.width <= 0) {
		resetStickyState();
		stickyState.layout = layout;
		return stripped;
	}

	const base = stripped[info.row] ?? "";
	if (isImageLine(base)) {
		resetStickyState();
		stickyState.layout = layout;
		return stripped;
	}

	// The scroll viewport sometimes reserves a column for its scrollbar or a
	// small right margin. Let the band grow a little into that space so it reads
	// as one continuous header, while staying inside the terminal.
	const extra = Math.max(0, Math.min(config.extraWidth, 8));
	const half = Math.floor(extra / 2);
	const leftGrow = Math.min(half, info.x);
	const rightGrow = Math.min(extra - leftGrow, Math.max(0, terminalWidth - (info.x + info.width)));
	const x = info.x - leftGrow;
	const width = info.width + leftGrow + rightGrow;

	const bars = renderBarLines(info.text, width, theme, config);
	const available = Math.max(0, stripped.length - info.row);
	const visibleBars: string[] = [];
	for (let i = 0; i < bars.length && i < available; i++) {
		if (isImageLine(stripped[info.row + i] ?? "")) break;
		visibleBars.push(bars[i]);
	}
	if (visibleBars.length === 0) {
		resetStickyState();
		stickyState.layout = layout;
		return stripped;
	}

	stickyState.visible = true;
	stickyState.row = info.row;
	stickyState.height = visibleBars.length;
	stickyState.x = x;
	stickyState.width = width;
	stickyState.jumpRow = info.jumpRow;
	stickyState.text = info.text;

	const next = [...stripped];
	visibleBars.forEach((bar, index) => {
		const row = info.row + index;
		next[row] = compositeTuiLine(next[row] ?? "", bar, x, width, terminalWidth);
	});
	return next;
}

export function stickyHit(tui: any, packet: SgrMousePacket): boolean {
	if (!stickyState.visible || stickyState.layout !== tui?.currentLayout) return false;
	const row = packet.row - 1;
	if (row < stickyState.row || row >= stickyState.row + stickyState.height) return false;
	const column = packet.col - 1;
	return column >= stickyState.x && column < stickyState.x + stickyState.width;
}
