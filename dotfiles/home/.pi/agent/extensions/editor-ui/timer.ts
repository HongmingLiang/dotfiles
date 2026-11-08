/** Working timer state, merged into the editor's top rule. */

import type { TUI } from "@earendil-works/pi-tui";
import { formatDuration } from "./format.ts";
import type { TimerState } from "./state.ts";

export function setTimerTui(timer: TimerState, tui: TUI | undefined): void {
	timer.tui = tui;
}

function requestRender(timer: TimerState): void {
	timer.tui?.requestRender();
}

export function stopTimer(timer: TimerState): void {
	if (timer.interval !== undefined) {
		clearInterval(timer.interval);
		timer.interval = undefined;
	}
}

export function resetTimer(timer: TimerState): void {
	stopTimer(timer);
	timer.startedAt = undefined;
	timer.elapsedSeconds = undefined;
	timer.phase = "idle";
}

function updateElapsed(timer: TimerState): void {
	if (timer.startedAt === undefined) return;
	const next = Math.floor((Date.now() - timer.startedAt) / 1_000);
	if (next === timer.elapsedSeconds) return;
	timer.elapsedSeconds = next;
	requestRender(timer);
}

export function beginTiming(timer: TimerState, phase: "run" | "compaction"): void {
	timer.phase = phase;
	stopTimer(timer);
	timer.startedAt = Date.now();
	timer.elapsedSeconds = 0;
	requestRender(timer);

	const interval = setInterval(() => updateElapsed(timer), 1_000);
	(interval as any).unref?.();
	timer.interval = interval;
}

export function freezeTiming(timer: TimerState): void {
	if (timer.phase === "idle" && timer.elapsedSeconds === undefined) return;
	if (timer.startedAt !== undefined) {
		timer.elapsedSeconds = Math.floor((Date.now() - timer.startedAt) / 1_000);
	}
	timer.phase = "idle";
	timer.startedAt = undefined;
	stopTimer(timer);
	requestRender(timer);
}

export function timerLabel(timer: TimerState): string | undefined {
	if (timer.elapsedSeconds === undefined) return undefined;
	return formatDuration(timer.elapsedSeconds);
}
