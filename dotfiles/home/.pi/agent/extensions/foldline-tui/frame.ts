/**
 * Transparent rounded frames for tool and thinking boxes.
 *
 * The body keeps foreground styling and hyperlinks; native background colors
 * are removed because Foldline TUI draws its own box surface. Custom edit rows
 * opt out so their diff tints survive.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ToolStatus } from "./tool-summary.ts";

/**
 * Strip background SGR parameters, keep all other styling.
 *
 * theme.bg() emits 48;5;n / 48;2;r;g;b followed by 49, and third-party renderers
 * may mix foreground and background in one SGR, so parse the parameter list
 * instead of deleting a whole escape.
 */
export function removeBackgroundSgr(text: string): string {
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

/**
 * Tool boxes use the theme's secondary accent (the link color), which stays
 * distinct from the user-message frame's `accent` / `borderAccent`. Only a
 * failed call turns red.
 */
export function borderColorFor(status: ToolStatus): string {
	return status === "error" ? "error" : "mdLink";
}

/**
 * A rounded transparent frame. `label` is already styled and sits in the top
 * border after a `─`: `╭─ Thinking ─────╮`.
 */
export function frameToolLines(
	lines: string[],
	width: number,
	colorName: string,
	theme: Theme | undefined,
	label?: string,
	keepBackgrounds = false,
): string[] {
	if (width <= 0) return [];
	if (width < 2) {
		return lines.map((line) =>
			truncateToWidth(keepBackgrounds ? line : removeBackgroundSgr(line), Math.max(1, width), ""),
		);
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
		let content = keepBackgrounds ? line : removeBackgroundSgr(line);
		if (visibleWidth(content) > innerWidth) {
			content = truncateToWidth(content, innerWidth, "");
		}
		content += " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
		return `${border("│")}${content}${border("│")}`;
	});

	return [top, ...body, bottom];
}
