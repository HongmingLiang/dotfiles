/**
 * Working timer.
 *
 * Mirrors the working message on the left end of the editor's top border: while
 * a prompt runs it shows the elapsed time, updated once per second, and freezes
 * at the final duration until the next prompt starts. Both sides are drawn with
 * the editor border color and plain text, so the timer matches the message.
 *
 * The duration is `MM:SS` and switches to `HH:MM:SS` after one hour; the leading
 * unit is never capped, so a long run continues as `100:00:03`.
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

	const startTimer = (): void => {
		stopInterval();
		startedAt = Date.now();
		elapsedSeconds = 0;
		requestRender();

		timer = setInterval(updateElapsed, 1000);
	};

	const stopTimer = (): void => {
		if (startedAt !== undefined) {
			elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
		}

		startedAt = undefined;
		stopInterval();
		requestRender();
	};

	pi.on("session_start", (_event, ctx) => {
		stopInterval();
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
		if (ctx.mode === "tui") startTimer();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode === "tui") stopTimer();
	});

	pi.on("session_shutdown", () => {
		stopInterval();
		startedAt = undefined;
		activeTui = undefined;
	});
}
