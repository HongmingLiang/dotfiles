/** Working timer state, merged into the editor's top rule. */

import type { TUI } from "@earendil-works/pi-tui";
import { formatDuration } from "./format.ts";
import type { ActiveTimerPhase, TimerState } from "./state.ts";

export function setTimerTui(timer: TimerState, tui: TUI | undefined): void {
	timer.tui = tui;
}

function requestRender(timer: TimerState): void {
	timer.tui?.requestRender();
}

/** Any scheduled freeze belongs to the clock that is being stopped or replaced. */
function invalidatePendingFreeze(timer: TimerState): number {
	const token = (timer.indicatorToken ?? 0) + 1;
	timer.indicatorToken = token;
	return token;
}

export function stopTimer(timer: TimerState): void {
	invalidatePendingFreeze(timer);
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

export function beginTiming(timer: TimerState, phase: ActiveTimerPhase): void {
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

/**
 * Mirror Pi's working indicator, which is the UI's single "busy" signal.
 *
 * Pi sets it for runs, retries, compactions, and branch summaries, and clears
 * it when that work ends. Mirroring it gives the timer a clock for every kind,
 * including operations that no extension event announces: a branch summary
 * only emits `session_before_tree`/`session_tree` (nothing on abort), and a
 * compaction that never reaches `session_before_compact` (nothing to compact)
 * only has indicator events. `phase` undefined means the indicator was cleared.
 */
export function syncWorkingIndicator(timer: TimerState, phase: ActiveTimerPhase | undefined): void {
	const token = invalidatePendingFreeze(timer);
	if (phase) {
		if (timer.phase === "idle") beginTiming(timer, phase);
		return;
	}
	// A run is timed from before_agent_start to agent_settled: Pi clears the
	// indicator at agent_end while settle work still belongs to the run.
	if (timer.phase === "idle" || timer.phase === "run") return;
	// showStatusIndicator() clears the indicator and installs its replacement in
	// the same tick (for example a summarization retry), so only freeze when
	// nothing took over.
	queueMicrotask(() => {
		if (timer.indicatorToken !== token) return;
		freezeTiming(timer);
	});
}

export function timerLabel(timer: TimerState): string | undefined {
	if (timer.elapsedSeconds === undefined) return undefined;
	return formatDuration(timer.elapsedSeconds);
}
