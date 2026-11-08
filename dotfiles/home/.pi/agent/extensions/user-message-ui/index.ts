/**
 * User Message UI — framed prompts and a sticky prompt header.
 *
 * Submitted user messages become a copy-friendly rounded frame:
 *
 *   ╭─ User ─────────────────────────────╮
 *
 *     Refactor the auth flow:
 *
 *     1. extract token parsing
 *     2. add tests
 *
 *   ╰────────────────────────────────────╯
 *
 * The frame uses the theme's highlighted border color, so it follows the
 * active palette without a filled background. Content rows have no vertical
 * frame characters, so a terminal selection copies only the message text. The
 * top rule carries a clickable Copy chip when the terminal is wide enough.
 * Once a message scrolls above the fullscreen viewport, its first readable
 * row is pinned to the top edge as a subtle `userMessageBg` band with the same
 * label; clicking the band jumps back to the message's top rule.
 *
 * Pi has no public renderer hook for normal user messages, so this module
 * wraps `UserMessageComponent.prototype.render` and `TuiAltScreen`'s frame
 * compositor. Both patches pass through to the previous implementation and
 * restore themselves on reload/shutdown. Tune the `CONFIG` object below if
 * you want a different label, padding, or sticky-header hint.
 */

import {
	copyToClipboard,
	UserMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { frameUserMessage, type CopyRange, type FrameConfig, type FrameTheme } from "./frame.ts";
import { stripMessageMarkersFromLines } from "./markers.ts";
import { isLeftPress, parseSgrMousePackets } from "./mouse.ts";
import {
	renderStickyScreen,
	resetStickyState,
	stickyHit,
	stickyState,
	type StickyConfig,
} from "./sticky.ts";

const FRAME_PATCH = Symbol.for("pi.user-message-frame.frame-patch");
const FRAME_PATCHES = Symbol.for("pi.user-message-frame.frame-patches");
const FRAME_WRAPPER = Symbol.for("pi.user-message-frame.frame-wrapper");
const STICKY_PATCH = Symbol.for("pi.user-message-frame.sticky-patch");
const STATE_KEY = Symbol.for("pi.user-message-frame.state");
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const WIDGET_KEY = "user-message-ui";
const LEGACY_WIDGET_KEY = "user-message-frame";
const COPY_FEEDBACK_MS = 1_400;
const COPY_MOUSE_VERSION = 2;

interface UserMessageConfig {
	frame: FrameConfig;
	sticky: StickyConfig;
}

const CONFIG: UserMessageConfig = {
	frame: {
		label: "User",
		paddingX: 2,
		paddingY: 1,
	},
	sticky: {
		enabled: true,
		label: "User",
		hint: "[click to jump]",
		minHintWidth: 24,
		background: "userMessageBg",
		extraWidth: 2,
	},
};

interface FramePatch {
	original: (this: any, width: number) => string[];
	installed: (this: any, width: number) => string[];
	originalHandleMouse?: (this: any, event: any) => unknown;
	handleMouseWrapper?: (this: any, event: any) => unknown;
	handleMouseVersion?: number;
	disposed: boolean;
	config: FrameConfig;
}

interface StickyPatch {
	original: (this: any, screen: string[], layout: any, width: number) => string[];
	installed: (this: any, screen: string[], layout: any, width: number) => string[];
	disposed: boolean;
}

interface ClickPatch {
	tui: any;
	original: (this: any, data: string) => unknown;
	installed: (this: any, data: string) => unknown;
	disposed: boolean;
}

interface State {
	config: UserMessageConfig;
	theme?: FrameTheme;
	tui?: any;
	framePatch?: FramePatch;
	stickyPatch?: StickyPatch;
	clickPatch?: ClickPatch;
	generation: number;
}

function getState(): State {
	const global = globalThis as unknown as Record<symbol, State | undefined>;
	const existing = global[STATE_KEY];
	if (existing) return existing;

	const created: State = {
		config: CONFIG,
		generation: 0,
	};
	global[STATE_KEY] = created;
	return created;
}

function currentTheme(state: State): FrameTheme | undefined {
	try {
		const globalTheme = (globalThis as unknown as Record<symbol, FrameTheme | undefined>)[THEME_KEY];
		if (globalTheme) return globalTheme;
	} catch {
		// Fall through to the theme captured at session start.
	}
	return state.theme;
}

function framePatches(prototype: any): FramePatch[] {
	let patches = prototype[FRAME_PATCHES] as FramePatch[] | undefined;
	if (!patches) {
		patches = [];
		Reflect.set(prototype, FRAME_PATCHES, patches);
	}
	return patches;
}

function topFramePatch(prototype: any): FramePatch | undefined {
	return (
		((prototype.render as any)?.[FRAME_WRAPPER] as FramePatch | undefined) ??
		(prototype[FRAME_PATCH] as FramePatch | undefined)
	);
}

function installFramePatch(state: State): void {
	const prototype = UserMessageComponent.prototype as any;
	const patches = framePatches(prototype);
	const existing = topFramePatch(prototype);
	if (existing && !patches.includes(existing)) patches.push(existing);

	if (existing && prototype.render === existing.installed) {
		// Reuse the active frame. Any older frame wrappers below it (for
		// example after repeated /new calls) become pass-throughs.
		for (const old of patches) if (old !== existing) old.disposed = true;
		existing.disposed = false;
		existing.config = state.config.frame;
		if (!existing.originalHandleMouse) {
			existing.originalHandleMouse = prototype.handleMouse ?? Object.getPrototypeOf(prototype)?.handleMouse;
		}
		if (existing.handleMouseVersion !== COPY_MOUSE_VERSION) {
			if (existing.handleMouseWrapper && prototype.handleMouse !== existing.handleMouseWrapper) {
				existing.originalHandleMouse = prototype.handleMouse ?? existing.originalHandleMouse;
			}
			installCopyMouse(existing, prototype, state);
		}
		state.framePatch = existing;
		return;
	}

	// A different extension may have wrapped our renderer on a later session
	// reload. Keep every older frame as a pass-through so only the new one
	// draws a border.
	for (const old of patches) old.disposed = true;

	const original = prototype.render;
	if (typeof original !== "function") return;

	const patch: FramePatch = {
		original,
		installed: undefined as unknown as FramePatch["installed"],
		originalHandleMouse: prototype.handleMouse ?? Object.getPrototypeOf(prototype)?.handleMouse,
		disposed: false,
		config: state.config.frame,
	};

	patch.installed = function frameUserMessageRender(this: any, width: number): string[] {
		if (patch.disposed || width < 8) {
			this.__userMessageUiCopyRange = undefined;
			return original.call(this, width);
		}

		const padX = Math.max(0, Math.min(patch.config.paddingX, Math.floor((width - 1) / 2)));
		const originalPad = Math.max(0, Number(this.outputPad ?? 1));
		const contentWidth = Math.max(1, width - padX * 2 + originalPad);
		let lines: string[];
		try {
			lines = original.call(this, contentWidth);
		} catch {
			this.__userMessageUiCopyRange = undefined;
			return original.call(this, width);
		}

		try {
			const copiedAt = Number(this.__userMessageUiCopiedAt ?? 0);
			const copyDone = copiedAt > 0 && Date.now() - copiedAt < COPY_FEEDBACK_MS;
			const result = frameUserMessage(
				lines,
				width,
				originalPad,
				currentTheme(state),
				patch.config,
				{
					includeMarkers: Boolean(state.stickyPatch),
					copyLabel: copyDone ? "Done" : "Copy",
					copyDone,
				},
			);
			this.__userMessageUiCopyRange = result.copy;
			return result.lines;
		} catch {
			this.__userMessageUiCopyRange = undefined;
			return original.call(this, width);
		}
	};

	(patch.installed as any)[FRAME_WRAPPER] = patch;
	patches.push(patch);
	prototype.render = patch.installed;
	Reflect.set(prototype, FRAME_PATCH, patch);
	installCopyMouse(patch, prototype, state);
	state.framePatch = patch;
}

function installCopyMouse(patch: FramePatch, prototype: any, state: State): void {
	const original = patch.originalHandleMouse;
	if (typeof original !== "function") return;

	patch.handleMouseWrapper = function userMessageHandleMouse(this: any, event: any): unknown {
		if (!patch.disposed && event?.button === "left" && event.y === 0) {
			const range = this.__userMessageUiCopyRange as CopyRange | undefined;
			const onCopy = Boolean(
				range && event.x >= range.start && event.x < range.start + range.width,
			);
			if (onCopy && (event.type === "press" || event.type === "click")) {
				// A handled press registers this component as the click target; the
				// synthesized click then fires the copy without starting a selection.
				if (event.type === "click") {
					const text = typeof this.text === "string" ? this.text : "";
					if (text) {
						void copyToClipboard(text)
							.then(() => {
								this.__userMessageUiCopiedAt = Date.now();
								this.invalidate?.();
								state.tui?.requestRender?.();
								clearTimeout(this.__userMessageUiCopyTimer);
								this.__userMessageUiCopyTimer = setTimeout(() => {
									this.__userMessageUiCopiedAt = 0;
									this.invalidate?.();
									state.tui?.requestRender?.();
								}, COPY_FEEDBACK_MS);
							})
							.catch(() => {
								// The transcript stays interactive if the clipboard is unavailable.
							});
					}
				}
				return { handled: true, render: false };
			}
		}
		return original.call(this, event);
	};

	prototype.handleMouse = patch.handleMouseWrapper;
	patch.handleMouseVersion = COPY_MOUSE_VERSION;
}

function installStickyPatch(state: State): void {
	const prototype = (TuiAltScreen as any)?.prototype;
	if (typeof prototype?.compositeScrollToEndIndicator !== "function") return;

	const existing = prototype[STICKY_PATCH] as StickyPatch | undefined;
	if (existing && prototype.compositeScrollToEndIndicator === existing.installed) {
		existing.disposed = false;
		state.stickyPatch = existing;
		return;
	}

	const original = prototype.compositeScrollToEndIndicator;
	const patch: StickyPatch = {
		original,
		installed: undefined as unknown as StickyPatch["installed"],
		disposed: false,
	};

	patch.installed = function compositeUserMessageHeader(
		this: any,
		screen: string[],
		layout: any,
		width: number,
	): string[] {
		const result = original.call(this, screen, layout, width);
		if (patch.disposed) return result;
		try {
			return renderStickyScreen(
				this,
				result,
				layout,
				width,
				currentTheme(state),
				state.config.sticky,
			);
		} catch {
			// Never leak the zero-width markers into the terminal.
			return stripMessageMarkersFromLines(result);
		}
	};

	prototype.compositeScrollToEndIndicator = patch.installed;
	Reflect.set(prototype, STICKY_PATCH, patch);
	state.stickyPatch = patch;
}

function hasOverlay(tui: any): boolean {
	try {
		return typeof tui?.hasOverlay === "function" && tui.hasOverlay();
	} catch {
		return false;
	}
}

function disposeClickPatch(state: State): void {
	const patch = state.clickPatch;
	if (!patch) return;

	patch.disposed = true;
	try {
		if (patch.tui.handleViewportInput === patch.installed) {
			// The wrapper lives on the instance, above the lazy-proxy prototype.
			// Deleting it restores normal lookup; setting the original is the
			// fallback for proxies that do not support delete.
			if (!Reflect.deleteProperty(patch.tui, "handleViewportInput")) {
				patch.tui.handleViewportInput = patch.original;
			}
		}
	} catch {
		// The TUI may already be gone during shutdown.
	}
	state.clickPatch = undefined;
	resetStickyState();
}

function installClickPatch(tui: any, state: State): void {
	if (!tui || typeof tui !== "object") return;
	if (typeof tui.getPrimaryScrollView !== "function") return;

	const existing = state.clickPatch;
	if (existing && existing.tui === tui && !existing.disposed) {
		if (tui.handleViewportInput === existing.installed) return;
	}

	disposeClickPatch(state);

	const prototype = Object.getPrototypeOf(tui);
	const original = prototype?.handleViewportInput;
	if (typeof original !== "function") return;

	const patch: ClickPatch = {
		tui,
		original,
		installed: undefined as unknown as ClickPatch["installed"],
		disposed: false,
	};

	patch.installed = function userMessageViewportInput(this: any, data: string): unknown {
		if (patch.disposed) return Reflect.apply(original, this, [data]);

		if (state.config.sticky.enabled && !hasOverlay(tui)) {
			const packets = parseSgrMousePackets(data);
			if (packets) {
				for (const packet of packets) {
					if (!isLeftPress(packet) || !stickyHit(tui, packet)) continue;
					const view = tui.getPrimaryScrollView?.();
					if (typeof view?.scrollTo === "function") {
						try {
							view.scrollTo(stickyState.jumpRow, { disableFollow: true });
							stickyState.visible = false;
							tui.requestRender?.();
						} catch {
							// Keep the click away from the transcript even if the view refuses.
						}
						return { consume: true };
					}
				}
			}
		}

		return Reflect.apply(original, this, [data]);
	};

	try {
		tui.handleViewportInput = patch.installed;
		state.clickPatch = patch;
	} catch {
		// Lazy proxies or a replaced TUI can refuse the assignment; the next
		// session_start attempt and widget render try again.
	}
}

function installTui(ctx: ExtensionContext, state: State): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) return;
	try {
		// Clear the zero-width widget registered by the pre-rename version.
		ctx.ui.setWidget(LEGACY_WIDGET_KEY, undefined);
		ctx.ui.setWidget(WIDGET_KEY, (tui: any, theme: FrameTheme) => {
			state.theme = theme;
			state.tui = tui;
			installClickPatch(tui, state);
			return {
				render: () => [],
				invalidate: () => {},
			};
		});
	} catch {
		// Widgets are unavailable outside the interactive TUI.
	}
}

function disposePrototypePatches(state: State): void {
	const frame = state.framePatch;
	const prototype = UserMessageComponent.prototype as any;
	const patches = framePatches(prototype);

	if (frame) {
		frame.disposed = true;
		if (prototype.render === frame.installed) prototype.render = frame.original;
		if (frame.handleMouseWrapper && prototype.handleMouse === frame.handleMouseWrapper) {
			if (frame.originalHandleMouse === Object.getPrototypeOf(prototype)?.handleMouse) {
				Reflect.deleteProperty(prototype, "handleMouse");
			} else if (frame.originalHandleMouse) {
				prototype.handleMouse = frame.originalHandleMouse;
			}
		}
		if (Reflect.get(prototype, FRAME_PATCH) === frame) {
			Reflect.deleteProperty(prototype, FRAME_PATCH);
		}
		state.framePatch = undefined;
	}

	// Any frame wrapper left in the chain stays inert until the next install.
	for (const patch of patches) patch.disposed = true;
	patches.length = 0;

	const sticky = state.stickyPatch;
	if (sticky) {
		sticky.disposed = true;
		const prototype = (TuiAltScreen as any)?.prototype;
		if (prototype?.compositeScrollToEndIndicator === sticky.installed) {
			prototype.compositeScrollToEndIndicator = sticky.original;
		}
		if (prototype && Reflect.get(prototype, STICKY_PATCH) === sticky) {
			Reflect.deleteProperty(prototype, STICKY_PATCH);
		}
		state.stickyPatch = undefined;
	}
}

export default function userMessageFrameExtension(pi: ExtensionAPI): void {
	const state = getState();
	state.config = CONFIG;
	state.generation += 1;
	const generation = state.generation;

	installStickyPatch(state);
	installFramePatch(state);

	pi.on("session_start", async (_event, ctx) => {
		state.theme = ctx.ui.theme as FrameTheme;
		installTui(ctx, state);
	});

	// Theme changes do not have their own extension event; the next turn is a
	// cheap point to pick up the current instance before new messages render.
	pi.on("before_agent_start", async (_event, ctx) => {
		state.theme = ctx.ui.theme as FrameTheme;
	});

	// Rebuilding the transcript can replace the TUI/widget; make sure the
	// click wrapper is installed on the current instance.
	pi.on("session_compact", async (_event, ctx) => {
		state.theme = ctx.ui.theme as FrameTheme;
		installTui(ctx, state);
	});

	pi.on("session_tree", async (_event, ctx) => {
		state.theme = ctx.ui.theme as FrameTheme;
		installTui(ctx, state);
	});

	pi.on("session_shutdown", async () => {
		disposeClickPatch(state);
		state.tui = undefined;
		resetStickyState();

		// Every session replacement reloads the extensions, so hand the
		// prototype back to the previous owner before the new module loads.
		if (state.generation === generation) disposePrototypePatches(state);
	});
}
