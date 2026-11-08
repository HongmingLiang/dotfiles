/**
 * Rounded, copy-friendly editor chrome.
 *
 * Top rule:  working spinner/message, timer, repo/branch/session, Copy chip.
 * Bottom:    model/provider, thinking, context bar, cost, cumulative token stats.
 *
 * The body rows are untouched: no side rails, so selecting the draft does not
 * copy frame glyphs. The Copy chip has the same fixed 8-column geometry as the
 * user-message frame's chip.
 */

import {
	copyToClipboard,
	CustomEditor,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	sliceByColumn,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	type EditorTheme,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	type TUI,
} from "@earendil-works/pi-tui";
import { CONFIG } from "./config.ts";
import { repoBranch } from "./branch.ts";
import {
	collectUsage,
	cwdBasename,
	formatCost,
	formatCwd,
	formatStats,
	formatTokens,
	oneLine,
	usageKey,
	type UsageTotals,
} from "./format.ts";
import {
	currentTheme,
	type AppState,
	type ChromeTheme,
} from "./state.ts";
import { setTimerTui, timerLabel } from "./timer.ts";

interface CopyRange {
	start: number;
	width: number;
}

function paint(theme: ChromeTheme | undefined, color: string, text: string): string {
	if (!theme) return text;
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function bold(theme: ChromeTheme | undefined, text: string): string {
	if (!theme?.bold) return text;
	try {
		return theme.bold(text);
	} catch {
		return text;
	}
}

function border(theme: ChromeTheme | undefined, text: string): string {
	return paint(theme, "borderAccent", text);
}

function separator(theme: ChromeTheme | undefined): string {
	return paint(theme, "dim", CONFIG.separator);
}

function thinkingPaint(theme: ChromeTheme | undefined, level: string, text: string): string {
	if (!theme) return text;
	try {
		const color = theme.getThinkingBorderColor?.(level);
		if (color) return color(text);
	} catch {
		// Fall through to the token-based color.
	}
	const token = `thinking${level.charAt(0).toUpperCase()}${level.slice(1)}`;
	return paint(theme, token, text);
}

export class ChromeEditor extends CustomEditor {
	private readonly ctx: ExtensionContext;
	private readonly appState: AppState;
	private readonly copyRanges = new Map<number, CopyRange>();
	private lastRenderedWidth = 80;
	private copiedUntil = 0;
	private copyTimer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private usageCache?: { key: string; totals: UsageTotals };

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, ctx: ExtensionContext, state: AppState) {
		super(tui, theme, keybindings, { embedWorkingStatus: true, paddingX: CONFIG.paddingX });
		this.ctx = ctx;
		this.appState = state;

		const fallbackBorder = theme.borderColor;
		const borderFn = (text: string) => {
			const current = currentTheme();
			if (current) {
				try {
					return current.fg("borderAccent", text);
				} catch {
					// Use the editor's fallback below.
				}
			}
			return fallbackBorder(text);
		};
		// Keep the frame a single color. Pi otherwise rewrites `borderColor`
		// with the thinking-level color and captures that color when it builds
		// the working indicator, which made the working message red while the
		// frame stayed mauve.
		Object.defineProperty(this, "borderColor", {
			configurable: true,
			enumerable: true,
			get: () => borderFn,
			set: () => {},
		});

		this.appState.tui = tui;
		setTimerTui(this.appState.timer, tui);
	}

	override setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(CONFIG.paddingX, padding));
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		const bodyCount = Number((this as any).renderedVisibleLineCount ?? 0);
		const bottomIndex = bodyCount + 1;
		if (width < 8 || bottomIndex >= lines.length - 1) return lines;

		const autocomplete = lines.slice(bottomIndex + 1);
		if (autocomplete.length === 0) return lines;

		const theme = this.currentChromeTheme();
		const borderChar = (text: string) => border(theme, text);
		const separator = `${borderChar("├")}${borderChar("─".repeat(Math.max(0, width - 2)))}${borderChar("┤")}`;
		const contentWidth = Math.max(1, width - 4);
		const framed = autocomplete.map((line) => {
			const inner = truncateToWidth(
				sliceByColumn(line, CONFIG.paddingX, contentWidth, true),
				contentWidth,
				"",
			);
			const padded = inner + " ".repeat(Math.max(0, contentWidth - visibleWidth(inner)));
			return `${borderChar("│")} ${padded} ${borderChar("│")}`;
		});

		return [
			...lines.slice(0, bottomIndex),
			separator,
			...framed,
			lines[bottomIndex] ?? this.renderBottomBorder(width, 0),
		];
	}

	dispose(): void {
		this.disposed = true;
		if (this.copyTimer !== undefined) {
			clearTimeout(this.copyTimer);
			this.copyTimer = undefined;
		}
	}

	private currentChromeTheme(): ChromeTheme | undefined {
		return currentTheme(this.appState.theme);
	}

	private usage(): UsageTotals {
		const key = usageKey(this.ctx);
		if (this.usageCache?.key !== key) {
			this.usageCache = { key, totals: collectUsage(this.ctx) };
		}
		return this.usageCache.totals;
	}

	private copyChip(theme: ChromeTheme | undefined): string {
		const label = Date.now() < this.copiedUntil ? "Done" : "Copy";
		const text = ` [${label.slice(0, 4).padEnd(4, " ")}] `;
		return bold(theme, paint(theme, label === "Done" ? "success" : "borderAccent", text));
	}

	private timerChip(theme: ChromeTheme | undefined): string {
		const label = timerLabel(this.appState.timer);
		if (!label) return "";
		return ` ${paint(theme, "borderAccent", label)} `;
	}

	private repoText(maxWidth: number, theme: ChromeTheme | undefined): string {
		if (maxWidth <= 0) return "";
		const cwd = this.ctx.sessionManager.getCwd();
		const branch = repoBranch(cwd) ?? null;
		const session = this.ctx.sessionManager.getSessionName();
		const fullPath = paint(theme, "accent", formatCwd(cwd));
		const shortPath = paint(theme, "accent", cwdBasename(cwd));
		const branchText = branch
			? paint(theme, branch === "detached" ? "warning" : "mdLink", oneLine(branch, 30))
			: "";
		const sessionText = session ? paint(theme, "success", oneLine(session, 24)) : "";
		const sep = separator(theme);
		const candidates = [
			[fullPath, branchText, sessionText],
			[fullPath, branchText],
			[fullPath],
			[shortPath, branchText, sessionText],
			[shortPath, branchText],
			[shortPath],
		];
		for (const parts of candidates) {
			const text = parts.filter(Boolean).join(sep);
			if (text && visibleWidth(text) <= maxWidth) return text;
		}
		return truncateToWidth(shortPath, maxWidth, "…");
	}

	private contextText(theme: ChromeTheme | undefined, width: number, includeWindow: boolean, compact = false): string | undefined {
		const usage = this.ctx.getContextUsage();
		const window = usage?.contextWindow ?? this.ctx.model?.contextWindow ?? 0;
		if (!window) return undefined;

		const percent = usage?.percent;
		const hasPercent = percent !== null && percent !== undefined && Number.isFinite(percent);
		const clamped = hasPercent ? Math.max(0, Math.min(100, percent)) : 0;
		const color = !hasPercent
			? "dim"
			: clamped >= CONFIG.errorPercent
				? "error"
				: clamped >= CONFIG.warnPercent
					? "warning"
					: "success";
		const cells =
			width >= 90 ? CONFIG.barCells : width >= 64 ? CONFIG.compactBarCells : CONFIG.narrowBarCells;
		const filled = hasPercent && clamped > 0
			? Math.max(1, Math.round((clamped / 100) * cells))
			: 0;
		const percentLabel = hasPercent ? `${Math.floor(clamped)}%` : "?";
		const windowText = includeWindow ? `/${formatTokens(window)}` : "";
		if (compact) return `${paint(theme, color, percentLabel)}${paint(theme, "dim", windowText)}`;
		// A line-style gauge: heavy rule for the used part, the ordinary border
		// rule for the empty track. No filled square cells, and no Nerd Font.
		const bar =
			paint(theme, color, "━".repeat(Math.max(0, filled))) +
			paint(theme, "dim", "─".repeat(Math.max(0, cells - filled)));
		return `${bar} ${paint(theme, color, percentLabel)}${paint(theme, "dim", windowText)}`;
	}

	private buildLeft(
		theme: ChromeTheme | undefined,
		usage: UsageTotals,
		width: number,
		includeProvider: boolean,
		includeWindow: boolean,
		includeThinking: boolean,
		compactContext = false,
	): string {
		const parts: string[] = [];
		const model = this.ctx.model;
		if (model) {
			const id = oneLine(model.id, 48) || "no-model";
			let modelText = bold(theme, paint(theme, "accent", id));
			const provider = oneLine(model.provider ?? "", 24);
			if (includeProvider && provider && !id.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) {
				modelText = `${paint(theme, "accent", `${provider}/`)}${modelText}`;
			}
			parts.push(modelText);

			const level = String(this.ctx.thinkingLevel ?? "off");
			if (includeThinking && model.reasoning && level !== "off") {
				parts.push(thinkingPaint(theme, level, level));
			}
		} else {
			parts.push(paint(theme, "dim", "no-model"));
		}

		const context = this.contextText(theme, width, includeWindow, compactContext);
		if (context) parts.push(context);
		if (usage.cost > 0) parts.push(paint(theme, "warning", formatCost(usage.cost)));
		return parts.join(separator(theme));
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		if (this.disposed || width < CONFIG.minWidth) {
			this.copyRanges.delete(width);
			return super.renderTopBorder(width, hiddenLineCount);
		}
		const theme = this.currentChromeTheme();
		if (!theme) return super.renderTopBorder(width, hiddenLineCount);

		let copy = this.copyChip(theme);
		let copyWidth = visibleWidth(copy);
		let timer = this.timerChip(theme);
		let timerWidth = visibleWidth(timer);
		const minBase = 6;

		// At very narrow widths the Copy chip gives way before the working timer.
		if (width < copyWidth + minBase + 2) {
			copy = "";
			copyWidth = 0;
		}
		if (width < timerWidth + copyWidth + minBase + 2) {
			timer = "";
			timerWidth = 0;
		}

		const maxRepoWidth = Math.max(0, width - copyWidth - timerWidth - minBase - 2);
		let repo = this.repoText(maxRepoWidth, theme);
		if (repo) repo = ` ${repo}`;
		let repoWidth = visibleWidth(repo);
		let copySeparator = repo && copyWidth > 0 ? ` ${border(theme, "──")}` : "";
		let copySeparatorWidth = visibleWidth(copySeparator);
		let baseWidth = width - copyWidth - timerWidth - repoWidth - copySeparatorWidth - 2;

		if (baseWidth < 1) {
			repo = "";
			repoWidth = 0;
			copySeparator = "";
			copySeparatorWidth = 0;
			baseWidth = width - copyWidth - timerWidth - 2;
		}
		if (baseWidth < 1 && copyWidth > 0) {
			copy = "";
			copyWidth = 0;
			baseWidth = width - timerWidth - 2;
		}
		if (baseWidth < 1 && timerWidth > 0) {
			timer = "";
			timerWidth = 0;
			baseWidth = width - copyWidth - 2;
		}
		if (baseWidth < 1) {
			this.copyRanges.delete(width);
			return super.renderTopBorder(width, hiddenLineCount);
		}

		const base = super.renderTopBorder(baseWidth, hiddenLineCount);
		let body = baseWidth > 2 ? sliceByColumn(base, 2, baseWidth - 2, true) : "";
		// The native working indicator starts with a leading space. With the
		// timer's trailing space that reads as two columns; keep one separating
		// column and replace the removed column with a border cell.
		if (timer && visibleWidth(body) > 0 && stripTerminalSequences(body).startsWith(" ")) {
			const bodyWidth = visibleWidth(body);
			body = `${sliceByColumn(body, 1, Math.max(0, bodyWidth - 1), true)}${border(theme, "─")}`;
		}
		const line = `${border(theme, "╭─")}${timer}${body}${repo}${copySeparator}${copy}${border(theme, "─╮")}`;
		if (copyWidth > 0) {
			const start = baseWidth + timerWidth + repoWidth + copySeparatorWidth;
			this.copyRanges.set(width, { start, width: copyWidth });
			if (this.copyRanges.size > 16) {
				for (const key of this.copyRanges.keys()) {
					if (key !== width) this.copyRanges.delete(key);
				}
			}
		} else {
			this.copyRanges.delete(width);
		}
		this.lastRenderedWidth = width;
		return truncateToWidth(line, width, "");
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (this.disposed || width < CONFIG.minWidth) {
			return super.renderBottomBorder(width, hiddenLineCount);
		}
		const theme = this.currentChromeTheme();
		if (!theme) return super.renderBottomBorder(width, hiddenLineCount);

		const usage = this.usage();
		const stats = width >= CONFIG.statsMinWidth ? formatStats(usage) : undefined;
		const scroll = hiddenLineCount > 0 ? `↓ ${hiddenLineCount} more` : "";
		const sep = separator(theme);
		const scrollText = scroll ? paint(theme, "dim", scroll) : "";
		let rightParts: string[] = [];
		if (stats) rightParts.push(paint(theme, "dim", stats));
		if (scrollText) rightParts.push(scrollText);
		let right = rightParts.join(sep);

		let left = this.buildLeft(theme, usage, width, true, true, true);
		const maxContent = width - 7;
		const totalWidth = () => visibleWidth(left) + visibleWidth(right);

		// Stats are the first thing to go. The scroll cue survives until the end.
		if (totalWidth() > maxContent && stats) {
			rightParts = scrollText ? [scrollText] : [];
			right = rightParts.join(sep);
		}
		if (totalWidth() > maxContent) left = this.buildLeft(theme, usage, width, false, true, true);
		if (totalWidth() > maxContent) left = this.buildLeft(theme, usage, width, false, false, true);
		if (totalWidth() > maxContent) left = this.buildLeft(theme, usage, width, false, false, false);
		if (totalWidth() > maxContent) left = this.buildLeft(theme, usage, width, false, false, false, true);
		if (totalWidth() > maxContent && scrollText) {
			rightParts = [];
			right = "";
		}
		if (visibleWidth(left) > maxContent) left = truncateToWidth(left, maxContent, "…");
		if (right && visibleWidth(left) + visibleWidth(right) > maxContent) right = "";
		if (visibleWidth(left) + visibleWidth(right) > maxContent) left = truncateToWidth(left, maxContent, "…");

		const leftWidth = visibleWidth(left);
		const rightWidth = visibleWidth(right);
		const leftGap = leftWidth > 0 ? 1 : 0;
		const rightGap = rightWidth > 0 ? 1 : 0;
		const suffix = rightWidth > 0 ? " ─╯" : "─╯";
		const gap = Math.max(
			0,
			width - 3 - leftWidth - leftGap - rightWidth - rightGap - visibleWidth(suffix),
		);
		const line =
			border(theme, "╰─ ") +
			left +
			(leftGap ? " " : "") +
			border(theme, "─".repeat(gap)) +
			(rightWidth > 0 ? " " + right : "") +
			border(theme, suffix);
		return truncateToWidth(line, width, "");
	}

	private copyDraft(): void {
		const text = this.getExpandedText();
		if (!text) return;
		void copyToClipboard(text).catch(() => {});
		this.copiedUntil = Date.now() + CONFIG.copyFeedbackMs;
		this.tui.requestRender();
		if (this.copyTimer !== undefined) clearTimeout(this.copyTimer);
		this.copyTimer = setTimeout(() => {
			this.copyTimer = undefined;
			this.copiedUntil = 0;
			if (!this.disposed) this.tui.requestRender();
		}, CONFIG.copyFeedbackMs);
		(this.copyTimer as any).unref?.();
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "click" && event.button === "left" && event.y === 0) {
			const width = Number.isFinite(event.width) ? Math.floor(event.width) : this.lastRenderedWidth;
			const range = this.copyRanges.get(width) ?? this.copyRanges.get(this.lastRenderedWidth);
			if (range && event.x >= range.start && event.x < range.start + range.width) {
				this.copyDraft();
				return { handled: true, focus: true };
			}
		}

		return super.handleMouse(event);
	}
}
