/**
 * Zero-width APC markers attached to a rendered user message.
 *
 * The terminal ignores APC sequences, and Pi's `stripTerminalSequences` removes
 * them before measuring or copying text. The sticky header uses them to find
 * the current message and its first readable row without guessing at frames or
 * Markdown shapes.
 */

export const MESSAGE_START = "\x1b_pi_um:s\x07";
export const MESSAGE_TEXT = "\x1b_pi_um:t\x07";
export const MESSAGE_END = "\x1b_pi_um:e\x07";

const MARKER_PREFIX = "\x1b_pi_um:";
const MESSAGE_MARKER_RE = /\x1b_pi_um:[ste]\x07/g;

export function hasMessageMarker(line: string): boolean {
	return line.includes(MARKER_PREFIX);
}

export function stripMessageMarkers(line: string): string {
	return hasMessageMarker(line) ? line.replace(MESSAGE_MARKER_RE, "") : line;
}

export function stripMessageMarkersFromLines(lines: readonly string[]): string[] {
	let dirty = false;
	for (const line of lines) {
		if (hasMessageMarker(line)) {
			dirty = true;
			break;
		}
	}
	return dirty ? lines.map(stripMessageMarkers) : [...lines];
}
