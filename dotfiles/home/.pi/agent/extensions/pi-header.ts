/**
 * Big π startup banner.
 *
 * Renders a large π above the built-in startup header (logo, keybinding
 * hints, onboarding text) without rewriting that header: the built-in header
 * component is located in the TUI tree and rendered underneath the art, so its
 * content stays identical to what the installed pi version ships.
 *
 * If the built-in header cannot be located (for example with
 * `quietStartup: true`, or if pi reworks its internals), the banner falls back
 * to a copy of the built-in startup texts.
 *
 * Commands:
 *   /pi-header    toggle the π banner on/off
 */

import {
	VERSION,
	keyHint,
	keyText,
	rawKeyHint,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";

// --- types ---------------------------------------------------------------

type HeaderComponent = Component & {
	setExpanded?(expanded: boolean): void;
	dispose?(): void;
};

type KeybindingHint = Parameters<typeof keyHint>[0];

interface PiHeaderState {
	/** The built-in header component, kept so /reload can keep using it. */
	builtInHeader?: HeaderComponent;
	/** Set by `/pi-header off` for the rest of this pi process. */
	disabled?: boolean;
}

// --- shared state --------------------------------------------------------

// Extensions are re-imported on /reload (module state resets), so the captured
// header lives on globalThis to stay available across reloads in one pi run.
const STATE_KEY = "__piHeaderBannerState__";

function getState(): PiHeaderState {
	const store = globalThis as unknown as Record<string, PiHeaderState | undefined>;
	let state = store[STATE_KEY];
	if (!state) {
		state = {};
		store[STATE_KEY] = state;
	}
	return state;
}

// --- π art ---------------------------------------------------------------

/**
 * π mark, borrowed from pi-powerline-footer's welcome art
 * (https://github.com/nicobailon/pi-powerline-footer).
 *
 *  ██████████
 *  ████  ████
 *  ████  ████
 *  ████████  ████
 *  ████      ████
 *  ████      ████
 */
const PI_LOGO = [
	"██████████",
	"████  ████",
	"████  ████",
	"████████  ████",
	"████      ████",
	"████      ████",
];

function buildPiArt(theme: Theme, width: number): string[] {
	return PI_LOGO.map((line) => truncateToWidth(` ${theme.fg("accent", line)}`, width, ""));
}

// --- built-in header lookup ----------------------------------------------

function isBuiltInHeader(component: Component): boolean {
	const candidate = component as Component & {
		setExpanded?: unknown;
		setText?: unknown;
		paddingX?: unknown;
		getExpandedText?: () => string;
	};
	if (typeof candidate.setExpanded !== "function" || typeof candidate.setText !== "function") return false;

	// The startup header is an ExpandableText built with paddingX = 1. Other
	// expandable texts (loaded resources) use paddingX = 0.
	if (candidate.paddingX === 1) return true;

	// Marker in case the padding ever changes: only the startup header lists
	// the interrupt keybinding hint.
	if (typeof candidate.getExpandedText === "function") {
		try {
			return candidate.getExpandedText().includes("to interrupt");
		} catch {
			// Treat as "not the header".
		}
	}
	return false;
}

function findBuiltInHeader(root: unknown): HeaderComponent | undefined {
	const queue: unknown[] = [root];
	const seen = new Set<unknown>();

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === null || current === undefined || typeof current !== "object" || seen.has(current)) continue;
		seen.add(current);

		if (isBuiltInHeader(current as Component)) return current as HeaderComponent;

		const children = (current as { children?: unknown }).children;
		if (Array.isArray(children)) queue.push(...children);
	}
	return undefined;
}

// --- fallback startup text (copy of the built-in header) -----------------

function buildStartupHelp(theme: Theme): { compact: string; expanded: string } {
	const hint = (keybinding: KeybindingHint, description: string) => keyHint(keybinding, description);

	const expanded = [
		hint("app.interrupt", "to interrupt"),
		hint("app.clear", "to clear"),
		rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
		hint("app.exit", "to exit (empty)"),
		hint("app.suspend", "to suspend"),
		keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
		hint("app.thinking.cycle", "to cycle thinking level"),
		rawKeyHint(`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`, "to cycle models"),
		hint("app.model.select", "to select model"),
		hint("app.tools.expand", "to expand tools"),
		hint("app.thinking.toggle", "to expand thinking"),
		hint("app.editor.external", "for external editor"),
		rawKeyHint("/", "for commands"),
		rawKeyHint("!", "to run bash"),
		rawKeyHint("!!", "to run bash (no context)"),
		hint("app.message.followUp", "to queue follow-up"),
		hint("app.message.dequeue", "to edit all queued messages"),
		hint("app.clipboard.pasteImage", "to paste image (with text fallback)"),
		rawKeyHint("drop files", "to attach"),
	].join("\n");

	const compact = [
		hint("app.interrupt", "interrupt"),
		rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
		rawKeyHint("/", "commands"),
		rawKeyHint("!", "bash"),
		hint("app.tools.expand", "more"),
	].join(theme.fg("muted", " · "));

	return { compact, expanded };
}

function buildFallbackHeader(theme: Theme, expanded: boolean): string[] {
	const help = buildStartupHelp(theme);
	const logo = theme.bold(theme.fg("accent", "pi")) + theme.fg("dim", ` v${VERSION}`);
	const onboarding = theme.fg(
		"dim",
		"Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.",
	);

	if (expanded) return [logo, help.expanded, "", onboarding];

	const compactOnboarding = theme.fg(
		"dim",
		`Press ${keyText("app.tools.expand")} to show full startup help and loaded resources.`,
	);
	return [logo, help.compact, compactOnboarding, "", onboarding];
}

// --- header component ----------------------------------------------------

function createBannerHeader(theme: Theme, builtIn: HeaderComponent | undefined): HeaderComponent {
	let expanded = false;

	return {
		render(width: number): string[] {
			// setExtensionHeader() calls setExpanded() right after construction,
			// so `expanded` matches the current tool-output expansion state.
			const body = builtIn ? builtIn.render(width) : buildFallbackHeader(theme, expanded);
			return [...buildPiArt(theme, width), "", ...body];
		},
		invalidate(): void {
			builtIn?.invalidate?.();
		},
		setExpanded(value: boolean): void {
			expanded = value;
			builtIn?.setExpanded?.(value);
		},
	};
}

function showBanner(ctx: ExtensionContext): void {
	getState().disabled = false;
	ctx.ui.setHeader((tui, theme) => {
		const state = getState();
		// Prefer a header found in the live TUI tree. On later sessions the
		// built-in header is no longer in the tree because our wrapper renders
		// it, so the captured reference is reused.
		const builtIn = findBuiltInHeader(tui) ?? state.builtInHeader;
		if (builtIn) state.builtInHeader = builtIn;
		return createBannerHeader(theme, builtIn);
	});
}

export default function piHeaderBanner(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || getState().disabled) return;
		showBanner(ctx);
	});

	pi.registerCommand("pi-header", {
		description: "Toggle the π startup banner",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;

			const state = getState();
			if (state.disabled) {
				showBanner(ctx);
				ctx.ui.notify("π startup banner enabled", "info");
				return;
			}

			state.disabled = true;
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});
}
