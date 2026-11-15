/**
 * Editor UI — heavy, copy-friendly rules around the input editor.
 *
 * It intentionally does not call `ctx.ui.setFooter()`: the native footer is
 * hidden by wrapping `FooterComponent.prototype.render`, so any future custom
 * footer extension still wins normally. The editor's existing top/bottom rules
 * become the information surface:
 *
 *   ━━ ⠼ Working 00:42 ━━━━━━━━━━━━ ~/repo - main - session ━ [Copy] ━━
 *   prompt...
 *   ━━ deepseek/deepseek-flash - max - ██████──── 14% - $2.413 ━ ↑... ━━
 *
 * The body has no vertical rails and no left padding, so the draft starts
 * flush left and selecting it stays copy-friendly.
 */

import {
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { ChromeEditor } from "./chrome.ts";
import { refreshRepoBranch, resetRepoBranch } from "./branch.ts";
import { CONFIG } from "./config.ts";
import {
	disposeFooterRuntime,
	installFooterPatch,
	restoreFooterPatch,
	setFooterRenderCallback,
} from "./footer.ts";
import { resetTimer, stopTimer, beginTiming, freezeTiming } from "./timer.ts";
import { getState, type ChromeTheme } from "./state.ts";


function installEditor(ctx: ExtensionContext, state: ReturnType<typeof getState>): void {
	if (ctx.mode !== "tui") return;
	state.ctx = ctx;
	state.theme = ctx.ui.theme as ChromeTheme;
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		const editor = new ChromeEditor(tui, theme, keybindings, ctx, state);
		setFooterRenderCallback(() => tui.requestRender());
		return editor;
	});
}

function setFooterHidden(state: ReturnType<typeof getState>, hidden: boolean): void {
	state.footerHidden = hidden;
	installFooterPatch(hidden);
	state.tui?.requestRender();
}

export default function editorChromeExtension(pi: ExtensionAPI): void {
	const state = getState();
	if (state.generation === 0) state.footerHidden = CONFIG.footerHidden;
	state.generation += 1;
	const generation = state.generation;

	// Install before the session starts so the first frame already has no
	// native footer. This never occupies the footer slot.
	installFooterPatch(state.footerHidden);

	pi.on("session_start", async (_event, ctx) => {
		state.ctx = ctx;
		state.theme = ctx.ui.theme as ChromeTheme;
		resetTimer(state.timer);
		installFooterPatch(state.footerHidden);
		resetRepoBranch();
		refreshRepoBranch(ctx.sessionManager.getCwd(), () => state.tui?.requestRender());
		installEditor(ctx, state);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.mode === "tui") beginTiming(state.timer, "run");
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (ctx.mode === "tui" && state.timer.phase === "run") freezeTiming(state.timer);
		if (ctx.mode === "tui") refreshRepoBranch(ctx.sessionManager.getCwd(), () => state.tui?.requestRender());
	});

	// Compaction outside a run gets its own clock; compaction inside a run
	// keeps the run clock going.
	pi.on("session_before_compact", async (_event, ctx) => {
		if (ctx.mode === "tui" && state.timer.phase === "idle") {
			beginTiming(state.timer, "compaction");
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		if (ctx.mode === "tui" && state.timer.phase === "compaction") freezeTiming(state.timer);
		state.tui?.requestRender();
	});

	pi.on("session_compact_failed", async (_event, ctx) => {
		if (ctx.mode === "tui" && state.timer.phase === "compaction") freezeTiming(state.timer);
		state.tui?.requestRender();
	});

	pi.on("model_select", async () => {
		state.tui?.requestRender();
	});

	pi.on("thinking_level_select", async () => {
		state.tui?.requestRender();
	});

	pi.on("turn_end", async () => {
		state.tui?.requestRender();
	});

	pi.on("session_shutdown", async () => {
		if (state.generation !== generation) return;
		stopTimer(state.timer);
		setFooterRenderCallback(undefined);
		disposeFooterRuntime();
		resetRepoBranch();
		restoreFooterPatch();
		state.tui = undefined;
		state.ctx = undefined;
	});

	pi.registerCommand("footer", {
		description: "Toggle the native footer",
		handler: async (_args, ctx) => {
			const hidden = !state.footerHidden;
			setFooterHidden(state, hidden);
			ctx.ui.notify(`Native footer ${hidden ? "hidden" : "shown"}`, "info");
		},
	});
}
