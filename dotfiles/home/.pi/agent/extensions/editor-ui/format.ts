/** Formatting, cwd, and usage helpers shared by the chrome renderer. */

import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	latestCacheHitRate?: number;
}

export const EMPTY_USAGE: UsageTotals = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
};

export function formatTokens(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "0";
	if (count < 1_000) return String(Math.round(count));
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function formatCost(cost: number): string {
	return `$${Math.max(0, cost).toFixed(3)}`;
}

export function formatDuration(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(safe / 3_600);
	const minutes = Math.floor((safe % 3_600) / 60);
	const seconds = safe % 60;
	const pad = (value: number) => String(value).padStart(2, "0");
	return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Keep one line and strip control characters from names/statuses. */
export function oneLine(text: string, max?: number): string {
	const plain = text.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
	if (max === undefined || plain.length <= max) return plain;
	return `${plain.slice(0, Math.max(0, max - 1))}…`;
}

export function formatCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const rel = relative(resolvedHome, resolvedCwd);
	const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

export function cwdBasename(cwd: string): string {
	return basename(cwd) || cwd;
}

function addUsage(totals: UsageTotals, usage: any): void {
	if (!usage || typeof usage !== "object") return;
	if (Number.isFinite(usage.input)) totals.input += Math.max(0, usage.input);
	if (Number.isFinite(usage.output)) totals.output += Math.max(0, usage.output);
	if (Number.isFinite(usage.cacheRead)) totals.cacheRead += Math.max(0, usage.cacheRead);
	if (Number.isFinite(usage.cacheWrite)) totals.cacheWrite += Math.max(0, usage.cacheWrite);
	if (Number.isFinite(usage.cost?.total)) totals.cost += Math.max(0, usage.cost.total);
}

export function collectUsage(ctx: ExtensionContext): UsageTotals {
	const totals: UsageTotals = { ...EMPTY_USAGE };
	let latestCacheHitRate: number | undefined;

	for (const entry of ctx.sessionManager.getEntries() as any[]) {
		if (entry.type === "usage") {
			addUsage(totals, entry.usage);
		} else if (entry.type === "message" && entry.message?.role === "assistant") {
			const usage = entry.message.usage;
			addUsage(totals, usage);
			if (usage) {
				const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
				if (prompt > 0) latestCacheHitRate = (usage.cacheRead / prompt) * 100;
			}
		} else if (entry.type === "message" && entry.message?.role === "toolResult") {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}

	if (latestCacheHitRate !== undefined) totals.latestCacheHitRate = latestCacheHitRate;
	return totals;
}

export function usageKey(ctx: ExtensionContext): string {
	const sm = ctx.sessionManager;
	const count = (sm as any).getEntryCount?.() ?? sm.getEntries().length;
	return `${sm.getSessionId()}:${sm.getLeafId() ?? ""}:${count}`;
}

/** The low-priority cumulative token/cache block on the right of the bottom rule. */
export function formatStats(totals: UsageTotals): string | undefined {
	const parts: string[] = [];
	if (totals.input > 0) parts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output > 0) parts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheRead > 0) parts.push(`R${formatTokens(totals.cacheRead)}`);
	if (totals.cacheWrite > 0) parts.push(`W${formatTokens(totals.cacheWrite)}`);
	if (totals.latestCacheHitRate !== undefined) {
		parts.push(`CH${totals.latestCacheHitRate.toFixed(1)}%`);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
}
