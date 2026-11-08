/**
 * Shared state for the editor UI extension.
 *
 * The extension is reloaded on `/new`, `/resume`, and `/reload`; this global
 * state keeps the footer patch, timer, and active TUI from stacking.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
export const STATE_KEY = Symbol.for("pi.editor-ui.state");
export const FOOTER_RUNTIME_KEY = Symbol.for("pi.editor-ui.footer-runtime");
export const FOOTER_PATCH_KEY = Symbol.for("pi.editor-ui.footer-patch");

export interface ChromeTheme {
	fg(color: string, text: string): string;
	bold?(text: string): string;
	getThinkingBorderColor?(level: string): (text: string) => string;
}

export interface TimerState {
	tui?: TUI;
	startedAt?: number;
	elapsedSeconds?: number;
	phase: "idle" | "run" | "compaction";
	interval?: ReturnType<typeof setInterval>;
}

export interface AppState {
	ctx?: ExtensionContext;
	tui?: TUI;
	theme?: ChromeTheme;
	footerHidden: boolean;
	timer: TimerState;
	generation: number;
}

export function getState(): AppState {
	const global = globalThis as unknown as Record<symbol, AppState | undefined>;
	const existing = global[STATE_KEY];
	if (existing) return existing;

	const created: AppState = {
		footerHidden: true,
		timer: { phase: "idle" },
		generation: 0,
	};
	global[STATE_KEY] = created;
	return created;
}

/** Keep the latest full theme available even though editor factories only receive EditorTheme. */
export function currentTheme(fallback?: ChromeTheme): ChromeTheme | undefined {
	try {
		const globalTheme = (globalThis as unknown as Record<symbol, ChromeTheme | undefined>)[THEME_KEY];
		if (globalTheme) return globalTheme;
	} catch {
		// Fall through to the captured theme.
	}
	return fallback;
}
