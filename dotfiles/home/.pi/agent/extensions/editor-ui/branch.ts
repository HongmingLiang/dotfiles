/**
 * Fallback git branch for when a future custom footer owns the footer slot,
 * so the native FooterComponent (and its footerData provider) is not rendered.
 * The normal path reads footerData.getGitBranch() and never runs git.
 */

import { execFile } from "node:child_process";
import { footerData } from "./footer.ts";

let cached: { cwd: string; branch?: string } | undefined;
let pending: string | undefined;

export function repoBranch(cwd: string): string | undefined {
	const native = footerData()?.getGitBranch();
	if (native !== undefined) return native ?? undefined;
	return cached?.cwd === cwd ? cached.branch : undefined;
}

export function refreshRepoBranch(cwd: string, onChange: () => void): void {
	if (footerData() || pending === cwd) return;
	pending = cwd;
	execFile(
		"git",
		["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
		{ cwd, encoding: "utf8", timeout: 1_500 },
		(error, stdout) => {
			if (pending === cwd) pending = undefined;
			const branch = error ? undefined : String(stdout).trim() || undefined;
			if (cached?.cwd === cwd && cached.branch === branch) return;
			cached = { cwd, branch };
			onChange();
		},
	);
}

export function resetRepoBranch(): void {
	cached = undefined;
	pending = undefined;
}
