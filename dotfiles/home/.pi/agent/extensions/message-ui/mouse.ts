/**
 * Minimal SGR mouse parsing for the sticky user-message header.
 *
 * Modern terminals report mouse events as CSI `<` button `;` column `;` row
 * followed by `M` (press/motion) or `m` (release). Only a plain left-button
 * press is needed here; everything else is handed back to Pi.
 */

export interface SgrMousePacket {
	code: number;
	col: number;
	row: number;
	final: "M" | "m";
}

const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

export function parseSgrMousePackets(data: string): SgrMousePacket[] | undefined {
	const packets: SgrMousePacket[] = [];
	let offset = 0;

	for (const match of data.matchAll(SGR_MOUSE_RE)) {
		if (match.index !== offset) return undefined;
		offset = match.index + match[0].length;
		packets.push({
			code: Number(match[1]),
			col: Number(match[2]),
			row: Number(match[3]),
			final: match[4] as "M" | "m",
		});
	}

	return packets.length > 0 && offset === data.length ? packets : undefined;
}

function baseButton(code: number): number {
	return code & ~(4 | 8 | 16 | 32);
}

export function isLeftPress(packet: SgrMousePacket): boolean {
	return packet.final === "M" && baseButton(packet.code) === 0 && (packet.code & 32) === 0;
}
