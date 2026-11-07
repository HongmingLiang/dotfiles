/**
 * Parse pi's numbered edit diff into layout rows.
 *
 * This module owns no colors or widths. It only turns the host's diff string
 * into changed/context lines with line numbers, then pairs removed and added
 * runs for the split view.
 */

export type LineKind = "add" | "remove" | "context";

export interface DiffLine {
	kind: LineKind;
	oldNumber: number | null;
	newNumber: number | null;
	text: string;
}

export interface DiffMeta {
	kind: "meta" | "skip";
	text: string;
}

export type DiffEntry = DiffLine | DiffMeta;

export interface SplitRow {
	left?: DiffLine;
	right?: DiffLine;
	meta?: DiffMeta;
}

export function isDiffLine(entry: DiffEntry): entry is DiffLine {
	return entry.kind !== "meta" && entry.kind !== "skip";
}

function parseNumber(value: string | undefined): number | null {
	if (!value || !value.trim()) return null;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function isMetaLine(raw: string): DiffMeta | undefined {
	if (raw.startsWith("diff --git ") || raw.startsWith("index ")) {
		return { kind: "meta", text: raw };
	}
	if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
		return { kind: "meta", text: raw };
	}
	if (raw.startsWith("@@")) {
		return { kind: "meta", text: raw };
	}
	return undefined;
}

/**
 * Parse pi's numbered diff (`- 12 text`, `+ 12 text`, `  12 text`) and the
 * unnumbered fallback (`-text`, `+text`, ` text`). The delta only computes the
 * other side's line number for context rows.
 */
export function parseDiff(diff: string): DiffEntry[] | undefined {
	const entries: DiffEntry[] = [];
	let delta = 0;

	for (const raw of diff.replace(/\r/g, "").split("\n")) {
		if (!raw) continue;

		const meta = isMetaLine(raw);
		if (meta) {
			entries.push(meta);
			continue;
		}

		const numbered = /^([+\- ])(\s*\d+)\s(.*)$/.exec(raw);
		const simple = numbered ? null : /^([+\- ])(.*)$/.exec(raw);
		const match = numbered ?? simple;
		if (!match) {
			entries.push({ kind: "meta", text: raw });
			continue;
		}

		const marker = match[1] as "+" | "-" | " ";
		const number = numbered ? parseNumber(match[2]) : null;
		const text = numbered ? (match[3] ?? "") : (match[2] ?? "");

		if (marker === " ") {
			if (text.trim() === "...") {
				entries.push({ kind: "skip", text: "…" });
				continue;
			}
			entries.push({
				kind: "context",
				oldNumber: number,
				newNumber: number === null ? null : number + delta,
				text,
			});
			continue;
		}

		if (marker === "-") {
			entries.push({ kind: "remove", oldNumber: number, newNumber: null, text });
			delta--;
			continue;
		}

		entries.push({ kind: "add", oldNumber: null, newNumber: number, text });
		delta++;
	}

	return entries.length > 0 ? entries : undefined;
}

/** Pair each removed run with the added run after it, index by index. */
export function buildSplitRows(entries: readonly DiffEntry[]): SplitRow[] {
	const rows: SplitRow[] = [];
	let index = 0;

	while (index < entries.length) {
		const entry = entries[index]!;
		if (!isDiffLine(entry)) {
			rows.push({ meta: entry });
			index++;
			continue;
		}

		if (entry.kind === "add") {
			rows.push({ right: entry });
			index++;
			continue;
		}
		if (entry.kind === "context") {
			rows.push({ left: entry, right: entry });
			index++;
			continue;
		}

		const removed: DiffLine[] = [];
		while (index < entries.length) {
			const candidate = entries[index]!;
			if (candidate.kind !== "remove") break;
			removed.push(candidate);
			index++;
		}

		const added: DiffLine[] = [];
		while (index < entries.length) {
			const candidate = entries[index]!;
			if (candidate.kind !== "add") break;
			added.push(candidate);
			index++;
		}

		const count = Math.max(removed.length, added.length);
		for (let pair = 0; pair < count; pair++) {
			rows.push({
				...(removed[pair] ? { left: removed[pair] } : {}),
				...(added[pair] ? { right: added[pair] } : {}),
			});
		}
	}

	return rows;
}

export function lineNumberWidth(entries: readonly DiffEntry[]): number {
	let width = 2;
	for (const entry of entries) {
		if (!isDiffLine(entry)) continue;
		for (const number of [entry.oldNumber, entry.newNumber]) {
			if (number !== null) width = Math.max(width, String(number).length);
		}
	}
	return width;
}
