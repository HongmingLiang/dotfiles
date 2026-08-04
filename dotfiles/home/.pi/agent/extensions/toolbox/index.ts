/**
 * Toolbox - a shared shell for every Pi tool execution.
 *
 * Pi's public tool-renderer hooks are per tool. The interactive UI, however,
 * renders every agent tool (built-ins, MCP adapters, subagents, and extension
 * tools) through ToolExecutionComponent. Wrapping that component gives every
 * tool the same shell without replacing or re-registering anybody else's tool.
 * Bash call rows additionally use the standalone tokenizer in
 * bash-highlighter.ts.
 *
 * The wrapper deliberately removes only SGR background-color sequences from the
 * rendered lines. Foreground colors, syntax highlighting, hyperlinks, and
 * terminal image sequences are left intact, so the tool content remains
 * transparent while retaining its normal rendering.
 */

import {
	ToolExecutionComponent,
	type ExtensionAPI,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, Text, visibleWidth } from "@earendil-works/pi-tui";
import { formatBashCallHighlighted } from "./bash-highlighter.ts";

const TOOLBOX_PATCH = Symbol.for("pi.toolbox.render-patch");
const MAX_REMEMBERED_STATUSES = 4096;

type ToolStatus = "running" | "success" | "error";

type ToolExecutionLike = {
	toolName?: string;
	toolCallId?: string;
	isPartial?: boolean;
	result?: { isError?: boolean };
};

type Render = (this: ToolExecutionLike, width: number) => string[];
type CallRenderer = (args: any, theme: Theme, context: any) => unknown;
type GetCallRenderer = (this: ToolExecutionLike) => CallRenderer | undefined;

type ToolboxPatch = {
	originalRender: Render;
	originalGetCallRenderer?: GetCallRenderer;
	theme?: Theme;
	statuses: Map<string, ToolStatus>;
};

type PatchedPrototype = {
	render: Render;
	getCallRenderer?: GetCallRenderer;
};

/**
 * Strip background SGR parameters while preserving all other styling.
 *
 * theme.bg() emits 48;5;n / 48;2;r;g;b followed by 49. Some third-party
 * renderers may combine foreground and background parameters in one SGR, so
 * this parses the parameter list instead of deleting a whole escape blindly.
 */
function removeBackgroundSgr(text: string): string {
	return text.replace(/\x1b\[([0-9;]*)m/g, (_sequence, rawParams: string) => {
		const params = rawParams === "" ? [0] : rawParams.split(";").map(Number);
		const kept: number[] = [];

		for (let i = 0; i < params.length; i++) {
			const param = params[i];

			// Extended background: 48;5;n or 48;2;r;g;b.
			if (param === 48) {
				if (params[i + 1] === 5) i += 2;
				else if (params[i + 1] === 2) i += 4;
				continue;
			}

			// 49 is the default background reset; the 40-47 and 100-107
			// ranges are the normal and bright background palettes.
			if (param === 49 || (param >= 40 && param <= 47) || (param >= 100 && param <= 107)) {
				continue;
			}

			kept.push(param);
		}

		return kept.length > 0 ? `\x1b[${kept.join(";")}m` : "";
	});
}

function fallbackBorderColor(status: ToolStatus, text: string): string {
	const ansi = status === "running" ? "\x1b[38;5;245m" : status === "success" ? "\x1b[32m" : "\x1b[31m";
	return `${ansi}${text}\x1b[39m`;
}

function getStatus(component: ToolExecutionLike, patch: ToolboxPatch): ToolStatus {
	// A component reports partial output until the final tool result has been
	// installed. Prefer that lifecycle state so a result event cannot turn the
	// border green a frame before the UI receives tool_execution_end.
	if (component.isPartial === true) return "running";

	if (component.result && component.isPartial === false) {
		return component.result.isError ? "error" : "success";
	}

	if (component.toolCallId) {
		const remembered = patch.statuses.get(component.toolCallId);
		if (remembered) return remembered;
	}

	// These are current pi internals. The lifecycle map covers component shapes
	// that do not expose these fields; these fallbacks also cover restored
	// sessions and already-rendered results that predate this extension's event
	// handlers.
	if (!component.result) return "running";
	return component.result.isError ? "error" : "success";
}

function frameToolLines(
	lines: string[],
	width: number,
	status: ToolStatus,
	theme: Theme | undefined,
): string[] {
	if (width <= 0) return [];
	if (width < 2) {
		return lines.map((line) => truncateToWidth(removeBackgroundSgr(line), Math.max(1, width), ""));
	}

	const innerWidth = width - 2;
	const borderColor =
		status === "running" ? "dim" : status === "success" ? "success" : "error";
	const border = (text: string) =>
		theme?.fg(borderColor, text) ?? fallbackBorderColor(status, text);
	const top = border(`╭${"─".repeat(innerWidth)}╮`);
	const bottom = border(`╰${"─".repeat(innerWidth)}╯`);

	const body = lines.map((line) => {
		let content = removeBackgroundSgr(line);
		if (visibleWidth(content) > innerWidth) {
			content = truncateToWidth(content, innerWidth, "");
		}
		content += " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
		return `${border("│")}${content}${border("│")}`;
	});

	return [top, ...body, bottom];
}

function installPatch(): ToolboxPatch {
	const prototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
	const existing = Reflect.get(prototype, TOOLBOX_PATCH) as ToolboxPatch | undefined;
	if (existing) return existing;

	const originalGetCallRenderer = prototype.getCallRenderer;
	const patch: ToolboxPatch = {
		originalRender: prototype.render,
		originalGetCallRenderer,
		statuses: new Map(),
	};

	Reflect.set(prototype, TOOLBOX_PATCH, patch);

	// Keep Pi's normal Bash renderer alive for its elapsed-time state, but
	// replace only the displayed call component with the standalone tokenizer.
	if (originalGetCallRenderer) {
		prototype.getCallRenderer = function toolboxGetCallRenderer(this: ToolExecutionLike): CallRenderer | undefined {
			const originalRenderer = patch.originalGetCallRenderer?.call(this);
			if (this.toolName !== "bash") return originalRenderer;

			return (args, theme, context) => {
				try {
					originalRenderer?.(args, theme, context);
				} catch {
					// A third-party Bash renderer must not prevent the highlighted
					// fallback from being displayed.
				}

				const previous = context?.lastComponent as { setText?: (text: string) => void } | undefined;
				const text = previous && typeof previous.setText === "function"
					? (previous as Text)
					: new Text("", 0, 0);
				text.setText(formatBashCallHighlighted(args, theme));
				return text;
			};
		};
	}

	prototype.render = function toolboxRender(this: ToolExecutionLike, width: number): string[] {
		// Keep the spacer owned by ToolExecutionComponent outside the frame. The
		// remaining lines are the actual tool call/result content.
		const rawLines = patch.originalRender.call(this, Math.max(1, width - 2));
		if (rawLines.length === 0) return [];

		const leadingSpacer = rawLines[0] === "" ? [rawLines[0]] : [];
		const contentLines = leadingSpacer.length > 0 ? rawLines.slice(1) : rawLines;
		if (contentLines.length === 0) return leadingSpacer;

		return [
			...leadingSpacer,
			...frameToolLines(contentLines, width, getStatus(this, patch), patch.theme),
		];
	};

	return patch;
}

function rememberStatus(patch: ToolboxPatch, toolCallId: string, status: ToolStatus): void {
	patch.statuses.delete(toolCallId);
	patch.statuses.set(toolCallId, status);
	while (patch.statuses.size > MAX_REMEMBERED_STATUSES) {
		const oldest = patch.statuses.keys().next().value;
		if (oldest === undefined) break;
		patch.statuses.delete(oldest);
	}
}

function uninstallPatch(patch: ToolboxPatch): void {
	const prototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
	if (Reflect.get(prototype, TOOLBOX_PATCH) !== patch) return;

	prototype.render = patch.originalRender;
	if (patch.originalGetCallRenderer) {
		prototype.getCallRenderer = patch.originalGetCallRenderer;
	}
	Reflect.deleteProperty(prototype, TOOLBOX_PATCH);
}

export default function (pi: ExtensionAPI) {
	const patch = installPatch();

	pi.on("session_start", async (_event, ctx) => {
		patch.theme = ctx.ui.theme;
	});

	pi.on("tool_execution_start", async (event) => {
		rememberStatus(patch, event.toolCallId, "running");
	});

	pi.on("tool_execution_update", async (event) => {
		rememberStatus(patch, event.toolCallId, "running");
	});

	pi.on("tool_result", async (event) => {
		rememberStatus(patch, event.toolCallId, event.isError ? "error" : "success");
	});

	pi.on("tool_execution_end", async (event) => {
		rememberStatus(patch, event.toolCallId, event.isError ? "error" : "success");
	});

	pi.on("session_shutdown", async () => {
		uninstallPatch(patch);
	});
}
