/**
 * System prompt size
 *
 * Shows the size of the effective system prompt as a startup widget and reports a
 * per-source breakdown via `/prompt-size`.
 *
 * The widget recomputes the size on every render instead of snapshotting it in
 * `session_start`: pi rebuilds the base prompt after the `session_start` handlers
 * finish (late tool registration, `prepareLoadout`, extension-discovered resources),
 * so the prompt at handler time is not the prompt the model receives. A short timer
 * forces one repaint after that bookkeeping settles.
 *
 * The command mirrors `buildSystemPromptSections()` (pi 1.0.4) for the variable
 * sections so the reported parts add up to the measured total.
 */

import {
	formatSkillsForPrompt,
	type BuildSystemPromptOptions,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "system-prompt-size";
const CONTEXT_FILE_LIMIT = 8;
const STARTUP_REASONS = new Set(["startup", "new", "resume", "fork"]);
const SKILL_READ_TOOLS = ["read", "bash"];
const WIDGET_REFRESH_MS = 250;
const numberFormatter = new Intl.NumberFormat("en-US");

let startupWidgetVisible = false;
let widgetRefreshTimer: ReturnType<typeof setTimeout> | undefined;

type ContextFile = NonNullable<BuildSystemPromptOptions["contextFiles"]>[number];

function countCharacters(text: string): number {
	return Array.from(text).length;
}

function formatCharacters(count: number): string {
	return `${numberFormatter.format(count)} character${count === 1 ? "" : "s"}`;
}

/** Project context section, rendered exactly as `buildSystemPromptSections()` does. */
function renderProjectContext(contextFiles: ContextFile[]): string {
	return [
		"Project-specific instructions and guidelines:",
		...contextFiles.map(
			({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
		),
	].join("\n\n");
}

/** The reader pi names in the skills section, or undefined when no tool can load skill files. */
function resolveSkillReadTool(options: BuildSystemPromptOptions): string | undefined {
	const selectedTools = options.selectedTools ?? [];
	const hiddenTools = options.hiddenTools ?? [];
	const declaredTools = selectedTools.filter((name) => !hiddenTools.includes(name));
	return (
		SKILL_READ_TOOLS.find((tool) => declaredTools.includes(tool)) ??
		(SKILL_READ_TOOLS.some((tool) => selectedTools.includes(tool)) ? "indirect" : undefined)
	);
}

/**
 * Sizes of the sections pi builds from options. Pi's own boilerplate (preamble, tools,
 * rules, docs and the section wrappers) stays in `generated`, which is measured as the
 * remainder of the actual prompt so the listed sources always add up to the total.
 */
function getPromptSections(prompt: string, options: BuildSystemPromptOptions) {
	const contextFiles = options.contextFiles ?? [];
	const customPrompt = options.customPrompt ?? "";
	const appendPrompt = options.appendSystemPrompt ?? "";
	const contextSection = contextFiles.length > 0 ? renderProjectContext(contextFiles) : "";
	const visibleSkills = (options.skills ?? []).filter((skill) => !skill.disableModelInvocation);
	const skillReadTool = resolveSkillReadTool(options);
	const skillSection = skillReadTool ? formatSkillsForPrompt(visibleSkills, skillReadTool).trim() : "";
	const cwd = (options.cwd ?? "").replace(/\\/g, "/");

	const total = countCharacters(prompt);
	const accounted = [customPrompt, appendPrompt, contextSection, skillSection, cwd].reduce(
		(sum, section) => sum + countCharacters(section),
		0,
	);

	return {
		total,
		generated: Math.max(0, total - accounted),
		customPrompt: countCharacters(customPrompt),
		appendPrompt: countCharacters(appendPrompt),
		contextSection: countCharacters(contextSection),
		skillSection: countCharacters(skillSection),
		cwdSection: countCharacters(cwd),
		contextFiles,
		availableSkills: visibleSkills.length,
		includedSkills: skillSection.length > 0 ? visibleSkills.length : 0,
	};
}

function createStartupWidget(getCharacterCount: () => number, initialCount: number, theme: Theme) {
	let characterCount = initialCount;

	return {
		render(width: number): string[] {
			if (width <= 0) return [];

			try {
				characterCount = getCharacterCount();
			} catch {
				// The session may be shutting down; keep the last known size.
			}

			const line = [
				theme.bold("System Prompt"),
				theme.fg("dim", "Total:"),
				formatCharacters(characterCount),
			].join(" ");
			return [truncateToWidth(line, width, "")];
		},
		invalidate(): void {},
	};
}

function clearWidgetRefreshTimer(): void {
	if (widgetRefreshTimer !== undefined) {
		clearTimeout(widgetRefreshTimer);
		widgetRefreshTimer = undefined;
	}
}

function setStartupWidget(ctx: ExtensionContext): void {
	const getCharacterCount = () => countCharacters(ctx.getSystemPrompt());
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => createStartupWidget(getCharacterCount, getCharacterCount(), theme));
}

function showStartupWidget(ctx: ExtensionContext): void {
	setStartupWidget(ctx);
	startupWidgetVisible = true;

	// Session-start handlers run before pi rebuilds the base prompt for late-registering
	// tools and extension resources, so repaint once that bookkeeping has settled.
	clearWidgetRefreshTimer();
	widgetRefreshTimer = setTimeout(() => {
		widgetRefreshTimer = undefined;
		if (startupWidgetVisible) setStartupWidget(ctx);
	}, WIDGET_REFRESH_MS);
}

function hideStartupWidget(ctx: ExtensionContext): void {
	clearWidgetRefreshTimer();
	if (startupWidgetVisible && ctx.mode === "tui") {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}
	startupWidgetVisible = false;
}

function formatPromptLine(theme: Theme, label: string, value: string, indent = ""): string {
	return `${indent}${theme.fg("dim", `${label}:`)} ${value}`;
}

function buildPromptSizeReport(ctx: ExtensionCommandContext, theme: Theme): string {
	const options = ctx.getSystemPromptOptions();
	const sections = getPromptSections(ctx.getSystemPrompt(), options);
	const lines = [
		`${theme.bold("System Prompt")}  ${formatPromptLine(theme, "Total", formatCharacters(sections.total))}`,
		"",
		theme.bold("Sources"),
		formatPromptLine(theme, "Pi guidance and active tools", formatCharacters(sections.generated)),
		formatPromptLine(theme, "Custom prompt", formatCharacters(sections.customPrompt)),
		formatPromptLine(theme, "Appended prompt", formatCharacters(sections.appendPrompt)),
		formatPromptLine(
			theme,
			"Project context",
			`${formatCharacters(sections.contextSection)} (${sections.contextFiles.length} files)`,
		),
		formatPromptLine(
			theme,
			"Skills index",
			`${formatCharacters(sections.skillSection)} (${sections.includedSkills} included, ${sections.availableSkills} available)`,
		),
		formatPromptLine(theme, "Working directory", formatCharacters(sections.cwdSection)),
	];

	if (sections.contextFiles.length > 0) {
		lines.push("", theme.bold("Context Files"));

		for (const file of sections.contextFiles.slice(0, CONTEXT_FILE_LIMIT)) {
			lines.push(formatPromptLine(theme, file.path, formatCharacters(countCharacters(file.content)), "  "));
		}

		const hiddenFileCount = sections.contextFiles.length - CONTEXT_FILE_LIMIT;
		if (hiddenFileCount > 0) {
			lines.push(
				formatPromptLine(
					theme,
					"Additional",
					`${hiddenFileCount} more file${hiddenFileCount === 1 ? "" : "s"}`,
					"  ",
				),
			);
		}
	}

	return theme.fg("text", lines.join("\n"));
}

export default function systemPromptSizeExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (event, ctx) => {
		startupWidgetVisible = false;
		if (ctx.mode !== "tui" || !STARTUP_REASONS.has(event.reason)) return;
		showStartupWidget(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		hideStartupWidget(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		hideStartupWidget(ctx);
	});

	pi.registerCommand("prompt-size", {
		description: "Show the current system prompt size and source breakdown",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;

			const report = buildPromptSizeReport(ctx, ctx.ui.theme);
			ctx.ui.notify(report, "info");
		},
	});
}
