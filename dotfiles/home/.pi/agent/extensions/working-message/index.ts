/**
 * File-based working messages.
 *
 * Reads every regular file under this extension's message directory, treats
 * every non-empty line as one message, and displays the messages while Pi is
 * running an agent turn.
 *
 * A message changes on every tool call and also every few seconds while the
 * agent is streaming. The list is shuffled, but every entry is used once per
 * cycle before the list is shuffled again.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REFRESH_SECONDS = 5;
const SETTINGS_FILE = "settings.json";
const MESSAGE_DIRECTORY = "message";
const EXTENSION_DIRECTORY = dirname(fileURLToPath(import.meta.url));

interface WorkingMessageConfig {
	enabled: boolean;
	refreshMs: number;
}

let config: WorkingMessageConfig = loadConfig();
let sourceMessages: string[] = [];
let shuffledMessages: string[] = [];
let shuffledIndex = 0;
let lastMessage: string | undefined;
let isStreaming = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function getAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
	return configured;
}

function getMessageDir(): string {
	return join(EXTENSION_DIRECTORY, MESSAGE_DIRECTORY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadConfig(): WorkingMessageConfig {
	const settingsPath = join(getAgentDir(), SETTINGS_FILE);
	let settings: Record<string, unknown> = {};

	try {
		if (existsSync(settingsPath)) {
			const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
			if (isRecord(parsed)) settings = parsed;
		}
	} catch (error) {
		console.debug(`[working-message] Failed to read settings at ${settingsPath}:`, error);
	}

	// Keep the old keys as fallbacks so existing settings survive the rename.
	const rawSeconds =
		settings.workingMessageRefreshInterval ?? settings.fileVibesRefreshInterval;
	const refreshSeconds =
		typeof rawSeconds === "number" && Number.isFinite(rawSeconds)
			? Math.max(0.1, rawSeconds)
			: DEFAULT_REFRESH_SECONDS;
	const rawEnabled = settings.workingMessageEnabled ?? settings.fileVibesEnabled;

	return {
		enabled: rawEnabled !== false,
		refreshMs: refreshSeconds * 1000,
	};
}

function readMessagesFromDirectory(): string[] {
	const messageDir = getMessageDir();
	if (!existsSync(messageDir)) return [];

	let names: string[];
	try {
		names = readdirSync(messageDir).sort((a, b) => a.localeCompare(b));
	} catch (error) {
		console.debug(`[working-message] Failed to list ${messageDir}:`, error);
		return [];
	}

	const messages: string[] = [];
	for (const name of names) {
		const filePath = join(messageDir, name);

		try {
			// stat() also follows symlinks, so linked message files are included.
			if (!statSync(filePath).isFile()) continue;

			const lines = readFileSync(filePath, "utf8")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			messages.push(...lines);
		} catch (error) {
			console.debug(`[working-message] Failed to read ${filePath}:`, error);
		}
	}

	return messages;
}

function listsEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function shuffle(values: string[]): string[] {
	const result = [...values];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

function rebuildCycle(): void {
	shuffledMessages = shuffle(sourceMessages);
	shuffledIndex = 0;

	// Avoid repeating the previous message at a cycle boundary where possible.
	if (shuffledMessages.length > 1 && shuffledMessages[0] === lastMessage) {
		const replacement = shuffledMessages.findIndex((message) => message !== lastMessage);
		if (replacement > 0) {
			[shuffledMessages[0], shuffledMessages[replacement]] = [
				shuffledMessages[replacement],
				shuffledMessages[0],
			];
		}
	}
}

function refreshMessageList(): void {
	const nextMessages = readMessagesFromDirectory();
	if (listsEqual(sourceMessages, nextMessages)) return;

	sourceMessages = nextMessages;
	rebuildCycle();
}

function nextMessage(): string | undefined {
	if (sourceMessages.length === 0) return undefined;
	if (shuffledIndex >= shuffledMessages.length) rebuildCycle();

	const message = shuffledMessages[shuffledIndex++];
	lastMessage = message;
	return message;
}

function setNextMessage(ctx: ExtensionContext): void {
	if (!config.enabled || !ctx.hasUI) return;

	const message = nextMessage();
	if (message) {
		ctx.ui.setWorkingMessage(message);
	} else {
		// Let Pi render its normal working message when the directory is empty.
		ctx.ui.setWorkingMessage(undefined);
	}
}

function stopRefreshTimer(): void {
	if (refreshTimer !== null) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
}

function startRefreshTimer(ctx: ExtensionContext): void {
	stopRefreshTimer();
	if (!config.enabled || config.refreshMs <= 0) return;

	refreshTimer = setInterval(() => {
		if (isStreaming) setNextMessage(ctx);
	}, config.refreshMs);
}

export default function workingMessageExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		isStreaming = false;
		stopRefreshTimer();
		refreshMessageList();

		if (!config.enabled && ctx.hasUI) {
			ctx.ui.setWorkingMessage(undefined);
		}
	});

	// Set the first message before Pi creates the working loader.
	pi.on("before_agent_start", async (_event, ctx) => {
		if (!config.enabled || !ctx.hasUI) return;
		refreshMessageList();
		setNextMessage(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (!config.enabled || !ctx.hasUI) return;
		isStreaming = true;
		startRefreshTimer(ctx);
	});

	// Tool calls cause an immediate change in addition to the timer-based one.
	pi.on("tool_call", async (_event, ctx) => {
		if (!config.enabled || !isStreaming || !ctx.hasUI) return;
		setNextMessage(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		isStreaming = false;
		stopRefreshTimer();
		if (ctx.hasUI) ctx.ui.setWorkingMessage(undefined);
	});

	pi.on("session_shutdown", async () => {
		isStreaming = false;
		stopRefreshTimer();
	});
}
