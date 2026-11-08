/**
 * pi's status lines are appended as Spacer + ThemedText pairs. Its "already
 * showing this status" check only looks at the last two children, so a
 * ctrl+o/ctrl+t before each new tool appends another pair; every pair renders
 * the latest message, producing a column of identical lines.
 *
 * Keep only the newest Foldline TUI status pair.
 */

import { Container, Spacer } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

/** Keep the pre-rename key so a hot reload can still prune the old wrapper. */
const STATUS_DEDUPE = Symbol.for("pi.foldline.status-dedupe");
const FOLDLINE_TUI_STATUS = /^(?:Tool output: (?:expanded|collapsed)|Thinking blocks: (?:hidden|visible))$/;

function isFoldlineTuiStatus(child: unknown): boolean {
	const candidate = child as { build?: unknown; setText?: unknown; render?: unknown };
	if (typeof candidate?.build !== "function" || typeof candidate.setText !== "function" || typeof candidate.render !== "function") {
		return false;
	}
	try {
		const rendered = (candidate.render as (width: number) => string[])(200).join("\n");
		return FOLDLINE_TUI_STATUS.test(stripVTControlCharacters(rendered).trim());
	} catch {
		return false;
	}
}

function pruneFoldlineTuiStatuses(container: Container, keep: unknown): void {
	const remove = new Set<unknown>();
	container.children.forEach((child, index) => {
		if (child === keep || !isFoldlineTuiStatus(child)) return;
		remove.add(child);
		const previous = container.children[index - 1];
		if (previous instanceof Spacer) remove.add(previous);
	});
	if (remove.size === 0) return;
	container.children = container.children.filter((child) => !remove.has(child));
}

export function installStatusDedupe(): void {
	const prototype = Container.prototype as unknown as { addChild: (child: unknown) => void; [STATUS_DEDUPE]?: true };
	if (prototype[STATUS_DEDUPE]) return;
	const originalAddChild = prototype.addChild;
	prototype.addChild = function addChildWithStatusDedupe(this: Container, child: unknown): void {
		originalAddChild.call(this, child);
		try {
			if (isFoldlineTuiStatus(child)) pruneFoldlineTuiStatuses(this, child);
		} catch {
			// Status cleanup must never take the TUI down with it.
		}
	};
	prototype[STATUS_DEDUPE] = true;
}
