/**
 * Per-message metadata for the frame's rule label: send time and the
 * provider/model that answered.
 *
 * The model is all-or-nothing: while the whole session was answered by a single
 * model the label stays clean, and as soon as a second model takes a turn every
 * message says who answered it. One rule, no per-message baseline to reason
 * about.
 *
 * The data lives in the session log rather than on the component: Pi stores the
 * send time on the user entry (`entry.timestamp`) and the answering model on
 * the assistant message that followed it. Rebuilt transcripts pass both the
 * entry id and the timestamp into the component; a live `message_start` passes
 * neither, so those fall back to the selected model and the moment the
 * component first rendered.
 */

export interface MessageMetadata {
	/** Local send time, `14:32`, `02-13 09:12`, or `2025-12-31 09:12`. */
	time?: string;
	/** `provider/model`, set only when the session used more than one model. */
	model?: string;
}

interface EntryMessage {
	role?: string;
	provider?: string;
	model?: string;
}

/** The subset of a session entry the resolver reads. */
export interface MetadataEntry {
	id?: string;
	type?: string;
	timestamp?: string;
	provider?: string;
	modelId?: string;
	message?: EntryMessage;
}

export interface MessageMetadataInput {
	/** Session entry id; absent for a message that is still being sent. */
	messageId?: string;
	/** Entry timestamp (ISO) when the component was rebuilt from the session. */
	timestamp?: string;
	/** Milliseconds captured when a live message first rendered. */
	sentAt: number;
	entries: readonly MetadataEntry[];
	/** `provider/model` of the model that would answer a message sent now. */
	currentModel?: string;
	showTime: boolean;
	showModel: boolean;
}

/**
 * Facts that never change for a committed prompt, plus the day the stamp was
 * formatted for (a transcript left open past midnight picks up the date instead
 * of keeping a bare clock time). Whether the model is *shown* is decided per
 * render from the session-wide model set, so it is not cached here.
 */
interface CachedFacts {
	day: string;
	time?: string;
	model?: string;
}

const cache = new Map<string, CachedFacts>();
const CACHE_LIMIT = 512;

function dayKey(now: number): string {
	const date = new Date(now);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Drop cached lookups after the transcript is rebuilt from other entries. */
export function resetMessageMetadataCache(): void {
	cache.clear();
	modelSet = undefined;
	modelSetKey = "";
}

export function modelLabel(provider?: string, id?: string): string | undefined {
	if (!provider) return id || undefined;
	if (!id) return provider;
	return `${provider}/${id}`;
}

function messageModel(message: EntryMessage | undefined): string | undefined {
	return modelLabel(message?.provider, message?.model);
}

/**
 * The model that answered a prompt: the first assistant message before the next
 * prompt. Prompts without a reply (aborted, or still queued) fall back to the
 * last `model_change` at or before them.
 */
function turnModel(entries: readonly MetadataEntry[], userIndex: number): string | undefined {
	for (let i = userIndex + 1; i < entries.length; i++) {
		const entry = entries[i];
		if (entry?.type !== "message") continue;
		const role = entry.message?.role;
		if (role === "user") break;
		if (role === "assistant") {
			const model = messageModel(entry.message);
			if (model) return model;
		}
	}
	for (let i = Math.min(userIndex, entries.length - 1); i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "model_change") return modelLabel(entry.provider, entry.modelId);
	}
	return undefined;
}

const MODEL_MAX = 32;

/**
 * Model ids are ASCII; clipping them here avoids the SGR resets that
 * `truncateToWidth` embeds around its ellipsis, which would break the label's
 * single accent color.
 */
function clipModel(model: string): string {
	const chars = Array.from(model);
	if (chars.length <= MODEL_MAX) return model;
	return `${chars.slice(0, MODEL_MAX - 1).join("")}…`;
}

/**
 * Whether the model label appears at all: only once the session stopped being
 * answered by a single model. The selected model counts, so switching models
 * labels the transcript immediately instead of after the next reply.
 */
let modelSetKey = "";
let modelSet: Set<string> | undefined;

function sessionModelSet(entries: readonly MetadataEntry[], selectedModel?: string): Set<string> {
	const last = entries[entries.length - 1];
	const key = `${entries.length}|${last?.id ?? ""}|${selectedModel ?? ""}`;
	if (modelSet && modelSetKey === key) return modelSet;

	const models = new Set<string>();
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const model = turnModel(entries, i);
		if (model) models.add(model);
	}
	if (selectedModel) models.add(selectedModel);

	modelSet = models;
	modelSetKey = key;
	return models;
}

function labelModel(
	entries: readonly MetadataEntry[],
	model: string | undefined,
	selectedModel?: string,
): string | undefined {
	if (!model) return undefined;
	if (sessionModelSet(entries, selectedModel).size <= 1) return undefined;
	return clipModel(model);
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/**
 * Local clock time. Relative times ("2m ago") would freeze in a cached
 * transcript until the next repaint, so the frame uses an absolute stamp:
 * `14:32` today, `02-13 14:32` for other days, `2025-12-31 14:32` outside the
 * current year.
 */
export function formatSendTime(value: string | number | undefined, now = Date.now()): string | undefined {
	if (value === undefined) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return undefined;

	const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	const today = new Date(now);
	const sameDay =
		date.getFullYear() === today.getFullYear() &&
		date.getMonth() === today.getMonth() &&
		date.getDate() === today.getDate();
	if (sameDay) return clock;

	const stamp = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	if (date.getFullYear() === today.getFullYear()) return `${stamp} ${clock}`;
	return `${date.getFullYear()}-${stamp} ${clock}`;
}

export function messageMetadata(input: MessageMetadataInput): MessageMetadata {
	const now = Date.now();
	const day = dayKey(now);
	const id = input.messageId;

	if (!id) {
		// The live prompt has no committed entry: its model is the selected one,
		// and it joins the session's model set as soon as it is on screen.
		const meta: MessageMetadata = {};
		if (input.showTime) meta.time = formatSendTime(input.sentAt, now);
		if (input.showModel) meta.model = labelModel(input.entries, input.currentModel, input.currentModel);
		return meta;
	}

	let facts = cache.get(id);
	if (!facts || facts.day !== day) {
		facts = { day };
		if (input.showTime) facts.time = formatSendTime(input.timestamp ?? input.sentAt, now);
		if (input.showModel) {
			const index = input.entries.findIndex((entry) => entry.id === id);
			facts.model = index >= 0 ? turnModel(input.entries, index) : undefined;
		}
		// A render that happens before the session is readable must not pin an
		// empty result into the cache.
		if (input.entries.length > 0) {
			if (cache.size >= CACHE_LIMIT) cache.clear();
			cache.set(id, facts);
		}
	}

	const meta: MessageMetadata = {};
	if (input.showTime) meta.time = facts.time;
	if (input.showModel) meta.model = labelModel(input.entries, facts.model, input.currentModel);
	return meta;
}
