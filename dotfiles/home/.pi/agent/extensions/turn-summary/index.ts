/**
 * Turn summary — one line of timing at the end of every prompt round.
 *
 *   │ took 1m 1s (model 58s + tools 2s, 12 calls)
 *
 * The footer hangs off the reply that ends the round: the assistant message
 * with no tool calls, preceded by a blank line so it reads as a closing note
 * rather than message content. It is painted with the blockquote tokens, so it
 * looks like a quoted remark under the reply. A round that stopped on
 * `aborted`/`error` says so after the timings.
 *
 * It is display only. Pi's session log is untouched, so nothing reaches the
 * model context and no entry is written; the numbers are recomputed from
 * `AssistantMessage.durationMs`, `ToolResultMessage.durationMs` and the entry
 * timestamps every time a transcript is built, so a reload, `/tree` or a
 * compaction shows the same line as the live session.
 *
 * Pi has no public renderer hook for built-in messages, so the footer wraps
 * `AssistantMessageComponent.prototype.render`. Only a repaint is requested
 * once a round settles — the content itself is unchanged, so `invalidate()`
 * (which rebuilds every Markdown block) would be wasted work. With
 * `CONFIG.enabled` false, or `/turn-summary` off, rendering passes straight
 * through.
 */
import {
	AssistantMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { indexRounds, turnSummary, type RoundLookup, type StatsEntry } from "./stats.ts";

interface TurnSummaryConfig {
	enabled: boolean;
	/** Split the total into provider latency, tool time and call count. */
	breakdown: boolean;
}

const CONFIG: TurnSummaryConfig = {
	enabled: true,
	breakdown: true,
};

/** Live theme instance, republished whenever the palette changes. */
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const WIDGET_KEY = "turn-summary";

/** Everything the render wrapper needs, refreshed on every install. */
interface Runtime {
	config: TurnSummaryConfig;
	entries: () => readonly StatsEntry[];
	theme: () => ThemeLike | undefined;
	requestRender: () => void;
}

interface ThemeLike {
	fg(color: string, text: string): string;
}

interface SummaryPatch {
	original: (this: any, width: number) => string[];
	installed: (this: any, width: number) => string[];
	runtime: Runtime;
	rounds?: Map<number, RoundLookup>;
	roundsKey?: string;
	disposed: boolean;
}

const PATCH = Symbol.for("pi.turn-summary.patch");
const PATCHES = Symbol.for("pi.turn-summary.patches");
const WRAPPER = Symbol.for("pi.turn-summary.wrapper");

/** Terminal prompt-zone markers (OSC 133) Pi prefixes to a reply's last row. */
const OSC133_RE = /\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

const runtime: Runtime = {
	config: CONFIG,
	entries: () => [],
	theme: () => undefined,
	requestRender: () => {},
};

function paint(theme: ThemeLike | undefined, color: string, text: string): string {
	if (!theme) return text;
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function patchesFor(prototype: any): SummaryPatch[] {
	let patches = prototype[PATCHES] as SummaryPatch[] | undefined;
	if (!patches) {
		patches = [];
		Reflect.set(prototype, PATCHES, patches);
	}
	return patches;
}

/** The round timings, rebuilt only when the session log changed. */
function roundsFor(patch: SummaryPatch): Map<number, RoundLookup> {
	const entries = patch.runtime.entries();
	const last = entries[entries.length - 1];
	const key = `${entries.length}|${last?.id ?? ""}|${last?.timestamp ?? ""}`;
	if (patch.rounds && patch.roundsKey === key) return patch.rounds;
	patch.rounds = indexRounds(entries);
	patch.roundsKey = key;
	return patch.rounds;
}

/**
 * The footer for a reply, or `undefined` when this reply does not end its
 * round. Keyed by `lastMessage.timestamp` rather than the entry id: a reply
 * that just streamed was mounted without an id, and its message object is the
 * one the session logged.
 */
function footer(patch: SummaryPatch, component: any, width: number): string | undefined {
	if (!patch.runtime.config.enabled) return undefined;
	if (component.hasToolCalls === true || component.isStreaming === true) return undefined;

	const timestamp = component.lastMessage?.timestamp;
	if (typeof timestamp !== "number") return undefined;

	const lookup = roundsFor(patch).get(timestamp);
	if (!lookup?.isFinal) return undefined;

	const theme = patch.runtime.theme();
	const stats = lookup.stats;
	const config = { breakdown: patch.runtime.config.breakdown };

	// Rendered like a Markdown blockquote, using the same theme tokens pi uses
	// for one (`mdQuoteBorder` / `mdQuote`), so it follows the palette instead of
	// inventing a style: `│ took 1m 1s (model 58s + tools 2s, 12 calls)`.
	const pad = Math.max(0, Number(component.outputPad ?? 0));
	const lead = "\u2502 ";
	const room = Math.max(1, width - pad - 2);
	const text = turnSummary(stats, config, room);
	const body = text.length > room ? text.slice(0, room).trimEnd() : text;
	return `${' '.repeat(pad)}${paint(theme, "mdQuoteBorder", lead)}${paint(theme, "mdQuote", body)}`;
}

function installPatch(): void {
	const prototype = AssistantMessageComponent.prototype as any;
	const patches = patchesFor(prototype);
	const active = (prototype[WRAPPER] as SummaryPatch | undefined) ?? (prototype[PATCH] as SummaryPatch | undefined);

	if (active && prototype.render === active.installed) {
		// Reuse the wrapper across reloads so the chain never stacks footers.
		for (const old of patches) if (old !== active) old.disposed = true;
		active.disposed = false;
		active.runtime = runtime;
		active.rounds = undefined;
		active.roundsKey = undefined;
		Reflect.set(prototype, PATCH, active);
		return;
	}

	for (const old of patches) old.disposed = true;

	const original = prototype.render;
	if (typeof original !== "function") return;

	const patch: SummaryPatch = {
		original,
		installed: undefined as unknown as SummaryPatch["installed"],
		runtime,
		disposed: false,
	};

	patch.installed = function renderReplyWithFooter(this: any, width: number): string[] {
		const lines = original.call(this, width);
		if (patch.disposed || lines.length === 0) return lines;
		try {
			const line = footer(patch, this, width);
			if (line === undefined) return lines;

			// OSC 133 marks where the prompt resumes; keep it on the last row so
			// terminal shell integration does not point at the reply text.
			const last = lines[lines.length - 1] ?? "";
			const markers = last.match(OSC133_RE)?.join("") ?? "";
			const body = markers ? last.replace(OSC133_RE, "") : last;
			return [...lines.slice(0, -1), body, "", `${markers}${line}`];
		} catch {
			return lines;
		}
	};

	(patch.installed as any)[WRAPPER] = patch;
	patches.push(patch);
	prototype.render = patch.installed;
	Reflect.set(prototype, PATCH, patch);
}

function disposePatches(): void {
	const prototype = AssistantMessageComponent.prototype as any;
	const patches = patchesFor(prototype);
	for (const patch of patches) {
		patch.disposed = true;
		if (prototype.render === patch.installed) prototype.render = patch.original;
		if (Reflect.get(prototype, PATCH) === patch) Reflect.deleteProperty(prototype, PATCH);
	}
	patches.length = 0;
}

function repaint(): void {
	try {
		runtime.requestRender();
	} catch {
		// The TUI may already be gone during shutdown.
	}
}

export default function turnSummaryExtension(pi: ExtensionAPI): void {
	installPatch();

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		runtime.theme = () => currentTheme(ctx);
		runtime.entries = () => sessionEntries(ctx);
		captureTui(ctx);
		const patch = (AssistantMessageComponent.prototype as any)[PATCH] as SummaryPatch | undefined;
		if (patch) {
			patch.rounds = undefined;
			patch.roundsKey = undefined;
		}
	});

	pi.on("before_agent_start", async (_event, ctx: ExtensionContext) => {
		runtime.theme = () => currentTheme(ctx);
		runtime.entries = () => sessionEntries(ctx);
	});

	// A tool step and its reply each end one `turn_end`; either can be the round
	// end that just gained its durations, so both simply repaint.
	pi.on("turn_end", async () => repaint());
	pi.on("agent_end", async () => repaint());

	pi.on("session_compact", async (_event, ctx: ExtensionContext) => {
		runtime.entries = () => sessionEntries(ctx);
		captureTui(ctx);
	});

	pi.on("session_tree", async (_event, ctx: ExtensionContext) => {
		runtime.entries = () => sessionEntries(ctx);
		captureTui(ctx);
	});

	pi.on("session_shutdown", async () => {
		disposePatches();
		runtime.entries = () => [];
		runtime.requestRender = () => {};
	});

	pi.registerCommand("turn-summary", {
		description: "Toggle the per-round timing footer",
		handler: async (_args, ctx) => {
			CONFIG.enabled = !CONFIG.enabled;
			repaint();
			ctx.ui.notify(`Turn summary ${CONFIG.enabled ? "on" : "off"}`, "info");
		},
	});
}

function currentTheme(ctx: ExtensionContext): ThemeLike | undefined {
	try {
		const global = (globalThis as unknown as Record<symbol, ThemeLike | undefined>)[THEME_KEY];
		if (global) return global;
	} catch {
		// Fall through to the live context.
	}
	return ctx.ui.theme as unknown as ThemeLike | undefined;
}

function sessionEntries(ctx: ExtensionContext): readonly StatsEntry[] {
	try {
		const entries = ctx.sessionManager?.getEntries?.();
		if (Array.isArray(entries)) return entries as StatsEntry[];
	} catch {
		// The session may be shutting down mid-render.
	}
	return [];
}

/**
 * Pi exposes no public repaint call to extensions. A zero-row widget factory
 * receives the live TUI, which is enough to ask for the next frame. The theme
 * is read through `currentTheme()` instead, because a palette switch installs
 * a new Theme instance while the factory closure keeps the first one.
 */
function captureTui(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;
	try {
		ctx.ui.setWidget(WIDGET_KEY, (tui: any) => {
			runtime.requestRender = () => tui?.requestRender?.();
			return {
				render: () => [],
				invalidate: () => {},
			};
		});
	} catch {
		// Widgets are unavailable outside the interactive TUI.
	}
}
