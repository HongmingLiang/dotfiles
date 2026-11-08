/**
 * Small ANSI helpers for the user-message frame.
 *
 * Pi renders user messages with a `userMessageBg` background and an
 * `outputPad` left margin. The frame owns both now: it paints no background
 * and applies its own alignment, so those parts must be removed before the
 * content is wrapped.
 */

import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** Strip background SGR parameters while keeping foreground styles and links. */
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

/** Remove trailing spaces without moving ANSI resets that follow them. */
export function trimTrailingSpaces(line: string): string {
	return line.replace(/ +((?:\x1b\[[0-9;]*m)*)$/, "$1");
}

/**
 * Remove exactly `count` leading padding cells. SGR codes may precede the
 * padding, so the spaces are removed after the first run of escape sequences.
 */
export function stripLeadingSpaces(line: string, count: number): string {
	if (count <= 0) return line;

	const prefix = /^((?:\x1b\[[0-9;]*m)*)/.exec(line)?.[1] ?? "";
	let rest = line.slice(prefix.length);
	let removed = 0;
	while (removed < count && rest.startsWith(" ")) {
		rest = rest.slice(1);
		removed++;
	}
	return prefix + rest;
}

/** Kitty and iTerm2 image rows must not be treated as blank padding. */
export function isImageLine(line: string): boolean {
	return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

export function isBlankLine(line: string): boolean {
	return !isImageLine(line) && stripTerminalSequences(line).trim() === "";
}

export function plainText(line: string): string {
	return stripTerminalSequences(line).trim();
}
