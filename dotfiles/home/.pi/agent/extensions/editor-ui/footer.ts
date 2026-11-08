/**
 * Hide only Pi's native footer component.
 *
 * `ctx.ui.setFooter()` is a single-owner replacement. This module deliberately
 * does not use it: it wraps `FooterComponent.prototype.render`, so a future
 * extension that installs its own footer still exists and wins normally. The
 * wrapper also captures the native footer's `footerData` provider for the git
 * branch, without taking ownership of the footer slot.
 */

import { FooterComponent, type ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { FOOTER_PATCH_KEY, FOOTER_RUNTIME_KEY } from "./state.ts";

const PATCH_MARK = Symbol.for("pi.editor-ui.footer-patch-wrapper");

interface FooterPatch {
	original: (this: any, width: number) => string[];
	installed: (this: any, width: number) => string[];
	hidden: boolean;
	disposed: boolean;
}

interface FooterRuntime {
	data?: ReadonlyFooterDataProvider;
	unsubscribe?: () => void;
	requestRender?: () => void;
}

function runtime(): FooterRuntime {
	const global = globalThis as unknown as Record<symbol, FooterRuntime | undefined>;
	const existing = global[FOOTER_RUNTIME_KEY];
	if (existing) return existing;
	const created: FooterRuntime = {};
	global[FOOTER_RUNTIME_KEY] = created;
	return created;
}

export function footerData(): ReadonlyFooterDataProvider | undefined {
	return runtime().data;
}

export function setFooterRenderCallback(callback: (() => void) | undefined): void {
	runtime().requestRender = callback;
}

function captureFooterData(data: ReadonlyFooterDataProvider | undefined): void {
	if (!data) return;
	const rt = runtime();
	if (rt.data === data) return;
	rt.unsubscribe?.();
	rt.data = data;
	rt.unsubscribe = data.onBranchChange(() => rt.requestRender?.());
	rt.requestRender?.();
}

function currentPatch(prototype: any): FooterPatch | undefined {
	const wrapped = (prototype.render as any)?.[PATCH_MARK] as FooterPatch | undefined;
	return wrapped ?? (prototype[FOOTER_PATCH_KEY] as FooterPatch | undefined);
}

/** Install or refresh the native-footer wrapper. */
export function installFooterPatch(hidden: boolean): void {
	const prototype = FooterComponent.prototype as any;
	if (typeof prototype.render !== "function") return;

	const existing = currentPatch(prototype);
	if (existing && prototype.render === existing.installed) {
		existing.hidden = hidden;
		existing.disposed = false;
		return;
	}

	// A previous wrapper (possibly below another extension's wrapper) must
	// become a pass-through so only this wrapper decides whether to hide.
	if (existing) existing.disposed = true;

	const original = prototype.render;
	let patch: FooterPatch;
	const installed = function footerRender(this: any, width: number): string[] {
		captureFooterData(this?.footerData);
		if (patch.disposed) return original.call(this, width);
		if (patch.hidden) return [];
		return original.call(this, width);
	};
	(installed as any)[PATCH_MARK] = (patch = {
		original,
		installed,
		hidden,
		disposed: false,
	});
	prototype.render = installed;
	Reflect.set(prototype, FOOTER_PATCH_KEY, patch);
}

/** Restore the native footer when this extension is disabled/unloaded. */
export function restoreFooterPatch(): void {
	const prototype = FooterComponent.prototype as any;
	const patch = currentPatch(prototype);
	if (patch && prototype.render === patch.installed) {
		prototype.render = patch.original;
		Reflect.deleteProperty(prototype, FOOTER_PATCH_KEY);
	}
	if (patch) patch.disposed = true;
}

export function disposeFooterRuntime(): void {
	const rt = runtime();
	rt.unsubscribe?.();
	rt.unsubscribe = undefined;
	rt.data = undefined;
	rt.requestRender = undefined;
}
