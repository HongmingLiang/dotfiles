/**
 * Working timer
 *
 * Mirrors the working message on the left end of the editor's top border: the
 * elapsed time of the current prompt or compaction, refreshed once per second and
 * frozen at the final duration. `MM:SS`, or `HH:MM:SS` after an hour (the leading
 * unit is never capped).
 *
 * Compaction counts as work: one triggered while idle (for example `/compact`, or
 * the context check before a prompt) starts its own clock, while a compaction
 * inside a run keeps the run's clock going.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

/**
 * Pi frames the working status in the editor's top border as `── <status> ────`.
 * The elapsed timer mirrors that frame so both ends stay symmetrical.
 */
const STATUS_DECORATION = "──";

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function formatDuration(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours === 0) return `${pad(minutes)}:${pad(seconds)}`;
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export default function workingTimerExtension(pi: ExtensionAPI): void {
	let activeTui: TUI | undefined;
	let startedAt: number | undefined;
	let elapsedSeconds: number | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	/** What the clock measures; `idle` means it is frozen. */
	let phase: "idle" | "run" | "compaction" = "idle";

	const requestRender = (): void => {
		activeTui?.requestRender();
	};

	const stopInterval = (): void => {
		if (timer !== undefined) {
			clearInterval(timer);
			timer = undefined;
		}
	};

	const updateElapsed = (): void => {
		if (startedAt === undefined) return;

		const nextElapsed = Math.floor((Date.now() - startedAt) / 1000);
		if (nextElapsed === elapsedSeconds) return;

		elapsedSeconds = nextElapsed;
		requestRender();
	};

	const beginTiming = (nextPhase: "run" | "compaction"): void => {
		phase = nextPhase;
		stopInterval();
		startedAt = Date.now();
		elapsedSeconds = 0;
		requestRender();

		timer = setInterval(updateElapsed, 1000);
	};

	const freezeTiming = (): void => {
		if (startedAt !== undefined) {
			elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
		}

		phase = "idle";
		startedAt = undefined;
		stopInterval();
		requestRender();
	};

	pi.on("session_start", (_event, ctx) => {
		stopInterval();
		phase = "idle";
		startedAt = undefined;
		elapsedSeconds = undefined;

		if (ctx.mode !== "tui") return;

		class WorkingTimerEditor extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { embedWorkingStatus: true });
				activeTui = tui;
			}

			protected override renderTopBorder(width: number, hiddenLineCount: number): string {
				if (elapsedSeconds === undefined) {
					return super.renderTopBorder(width, hiddenLineCount);
				}

				const timer = ` ${formatDuration(elapsedSeconds)} `;
				const rightBlock = `${timer}${STATUS_DECORATION}`;
				const leftWidth = width - visibleWidth(rightBlock);

				// Reserve the timer's columns before asking Pi to render the left
				// side, so a long working message uses Pi's own compact fallback.
				if (leftWidth < 1) return super.renderTopBorder(width, hiddenLineCount);

				const border = this.borderColor;
				return `${super.renderTopBorder(leftWidth, hiddenLineCount)}${border(rightBlock)}`;
			}
		}

		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new WorkingTimerEditor(tui, theme, keybindings),
		);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (ctx.mode === "tui") beginTiming("run");
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode === "tui" && phase === "run") freezeTiming();
	});

	// The compaction check before a prompt runs ahead of `before_agent_start`, and
	// `/compact` runs with no run at all, so start a clock for any compaction that
	// finds the timer idle. A compaction inside a run leaves the run clock alone.
	pi.on("session_before_compact", (_event, ctx) => {
		if (ctx.mode === "tui" && phase === "idle") beginTiming("compaction");
	});

	pi.on("session_compact", (_event, ctx) => {
		if (ctx.mode === "tui" && phase === "compaction") freezeTiming();
	});

	pi.on("session_compact_failed", (_event, ctx) => {
		if (ctx.mode === "tui" && phase === "compaction") freezeTiming();
	});

	pi.on("session_shutdown", () => {
		stopInterval();
		phase = "idle";
		startedAt = undefined;
		activeTui = undefined;
	});
}
