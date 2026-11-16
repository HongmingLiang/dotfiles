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
 * the assistant message that followed it. Nothing here is persisted or carried
 * across a rebuild; the label is re-derived from the entries. Rebuilt
 * transcripts pass the entry id and timestamp into the component; a live
 * `message_start` passes neither, so `index.ts` binds the component to its entry
 * by message identity. Until that binding exists the message falls back to the
 * selected model and the moment the component first rendered.
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
 * prompt. Prompts without a reply (aborted, still running, or queued) fall back
 * to the last `model_change` at or before them; the reply that lands later wins
 * because the whole view is re-derived whenever the log grows.
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
 *
 * Everything is derived from the entries once per log version, so one scan
 * serves every message in the frame and any appended entry re-derives it. The
 * only reason this is memoised is render frequency: a frame repaints on every
 * keystroke and spinner tick, while the log changes only per turn step.
 */
interface SessionView {
	key: string;
	/** What answered each prompt, by user entry id. */
	turns: Map<string, string>;
	/** Every model the session ran on, including the selected one. */
	models: Set<string>;
}

let view: SessionView | undefined;

function entriesKey(entries: readonly MetadataEntry[], selectedModel?: string): string {
	const first = entries[0]?.id ?? "";
	const last = entries[entries.length - 1]?.id ?? "";
	return `${entries.length}|${first}|${last}|${selectedModel ?? ""}`;
}

function sessionView(entries: readonly MetadataEntry[], selectedModel?: string): SessionView {
	const key = entriesKey(entries, selectedModel);
	if (view && view.key === key) return view;

	const turns = new Map<string, string>();
	const models = new Set<string>();
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const model = turnModel(entries, i);
		if (entry.id) turns.set(entry.id, model);
		if (model) models.add(model);
	}
	if (selectedModel) models.add(selectedModel);

	view = { key, turns, models };
	return view;
}

/** Drop the derived view after the transcript is rebuilt from other entries. */
export function resetMessageMetadataCache(): void {
	view = undefined;
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
	const id = input.messageId;
	const meta: MessageMetadata = {};

	if (input.showTime) {
		meta.time = formatSendTime(id ? input.timestamp ?? input.sentAt : input.sentAt, now);
	}
	if (!input.showModel) return meta;

	const session = sessionView(input.entries, input.currentModel);
	// A prompt that is still being sent has no entry yet: it is answered by the
	// selected model, and it joins the model set with it.
	const model = id ? session.turns.get(id) : input.currentModel;
	if (model && session.models.size > 1) meta.model = clipModel(model);
	return meta;
}
