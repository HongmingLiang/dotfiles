/** Fixed behavior for the editor chrome. No config file: tune these constants. */
export const CONFIG = {
	/** Hide Pi's native footer. Only the native component is patched; custom footers are untouched. */
	footerHidden: true,
	/** Fixed copy-chip width (` [Copy] ` / ` [Done] `). */
	copyFeedbackMs: 1_400,
	/** Body padding. Editor owns the cursor/mouse geometry, so this is safe. */
	paddingX: 2,
	/** Context bar cells at normal / compact widths. */
	barCells: 10,
	compactBarCells: 6,
	narrowBarCells: 4,
	/** Context warning thresholds, matching Pi's native footer. */
	warnPercent: 70,
	errorPercent: 90,
	/** Only attempt the low-priority token/cache stats above this width. */
	statsMinWidth: 64,
	/** Separator for the bottom information line. */
	separator: " · ",
	/** Minimum width for the editor chrome; narrower falls back to Pi's native borders. */
	minWidth: 8,
} as const;
