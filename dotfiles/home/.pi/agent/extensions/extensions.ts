/**
 * Extensions Manager
 *
 * Adds /extensions: a searchable list of every extension pi would load, split
 * into "Direct extensions" (auto-discovered files in ~/.pi/agent/extensions and
 * .pi/extensions, plus explicit `extensions` entries) and "Package extensions"
 * (extensions contributed by packages from settings `packages`).
 *
 * Each row is prefixed with its scope: G = global (~/.pi/agent, used by every
 * project), L = local (this project's .pi/ directory).
 *
 * Behavior:
 * - Toggles are only staged while the list is open. They are written to
 *   settings.json when the list is closed with Esc — Esc applies, it is not a
 *   cancel and there is no separate confirm step. Closing with no changes
 *   writes nothing and does not reload.
 * - Disabling writes a `-path` force-exclude entry. Enabling just removes the
 *   exclusion again instead of adding a redundant `+path`, because extensions
 *   are enabled by default. Empty `extensions` arrays/fields are deleted.
 * - After a successful write the session is reloaded, so changes take effect
 *   immediately. Nothing is cached: the list is resolved from settings plus
 *   the filesystem on every open, which keeps disabled extensions visible and
 *   avoids stale registries.
 *
 * Usage: /extensions
 */

import {
	CONFIG_DIR_NAME,
	DefaultPackageManager,
	SettingsManager,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Input,
	fuzzyFilter,
	fuzzyMatch,
	getKeybindings,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

type Scope = "user" | "project";

interface ExtensionRow {
	/** Stable id (unique across scopes). */
	id: string;
	/** Display name in the list. */
	name: string;
	description: string;
	enabled: boolean;
	path: string;
	scope: Scope;
	origin: "top-level" | "package";
	/** Settings source string for package entries ("auto"/"local" for top-level). */
	source: string;
	/** Directory that relative +path / -path filters resolve against. */
	baseDir: string;
}

interface Group {
	key: string;
	label: string;
	rows: ExtensionRow[];
}

interface PendingChange {
	row: ExtensionRow;
	enabled: boolean;
}

// --- generics -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// --- path helpers ---------------------------------------------------------

function toPosix(path: string): string {
	return path.replaceAll("\\", "/");
}

function displayPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${toPosix(path.slice(home.length))}` : toPosix(path);
}

/** Scope wording used in descriptions and the legend. */
function scopeLabel(scope: Scope): string {
	return scope === "user" ? "global" : "local";
}

/** One-letter scope marker shown in front of every row. */
function scopeLetter(scope: Scope): string {
	return scope === "user" ? "G" : "L";
}

/** Short, human name for a package source: "npm:pi-web-access@1" -> "pi-web-access",
 * "git:github.com/user/repo@v1" -> "repo", "/path/to/my-pkg" -> "my-pkg". */
function shortSource(source: string): string {
	if (source.startsWith("npm:")) return source.slice(4).replace(/@[^/@]*$/, "") || source;

	const isGit = /^(git:|git@|https?:\/\/|ssh:\/\/)/.test(source);
	const withoutPrefix = source.replace(/^(git:|https?:\/\/|ssh:\/\/)/, "");
	const withoutRef = isGit ? withoutPrefix.replace(/@[^/@]*$/, "") : withoutPrefix;
	const segments = withoutRef.replace(/[\\/]+$/, "").split(/[\\/:]/).filter(Boolean);
	const segment = segments[segments.length - 1];
	return segment && segment !== "." && segment !== ".." ? segment : source;
}

/** Name of a local extension; `foo/index.ts` shows as `foo`, not `index.ts`. */
function localExtensionName(path: string): string {
	const file = basename(path);
	const parent = basename(dirname(path));
	if (/^index\.(ts|js|mts|mjs|cts|cjs)$/i.test(file) && parent && parent !== "extensions") {
		return parent;
	}
	return file;
}

/**
 * Detail shown next to a package name when one package contributes several extensions.
 * Keeps it short: file base name, or the folder for `index.*` entry points.
 */
function packageEntryDetail(path: string, baseDir: string): string {
	const file = basename(path);
	if (!/^index\.(ts|js|mts|mjs|cts|cjs)$/i.test(file)) return file;
	const rel = toPosix(relative(baseDir, path));
	const dir = rel && !rel.startsWith("..") ? toPosix(dirname(rel)) : ".";
	return dir === "." ? file : dir;
}

/**
 * Pattern written to settings.json. Exact `+path` / `-path` entries match either
 * the path relative to the settings base dir or an absolute path, so prefer the
 * relative form to keep settings readable.
 */
function settingPattern(path: string, baseDir: string): string {
	const rel = toPosix(relative(baseDir, path));
	if (rel && !rel.startsWith("../") && !rel.startsWith("/")) return rel;
	return toPosix(path);
}

/**
 * True when an override entry (`+path` / `-path` / `!path`) refers to exactly this file.
 * Plain entries are deliberately left alone: they are what makes an explicitly-listed
 * extension discoverable at all, so removing one on disable would hide it from this list
 * (a force-exclude already wins over a plain include). Never matches globs.
 */
function overrideTargetsPath(entry: string, path: string, baseDir: string): boolean {
	if (!/^[!+-]/.test(entry)) return false;
	const target = toPosix(entry.slice(1)).replace(/^\.\//, "");
	if (!target || /[*?[\]{}]/.test(target)) return false;
	return target === toPosix(path) || resolve(baseDir, target) === resolve(path);
}

// --- settings file access -------------------------------------------------

function settingsPath(scope: Scope, cwd: string): string {
	return scope === "user"
		? join(getAgentDir(), "settings.json")
		: join(cwd, CONFIG_DIR_NAME, "settings.json");
}

async function readSettingsFile(path: string): Promise<Record<string, unknown>> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isRecord(parsed)) throw new Error(`${displayPath(path)} must contain a JSON object`);
		return parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {};
		throw error;
	}
}

async function writeSettingsFile(path: string, settings: Record<string, unknown>): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	await rename(tempPath, path);
}

/** Disable = add `-path`; enable = drop the exclusion (extensions are on by default). */
function applyTopLevelToggle(
	settings: Record<string, unknown>,
	row: ExtensionRow,
	enabled: boolean,
): void {
	const next = stringArray(settings.extensions).filter(
		(entry) => !overrideTargetsPath(entry, row.path, row.baseDir),
	);
	if (!enabled) next.push(`-${settingPattern(row.path, row.baseDir)}`);
	if (next.length > 0) settings.extensions = next;
	else delete settings.extensions;
}

function applyPackageToggle(
	settings: Record<string, unknown>,
	row: ExtensionRow,
	enabled: boolean,
): void {
	const packages = Array.isArray(settings.packages) ? [...settings.packages] : [];
	const index = packages.findIndex((entry) => {
		if (typeof entry === "string") return entry === row.source;
		return isRecord(entry) && entry.source === row.source;
	});
	if (index === -1) {
		throw new Error(`Package ${row.source} not found in ${row.scope} settings`);
	}

	const current = packages[index];
	const entry: Record<string, unknown> =
		typeof current === "string" ? { source: current } : isRecord(current) ? { ...current } : {};
	const filters = stringArray(entry.extensions).filter(
		(filter) => !overrideTargetsPath(filter, row.path, row.baseDir),
	);
	if (!enabled) filters.push(`-${settingPattern(row.path, row.baseDir)}`);
	// `autoload: false` packages start empty, so enabling one entry must keep a force-include.
	else if (entry.autoload === false) filters.push(`+${settingPattern(row.path, row.baseDir)}`);

	if (filters.length > 0) entry.extensions = filters;
	else delete entry.extensions;
	packages[index] =
		Object.keys(entry).length === 1 && typeof entry.source === "string" ? entry.source : entry;
	settings.packages = packages;
}

async function applyChanges(
	cwd: string,
	projectTrusted: boolean,
	changes: PendingChange[],
): Promise<void> {
	for (const scope of ["user", "project"] as const) {
		const scoped = changes.filter((change) => change.row.scope === scope);
		if (scoped.length === 0) continue;
		if (scope === "project" && !projectTrusted) {
			throw new Error("Project is not trusted, refusing to write .pi/settings.json");
		}
		const path = settingsPath(scope, cwd);
		const settings = await readSettingsFile(path);
		for (const change of scoped) {
			if (change.row.origin === "package") applyPackageToggle(settings, change.row, change.enabled);
			else applyTopLevelToggle(settings, change.row, change.enabled);
		}
		await writeSettingsFile(path, settings);
	}
}

// --- discovery ------------------------------------------------------------

async function loadExtensions(
	cwd: string,
	projectTrusted: boolean,
): Promise<{ rows: ExtensionRow[]; settingsManager: SettingsManager }> {
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

	// "skip" keeps resolve() read-only: a list command must not install packages.
	const resolved = await packageManager.resolve(async () => "skip");
	const projectBaseDir = join(cwd, CONFIG_DIR_NAME);
	const rows: ExtensionRow[] = [];

	for (const resource of resolved.extensions) {
		if (resource.metadata.scope === "temporary") continue;
		const scope: Scope = resource.metadata.scope === "project" ? "project" : "user";
		const origin = resource.metadata.origin;
		const baseDir = resource.metadata.baseDir ?? (scope === "project" ? projectBaseDir : agentDir);
		const source = resource.metadata.source;
		const name =
			origin === "package" ? shortSource(source) : localExtensionName(resource.path);
		const description =
			origin === "package"
				? `package ${source} · ${scopeLabel(scope)} · ${displayPath(resource.path)}`
				: `${scopeLabel(scope)} · ${displayPath(resource.path)}`;
		rows.push({
			id: `${scope}:${origin}:${resource.path}`,
			name,
			description,
			enabled: resource.enabled,
			path: resource.path,
			scope,
			origin,
			source,
			baseDir,
		});
	}

	// A package that contributes several extensions gets a short suffix so the rows
	// stay distinguishable; single-extension packages show just their name.
	const packageRows = new Map<string, ExtensionRow[]>();
	for (const row of rows) {
		if (row.origin !== "package") continue;
		const group = packageRows.get(row.source);
		if (group) group.push(row);
		else packageRows.set(row.source, [row]);
	}
	for (const [source, group] of packageRows) {
		if (group.length < 2) continue;
		for (const row of group) {
			row.name = `${shortSource(source)} › ${packageEntryDetail(row.path, row.baseDir)}`;
		}
	}

	rows.sort((a, b) => {
		if (a.origin !== b.origin) return a.origin === "top-level" ? -1 : 1;
		if (a.scope !== b.scope) return a.scope === "user" ? -1 : 1;
		if (a.source !== b.source) return a.source.localeCompare(b.source);
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		return a.path.localeCompare(b.path);
	});

	return { rows, settingsManager };
}

/** Sections by origin: direct extension files first, then package-provided ones. */
function buildGroups(rows: ExtensionRow[]): Group[] {
	const local = rows.filter((row) => row.origin === "top-level");
	const packages = rows.filter((row) => row.origin === "package");
	const groups: Group[] = [];
	if (local.length > 0) groups.push({ key: "local", label: "Direct extensions", rows: local });
	if (packages.length > 0) {
		groups.push({ key: "packages", label: "Package extensions", rows: packages });
	}
	return groups;
}

/**
 * Search text for one row. Only the name plus the scope word is searched: fuzzy
 * matching is subsequence-based, so longer text (full paths) would match almost
 * any query. Package rows include the shortened package name, so searching by
 * package works too.
 */
function rowSearchText(row: ExtensionRow): string {
	return `${row.name} ${scopeLabel(row.scope)}`;
}

function filterGroups(groups: Group[], query: string): Group[] {
	const trimmed = query.trim();
	if (!trimmed) return groups;
	const result: Group[] = [];
	for (const group of groups) {
		const rows = fuzzyMatch(trimmed, group.label).matches
			? group.rows
			: fuzzyFilter(group.rows, trimmed, rowSearchText);
		if (rows.length > 0) result.push({ key: group.key, label: group.label, rows });
	}
	return result;
}

// --- UI ------------------------------------------------------------------

type Entry =
	| { kind: "spacer" }
	| { kind: "header"; group: Group }
	| { kind: "row"; row: ExtensionRow };

class ExtensionsList implements Component {
	private readonly input = new Input({ prompt: "> ", placeholder: "search extensions" });
	private readonly groups: Group[];
	private filtered: Group[];
	private selectedId: string | undefined;
	private scrollTop = 0;
	private _focused = false;

	constructor(
		private readonly rows: ExtensionRow[],
		private readonly initial: ReadonlyMap<string, boolean>,
		private readonly theme: Theme,
		private readonly maxVisible: number,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
	) {
		this.groups = buildGroups(rows);
		this.filtered = this.groups;
		this.selectedId = rows[0]?.id;
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	invalidate(): void {}

	private visibleRows(): ExtensionRow[] {
		return this.filtered.flatMap((group) => group.rows);
	}

	private selectedRow(): ExtensionRow | undefined {
		return this.visibleRows().find((row) => row.id === this.selectedId);
	}

	private pendingCount(): number {
		return this.rows.filter((row) => this.initial.get(row.id) !== row.enabled).length;
	}

	private move(delta: number): void {
		const rows = this.visibleRows();
		if (rows.length === 0) return;
		const current = rows.findIndex((row) => row.id === this.selectedId);
		const next = Math.max(0, Math.min(rows.length - 1, (current < 0 ? 0 : current) + delta));
		this.selectedId = rows[next]?.id;
	}

	private rebuildFilter(): void {
		this.filtered = filterGroups(this.groups, this.input.getValue());
		const rows = this.visibleRows();
		if (!rows.some((row) => row.id === this.selectedId)) this.selectedId = rows[0]?.id;
		this.scrollTop = 0;
	}

	private toggleSelected(): void {
		const row = this.selectedRow();
		if (!row) return;
		row.enabled = !row.enabled;
	}

	private buildEntries(): Entry[] {
		const entries: Entry[] = [];
		for (const group of this.filtered) {
			if (entries.length > 0) entries.push({ kind: "spacer" });
			entries.push({ kind: "header", group });
			for (const row of group.rows) entries.push({ kind: "row", row });
		}
		return entries;
	}

	private renderHeader(group: Group, width: number): string {
		const label = ` ${group.label} `;
		const count = `(${group.rows.length}) `;
		const used = 2 + visibleWidth(label) + visibleWidth(count);
		const rule = this.theme.fg("border", "─".repeat(Math.max(0, width - used - 1)));
		return `  ${this.theme.fg("accent", this.theme.bold(label))}${this.theme.fg("dim", count)}${rule}`;
	}

	private renderRow(row: ExtensionRow): string {
		const selected = row.id === this.selectedId;
		const cursor = selected ? this.theme.fg("accent", "→ ") : "  ";
		const dot = row.enabled ? this.theme.fg("success", "●") : this.theme.fg("dim", "○");
		const name = selected
			? this.theme.bold(row.name)
			: row.enabled
				? row.name
				: this.theme.fg("dim", row.name);
		const scope = this.theme.fg(row.scope === "user" ? "muted" : "accent", scopeLetter(row.scope));
		return `  ${cursor}${dot} ${scope} ${name}`;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const push = (line: string) => lines.push(truncateToWidth(line, width, ""));
		const enabledCount = this.rows.filter((row) => row.enabled).length;
		const pending = this.pendingCount();

		push("");
		const header = `${this.theme.fg("accent", this.theme.bold("Extensions"))}${this.theme.fg(
			"muted",
			`  ${enabledCount}/${this.rows.length} enabled`,
		)}${pending > 0 ? this.theme.fg("warning", `  · ${pending} pending`) : ""}`;
		push(` ${header}`);
		push(
			` ${this.theme.fg("muted", "G = global (~/.pi/agent)  ·  L = local (this project's .pi/)")}`,
		);
		push(
			` ${this.theme.fg("muted", "Changes are staged and written to settings.json when you close with Esc.")}`,
		);
		push("");
		for (const line of this.input.render(Math.max(1, width - 1))) push(` ${line}`);
		push("");

		const entries = this.buildEntries();
		if (entries.length === 0) {
			push(this.theme.fg("muted", "  no matches"));
		} else {
			const budget = Math.max(3, this.maxVisible);
			const selectedEntryIndex = entries.findIndex(
				(entry) => entry.kind === "row" && entry.row.id === this.selectedId,
			);
			let start = Math.min(this.scrollTop, Math.max(0, entries.length - budget));
			if (selectedEntryIndex >= 0) {
				if (selectedEntryIndex < start) start = selectedEntryIndex;
				if (selectedEntryIndex >= start + budget) start = selectedEntryIndex - budget + 1;
			}
			start = Math.max(0, Math.min(start, Math.max(0, entries.length - budget)));
			this.scrollTop = start;

			const end = Math.min(entries.length, start + budget);
			for (let index = start; index < end; index += 1) {
				const entry = entries[index]!;
				if (entry.kind === "spacer") push("");
				else if (entry.kind === "header") push(this.renderHeader(entry.group, width));
				else push(this.renderRow(entry.row));
			}

			const visible = this.visibleRows();
			const selectedIndex = visible.findIndex((row) => row.id === this.selectedId);
			if (selectedIndex >= 0) {
				push(this.theme.fg("dim", `  (${selectedIndex + 1}/${visible.length})`));
			}
		}

		const selected = this.selectedRow();
		if (selected) {
			push("");
			for (const line of wrapTextWithAnsi(`  ${selected.description}`, Math.max(1, width - 1))) {
				push(this.theme.fg("muted", line));
			}
		}

		push("");
		push(this.theme.fg("muted", "  Type to search · ↑/↓ move · Enter toggle · Esc apply & close"));
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			this.move(event.wheelDelta > 0 ? 1 : -1);
			this.requestRender();
			return { handled: true };
		}
		return undefined;
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();
		if (keybindings.matches(data, "tui.select.cancel")) {
			this.onClose();
			return;
		}
		if (keybindings.matches(data, "tui.select.up")) {
			this.move(-1);
			this.requestRender();
			return;
		}
		if (keybindings.matches(data, "tui.select.down")) {
			this.move(1);
			this.requestRender();
			return;
		}
		if (keybindings.matches(data, "tui.select.pageUp")) {
			this.move(-this.maxVisible);
			this.requestRender();
			return;
		}
		if (keybindings.matches(data, "tui.select.pageDown")) {
			this.move(this.maxVisible);
			this.requestRender();
			return;
		}
		// Enter toggles; Space only toggles while the search box is empty so it can be typed.
		const confirm = keybindings.matches(data, "tui.select.confirm");
		if (confirm || (data === " " && this.input.getValue().length === 0)) {
			this.toggleSelected();
			this.requestRender();
			return;
		}

		const previous = this.input.getValue();
		this.input.handleInput(data);
		if (this.input.getValue() !== previous) {
			this.rebuildFilter();
			this.requestRender();
		}
	}
}

// --- command --------------------------------------------------------------

async function showExtensions(ctx: ExtensionCommandContext): Promise<void> {
	const projectTrusted = ctx.isProjectTrusted();
	const { rows } = await loadExtensions(ctx.cwd, projectTrusted);
	if (rows.length === 0) {
		ctx.ui.notify("No extensions found in settings or auto-discovery directories.", "info");
		return;
	}

	// Snapshot so we can write one batch when the list closes (Esc applies).
	const initial = new Map(rows.map((row) => [row.id, row.enabled]));
	await ctx.ui.custom((tui, theme, _keybindings, done) => {
		return new ExtensionsList(
			rows,
			initial,
			theme,
			Math.max(6, (tui.terminal?.rows ?? 24) - 12),
			() => done(undefined),
			() => tui.requestRender(),
		);
	});

	const changes: PendingChange[] = rows
		.filter((row) => initial.get(row.id) !== row.enabled)
		.map((row) => ({ row, enabled: row.enabled }));
	if (changes.length === 0) return;

	try {
		await applyChanges(ctx.cwd, projectTrusted, changes);
	} catch (error) {
		ctx.ui.notify(`Failed to update settings: ${errorMessage(error)}`, "error");
		return;
	}

	const files = [...new Set(changes.map((change) => settingsPath(change.row.scope, ctx.cwd)))];
	ctx.ui.notify(
		`Applied ${changes.length} change${changes.length === 1 ? "" : "s"} to ${files.map(displayPath).join(", ")} · reloading`,
		"info",
	);
	await ctx.reload();
}

export default function extensionsManager(pi: ExtensionAPI) {
	pi.registerCommand("extensions", {
		description: "List and enable/disable extensions",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/extensions requires TUI mode", "error");
				return;
			}
			try {
				await showExtensions(ctx);
			} catch (error) {
				ctx.ui.notify(`Failed to load extensions: ${errorMessage(error)}`, "error");
			}
		},
	});
}
