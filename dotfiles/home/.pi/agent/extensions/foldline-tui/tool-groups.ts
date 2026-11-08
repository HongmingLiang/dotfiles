/**
 * Tool and thinking folding, Claude-Code style: the calls between two pieces of
 * assistant text (or a user message) share one header and a row per call. Rows
 * start open, but a group with more than AUTO_COLLAPSE_ROWS rows starts folded;
 * the header unfolds them, and ctrl+o opens every call's box.
 *
 *   1  ▾ 4 calls · Bash×3 Read×1 · Thinking×2 · 1.2s   default: one row per call
 *      │ ✓ Thinking  check which assertion failed            a step's thinking
 *      │ ✓ Bash pnpm test  12 lines · 0.5s
 *      │ ✓ Read src/app.ts  120 lines · 0.1s
 *   0  ▸ 4 calls · …                                  click the header to fold
 *
 * ctrl+o adds the detail boxes:
 *
 *      │ ╭───────╮
 *      │ │ …the framed box… │
 *      │ ╰───────╯
 *
 * Membership is decided at render time from transcript order, so a reloaded
 * session folds the same way and nothing is persisted. Group boundaries are the
 * message components: a user message or an assistant message with visible text
 * starts a new group; a step that only calls tools (or only thinks) does not, so
 * a reply that runs six tools in six steps still folds into one line.
 *
 * A step that only thinks and calls tools is a "carrier": it has no text of its
 * own, so its thinking becomes rows in the group instead of a `Thinking...`
 * label per step. The first carrier also takes the header over when the group
 * opens, because it renders before the first tool.
 *
 * `edit` and `write` are pinned: their diff is the point, so they keep their box
 * and end the group before them.
 */

import {
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	SkillInvocationMessageComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { SPINNER_INTERVAL_MS, type GroupSummary } from "./tool-summary.ts";

/** 0 = header only; 1 = one row per call. */
export type GroupLevel = 0 | 1;

export interface GroupMemberLike {
	toolName?: string;
	isPartial?: boolean;
	expanded: boolean;
	result?: { isError?: boolean; durationMs?: number };
	ui?: { requestRender?(): void };
	setExpanded(expanded: boolean): void;
}

/** What a tool component should draw this frame. */
export interface GroupPlan {
	/** The summary line, carried by the group's first member (or first carrier). */
	header: "closed" | "open" | null;
	/** The one-row view of this call. */
	row: boolean;
	/** The full framed box. */
	full: boolean;
	/** Pinned tools keep their box and break the group. */
	pinned: boolean;
}

/** What a thinking-only step (a "carrier") should draw this frame. */
export interface CarrierPlan {
	/** The summary line, drawn by the leading carrier when the group is open. */
	header: boolean;
	/** The group's rows are visible (the group is open). */
	rows: boolean;
	/** Thinking runs, in order. */
	runs: readonly string[];
	/** Real tools in the carrier's group; zero means the row stands alone. */
	members: number;
}

interface Group {
	level: GroupLevel;
	/** The reader chose a level; automatic size folding must not override it. */
	manual: boolean;
	members: GroupMemberLike[];
	/** The thinking runs each carrier contributed, for the header count. */
	thoughts: number;
	/** Carriers whose thinking is still arriving (the header spins). */
	liveCarriers: Set<object>;
	/** Per carrier: how many of its runs the total already includes. */
	counted: Map<object, number>;
	/** The carrier that draws the header when the group is open. */
	headerCarrier: object | null;
	/** The header has already been drawn somewhere this frame. */
	headerDrawn: boolean;
}

export interface GroupOptions {
	enabled: boolean;
}

/**
 * After the reader folds a group, a call hidden for its first second stays
 * hidden: a row that pops out under the summary and folds back a frame later
 * reads as a flicker. Long commands still surface.
 */
export const RUNNING_ROW_DELAY_MS = 1000;

/** Tools that never fold: their box is the point. */
const ALWAYS_SHOW = new Set(["edit", "write"]);
/** A larger row list starts folded so it cannot take over the transcript. */
const AUTO_COLLAPSE_ROWS = 20;

let groupingEnabled = true;
/** Every group in this session, so ctrl+t can reveal the ones with thinking. */
const allGroups = new Set<Group>();
let current: Group = newGroup();
/** The group of the most recent real tool; a non-carrier step's thought joins it. */
let lastMemberGroup: Group | undefined;
const groupOfTool = new WeakMap<object, Group>();
/** A pinned tool starts one stable group; re-rendering it must not reset it. */
let groupOfPinned = new WeakMap<object, Group>();
const groupAtBoundary = new WeakMap<object, Group>();
const groupOfCarrier = new WeakMap<object, Group>();
const firstSeen = new WeakMap<object, number>();
const revealScheduled = new WeakSet<object>();

/** The most recent TUI, so a carrier with no tool in its group can still repaint. */
let lastRenderer: { requestRender?(): void } | undefined;

/**
 * Whether the last component that actually drew something ended on a blank
 * row. A group opens with one blank above its summary — but only when the
 * component before it did not already leave one (a user message does).
 */
let lastLineBlank = true;

/** A line that only draws a background fill is a band, not a separator. */
const BG_FILL = /\x1b\[(?:48;[0-9;]*|4[0-7]|10[0-7])m/;

/** Visually empty: padding spaces and foreground escapes do not count. */
export function isBlankLine(line: string): boolean {
	if (BG_FILL.test(line)) return false;
	return stripVTControlCharacters(line).trim() === "";
}

export function noteRenderedLines(lines: readonly string[]): void {
	if (lines.length === 0) return;
	lastLineBlank = isBlankLine(lines[lines.length - 1] ?? "");
}

export function needsLeadingBlank(): boolean {
	return !lastLineBlank;
}

function newGroup(): Group {
	const group: Group = {
		level: 1,
		manual: false,
		members: [],
		thoughts: 0,
		liveCarriers: new Set(),
		counted: new Map(),
		headerCarrier: null,
		headerDrawn: false,
	};
	allGroups.add(group);
	return group;
}

/**
 * A group's row list is what takes over the screen, not the size of one box.
 * Once it grows past AUTO_COLLAPSE_ROWS, close it unless the reader already
 * chose a level for it. Tools and thinking runs both count as rows.
 */
function maybeAutoCollapse(group: Group): void {
	if (group.manual || group.members.length === 0) return;
	const rows = group.members.length + group.thoughts;
	if (rows <= AUTO_COLLAPSE_ROWS || group.level === 0) return;
	group.level = 0;
	for (const member of group.members) {
		if (member.expanded) member.setExpanded(false);
	}
	requestGroupRender();
}

/**
 * ctrl+t is a global "show thinking" action: a collapsed group must not hide
 * the bodies it just opened. Open only groups that actually have thinking.
 */
export function openThinkingGroups(): void {
	let changed = false;
	for (const group of allGroups) {
		if (group.level === 0 && group.thoughts > 0) {
			group.level = 1;
			group.manual = true;
			changed = true;
		}
	}
	if (changed) requestGroupRender();
}

export function configureGroups(options: GroupOptions): void {
	groupingEnabled = options.enabled;
}

export function rememberRenderer(ui: { requestRender?(): void } | undefined): void {
	if (ui) lastRenderer = ui;
}

export function requestGroupRender(): void {
	lastRenderer?.requestRender?.();
}

let spinnerTimer: ReturnType<typeof setTimeout> | undefined;
let lastSpinnerTick = 0;

/**
 * Ask for the next spinner frame. Called by the rows that are showing one;
 * when nothing is running or arriving, nothing calls it and the timer stops.
 */
export function tickSpinner(): void {
	if (spinnerTimer) return;
	const delay = Math.max(0, SPINNER_INTERVAL_MS - (Date.now() - lastSpinnerTick)) + 5;
	spinnerTimer = setTimeout(() => {
		spinnerTimer = undefined;
		lastSpinnerTick = Date.now();
		lastRenderer?.requestRender?.();
	}, delay);
	spinnerTimer.unref?.();
}

/**
 * A user/compaction/branch/custom message starts a new group. An assistant
 * text message also ends the current group, but it must not clear the "last
 * real tool" pointer: its own trailing thinking still belongs to that group.
 */
export function noteBoundary(component: object, resetTail = true): void {
	if (resetTail) lastMemberGroup = undefined;
	let group = groupAtBoundary.get(component);
	if (!group) {
		group = newGroup();
		groupAtBoundary.set(component, group);
	}
	current = group;
}

/**
 * Count a step's thinking runs once and keep the group's live set current.
 * Both a carrier and a tail use this; only the row-placement rule differs.
 */
function attachRuns(group: Group, component: object, runs: readonly string[], live: boolean): void {
	const counted = group.counted.get(component) ?? 0;
	if (runs.length > counted) {
		group.thoughts += runs.length - counted;
		group.counted.set(component, runs.length);
		if (group.headerDrawn) requestGroupRender();
	}
	if (live) group.liveCarriers.add(component);
	else if (group.liveCarriers.delete(component) && group.headerDrawn) requestGroupRender();
	maybeAutoCollapse(group);
}

/**
 * The runs of a carrier step joined the current group. Counts only ever grow,
 * so a streaming step adds its new runs once; a message that turns out to have
 * text gives them back through `releaseCarrier`.
 */
export function noteCarrier(component: object, runs: readonly string[], live = false): CarrierPlan {
	let group = groupOfCarrier.get(component);
	if (!group) {
		group = current;
		groupOfCarrier.set(component, group);
		if (group.members.length === 0 && group.headerCarrier === null) {
			group.headerCarrier = component;
		}
	}

	attachRuns(group, component, runs, live);

	const open = group.level === 1;
	return {
		header: open && group.members.length > 0 && group.headerCarrier === component,
		rows: open && runs.length > 0,
		runs,
		members: group.members.length,
	};
}

/** What a text step's trailing thinking should draw after the group's rows. */
export interface TailPlan {
	/** Draw the runs at the tail of the group's row list (open, or live). */
	rows: boolean;
	/** Runs to draw (empty when there is no group with tools to join). */
	runs: readonly string[];
}

/**
 * A non-carrier step can still close a group with its thinking: the final
 * answer, or a step that writes a sentence before calling one more tool. That
 * thinking belongs to the calls above it, so it folds and unfolds with them.
 * It never takes the header (the first tool owns that) and it never starts a
 * new group for itself; the caller notes the boundary afterwards so later
 * tools land in a fresh group.
 */
export function noteTailCarrier(
	component: object,
	runs: readonly string[],
	live = false,
	streaming = false,
): TailPlan {
	let group = groupOfCarrier.get(component);
	if (!group || group.members.length === 0) group = lastMemberGroup;
	if (!group || group.members.length === 0) return { rows: false, runs: [] };
	if (groupOfCarrier.get(component) !== group) groupOfCarrier.set(component, group);

	attachRuns(group, component, runs, live);

	// A live final thought is the answer being thought: show it under the
	// folded header while it streams, then let it fold away when the message
	// settles. An open group always shows it.
	return { rows: (group.level === 1 || streaming) && runs.length > 0, runs };
}

/**
 * This message stopped being a carrier: its text arrived (so it is a boundary
 * now), it ended without tool calls, or it is an error row. Take its runs back
 * out of the group so the header does not promise rows that are never drawn.
 */
export function releaseCarrier(component: object): void {
	const group = groupOfCarrier.get(component);
	if (!group) return;
	const counted = group.counted.get(component) ?? 0;
	if (counted > 0) {
		group.thoughts = Math.max(0, group.thoughts - counted);
		group.counted.delete(component);
	}
	group.liveCarriers.delete(component);
	if (group.headerCarrier === component) {
		group.headerCarrier = null;
		if (group.level === 1 && group.members.length > 0) requestGroupRender();
	}
	groupOfCarrier.delete(component);
}

function requestLater(tool: GroupMemberLike, ms: number): void {
	if (revealScheduled.has(tool)) return;
	revealScheduled.add(tool);
	const timer = setTimeout(() => {
		revealScheduled.delete(tool);
		tool.ui?.requestRender?.();
	}, Math.max(0, ms) + 20);
	timer.unref?.();
}

/**
 * What this call draws this frame. Also the only place membership is decided:
 * the first render adds the tool to the group its boundary selected.
 */
export function planFor(tool: GroupMemberLike, now = Date.now()): GroupPlan {
	const name = tool.toolName ?? "";
	rememberRenderer(tool.ui);

	if (ALWAYS_SHOW.has(name)) {
		// A pinned box keeps its frame and splits the calls around it. Its group
		// is stable across frames: a fresh group per render would send every
		// later call to a different group and draw each as a separate one-row box.
		let group = groupOfPinned.get(tool);
		if (!group) {
			group = newGroup();
			groupOfPinned.set(tool, group);
		}
		current = group;
		lastMemberGroup = undefined;
		return { header: null, row: false, full: true, pinned: true };
	}

	let group = groupOfTool.get(tool);
	if (!group) {
		group = current;
		group.members.push(tool);
		groupOfTool.set(tool, group);
		firstSeen.set(tool, now);
		// The header was drawn by the group's first member, before this one
		// rendered: ask for one more frame so its count catches up. A leading
		// carrier has not drawn it yet (it had no members when it rendered), so
		// this join also has to schedule that first header frame.
		if (group.headerDrawn || group.headerCarrier !== null) tool.ui?.requestRender?.();
		// pi hands a box `setExpanded(toolOutputExpanded)` before it first
		// renders; arriving expanded means ctrl+o's expand-all is on. Open the
		// group too, so its header and rows match the box.
		if (tool.expanded) group.level = 1;
	}
	// A full re-render walks the transcript from the top: the user boundary
	// clears this pointer first, so every member must restore it, not just the
	// frame that first joined the group. Moving `current` with the last rendered
	// member also makes a call that arrives on a later frame join the same group.
	current = group;
	lastMemberGroup = group;
	maybeAutoCollapse(group);

	const first = group.members[0] === tool;
	const header = first && (group.level === 0 || group.headerCarrier === null)
		? group.level === 0
			? "closed"
			: "open"
		: null;

	// ctrl+o expands every tool; a row click toggles one. Either way `expanded`
	// is the source of truth for whether this call draws its box.
	const boxOpen = tool.expanded === true;

	if (group.level === 0) {
		const age = tool.isPartial ? now - (firstSeen.get(tool) ?? now) : undefined;
		if (age !== undefined && age < RUNNING_ROW_DELAY_MS) {
			requestLater(tool, RUNNING_ROW_DELAY_MS - age);
		}
		return {
			header,
			row: age !== undefined && age >= RUNNING_ROW_DELAY_MS,
			full: false,
			pinned: false,
		};
	}

	return { header, row: !boxOpen, full: boxOpen, pinned: false };
}

/** Note that this group's header has been drawn, for the late-join repaint. */
export function noteHeaderDrawn(component: object): void {
	const group = groupOfTool.get(component) ?? groupOfCarrier.get(component);
	if (group) group.headerDrawn = true;
}

function groupFor(component: object): Group | undefined {
	return groupOfTool.get(component) ?? groupOfCarrier.get(component);
}

export function groupSummaryFor(component: object): GroupSummary | undefined {
	const group = groupFor(component);
	if (!group) return undefined;

	const counts = new Map<string, number>();
	let failed = 0;
	let running: string | undefined;
	let durationMs = 0;

	for (const member of group.members) {
		const name = member.toolName ?? "tool";
		counts.set(name, (counts.get(name) ?? 0) + 1);
		if (!member.isPartial && member.result?.isError) failed++;
		if (member.isPartial && running === undefined) running = name;
		if (typeof member.result?.durationMs === "number" && Number.isFinite(member.result.durationMs)) {
			durationMs += member.result.durationMs;
		}
	}

	const breakdown = [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

	return {
		count: group.members.length,
		breakdown,
		thoughts: group.thoughts,
		thinkingLive: group.liveCarriers.size > 0,
		failed,
		running,
		durationMs,
	};
}

/**
 * pi calls `setExpanded` for `ctrl+o` (every tool) and for a click on a row.
 * Expanding opens the group; collapsing only closes boxes, leaving the rows
 * that are the default view. The header is the way to fold the rows.
 */
export function noteSetExpanded(tool: GroupMemberLike, expanded: boolean): void {
	const group = groupOfTool.get(tool);
	if (!group) return;
	if (expanded) {
		group.manual = true;
		group.level = 1;
	}
}

/** A click on the summary: fold the rows and every box, or bring the rows back. */
export function toggleGroup(component: object): void {
	const group = groupFor(component);
	if (!group) return;
	group.manual = true;
	if (group.level === 1) {
		group.level = 0;
		for (const member of group.members) {
			if (member.expanded) member.setExpanded(false);
		}
	} else {
		group.level = 1;
	}
}

// Kept from the toolbox name so `/reload` can dispose an older build's hooks.
const BOUNDARY_WRAPPER = Symbol.for("pi.toolbox.boundary-render");
const WRAPPER_DISPOSED = Symbol.for("pi.toolbox.wrapper-disposed");

type RenderFn = (this: unknown, width: number) => string[];

const boundaryWrappers: Array<{ proto: any; wrapper: any; original: RenderFn }> = [];
let groupsDisposed = false;

function wrapBoundary(proto: { render?: RenderFn } | undefined, note: (component: any) => void): void {
	if (!proto || typeof proto.render !== "function") return;
	const original = proto.render as RenderFn & { [BOUNDARY_WRAPPER]?: true; [WRAPPER_DISPOSED]?: true };
	if (original[BOUNDARY_WRAPPER] && !original[WRAPPER_DISPOSED]) return;
	const wrapped = function (this: unknown, width: number): string[] {
		const lines = original.call(this, width);
		if (!groupsDisposed) {
			if (groupingEnabled) note(this);
			noteRenderedLines(lines);
		}
		return lines;
	};
	wrapped[BOUNDARY_WRAPPER] = true;
	wrapped[WRAPPER_DISPOSED] = false;
	proto.render = wrapped;
	boundaryWrappers.push({ proto, wrapper: wrapped, original });
}

/**
 * A `/reload` emits session_shutdown before the new module loads. Restore what
 * is still on top so the new module starts clean; a wrapper another extension
 * covered is left behind as a pass-through instead of being ripped out of the
 * middle of their chain.
 */
export function disposeGroupBoundaries(): void {
	groupsDisposed = true;
	for (const { proto, wrapper, original } of boundaryWrappers) {
		if (proto.render === wrapper) proto.render = original;
		else wrapper[WRAPPER_DISPOSED] = true;
	}
	boundaryWrappers.length = 0;
	if (spinnerTimer) {
		clearTimeout(spinnerTimer);
		spinnerTimer = undefined;
	}
}

/**
 * Put the boundary hooks on the non-assistant message components. Installed
 * once; assistant messages are wrapped by the entry point, which also draws
 * their thinking rows.
 */
export function installGroupBoundaries(): void {
	for (const component of [
		UserMessageComponent,
		CustomMessageComponent,
		CompactionSummaryMessageComponent,
		BranchSummaryMessageComponent,
		SkillInvocationMessageComponent,
		BashExecutionComponent,
	]) {
		wrapBoundary(component?.prototype as any, noteBoundary);
	}
}

/**
 * `/new`, `/resume` and `/fork` reuse this process and this module. The old
 * transcript's components are gone, but its group pointer, blank-line state and
 * spinner would leak into the next session; clear them here.
 */
export function resetSessionState(): void {
	allGroups.clear();
	groupOfPinned = new WeakMap();
	current = newGroup();
	lastMemberGroup = undefined;
	lastLineBlank = true;
	lastRenderer = undefined;
	lastSpinnerTick = 0;
	if (spinnerTimer) {
		clearTimeout(spinnerTimer);
		spinnerTimer = undefined;
	}
}

/** Test seam: forget the current group. WeakMaps drop with their components. */
export function resetGroups(): void {
	allGroups.clear();
	groupOfPinned = new WeakMap();
	current = newGroup();
	lastMemberGroup = undefined;
}
