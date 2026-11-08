/**
 * Compact one-line summaries for compaction, skill, and branch messages.
 *
 * Pi's stock components put a `[compaction]` / `[skill]` label above a boxed
 * body even while collapsed. This patch keeps the same expandable component but
 * renders the collapsed state as one colored row:
 *
 *   ✓ Compacted from 490,492 tokens · click to show more
 *
 * The whole row is a MouseRegion, so clicking anywhere on it toggles the
 * message. The expanded state becomes a `customMessageBg` card with the same
 * body Pi already renders.
 */

import {
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	SkillInvocationMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import type { FrameTheme } from "./frame.ts";

export interface SummaryConfig {
	icon: string;
	showMore: string;
	background: string;
}

interface SummaryKind {
	title(component: any): string;
	body(component: any): string;
}

interface SummaryEntry {
	original(this: any): void;
	installed(this: any): void;
	disposed: boolean;
	getTheme(): FrameTheme | undefined;
	config: SummaryConfig;
}

const SUMMARY_PATCH = Symbol.for("pi.message-ui.summary-patch");
const SUMMARY_PATCHES = Symbol.for("pi.message-ui.summary-patches");
const SUMMARY_WRAPPER = Symbol.for("pi.message-ui.summary-wrapper");

const SKILL_KIND: SummaryKind = {
	title: (component) => `Skill ${String(component.skillBlock?.name ?? "skill")}`,
	body: (component) => String(component.skillBlock?.content ?? ""),
};

const COMPACTION_KIND: SummaryKind = {
	title: (component) => `Compacted from ${Number(component.message?.tokensBefore ?? 0).toLocaleString()} tokens`,
	body: (component) => String(component.message?.summary ?? ""),
};

const BRANCH_KIND: SummaryKind = {
	title: () => "Branch summary",
	body: (component) => String(component.message?.summary ?? ""),
};

const KINDS: Array<[any, SummaryKind]> = [
	[SkillInvocationMessageComponent, SKILL_KIND],
	[CompactionSummaryMessageComponent, COMPACTION_KIND],
	[BranchSummaryMessageComponent, BRANCH_KIND],
];

function entriesFor(prototype: any): SummaryEntry[] {
	let entries = prototype[SUMMARY_PATCHES] as SummaryEntry[] | undefined;
	if (!entries) {
		entries = [];
		Reflect.set(prototype, SUMMARY_PATCHES, entries);
	}
	return entries;
}

function topEntry(prototype: any): SummaryEntry | undefined {
	return (
		((prototype.updateDisplay as any)?.[SUMMARY_WRAPPER] as SummaryEntry | undefined) ??
		(prototype[SUMMARY_PATCH] as SummaryEntry | undefined)
	);
}

function boxBase(component: any): { paddingX: number; paddingY: number; bgFn?: (text: string) => string } {
	if (!component.__messageUiBoxBase) {
		component.__messageUiBoxBase = {
			paddingX: Number(component.paddingX ?? 0),
			paddingY: Number(component.paddingY ?? 0),
			bgFn: component.bgFn,
		};
	}
	return component.__messageUiBoxBase;
}

function restoreBox(component: any): void {
	const base = component.__messageUiBoxBase;
	if (!base) return;
	component.paddingX = base.paddingX;
	component.paddingY = base.paddingY;
	component.setBgFn?.(base.bgFn);
}

function toggle(component: any, event: any): unknown {
	if (event?.type !== "click" || event.button !== "left") return undefined;
	component.setExpanded(!component.expanded);
	return { handled: true };
}

function renderSummary(component: any, kind: SummaryKind, theme: FrameTheme, config: SummaryConfig): void {
	const base = boxBase(component);
	const icon = theme.fg("success", config.icon);
	const title = theme.fg("toolTitle", kind.title(component));
	component.clear();

	if (!component.expanded) {
		component.paddingX = base.paddingX;
		component.paddingY = 0;
		component.setBgFn?.(undefined);
		const hint = theme.fg("dim", ` · ${config.showMore}`);
		component.addChild(
			new MouseRegion(new Text(`${icon} ${title}${hint}`, 0, 0), (event: any) => toggle(component, event)),
		);
		return;
	}

	component.paddingX = 1;
	component.paddingY = 1;
	if (typeof theme.bg === "function") component.setBgFn?.((text: string) => theme.bg?.(config.background, text) ?? text);
	else component.setBgFn?.(base.bgFn);

	const content = new Container();
	content.addChild(new Text(`${icon} ${title}`, 0, 0));
	content.addChild(new Spacer(1));
	content.addChild(
		new Markdown(kind.body(component), 0, 0, component.markdownTheme, {
			color: (text: string) => theme.fg("customMessageText", text),
		}),
	);
	component.addChild(new MouseRegion(content, (event: any) => toggle(component, event)));
}

function installOne(ComponentClass: any, kind: SummaryKind, getTheme: () => FrameTheme | undefined, config: SummaryConfig): void {
	const prototype = ComponentClass?.prototype;
	if (!prototype || typeof prototype.updateDisplay !== "function") return;

	const entries = entriesFor(prototype);
	const existing = topEntry(prototype);
	if (existing && !entries.includes(existing)) entries.push(existing);

	if (existing && prototype.updateDisplay === existing.installed) {
		for (const old of entries) if (old !== existing) old.disposed = true;
		existing.disposed = false;
		existing.getTheme = getTheme;
		existing.config = config;
		return;
	}

	// If another extension wrapped updateDisplay, keep older wrappers as
	// pass-throughs instead of letting them draw a second card.
	for (const old of entries) old.disposed = true;

	const original = prototype.updateDisplay;
	const entry: SummaryEntry = {
		original,
		installed: undefined as unknown as SummaryEntry["installed"],
		disposed: false,
		getTheme,
		config,
	};

	entry.installed = function summaryRender(this: any): void {
		if (entry.disposed) {
			original.call(this);
			return;
		}
		const theme = getTheme();
		if (!theme) {
			restoreBox(this);
			original.call(this);
			return;
		}
		try {
			renderSummary(this, kind, theme, entry.config);
		} catch {
			restoreBox(this);
			original.call(this);
		}
	};

	(entry.installed as any)[SUMMARY_WRAPPER] = entry;
	entries.push(entry);
	prototype.updateDisplay = entry.installed;
	Reflect.set(prototype, SUMMARY_PATCH, entry);
}

export function installSummaryPatches(
	getTheme: () => FrameTheme | undefined,
	config: SummaryConfig,
): void {
	for (const [ComponentClass, kind] of KINDS) installOne(ComponentClass, kind, getTheme, config);
}

export function disposeSummaryPatches(): void {
	for (const [ComponentClass] of KINDS) {
		const prototype = ComponentClass?.prototype;
		if (!prototype) continue;
		const entries = entriesFor(prototype);
		const active = topEntry(prototype);
		if (active && prototype.updateDisplay === active.installed) {
			prototype.updateDisplay = active.original;
			if (Reflect.get(prototype, SUMMARY_PATCH) === active) {
				Reflect.deleteProperty(prototype, SUMMARY_PATCH);
			}
		}
		for (const entry of entries) entry.disposed = true;
		entries.length = 0;
	}
}
