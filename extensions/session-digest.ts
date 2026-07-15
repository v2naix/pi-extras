// Adapted from disler/pi-vs-claude-code at commit
// 32dfe122cb6d444e91c68b32597274a725d81fa3. See session-digest.LICENSE.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, Component, KeybindingsManager } from "@earendil-works/pi-tui";
import { Box, Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";

const MAX_ENTRIES = 500;
const MAX_CONTENT_CHARS = 32_000;
const MAX_TOOL_ARGUMENT_CHARS = 2_000;
const PAGE_SIZE = 5;
const DETAIL_LINES = 10;
const REDACTED = "[REDACTED]";

type HistoryItemType = "user" | "assistant" | "tool";
type DigestFilter = "all" | "ai" | "tool" | "user";

interface HistoryItem {
	type: HistoryItemType;
	title: string;
	content: string;
	timestamp: Date;
	elapsed?: string;
}

interface DigestStats {
	toolCalls: number;
	userTurns: number;
}

interface DigestHistory {
	items: HistoryItem[];
	omittedCount: number;
	stats: DigestStats;
}

const FILTER_LABELS: Record<DigestFilter, string> = {
	all: "All",
	ai: "AI",
	tool: "Tool",
	user: "User",
};

const FILTER_COMPLETIONS: AutocompleteItem[] = (Object.keys(FILTER_LABELS) as DigestFilter[]).map((filter) => ({
	value: filter,
	label: filter,
	description: `Show ${FILTER_LABELS[filter]} messages`,
}));

interface MessageLike {
	role?: unknown;
	content?: unknown;
	timestamp?: unknown;
	toolName?: unknown;
}

interface EntryLike {
	type?: unknown;
	timestamp?: unknown;
	message?: MessageLike;
}

interface ContentBlockLike {
	type?: unknown;
	text?: unknown;
	name?: unknown;
	arguments?: unknown;
}

/** Remove terminal control sequences while preserving tabs and newlines. */
function sanitizeTerminalText(value: string): string {
	return value
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

function limitContent(value: string): string {
	const sanitized = sanitizeTerminalText(value);
	if (sanitized.length <= MAX_CONTENT_CHARS) return sanitized;
	return `${sanitized.slice(0, MAX_CONTENT_CHARS)}\n\n[Content truncated at ${MAX_CONTENT_CHARS.toLocaleString()} characters]`;
}

function isSensitiveKey(key: string): boolean {
	return /(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/i.test(key);
}

function safeStringify(value: unknown, maxChars: number): string {
	const seen = new WeakSet<object>();
	let serialized: string;

	try {
		serialized = JSON.stringify(value, (key, nestedValue) => {
			if (key && isSensitiveKey(key)) return REDACTED;
			if (nestedValue && typeof nestedValue === "object") {
				if (seen.has(nestedValue)) return "[Circular]";
				seen.add(nestedValue);
			}
			return nestedValue;
		}) ?? String(value);
	} catch {
		serialized = "[Unserializable value]";
	}

	const sanitized = sanitizeTerminalText(serialized);
	return sanitized.length <= maxChars ? sanitized : `${sanitized.slice(0, maxChars)}…`;
}

function parseTimestamp(messageTimestamp: unknown, entryTimestamp: unknown): Date {
	for (const candidate of [messageTimestamp, entryTimestamp]) {
		if (typeof candidate !== "string" && typeof candidate !== "number" && !(candidate instanceof Date)) {
			continue;
		}
		const parsed = new Date(candidate);
		if (Number.isFinite(parsed.getTime())) return parsed;
	}
	return new Date();
}

function formatTime(date: Date): string {
	return date.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
}

function formatElapsed(start: Date, end: Date): string | undefined {
	const seconds = Math.floor((end.getTime() - start.getTime()) / 1_000);
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function extractContent(message: MessageLike): string {
	const { content } = message;
	if (typeof content === "string") return limitContent(content);
	if (!Array.isArray(content)) return content == null ? "" : limitContent(safeStringify(content, MAX_CONTENT_CHARS));

	const parts: string[] = [];
	for (const rawBlock of content) {
		if (!rawBlock || typeof rawBlock !== "object") continue;
		const block = rawBlock as ContentBlockLike;

		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		} else if (block.type === "toolCall" && typeof block.name === "string") {
			const args = safeStringify(block.arguments ?? {}, MAX_TOOL_ARGUMENT_CHARS);
			parts.push(`Tool: ${sanitizeTerminalText(block.name)}(${args})`);
		} else if (block.type === "image") {
			parts.push("[Image]");
		}
	}

	return limitContent(parts.join("\n"));
}

function historyTypeForRole(role: unknown): HistoryItemType | undefined {
	if (role === "user") return "user";
	if (role === "assistant") return "assistant";
	if (role === "toolResult") return "tool";
	return undefined;
}

function matchesFilter(type: HistoryItemType, filter: DigestFilter): boolean {
	return filter === "all" || (filter === "ai" && type === "assistant") || filter === type;
}

function parseFilter(args: string): DigestFilter | undefined {
	const normalized = args.trim().toLowerCase();
	if (!normalized) return "all";
	if (normalized === "assistant") return "ai";
	if (normalized === "all" || normalized === "ai" || normalized === "tool" || normalized === "user") {
		return normalized;
	}
	return undefined;
}

function toDigestHistory(branch: unknown[], filter: DigestFilter): DigestHistory {
	const messageEntries = branch.filter((entry): entry is EntryLike => {
		return Boolean(entry && typeof entry === "object" && (entry as EntryLike).type === "message");
	});
	const stats: DigestStats = { toolCalls: 0, userTurns: 0 };
	const matchingEntries: Array<{ entry: EntryLike; type: HistoryItemType }> = [];

	for (const entry of messageEntries) {
		const role = entry.message?.role;
		if (role === "toolResult") stats.toolCalls++;
		if (role === "user") stats.userTurns++;

		const type = historyTypeForRole(role);
		if (type && matchesFilter(type, filter)) matchingEntries.push({ entry, type });
	}

	const omittedCount = Math.max(0, matchingEntries.length - MAX_ENTRIES);
	const recentEntries = matchingEntries.slice(-MAX_ENTRIES);
	const items: HistoryItem[] = [];

	for (const { entry, type } of recentEntries) {
		const message = entry.message;
		if (!message) continue;
		const content = extractContent(message);
		if (!content) continue;
		const timestamp = parseTimestamp(message.timestamp, entry.timestamp);

		if (type === "user") {
			items.push({ type, title: "User Prompt", content, timestamp });
		} else if (type === "assistant") {
			items.push({ type, title: "Assistant", content, timestamp });
		} else {
			const rawToolName = typeof message.toolName === "string" ? message.toolName : "tool";
			items.push({
				type,
				title: `Tool: ${sanitizeTerminalText(rawToolName)}`,
				content,
				timestamp,
			});
		}
	}

	for (let index = 1; index < items.length; index++) {
		items[index].elapsed = formatElapsed(items[index - 1].timestamp, items[index].timestamp);
	}

	return { items, omittedCount, stats };
}

class ClippedText implements Component {
	lineCount = 0;

	constructor(
		private readonly content: string,
		private readonly getOffset: () => number,
		private readonly maxLines: number,
	) {}

	render(width: number): string[] {
		const lines = new Text(this.content, 1, 0).render(width);
		this.lineCount = lines.length;
		const maxOffset = Math.max(0, lines.length - this.maxLines);
		const offset = Math.min(this.getOffset(), maxOffset);
		return lines.slice(offset, offset + this.maxLines);
	}

	invalidate(): void {}
}

class SessionDigestUI implements Component {
	private selectedIndex: number;
	private expanded = false;
	private detailOffset = 0;
	private detailLineCount = 0;

	constructor(
		private readonly items: HistoryItem[],
		private readonly omittedCount: number,
		private readonly filter: DigestFilter,
		private readonly stats: DigestStats,
		private readonly onDone: () => void,
		private readonly requestRender: () => void,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
	) {
		this.selectedIndex = Math.max(0, items.length - 1);
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onDone();
			return;
		}

		if (this.keybindings.matches(data, "tui.select.up")) {
			this.moveSelection(-1);
		} else if (this.keybindings.matches(data, "tui.select.down")) {
			this.moveSelection(1);
		} else if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.expanded = !this.expanded;
			this.detailOffset = 0;
		} else if (this.keybindings.matches(data, "tui.select.pageUp")) {
			if (this.expanded) {
				this.detailOffset = Math.max(0, this.detailOffset - DETAIL_LINES);
			} else {
				this.moveSelection(-PAGE_SIZE);
			}
		} else if (this.keybindings.matches(data, "tui.select.pageDown")) {
			if (this.expanded) {
				const maxOffset = Math.max(0, this.detailLineCount - DETAIL_LINES);
				this.detailOffset = Math.min(maxOffset, this.detailOffset + DETAIL_LINES);
			} else {
				this.moveSelection(PAGE_SIZE);
			}
		} else {
			return;
		}

		this.requestRender();
	}

	private moveSelection(delta: number): void {
		this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex + delta));
		this.expanded = false;
		this.detailOffset = 0;
	}

	render(width: number): string[] {
		const container = new Container();
		const theme = this.theme;
		const pageStart = Math.floor(this.selectedIndex / PAGE_SIZE) * PAGE_SIZE;
		const pageItems = this.items.slice(pageStart, pageStart + PAGE_SIZE);
		const pageCount = Math.max(1, Math.ceil(this.items.length / PAGE_SIZE));
		const currentPage = Math.floor(pageStart / PAGE_SIZE) + 1;

		container.addChild(new DynamicBorder((text: string) => theme.fg("borderAccent", text)));
		container.addChild(
			new Text(
				`${theme.fg("accent", theme.bold(" SESSION DIGEST"))} ${theme.fg("muted", "|")} ` +
					`${theme.fg("text", `Filter: ${FILTER_LABELS[this.filter]}`)} ${theme.fg("muted", "|")} ` +
					`${theme.fg("success", String(this.items.length))} entries ${theme.fg("muted", `| page ${currentPage}/${pageCount}`)}`,
				1,
				0,
			),
		);
		if (this.omittedCount > 0) {
			container.addChild(new Text(theme.fg("warning", `${this.omittedCount} older entries omitted`), 1, 0));
		}
		container.addChild(new Spacer(1));

		pageItems.forEach((item, pageIndex) => {
			const absoluteIndex = pageStart + pageIndex;
			const selected = absoluteIndex === this.selectedIndex;
			const badge = item.type === "user" ? "[USER]" : item.type === "assistant" ? "[AI]" : "[TOOL]";
			const color = item.type === "user" ? "success" : item.type === "assistant" ? "accent" : "toolTitle";
			const elapsed = item.elapsed ? theme.fg("muted", ` (+${item.elapsed})`) : "";
			const title = `${theme.fg(color, theme.bold(badge))} ${theme.fg("text", theme.bold(item.title))} ` +
				`${theme.fg("success", `[${formatTime(item.timestamp)}]`)}${elapsed}`;
			const preview = item.content.replace(/\s+/g, " ").trim();
			const box = new Box(1, 0, selected ? (text) => theme.bg("selectedBg", text) : undefined);
			box.addChild(new Text(truncateToWidth(title, Math.max(1, width - 4)), 0, 0));
			box.addChild(
				new Text(
					theme.fg(selected ? "text" : "muted", truncateToWidth(`  ${preview}`, Math.max(1, width - 4), "…")),
					0,
					0,
				),
			);
			container.addChild(box);
		});

		if (this.expanded) {
			const selected = this.items[this.selectedIndex];
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("accent", theme.bold(` ${selected.title} — details`)), 0, 0));
			const clipped = new ClippedText(selected.content, () => this.detailOffset, DETAIL_LINES);
			container.addChild(clipped);
			const lines = container.render(width);
			this.detailLineCount = clipped.lineCount;
			return [
				...lines,
				...new Text(
					theme.fg("muted", ` PgUp/PgDn Scroll details (${Math.min(this.detailOffset + 1, Math.max(1, this.detailLineCount))}-${Math.min(this.detailOffset + DETAIL_LINES, this.detailLineCount)}/${this.detailLineCount})`),
					0,
					0,
				).render(width),
				...this.renderStats(width),
				...new DynamicBorder((text: string) => theme.fg("borderAccent", text)).render(width),
			];
		}

		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", " ↑/↓ Navigate • PgUp/PgDn Page • Enter Details • Esc Close"), 0, 0));
		container.addChild({ render: (renderWidth) => this.renderStats(renderWidth), invalidate: () => {} });
		container.addChild(new DynamicBorder((text: string) => theme.fg("borderAccent", text)));
		return container.render(width);
	}

	private renderStats(width: number): string[] {
		const text = ` Stats  ${this.theme.fg("toolTitle", "Tool calls:")} ${this.theme.fg("text", String(this.stats.toolCalls))}` +
			` ${this.theme.fg("muted", "|")} ${this.theme.fg("success", "User turns:")} ${this.theme.fg("text", String(this.stats.userTurns))}`;
		return new Text(truncateToWidth(text, width), 0, 0).render(width);
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("digest", {
		description: "Show a session digest filtered by all, ai, tool, or user",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const normalized = prefix.trim().toLowerCase();
			const matches = FILTER_COMPLETIONS.filter((item) => item.value.startsWith(normalized));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify("Session Digest is available only in TUI mode.", "warning");
				return;
			}

			const filter = parseFilter(args);
			if (!filter) {
				ctx.ui.notify("Usage: /digest [all|ai|tool|user]", "warning");
				return;
			}

			const branch = ctx.sessionManager.getBranch() as unknown[];
			const { items, omittedCount, stats } = toDigestHistory(branch, filter);
			if (items.length === 0) {
				ctx.ui.notify(`No ${FILTER_LABELS[filter]} messages found in the current session branch.`, "warning");
				return;
			}

			await ctx.ui.custom(
				(tui, theme, keybindings, done) => {
					const component = new SessionDigestUI(
						items,
						omittedCount,
						filter,
						stats,
						() => done(undefined),
						() => tui.requestRender(),
						theme,
						keybindings,
					);
					return component;
				},
				{
					overlay: true,
					overlayOptions: {
						width: "80%",
						maxHeight: "90%",
						anchor: "center",
					},
				},
			);
		},
	});
}
