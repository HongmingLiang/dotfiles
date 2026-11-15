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
const MARKER_TERMINATOR = "\x07";
const LABEL_MARKER = `${MARKER_PREFIX}l`;

/**
 * The composed rule label ("User · 14:32 · openai/gpt-5"). The sticky header
 * reads it back instead of guessing at the frame's rule characters.
 */
export function messageLabelMarker(label: string): string {
	return label ? `${LABEL_MARKER}${label}${MARKER_TERMINATOR}` : "";
}

export function extractMessageLabel(line: string): string | undefined {
	const start = line.indexOf(LABEL_MARKER);
	if (start < 0) return undefined;
	const from = start + LABEL_MARKER.length;
	const end = line.indexOf(MARKER_TERMINATOR, from);
	if (end < 0) return undefined;
	const label = line.slice(from, end).trim();
	return label || undefined;
}

const MESSAGE_MARKER_RE = /\x1b_pi_um:(?:[ste]|l[^\x07]*)\x07/g;

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
