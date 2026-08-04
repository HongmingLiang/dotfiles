/**
 * File-only working vibes.
 *
 * Reads every regular file under ~/.pi/agent/vibes (or
 * $PI_CODING_AGENT_DIR/vibes), treats every non-empty line as one message,
 * and displays the messages while Pi is running an agent turn.
 *
 * A message changes on every tool call and also every few seconds while the
 * agent is streaming. The list is shuffled, but every entry is used once per
 * cycle before the list is shuffled again.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_REFRESH_SECONDS = 5;
const SETTINGS_FILE = "settings.json";
const VIBES_DIRECTORY = "vibes";

interface FileVibesConfig {
	enabled: boolean;
	refreshMs: number;
}

let config: FileVibesConfig = loadConfig();
let sourceVibes: string[] = [];
let shuffledVibes: string[] = [];
let shuffledIndex = 0;
let lastVibe: string | undefined;
let isStreaming = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function getAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
	return configured;
}

function getVibesDir(): string {
	return join(getAgentDir(), VIBES_DIRECTORY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadConfig(): FileVibesConfig {
	const settingsPath = join(getAgentDir(), SETTINGS_FILE);
	let settings: Record<string, unknown> = {};

	try {
		if (existsSync(settingsPath)) {
			const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
			if (isRecord(parsed)) settings = parsed;
		}
	} catch (error) {
		console.debug(`[file-vibes] Failed to read settings at ${settingsPath}:`, error);
	}

	const rawSeconds = settings.fileVibesRefreshInterval;
	const refreshSeconds =
		typeof rawSeconds === "number" && Number.isFinite(rawSeconds)
			? Math.max(0.1, rawSeconds)
			: DEFAULT_REFRESH_SECONDS;

	return {
		enabled: settings.fileVibesEnabled !== false,
		refreshMs: refreshSeconds * 1000,
	};
}

function readVibesFromDirectory(): string[] {
	const vibesDir = getVibesDir();
	if (!existsSync(vibesDir)) return [];

	let names: string[];
	try {
		names = readdirSync(vibesDir).sort((a, b) => a.localeCompare(b));
	} catch (error) {
		console.debug(`[file-vibes] Failed to list ${vibesDir}:`, error);
		return [];
	}

	const vibes: string[] = [];
	for (const name of names) {
		const filePath = join(vibesDir, name);

		try {
			// stat() also follows symlinks, so linked vibe files are included.
			if (!statSync(filePath).isFile()) continue;

			const lines = readFileSync(filePath, "utf8")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			vibes.push(...lines);
		} catch (error) {
			console.debug(`[file-vibes] Failed to read ${filePath}:`, error);
		}
	}

	return vibes;
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
	shuffledVibes = shuffle(sourceVibes);
	shuffledIndex = 0;

	// Avoid repeating the previous message at a cycle boundary where possible.
	if (shuffledVibes.length > 1 && shuffledVibes[0] === lastVibe) {
		const replacement = shuffledVibes.findIndex((vibe) => vibe !== lastVibe);
		if (replacement > 0) {
			[shuffledVibes[0], shuffledVibes[replacement]] = [
				shuffledVibes[replacement],
				shuffledVibes[0],
			];
		}
	}
}

function refreshVibeList(): void {
	const nextVibes = readVibesFromDirectory();
	if (listsEqual(sourceVibes, nextVibes)) return;

	sourceVibes = nextVibes;
	rebuildCycle();
}

function nextVibe(): string | undefined {
	if (sourceVibes.length === 0) return undefined;
	if (shuffledIndex >= shuffledVibes.length) rebuildCycle();

	const vibe = shuffledVibes[shuffledIndex++];
	lastVibe = vibe;
	return vibe;
}

function setNextVibe(ctx: ExtensionContext): void {
	if (!config.enabled || !ctx.hasUI) return;

	const vibe = nextVibe();
	if (vibe) {
		ctx.ui.setWorkingMessage(vibe);
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
		if (isStreaming) setNextVibe(ctx);
	}, config.refreshMs);
}

export default function fileVibesExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();
		isStreaming = false;
		stopRefreshTimer();
		refreshVibeList();

		if (!config.enabled && ctx.hasUI) {
			ctx.ui.setWorkingMessage(undefined);
		}
	});

	// Set the first message before Pi creates the working loader.
	pi.on("before_agent_start", async (_event, ctx) => {
		if (!config.enabled || !ctx.hasUI) return;
		refreshVibeList();
		setNextVibe(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (!config.enabled || !ctx.hasUI) return;
		isStreaming = true;
		startRefreshTimer(ctx);
	});

	// Tool calls cause an immediate change in addition to the timer-based one.
	pi.on("tool_call", async (_event, ctx) => {
		if (!config.enabled || !isStreaming || !ctx.hasUI) return;
		setNextVibe(ctx);
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
