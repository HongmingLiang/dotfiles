/**
 * Pi notify.
 *
 * Desktop notifications for the two moments where Pi is waiting on you:
 *
 * - a blocking extension UI prompt appears (approval, question, password, ...)
 * - a run settles (no retry, compaction, or queued continuation will follow)
 *
 * The notification is a terminal escape sequence, so it is only as good as the
 * terminal in front of it. Inside tmux the sequence goes through the
 * passthrough envelope, and a one-shot `client-focus-in` hook jumps back to the
 * pane that fired it once the terminal window regains focus.
 *
 * Content is deliberately terse: state and kind of input wanted, never the
 * prompt text. Notifications linger in the OS notification center, so the
 * payload stays free of commands, paths, and other session details.
 *
 * Config: `~/.pi/agent/notify.json` (see DEFAULT_CONFIG). `/notify` shows the
 * effective values, `/notify test` renders every variant.
 */

import { execFile } from "node:child_process";
import {
	appendFileSync,
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type Protocol = "osc777" | "osc99" | "osc9";
type Channel = Protocol | "powershell";
type UnknownPromptPolicy = "confirm" | "all" | "none";
type SettleOutcome = "done" | "incomplete" | "error";

/** A tool-name prefix that counts as "this tool is asking the user". */
export interface ToolPattern {
	startsWith: string;
	label: string;
}

export interface Config {
	/** Master switch. */
	enabled: boolean;
	/** Wait this long after a blocking prompt appears before notifying. */
	promptDelayMs: number;
	/**
	 * Wait this long after a run settles before notifying. Nothing is blocked
	 * here, so this one is deliberately the longer of the two.
	 */
	settledDelayMs: number;
	/** Tools whose prompts are worth a notification, by exact name. */
	notifyTools: string[];
	/** Tools that never notify, by exact name. Checked before everything else. */
	muteTools: string[];
	/**
	 * Fallback for tools whose names cannot be enumerated (new packages, MCP
	 * tools). A name matches when it starts with `startsWith` once `-` and `_`
	 * are removed, so `ask_user_question`, `ask-user-question` and
	 * `AskUserQuestion` all match `ask` while `task_list` does not. First match
	 * in the array wins.
	 */
	notifyToolPatterns: ToolPattern[];
	/** What to do with prompts that cannot be tied to a tool. */
	notifyUnknownPrompt: UnknownPromptPolicy;
	/** Display label overrides, by exact lower-cased tool name. */
	labels: Record<string, string>;
	/**
	 * Append a snippet of your latest prompt, so the notification says which
	 * situation it belongs to. Truncated, and it lands in the OS notification
	 * center, which keeps history.
	 */
	showPrompt: boolean;
	/** Terminal protocol, or "auto" to detect it. */
	protocol: Channel | "auto";
	/** Append every decision to `~/.pi/agent/pi-notify.log`. */
	debug: boolean;
	/** Warn once per session when tmux will not forward background panes. */
	warnOnPassthrough: boolean;
}

export const DEFAULT_CONFIG: Config = {
	enabled: true,
	promptDelayMs: 10_000,
	settledDelayMs: 30_000,
	notifyTools: ["bash", "write", "edit"],
	muteTools: [],
	notifyToolPatterns: [
		{ startsWith: "ask", label: "question" },
		{ startsWith: "question", label: "question" },
	],
	notifyUnknownPrompt: "confirm",
	labels: {
		bash: "command",
		write: "file change",
		edit: "file change",
	},
	showPrompt: true,
	protocol: "auto",
	debug: false,
	warnOnPassthrough: true,
};

const CONFIG_PATH = join(getAgentDir(), "notify.json");
const LOG_PATH = join(getAgentDir(), "pi-notify.log");
const HOOK_NAME = "client-focus-in[777]";
const TITLE_MAX = 60;
const BODY_MAX = 90;
const PROMPT_MAX = 40;
const IN_FLIGHT_TTL_MS = 60_000;
const TMUX_HOOK_MARKER = "pi-notify";

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Strip control characters and the OSC 777 field separator from a payload. */
export function sanitize(text: string): string {
	return text
		.replace(/[\u0000-\u001f\u007f\u009c]/g, " ")
		.replace(/;/g, ",")
		.replace(/\s+/g, " ")
		.replace(/\s*,\s*/g, ", ")
		.trim();
}

export function clamp(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Terminal channel
// ---------------------------------------------------------------------------

export function wrapForTmux(sequence: string): string {
	// tmux consumes the DCS envelope and forwards the payload verbatim, so the
	// inner ESC bytes have to be doubled.
	return `\x1bPtmux;${sequence.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
}

function writeToTty(data: string): void {
	let fd: number | undefined;
	try {
		fd = openSync("/dev/tty", "w");
		writeSync(fd, data);
	} catch {
		try {
			process.stdout.write(data);
		} catch {
			// Nothing left to write to.
		}
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

export function buildSequence(protocol: Protocol, title: string, body: string): string {
	switch (protocol) {
		case "osc99":
			// Kitty: two chunks, title then body, terminated with ST.
			return `\x1b]99;i=pi:d=0;${title}\x1b\\\x1b]99;i=pi:p=body;${body}\x1b\\`;
		case "osc9":
			// Single field only, so the title rides along in the body.
			return `\x1b]9;${title} · ${body}\x07`;
		case "osc777":
			return `\x1b]777;notify;${title};${body}\x07`;
	}
}

function sendWindowsToast(title: string, body: string): void {
	const quote = (value: string) => value.replace(/'/g, "''");
	const script = [
		"$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(" +
			"[Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
		'$nodes = $xml.GetElementsByTagName("text")',
		`$nodes.Item(0).InnerText = '${quote(title)}'`,
		`$nodes.Item(1).InnerText = '${quote(body)}'`,
		"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Pi').Show(" +
			"[Windows.UI.Notifications.ToastNotification]::new($xml))",
	].join("; ");
	execFile("powershell.exe", ["-NoProfile", "-Command", script], () => {
		// A failed toast is not worth interrupting the session over.
	});
}

/**
 * The program that actually draws the notification. Inside tmux the pane env
 * says `TERM_PROGRAM=tmux`, and the client's value only survives in tmux's
 * global environment.
 */
async function terminalProgram(): Promise<string> {
	const raw = (process.env.TERM_PROGRAM ?? "").trim().toLowerCase();
	if (raw && raw !== "tmux") return raw;

	if (process.env.TMUX) {
		try {
			const line = await tmux(["show-environment", "-g", "TERM_PROGRAM"]);
			const separator = line.indexOf("=");
			if (separator > 0) return line.slice(separator + 1).trim().toLowerCase();
		} catch {
			// Fall through to the env hints below.
		}
	}

	if (process.env.KITTY_WINDOW_ID) return "kitty";
	if (process.env.GHOSTTY_RESOURCES_DIR) return "ghostty";
	if (process.env.WEZTERM_PANE || process.env.WEZTERM_EXECUTABLE) return "wezterm";
	return raw;
}

async function resolveChannel(): Promise<Channel> {
	if (config.protocol !== "auto") return config.protocol;

	const program = await terminalProgram();
	if (program.includes("kitty")) return "osc99";
	if (/wezterm|ghostty|iterm|rxvt/.test(program)) return "osc777";
	// Windows Terminal understands no OSC notification we can rely on, but it
	// can always raise a toast through PowerShell. Only outside tmux: inside,
	// the passthrough path is the one that keeps the pane jump alive.
	if (!process.env.TMUX && process.env.WT_SESSION) return "powershell";
	return "osc9";
}

async function deliver(title: string, body: string): Promise<Channel> {
	const channel = await resolveChannel();
	if (channel === "powershell") {
		sendWindowsToast(title, body);
		return channel;
	}

	let sequence = buildSequence(channel, title, body);
	if (process.env.TMUX) sequence = wrapForTmux(sequence);
	writeToTty(sequence);
	return channel;
}

// ---------------------------------------------------------------------------
// tmux
// ---------------------------------------------------------------------------

export interface TmuxTarget {
	session: string;
	windowId: string;
	paneId: string;
	label: string;
}

function tmux(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("tmux", args, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout.trim());
		});
	});
}

/** Query session/window/pane fresh: indices change, so labels are read live. */
/**
 * Human-readable target, e.g. `dotfiles · 1:nvim · pane:1`. The window name is
 * only meaningful when it was set by hand: tmux's `automatic-rename` names
 * windows after the running command.
 */
export function formatTargetLabel(
	session: string,
	windowIndex: string,
	paneIndex: string,
	windowName?: string,
): string {
	const window = windowName ? `${windowIndex}:${windowName}` : windowIndex;
	return `${session} · ${window} · pane:${paneIndex}`;
}

async function queryTmuxTarget(): Promise<TmuxTarget | undefined> {
	const pane = process.env.TMUX_PANE;
	if (!process.env.TMUX || !pane) return undefined;

	try {
		// The free-form names come last so an embedded separator cannot shift
		// the structural fields.
		const out = await tmux([
			"display-message",
			"-p",
			"-t",
			pane,
			"#{session_name}\t#{window_index}\t#{pane_index}\t#{window_id}\t#{pane_id}\t#{window_name}",
		]);
		const [session, windowIndex, paneIndex, windowId, paneId, windowName] = out.split("\t");
		if (!session || !windowId || !paneId) return undefined;
		return {
			session,
			windowId,
			paneId,
			label: formatTargetLabel(session, windowIndex!, paneIndex!, windowName),
		};
	} catch {
		return undefined;
	}
}

/** True when this pane is already the visible one, so there is nowhere to jump. */
async function isVisiblePane(): Promise<boolean> {
	const pane = process.env.TMUX_PANE;
	if (!pane) return false;

	try {
		const value = await tmux(["display-message", "-p", "-t", pane, "#{&&:#{window_active},#{pane_active}}"]);
		return value === "1";
	} catch {
		return false;
	}
}

/**
 * Build the one-shot hook command. Exported for tests: the quoting and the
 * ownership marker are the parts most likely to break silently.
 */
export function buildFocusHookScript(target: TmuxTarget): string {
	const quote = (value: string) => `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
	return [
		'c="#{client_name}"',
		`if [ -n "$c" ]; then tmux switch-client -c "$c" -t ${quote(target.session)}; ` +
			`else tmux switch-client -t ${quote(target.session)}; fi`,
		`tmux select-window -t ${quote(target.windowId)}`,
		`tmux select-pane -t ${quote(target.paneId)}`,
		`tmux set-hook -gu ${quote(HOOK_NAME)}`,
		`# ${TMUX_HOOK_MARKER} ${target.paneId}`,
	].join(" ; ");
}

/**
 * Wrap the script for `set-hook`. Exported for tests alongside the script.
 */
export function buildFocusHookCommand(target: TmuxTarget): string {
	return `run-shell '${buildFocusHookScript(target).replace(/'/g, "'\\''")}'`;
}

/**
 * Arm a one-shot hook that switches back to this pane when the client regains
 * focus. Clicking an OSC notification cannot carry an identity, so the focus
 * event is the only signal available. Later notifications overwrite the hook.
 */
async function armFocusHook(target: TmuxTarget): Promise<void> {
	if (await isVisiblePane()) return;

	try {
		await tmux(["set-hook", "-g", HOOK_NAME, buildFocusHookCommand(target)]);
		armedPaneId = target.paneId;
	} catch {
		// The notification already went out; the jump is best effort.
	}
}

/** Disarm only our own hook, so a later notification from another pane survives. */
async function disarmFocusHook(): Promise<void> {
	const pane = armedPaneId;
	if (!pane) return;
	armedPaneId = undefined;

	try {
		const hooks = await tmux(["show-hooks", "-g", HOOK_NAME]);
		if (!hooks.includes(`${TMUX_HOOK_MARKER} ${pane}`)) return;
		await tmux(["set-hook", "-gu", HOOK_NAME]);
	} catch {
		// Leave the hook alone when its ownership cannot be established.
	}
}

/** `on` only forwards visible panes; background panes need `all`. */
async function passthroughAllowsBackground(): Promise<boolean | undefined> {
	const pane = process.env.TMUX_PANE;
	if (!process.env.TMUX || !pane) return undefined;

	try {
		const value = await tmux(["show", "-Ap", "-t", pane, "allow-passthrough"]);
		return /\ball\b/.test(value);
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface InFlightTool {
	toolName: string;
	startedAt: number;
}

export type PendingPayload =
	| { trigger: "prompt"; label: string; prompt?: string }
	| { trigger: "settled"; outcome: SettleOutcome; openTodos?: number; prompt?: string };

interface PendingNotification {
	payload: PendingPayload;
	timer: ReturnType<typeof setTimeout> | undefined;
}

let config: Config = { ...DEFAULT_CONFIG };
let target: TmuxTarget | undefined;
let armedPaneId: string | undefined;
let current: PendingNotification | undefined;
let lastUserInput: string | undefined;
let passthroughWarned = false;
let unsubscribeInput: (() => void) | undefined;
let notificationsEnabled = false;

const inFlight = new Map<string, InFlightTool>();

// ---------------------------------------------------------------------------
// Config IO
// ---------------------------------------------------------------------------

function loadConfig(): Config {
	if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };

	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
		return {
			...DEFAULT_CONFIG,
			...raw,
			labels: { ...DEFAULT_CONFIG.labels, ...(raw.labels ?? {}) },
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function readStoredConfig(): Record<string, unknown> {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function saveConfig(patch: Partial<Config>): void {
	writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...readStoredConfig(), ...patch }, null, 2)}\n`);
	config = loadConfig();
}

// ---------------------------------------------------------------------------
// Debug log
// ---------------------------------------------------------------------------

function log(entry: Record<string, unknown>): void {
	if (!config.debug) return;

	try {
		appendFileSync(LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
	} catch {
		// Logging must never break a notification.
	}
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function pruneInFlight(): void {
	const now = Date.now();
	for (const [id, tool] of inFlight) {
		if (now - tool.startedAt > IN_FLIGHT_TTL_MS) inFlight.delete(id);
	}
}

interface PromptDecision {
	notify: boolean;
	label?: string;
	reason: string;
}

function normalizeToolName(toolName: string): string {
	return toolName.toLowerCase().replace(/[-_]/g, "");
}

/**
 * Does this tool ask the user something? Rule order, first hit wins:
 *
 *   1. `muteTools` — exact deny, always silent
 *   2. `notifyTools` — exact allow
 *   3. `notifyToolPatterns` — prefix match after `-`/`_` removal, in array order
 *   4. otherwise silent
 *
 * `labels` overrides the display label for an exact tool name, whichever rule
 * matched it.
 */
export function classifyTool(toolName: string, settings: Config): { notify: boolean; label?: string; reason: string } {
	const name = toolName.toLowerCase();
	const override = settings.labels[name];

	if (settings.muteTools.some((muted) => muted.toLowerCase() === name)) {
		return { notify: false, reason: "tool-muted" };
	}

	if (settings.notifyTools.some((listed) => listed.toLowerCase() === name)) {
		return { notify: true, label: override ?? toolName, reason: "tool" };
	}

	const normalized = normalizeToolName(name);
	for (const pattern of settings.notifyToolPatterns) {
		const prefix = normalizeToolName(pattern.startsWith);
		if (prefix && normalized.startsWith(prefix)) {
			return { notify: true, label: override ?? pattern.label, reason: `pattern:${pattern.startsWith}` };
		}
	}

	return { notify: false, reason: "tool-not-listed" };
}

/**
 * Decide whether a blocking prompt deserves a notification, and how to label
 * it. The prompt event carries no source, so it is correlated with the tools
 * currently executing: one shared label wins, anything ambiguous falls back to
 * the prompt kind rather than guessing wrong.
 */
export function classifyPrompt(kind: string, tools: InFlightTool[], settings: Config): PromptDecision {
	const sorted = [...tools].sort((a, b) => b.startedAt - a.startedAt);
	const matched = sorted
		.map((tool) => classifyTool(tool.toolName, settings))
		.filter((verdict) => verdict.notify);
	const labels = [...new Set(matched.map((verdict) => verdict.label ?? kind))];

	if (kind === "input") {
		return { notify: true, label: labels.length === 1 ? labels[0]! : "input", reason: "input-kind" };
	}

	if (sorted.length === 0) {
		if (settings.notifyUnknownPrompt === "none") {
			return { notify: false, reason: "unknown-source-disabled" };
		}
		if (settings.notifyUnknownPrompt === "all" || kind === "confirm") {
			return { notify: true, label: kind, reason: `unknown-source-${kind}` };
		}
		return { notify: false, reason: `unknown-source-${kind}` };
	}

	if (matched.length === 0) {
		return { notify: false, reason: "tool-not-listed" };
	}

	// Several tools asked at once and they disagree on the label: the prompt
	// event carries no source, so report the kind rather than picking one.
	if (labels.length > 1) {
		return { notify: true, label: kind, reason: "tool-ambiguous" };
	}

	return { notify: true, label: labels[0]!, reason: matched[0]!.reason };
}

/** Settle notifications are classified from the final message, not from agent_end. */
function classifySettle(ctx: ExtensionContext): { outcome: SettleOutcome; openTodos?: number } | undefined {
	const branch = ctx.sessionManager.getBranch() as unknown as BranchEntry[];

	let stopReason: string | undefined;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "message" && entry.message?.role === "assistant") {
			stopReason = entry.message.stopReason;
			break;
		}
	}

	let outcome: SettleOutcome | undefined;
	switch (stopReason) {
		case undefined:
		case "stop":
			outcome = "done";
			break;
		case "length":
			outcome = "incomplete";
			break;
		case "error":
			outcome = "error";
			break;
		default:
			// "toolUse" is still working, "aborted" means the user is present,
			// "pending"/"deferred" are not terminal states.
			return undefined;
	}

	const openTodos = countOpenTodos(branch);
	return { outcome, openTodos };
}

export interface BranchEntry {
	type?: string;
	message?: {
		role?: string;
		stopReason?: string;
		content?: unknown;
		details?: unknown;
	};
}

export function countOpenTodos(branch: BranchEntry[]): number | undefined {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message?.role !== "toolResult") continue;

		const todos = (entry.message.details as { todos?: unknown } | undefined)?.todos;
		if (!Array.isArray(todos) || todos.length === 0) continue;

		let open = 0;
		for (const todo of todos) {
			if (!todo || typeof todo !== "object") continue;
			const record = todo as { done?: unknown; status?: unknown };
			if (record.done === true) continue;
			if (typeof record.status === "string") {
				const status = record.status.toLowerCase();
				if (status === "completed" || status === "done" || status === "cancelled") continue;
			}
			open += 1;
		}
		return open;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function composeTitle(target: TmuxTarget | undefined): string {
	return target ? `pi · ${target.label}` : "pi";
}

export function composeBody(payload: PendingPayload): string {
	const parts: string[] = [];

	if (payload.trigger === "prompt") {
		parts.push(`Waiting: ${payload.label}`);
	} else {
		if (payload.outcome === "done") parts.push("Done");
		else if (payload.outcome === "incomplete") parts.push("Incomplete: token limit");
		else parts.push("Error");

		if (payload.openTodos !== undefined && payload.openTodos > 0) {
			parts.push(`${payload.openTodos} todo${payload.openTodos === 1 ? "" : "s"}`);
		}
	}

	// The prompt goes last so it never truncates the actionable part.
	if (payload.prompt) parts.push(`"${payload.prompt}"`);
	return parts.join(" · ");
}

/** Re-read the config so mid-session file edits apply to the next trigger. */
function freshConfig(): Config {
	config = loadConfig();
	return config;
}

/** Short snippet of your latest prompt, for identifying the situation. */
function promptFor(settings: Config): string | undefined {
	if (!settings.showPrompt || !lastUserInput) return undefined;
	return clamp(sanitize(lastUserInput), PROMPT_MAX);
}

/** Seed the prompt from the session so a resumed session is labelled too. */
function readLastUserInput(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch() as unknown as BranchEntry[];

	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const message = branch[index]?.message;
		if (message?.role !== "user") continue;

		const content = message.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			for (const part of content) {
				const text = (part as { text?: unknown }).text;
				if (typeof text === "string" && text.trim()) return text;
			}
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function cancel(reason: string): void {
	const pending = current;
	if (!pending) return;

	if (pending.timer) clearTimeout(pending.timer);
	current = undefined;
	log({ event: "cancel", reason, trigger: pending.payload.trigger });
	void disarmFocusHook();
}

function schedule(payload: PendingPayload): void {
	cancel("reschedule");
	config = loadConfig();
	if (!notificationsEnabled || !config.enabled) return;

	const pending: PendingNotification = { payload, timer: undefined };
	const delay = payload.trigger === "prompt" ? config.promptDelayMs : config.settledDelayMs;

	pending.timer = setTimeout(() => {
		pending.timer = undefined;
		void fire(pending);
	}, Math.max(0, delay));
	pending.timer.unref?.();
	current = pending;
}

async function fire(pending: PendingNotification): Promise<void> {
	if (current !== pending) return;

	config = loadConfig();
	target = (await queryTmuxTarget()) ?? target;

	// The prompt is resolved at delivery time: with a 30s settle delay the world
	// may have moved on, and the snippet should describe the moment it appears.
	const payload: PendingPayload = { ...pending.payload, prompt: promptFor(config) };
	const title = clamp(sanitize(composeTitle(target)), TITLE_MAX);
	const body = clamp(sanitize(composeBody(payload)), BODY_MAX);
	const channel = await deliver(title, body);

	if (target) await armFocusHook(target);

	log({
		event: "notify",
		trigger: payload.trigger,
		payload,
		title,
		body,
		channel,
		tmux: target?.label,
	});

	current = undefined;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function piNotifyExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		notificationsEnabled = config.enabled && ctx.mode === "tui";
		inFlight.clear();
		current = undefined;

		unsubscribeInput?.();
		unsubscribeInput = undefined;

		if (!notificationsEnabled) {
			log({ event: "disabled", mode: ctx.mode, enabled: config.enabled });
			return;
		}

		target = await queryTmuxTarget();
		lastUserInput = readLastUserInput(ctx);
		unsubscribeInput = ctx.ui.onTerminalInput(() => {
			cancel("terminal-input");
		});

		if (config.warnOnPassthrough && !passthroughWarned) {
			const allowsBackground = await passthroughAllowsBackground();
			if (allowsBackground === false) {
				passthroughWarned = true;
				ctx.ui.notify(
					"pi-notify: background panes need tmux 'allow-passthrough all' — add it to ~/.tmux.conf and restart tmux",
					"warning",
				);
			}
		}

		log({ event: "session_start", target: target?.label, channel: await resolveChannel() });
	});

	pi.on("session_shutdown", async () => {
		cancel("session-shutdown");
		unsubscribeInput?.();
		unsubscribeInput = undefined;
		await disarmFocusHook();
		inFlight.clear();
	});

	// --- tool correlation -------------------------------------------------

	pi.on("tool_execution_start", (event) => {
		inFlight.set(event.toolCallId, { toolName: event.toolName, startedAt: Date.now() });
	});

	pi.on("tool_execution_end", (event) => {
		inFlight.delete(event.toolCallId);
	});

	// --- "waiting on you" -------------------------------------------------

	pi.on("ui_prompt_start", (event) => {
		pruneInFlight();
		const decision = classifyPrompt(event.kind, [...inFlight.values()], freshConfig());
		log({ event: "ui_prompt_start", kind: event.kind, title: event.title, decision });
		if (!decision.notify) return;

		schedule({
			trigger: "prompt",
			label: decision.label ?? event.kind,
		});
	});

	pi.on("ui_prompt_end", (event) => {
		log({ event: "ui_prompt_end", kind: event.kind });
		if (current?.payload.trigger === "prompt") cancel("prompt-end");
	});

	// --- "done" -----------------------------------------------------------

	pi.on("agent_settled", (_event, ctx) => {
		if (!ctx.isIdle()) return;

		freshConfig();
		const settled = classifySettle(ctx);
		if (!settled) return;

		schedule({
			trigger: "settled",
			outcome: settled.outcome,
			openTodos: settled.openTodos,
		});
	});

	// --- cancel paths -----------------------------------------------------

	pi.on("agent_start", () => {
		inFlight.clear();
		cancel("agent-start");
	});

	pi.on("before_agent_start", () => cancel("before-agent-start"));

	pi.on("input", (event) => {
		// Extension-injected messages are not "my prompt", so they must not
		// relabel the situation later.
		if (event.source !== "extension") lastUserInput = event.text;
		cancel("input");
	});

	// --- commands ---------------------------------------------------------

	pi.registerCommand("notify", {
		description: "Notifications: status, on/off, test, preview, protocol, debug, init",
		handler: async (args, ctx) => {
			const [action, value] = (args ?? "").trim().split(/\s+/, 2);
			const settings = loadConfig();

			switch (action) {
				case "on":
				case "off": {
					saveConfig({ enabled: action === "on" });
					notificationsEnabled = action === "on" && ctx.mode === "tui";
					if (!notificationsEnabled) cancel("disabled");
					ctx.ui.notify(`pi-notify: ${action}`, "info");
					return;
				}
				case "test": {
					const settings = freshConfig();
					target = (await queryTmuxTarget()) ?? target;
					const label = clamp(sanitize(composeTitle(target)), TITLE_MAX);
					const prompt = promptFor(settings);
					// Every sample shows the real format, so the only difference between
					// them is the state that is being previewed.
					const samples: Array<[string, string]> = [
						[label, composeBody({ trigger: "prompt", label: "command", prompt })],
						[label, composeBody({ trigger: "prompt", label: "input", prompt })],
						[label, composeBody({ trigger: "settled", outcome: "done", openTodos: 2, prompt })],
						[label, composeBody({ trigger: "settled", outcome: "incomplete", prompt })],
					];
					for (const [title, body] of samples) {
						await deliver(title, body);
						await new Promise((resolve) => setTimeout(resolve, 1200));
					}
					ctx.ui.notify("pi-notify: sent 4 test notifications", "info");
					return;
				}
				case "preview": {
					const toolName = value ?? "bash";
					const settings = freshConfig();
					target = (await queryTmuxTarget()) ?? target;
					const verdict = classifyTool(toolName, settings);

					// ui.notify is a single status line: everything goes into one string,
					// and the prompt snippet is the part worth verifying.
					const shown = verdict.notify
						? clamp(
								sanitize(composeBody({ trigger: "prompt", label: verdict.label ?? "input", prompt: promptFor(settings) })),
								BODY_MAX,
							)
						: `silent (${verdict.reason})`;
					ctx.ui.notify(`pi-notify preview: ${shown}`, "info");
					return;
				}
				case "protocol": {
					if (!value || !["auto", "osc777", "osc99", "osc9", "powershell"].includes(value)) {
						ctx.ui.notify("pi-notify: /notify protocol auto|osc777|osc99|osc9|powershell", "warning");
						return;
					}
					saveConfig({ protocol: value as Config["protocol"] });
					ctx.ui.notify(`pi-notify: protocol ${value}`, "info");
					return;
				}
				case "debug": {
					saveConfig({ debug: value === "on" });
					ctx.ui.notify(`pi-notify: debug ${value === "on" ? "on" : "off"} → ${LOG_PATH}`, "info");
					return;
				}
				case "init": {
					if (existsSync(CONFIG_PATH)) {
						ctx.ui.notify(`pi-notify: config already exists → ${CONFIG_PATH}`, "info");
						return;
					}
					writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
					ctx.ui.notify(`pi-notify: wrote ${CONFIG_PATH}`, "info");
					return;
				}
				default: {
					const channel = settings.protocol === "auto" ? `auto → ${await resolveChannel()}` : settings.protocol;
					const allowsBackground = await passthroughAllowsBackground();
					const tmuxState =
						allowsBackground === undefined
							? "no tmux"
							: `${target?.label ?? "tmux"} · passthrough ${allowsBackground ? "all" : "not all"}`;

					ctx.ui.notify(
						`pi-notify: ${notificationsEnabled ? "on" : "off"} · ${channel} · ` +
							`prompt ${settings.promptDelayMs / 1000}s · settled ${settings.settledDelayMs / 1000}s · ` +
							`${tmuxState}`,
						"info",
					);
					ctx.ui.notify(
						`/notify on|off|test|preview|protocol|debug|init · ` +
							`prompt: ${lastUserInput ? `"${clamp(sanitize(lastUserInput), PROMPT_MAX)}"` : "(none yet)"}`,
						"info",
					);
					return;
				}
			}
		},
	});
}
