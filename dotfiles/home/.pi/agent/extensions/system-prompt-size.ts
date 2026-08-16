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
const numberFormatter = new Intl.NumberFormat("en-US");

let startupWidgetVisible = false;

type ContextFile = NonNullable<BuildSystemPromptOptions["contextFiles"]>[number];

function countCharacters(text: string): number {
	return Array.from(text).length;
}

function formatCharacters(count: number): string {
	return `${numberFormatter.format(count)} character${count === 1 ? "" : "s"}`;
}

function buildContextSection(contextFiles: ContextFile[]): string {
	if (contextFiles.length === 0) return "";

	let section = "\n\n<project_context>\n\n";
	section += "Project-specific instructions and guidelines:\n\n";

	for (const { path, content } of contextFiles) {
		section += `<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n`;
	}

	return `${section}</project_context>\n`;
}

function canIncludeSkills(options: BuildSystemPromptOptions): boolean {
	return options.selectedTools === undefined || options.selectedTools.includes("read");
}

function getPromptSections(prompt: string, options: BuildSystemPromptOptions) {
	const contextFiles = options.contextFiles ?? [];
	const customPrompt = options.customPrompt ?? "";
	const appendSection = options.appendSystemPrompt ? `\n\n${options.appendSystemPrompt}` : "";
	const contextSection = buildContextSection(contextFiles);
	const visibleSkills = (options.skills ?? []).filter((skill) => !skill.disableModelInvocation);
	const skillSection = canIncludeSkills(options) ? formatSkillsForPrompt(visibleSkills) : "";
	const normalizedCwd = options.cwd.replace(/\\/g, "/");
	const cwdSection = `\nCurrent working directory: ${normalizedCwd}${customPrompt ? "\n" : ""}`;

	const total = countCharacters(prompt);
	const accounted = [customPrompt, appendSection, contextSection, skillSection, cwdSection].reduce(
		(sum, section) => sum + countCharacters(section),
		0,
	);

	return {
		total,
		generated: Math.max(0, total - accounted),
		customPrompt: countCharacters(customPrompt),
		appendSection: countCharacters(appendSection),
		contextSection: countCharacters(contextSection),
		skillSection: countCharacters(skillSection),
		cwdSection: countCharacters(cwdSection),
		contextFiles,
		availableSkills: visibleSkills.length,
		includedSkills: skillSection.length > 0 ? visibleSkills.length : 0,
	};
}

function createStartupWidget(characterCount: number, theme: Theme) {
	return {
		render(width: number): string[] {
			if (width <= 0) return [];

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

function showStartupWidget(ctx: ExtensionContext): void {
	const size = countCharacters(ctx.getSystemPrompt());
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => createStartupWidget(size, theme));
	startupWidgetVisible = true;
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
		formatPromptLine(theme, "Appended prompt", formatCharacters(sections.appendSection)),
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
		if (!startupWidgetVisible || ctx.mode !== "tui") return;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		startupWidgetVisible = false;
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (startupWidgetVisible && ctx.mode === "tui") {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}
		startupWidgetVisible = false;
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
