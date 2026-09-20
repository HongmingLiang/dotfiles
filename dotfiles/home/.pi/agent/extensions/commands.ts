/**
 * Slash command directory.
 *
 * `/commands` prints every slash command available in the current session into
 * the transcript:
 *
 *   - Built-in:   pi's own interactive commands (/model, /settings, /hotkeys, ...)
 *   - Extensions: commands registered via pi.registerCommand(), labelled with
 *                 the extension file (or package) that registered them
 *   - Prompts:    prompt templates from ~/.pi/agent/prompts and .pi/prompts
 *   - Skills:     skills exposed as /skill:<name>, labelled with the extension or
 *                 package that contributes them plus whether the model may
 *                 invoke them (see `disable-model-invocation` in docs/skills.md)
 *
 * `/commands <group>` filters the listing. The output is written with
 * pi.appendEntry() and drawn by a registered entry renderer, so it never
 * reaches the LLM context. Running it again appends a fresh entry while the
 * previous one collapses to nothing, which is as close to "replace the last
 * output" as the transcript allows.
 *
 * pi.getCommands() covers extensions, prompts, and skills but deliberately
 * omits built-ins. Those are read from pi's internal command table via
 * getPackageDir(), best-effort: if a release moves the file, the built-in
 * group is dropped instead of failing the command.
 */

import * as path from "node:path";
import {
	DynamicBorder,
	getMarkdownTheme,
	getPackageDir,
	type ExtensionAPI,
	type SessionEntry,
	type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

const ENTRY_TYPE = "commands-list";

type GroupKey = "builtin" | "extension" | "prompt" | "skill";

const GROUPS: ReadonlyArray<{ key: GroupKey; label: string }> = [
	{ key: "builtin", label: "Built-in" },
	{ key: "extension", label: "Extensions" },
	{ key: "prompt", label: "Prompts" },
	{ key: "skill", label: "Skills" },
];

/** Column headers per group, in render order. */
const COLUMNS: Record<GroupKey, string[]> = {
	builtin: ["Command", "Description"],
	extension: ["Command", "Extension", "Description"],
	prompt: ["Command", "Description"],
	skill: ["Command", "Extension", "Model-invocable", "Description"],
};

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

/** Source label pi gives to resources an extension contributes via resources_discover. */
const EXTENSION_SOURCE_PREFIX = "extension:";

/**
 * Extension name when a skill came from an extension, e.g. "dynamic-resources"
 * for source "extension:dynamic-resources".
 */
function contributedByExtension(sourceInfo: SourceInfo): string | undefined {
	if (!sourceInfo.source.startsWith(EXTENSION_SOURCE_PREFIX)) return undefined;
	const name = sourceInfo.source.slice(EXTENSION_SOURCE_PREFIX.length).trim();
	return name.length > 0 ? name : undefined;
}

interface BuiltinCommand {
	name: string;
	description: string;
	argumentHint?: string;
}

interface CommandRow {
	name: string;
	hint?: string;
	description?: string;
	/** Extensions only: the extension file or package that registered the command. */
	source?: string;
	/** Skills only: true when the skill was contributed by an extension. */
	contributed?: boolean;
	/** Skills only: whether the model may invoke the skill (disable-model-invocation). */
	modelInvocable?: boolean;
}

interface CommandsListData {
	/** Unique id per invocation; only the newest entry stays expanded. */
	id?: string;
	filter: string;
	groups: { key: GroupKey; label: string; rows: CommandRow[] }[];
}

function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function formatInvocation(row: CommandRow): string {
	return `/${row.name}${row.hint ? ` ${row.hint}` : ""}`;
}

/** Package name for paths inside node_modules, e.g. "npm:@scope/pkg". */
function packageLabel(filePath: string): string | undefined {
	const index = filePath.lastIndexOf(NODE_MODULES);
	if (index < 0) return undefined;

	const segments = filePath.slice(index + NODE_MODULES.length).split(path.sep);
	const first = segments[0];
	if (!first) return undefined;
	if (first.startsWith("@") && segments[1]) return `npm:${first}/${segments[1]}`;
	return `npm:${first}`;
}

/** "commands.ts", "toolbox/index.ts", "npm:pi-web-access" */
function extensionLabel(sourceInfo: SourceInfo): string {
	const pkg = packageLabel(sourceInfo.path);
	if (pkg) return pkg;

	const segments = sourceInfo.path.split(path.sep);
	const base = segments.at(-1) ?? sourceInfo.path;
	if (/^index\.[cm]?[jt]s$/.test(base)) return segments.slice(-2).join("/");
	return base;
}

/**
 * Read pi's built-in interactive command table.
 */
async function loadBuiltinCommands(): Promise<BuiltinCommand[]> {
	try {
		const modulePath = path.join(getPackageDir(), "dist", "core", "slash-commands.js");
		const module = (await import(modulePath)) as {
			BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinCommand>;
		};
		return [...module.BUILTIN_SLASH_COMMANDS];
	} catch {
		return [];
	}
}

export default function commandsExtension(pi: ExtensionAPI): void {
	let builtinCache: Promise<BuiltinCommand[]> | undefined;
	const builtins = (): Promise<BuiltinCommand[]> => (builtinCache ??= loadBuiltinCommands());

	// pi has no API for removing a transcript entry, so a repeated /commands
	// appends a new entry and the superseded one collapses itself: every entry
	// renders on each frame, and stale ids return no lines. Ids are restored
	// from the session so a resumed or reloaded session only shows the last one.
	let latestEntryId: string | undefined;
	let entrySeq = 0;

	const nextEntryId = (): string => `commands-${Date.now().toString(36)}-${++entrySeq}`;

	const adoptLatestEntry = (entries: readonly SessionEntry[]): void => {
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index]!;
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			latestEntryId = (entry.data as CommandsListData | undefined)?.id;
			return;
		}
	};

	pi.on("session_start", (_event, ctx) => {
		adoptLatestEntry(ctx.sessionManager.getEntries());
	});

	pi.registerEntryRenderer<CommandsListData>(ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		const groups = data?.groups ?? [];
		const total = groups.reduce((sum, group) => sum + group.rows.length, 0);

		const container = new Container();
		container.addChild(new DynamicBorder((str) => theme.fg("border", str)));
		container.addChild(new Spacer(1));

		const title = data && data.filter !== "all" ? `Slash Commands · ${data.filter} (${total})` : `Slash Commands (${total})`;
		container.addChild(new Text(theme.bold(theme.fg("accent", title)), 1, 0));
		container.addChild(new Spacer(1));

		const markdown: string[] = [];
		for (const group of groups) {
			const columns = COLUMNS[group.key];
			markdown.push(`### ${group.label} (${group.rows.length})`, "");
			markdown.push(`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`);

			for (const row of group.rows) {
				const cells = [`\`${escapeCell(formatInvocation(row))}\``];
				if (group.key === "extension") cells.push(`\`${escapeCell(row.source ?? "")}\``);
				if (group.key === "skill") {
					cells.push(escapeCell(row.source ?? ""));
					cells.push(
						row.modelInvocable === undefined ? "?" : row.modelInvocable ? "yes" : "no",
					);
				}
				cells.push(escapeCell(row.description ?? ""));
				markdown.push(`| ${cells.join(" | ")} |`);
			}

			if (group.key === "skill") {
				if (group.rows.some((row) => row.contributed)) {
					markdown.push(
						"",
						"`Extension` = contributing extension (`resources_discover`) or package; `—` = plain skills directory.",
					);
				}
				if (group.rows.some((row) => row.modelInvocable === false)) {
					markdown.push(
						"",
						"`no` = kept out of the system prompt, so the model cannot invoke it; type `/skill:<name>` yourself.",
					);
				}
			}

			markdown.push("");
		}

		container.addChild(new Markdown(markdown.join("\n").trim(), 1, 0, getMarkdownTheme()));
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder((str) => theme.fg("border", str)));

		return {
			render(width: number): string[] {
				if (latestEntryId !== undefined && data?.id !== latestEntryId) return [];
				return container.render(width);
			},
			invalidate(): void {
				container.invalidate();
			},
		};
	});

	pi.registerCommand("commands", {
		description: "List all available slash commands",
		getArgumentCompletions: (prefix) => {
			const candidates = ["all", ...GROUPS.map((group) => group.key)];
			const matches = candidates.filter((candidate) => candidate.startsWith(prefix));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const filter = args.trim().toLowerCase();

			if (filter && filter !== "all" && !GROUPS.some((group) => group.key === filter)) {
				ctx.ui.notify(
					`Unknown group "${filter}". Try: all, ${GROUPS.map((group) => group.key).join(", ")}`,
					"warning",
				);
				return;
			}

			const builtinCommands = await builtins();
			const commands = pi.getCommands();

			// Only name/flag metadata is read from the prompt options here; loaded
			// context files and skill bodies stay out of the listing.
			const skills = ctx.getSystemPromptOptions().skills ?? [];
			const skillFlags = new Map(skills.map((skill) => [skill.name, !skill.disableModelInvocation]));

			const rowsFor = (key: GroupKey): CommandRow[] => {
				if (key === "builtin") {
					return builtinCommands.map((command) => ({
						name: command.name,
						hint: command.argumentHint,
						description: command.description,
					}));
				}

				const rows = commands.filter((command) => command.source === key);

				if (key === "skill") {
					return rows.sort((a, b) => a.name.localeCompare(b.name)).map((command) => {
						const extension = contributedByExtension(command.sourceInfo);
						return {
							name: command.name,
							description: command.description,
							source: extension ?? packageLabel(command.sourceInfo.path) ?? "—",
							contributed: extension !== undefined,
							modelInvocable: skillFlags.get(command.name.replace(/^skill:/, "")),
						};
					});
				}

				return rows
					.sort((a, b) =>
						key === "extension"
							? extensionLabel(a.sourceInfo).localeCompare(extensionLabel(b.sourceInfo)) ||
								a.name.localeCompare(b.name)
							: a.name.localeCompare(b.name),
					)
					.map((command) => ({
						name: command.name,
						description: command.description,
						...(key === "extension" ? { source: extensionLabel(command.sourceInfo) } : {}),
					}));
			};

			const wanted = filter === "" || filter === "all" ? GROUPS : GROUPS.filter((group) => group.key === filter);
			const groups = wanted
				.map((group) => ({ key: group.key, label: group.label, rows: rowsFor(group.key) }))
				.filter((group) => group.rows.length > 0);
			const total = groups.reduce((sum, group) => sum + group.rows.length, 0);

			if (total === 0) {
				ctx.ui.notify(filter ? `No ${filter} commands found` : "No commands found", "info");
				return;
			}

			if (ctx.mode === "tui") {
				const id = nextEntryId();
				latestEntryId = id;
				pi.appendEntry<CommandsListData>(ENTRY_TYPE, {
					id,
					filter: filter === "" ? "all" : filter,
					groups,
				});
			} else {
				ctx.ui.notify(groups.map((group) => `${group.label}: ${group.rows.length}`).join(" · "), "info");
			}
		},
	});
}
