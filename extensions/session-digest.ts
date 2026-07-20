// Adapted from disler/pi-vs-claude-code at commit
// 32dfe122cb6d444e91c68b32597274a725d81fa3, with context usage visualization
// adapted from ttttmr/pi-context v2.1.0. See session-digest.LICENSE.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, Component, KeybindingsManager } from "@earendil-works/pi-tui";
import { Box, Container, Key, matchesKey, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MAX_ENTRIES = 500;
const MAX_CONTENT_CHARS = 32_000;
const MAX_TOOL_ARGUMENT_CHARS = 2_000;
const PAGE_SIZE = 10;
const DETAIL_LINES = 14;
const REDACTED = "[REDACTED]";
const OVERLAY_ACCENT_FG = "\x1b[38;2;138;181;249m";
const OVERLAY_ACCENT_BG = "\x1b[48;2;138;181;249m";

function overlayAccent(text: string): string {
	return `${OVERLAY_ACCENT_FG}${text}\x1b[39m`;
}

function overlayAccentBackground(text: string): string {
	return `${OVERLAY_ACCENT_BG}\x1b[38;2;24;24;37m${text}\x1b[39m\x1b[49m`;
}

type HistoryItemType = "user" | "assistant" | "tool";
type DigestFilter = "all" | "ai" | "tool" | "user";
type DigestView = DigestFilter | "context";

interface HistoryItem {
	type: HistoryItemType;
	title: string;
	content: string;
	timestamp: Date;
	elapsed?: string;
}

interface DigestHistory {
	items: HistoryItem[];
	omittedCount: number;
}

const FILTER_LABELS: Record<DigestFilter, string> = {
	all: "All",
	ai: "AI",
	tool: "Tool",
	user: "User",
};

const FILTER_COMPLETIONS: AutocompleteItem[] = [
	...(Object.keys(FILTER_LABELS) as DigestFilter[]).map((filter) => ({
		value: filter,
		label: filter,
		description: `Show ${FILTER_LABELS[filter]} messages`,
	})),
	{ value: "context", label: "context", description: "Show context usage visualization" },
];

interface MessageLike {
	role?: unknown;
	content?: unknown;
	timestamp?: unknown;
	toolName?: unknown;
	command?: unknown;
}

interface EntryLike {
	type?: unknown;
	timestamp?: unknown;
	message?: MessageLike;
	summary?: unknown;
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

function parseView(args: string): DigestView | undefined {
	const normalized = args.trim().toLowerCase();
	if (!normalized) return "user";
	if (normalized === "assistant") return "ai";
	if (
		normalized === "all" ||
		normalized === "ai" ||
		normalized === "tool" ||
		normalized === "user" ||
		normalized === "context"
	) {
		return normalized;
	}
	return undefined;
}

function viewForShortcut(data: string): DigestView | undefined {
	switch (data.toLowerCase()) {
		case "a": return "ai";
		case "u": return "user";
		case "t": return "tool";
		case "c": return "context";
		case "d": return "all";
		default: return undefined;
	}
}

const DIGEST_VIEWS: DigestView[] = ["all", "ai", "tool", "user", "context"];

function adjacentView(current: DigestView, direction: 1 | -1): DigestView {
	const index = DIGEST_VIEWS.indexOf(current);
	return DIGEST_VIEWS[(index + direction + DIGEST_VIEWS.length) % DIGEST_VIEWS.length];
}

function renderDigestHeader(theme: Theme, activeView: DigestView, width: number): string[] {
	const tabs: Array<{ view: DigestView; label: string }> = [
		{ view: "all", label: "all" },
		{ view: "ai", label: "ai" },
		{ view: "tool", label: "tool" },
		{ view: "user", label: "user" },
		{ view: "context", label: "context" },
	];
	const tabLine = tabs.map(({ view, label }) => {
		const text = ` ${label} `;
		return view === activeView
			? overlayAccentBackground(theme.bold(text))
			: theme.fg("muted", text);
	}).join("   ");
	return [
		...new Text(theme.fg("text", theme.bold("session digest")), 1, 0).render(width),
		...new Text(tabLine, 1, 0).render(width),
		theme.fg("borderMuted", "─".repeat(Math.max(1, width))),
	];
}

function renderFooter(
	theme: Theme,
	hints: Array<[string, string]>,
	actions: Array<[string, string]>,
	width: number,
): string[] {
	const left = hints.map(([key, label]) => `${theme.fg("dim", key)} ${theme.fg("muted", label)}`).join("    ");
	const right = actions.map(([key, label]) =>
		theme.bg("selectedBg", theme.fg("text", theme.bold(` ${key} ${label} `)))
	).join("  ");
	const available = Math.max(1, width - 2);
	const gap = Math.max(2, available - visibleWidth(left) - visibleWidth(right));
	const line = ` ${left}${" ".repeat(gap)}${right} `;
	return new Text(truncateToWidth(line, width, ""), 0, 0).render(width);
}

function frameOverlay(theme: Theme, content: string[], width: number): string[] {
	const innerWidth = Math.max(1, width - 2);
	const horizontal = "─".repeat(innerWidth);
	const row = (line: string): string => {
		const clipped = truncateToWidth(line, innerWidth, "");
		const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
		return overlayAccent("│") + clipped + padding + overlayAccent("│");
	};
	return [
		overlayAccent(`┌${horizontal}┐`),
		...content.map(row),
		overlayAccent(`└${horizontal}┘`),
	];
}

function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
	return String(value);
}

function estimateTokens(value: unknown): number {
	if (typeof value === "string") return Math.ceil(value.length / 4);
	if (value == null) return 0;
	try {
		const serialized = JSON.stringify(value);
		return Math.ceil((serialized ?? String(value)).length / 4);
	} catch {
		return Math.ceil(String(value).length / 4);
	}
}

interface ContextCategory {
	label: string;
	value: number;
	color: Parameters<Theme["fg"]>[0];
	available?: boolean;
}

interface ContextBreakdown {
	total: number;
	limit: number;
	percent: number;
	categories: ContextCategory[];
}

function toContextBreakdown(
	branch: unknown[],
	systemPrompt: string,
	activeToolDefinitions: unknown[],
	total: number,
	limit: number,
	percent: number,
): ContextBreakdown {
	let messageTokensRaw = 0;
	let toolCallTokensRaw = 0;
	let toolResultTokensRaw = 0;

	for (const rawEntry of branch) {
		if (!rawEntry || typeof rawEntry !== "object") continue;
		const entry = rawEntry as EntryLike;
		if (entry.type === "branch_summary" || entry.type === "compaction") {
			messageTokensRaw += estimateTokens(entry.summary);
			continue;
		}
		if (entry.type !== "message" || !entry.message) continue;

		const message = entry.message;
		if (message.role === "toolResult") {
			if (Array.isArray(message.content)) {
				for (const rawBlock of message.content) {
					if (rawBlock && typeof rawBlock === "object" && (rawBlock as ContentBlockLike).type === "text") {
						toolResultTokensRaw += estimateTokens((rawBlock as ContentBlockLike).text);
					}
				}
			}
		} else if (message.role === "bashExecution") {
			toolCallTokensRaw += estimateTokens(message.command);
		} else if (message.role === "user" || message.role === "assistant") {
			if (typeof message.content === "string") {
				messageTokensRaw += estimateTokens(message.content);
			} else if (Array.isArray(message.content)) {
				for (const rawBlock of message.content) {
					if (!rawBlock || typeof rawBlock !== "object") continue;
					const block = rawBlock as ContentBlockLike;
					if (block.type === "text") messageTokensRaw += estimateTokens(block.text);
					if (message.role === "assistant" && block.type === "toolCall") {
						toolCallTokensRaw += estimateTokens(block);
					}
				}
			}
		}
	}

	const systemTokensRaw = estimateTokens(systemPrompt);
	const toolDefinitionTokensRaw = estimateTokens(activeToolDefinitions);
	const rawTotal = systemTokensRaw + toolDefinitionTokensRaw + messageTokensRaw + toolCallTokensRaw + toolResultTokensRaw;
	const ratio = rawTotal > 0 ? total / rawTotal : 1;
	const systemTokens = Math.round(systemTokensRaw * ratio);
	const toolDefinitionTokens = Math.round(toolDefinitionTokensRaw * ratio);
	const messageTokens = Math.round(messageTokensRaw * ratio);
	const toolCallTokens = Math.round((toolCallTokensRaw + toolResultTokensRaw) * ratio);
	const accountedTokens = systemTokens + toolDefinitionTokens + messageTokens + toolCallTokens;

	const categories: ContextCategory[] = [
		{ label: "System Prompt", value: systemTokens, color: "muted" },
		{ label: "System Tools", value: toolDefinitionTokens, color: "dim" },
		{ label: "Tool Call", value: toolCallTokens, color: "success" },
		{ label: "Messages", value: messageTokens, color: "accent" },
	];
	const otherTokens = Math.max(0, total - accountedTokens);
	if (otherTokens > 10) categories.push({ label: "Other", value: otherTokens, color: "dim" });
	categories.push({
		label: "Available",
		value: Math.max(0, limit - total),
		color: "borderMuted",
		available: true,
	});

	return { total, limit, percent, categories };
}

class ContextUsageUI implements Component {
	constructor(
		private readonly breakdown: ContextBreakdown,
		private readonly onDone: (nextView?: DigestView) => void,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
	) {}

	handleInput(data: string): void {
		const nextView = viewForShortcut(data);
		if (nextView) {
			this.onDone(nextView);
		} else if (matchesKey(data, Key.tab)) {
			this.onDone(adjacentView("context", 1));
		} else if (matchesKey(data, Key.shift("tab"))) {
			this.onDone(adjacentView("context", -1));
		} else if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onDone();
		}
	}

	render(width: number): string[] {
		const { total, limit, percent, categories } = this.breakdown;
		const theme = this.theme;
		const container = new Container();
		container.addChild({ render: (renderWidth) => renderDigestHeader(theme, "context", renderWidth), invalidate: () => {} });
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("accent", theme.bold("Context usage")), 1, 0));
		container.addChild(new Spacer(1));

		const gridWidth = 10;
		const gridHeight = 5;
		const totalBlocks = gridWidth * gridHeight;
		const blocks: Array<{ color: ContextCategory["color"]; filled: boolean }> = [];
		for (const category of categories) {
			if (category.available) continue;
			let count = Math.round((category.value / limit) * totalBlocks);
			if (count === 0 && category.value > 0) count = 1;
			for (let index = 0; index < count && blocks.length < totalBlocks; index++) {
				blocks.push({ color: category.color, filled: true });
			}
		}
		while (blocks.length < totalBlocks) blocks.push({ color: "borderMuted", filled: false });

		const gridLines: string[] = [];
		for (let row = 0; row < gridHeight; row++) {
			let line = "";
			for (let column = 0; column < gridWidth; column++) {
				const block = blocks[row * gridWidth + column];
				line += theme.fg(block.color, block.filled ? "■ " : "□ ");
			}
			gridLines.push(line.trimEnd());
		}

		const detailLines = [
			`${theme.fg("text", theme.bold("Total Usage".padEnd(16)))} ${theme.fg("text", theme.bold(formatTokens(total).padStart(7)))} ${theme.fg("text", theme.bold(`(${percent.toFixed(1).padStart(5)}%)`))}`,
			"",
			...categories.map((category) => {
				const icon = category.available ? "□" : "■";
				const rowPercent = ((category.value / limit) * 100).toFixed(1).padStart(5);
				return `${theme.fg(category.color, icon)} ${theme.fg("text", category.label.padEnd(14))} ${theme.fg("accent", formatTokens(category.value).padStart(7))} (${rowPercent}%)`;
			}),
		];

		const maxRows = Math.max(gridLines.length, detailLines.length);
		for (let index = 0; index < maxRows; index++) {
			const left = (gridLines[index] ?? "").padEnd(20);
			const right = detailLines[index] ?? "";
			container.addChild(new Text(truncateToWidth(`    ${left}      ${right}`, Math.max(1, width - 2)), 1, 0));
		}
		container.addChild(new Spacer(1));
		container.addChild({
			render: (renderWidth) => renderFooter(theme, [["tab", "view"], ["A/U/T/D", "jump"]], [["esc", "close"]], renderWidth),
			invalidate: () => {},
		});
		return frameOverlay(theme, container.render(Math.max(1, width - 2)), width);
	}

	invalidate(): void {}
}

function toDigestHistory(branch: unknown[], filter: DigestFilter): DigestHistory {
	const messageEntries = branch.filter((entry): entry is EntryLike => {
		return Boolean(entry && typeof entry === "object" && (entry as EntryLike).type === "message");
	});
	const matchingEntries: Array<{ entry: EntryLike; type: HistoryItemType }> = [];

	for (const entry of messageEntries) {
		const role = entry.message?.role;
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

	return { items, omittedCount };
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
		const visible = lines.slice(offset, offset + this.maxLines);
		while (visible.length < this.maxLines) visible.push("");
		return visible;
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
		private readonly onDone: (nextView?: DigestView) => void,
		private readonly requestRender: () => void,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
	) {
		this.selectedIndex = Math.max(0, items.length - 1);
	}

	handleInput(data: string): void {
		const nextView = viewForShortcut(data);
		if (nextView) {
			this.onDone(nextView);
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.onDone(adjacentView(this.filter, 1));
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.onDone(adjacentView(this.filter, -1));
			return;
		}
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			if (this.expanded) {
				this.expanded = false;
				this.detailOffset = 0;
				this.requestRender();
			} else {
				this.onDone();
			}
			return;
		}

		if (this.expanded) {
			const maxOffset = Math.max(0, this.detailLineCount - DETAIL_LINES);
			if (this.keybindings.matches(data, "tui.select.confirm")) {
				this.expanded = false;
				this.detailOffset = 0;
			} else if (this.keybindings.matches(data, "tui.select.up")) {
				this.detailOffset = Math.max(0, this.detailOffset - 1);
			} else if (this.keybindings.matches(data, "tui.select.down")) {
				this.detailOffset = Math.min(maxOffset, this.detailOffset + 1);
			} else if (this.keybindings.matches(data, "tui.select.pageUp")) {
				this.detailOffset = Math.max(0, this.detailOffset - DETAIL_LINES);
			} else if (this.keybindings.matches(data, "tui.select.pageDown")) {
				this.detailOffset = Math.min(maxOffset, this.detailOffset + DETAIL_LINES);
			} else if (matchesKey(data, Key.home)) {
				this.detailOffset = 0;
			} else if (matchesKey(data, Key.end)) {
				this.detailOffset = maxOffset;
			} else {
				return;
			}
		} else if (this.keybindings.matches(data, "tui.select.up")) {
			this.moveSelection(-1);
		} else if (this.keybindings.matches(data, "tui.select.down")) {
			this.moveSelection(1);
		} else if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.expanded = true;
			this.detailOffset = 0;
		} else if (this.keybindings.matches(data, "tui.select.pageUp")) {
			this.moveSelection(-PAGE_SIZE);
		} else if (this.keybindings.matches(data, "tui.select.pageDown")) {
			this.moveSelection(PAGE_SIZE);
		} else if (matchesKey(data, Key.home)) {
			this.moveSelection(-this.items.length);
		} else if (matchesKey(data, Key.end)) {
			this.moveSelection(this.items.length);
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

		container.addChild({ render: (renderWidth) => renderDigestHeader(theme, this.filter, renderWidth), invalidate: () => {} });
		container.addChild(new Spacer(1));
		container.addChild(
			new Text(
				`${theme.fg("text", theme.bold(FILTER_LABELS[this.filter]))}  ` +
					`${theme.fg("accent", String(this.items.length))} ${theme.fg("muted", "entries")}  ` +
					theme.fg("dim", `page ${currentPage} / ${pageCount}`),
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
			const color = item.type === "user" ? "text" : item.type === "assistant" ? "accent" : "success";
			const badge = item.type === "user" ? "user" : item.type === "assistant" ? "ai" : "tool";
			const cursor = selected ? theme.fg("accent", "▸") : " ";
			const label = theme.fg(color, theme.bold(badge.padEnd(4)));
			const timestamp = theme.fg("dim", formatTime(item.timestamp));
			const toolName = item.type === "tool" ? `${theme.fg("text", item.title.replace(/^Tool: /, ""))}  ` : "";
			const elapsed = item.elapsed ? `${theme.fg("dim", `+${item.elapsed}`)}  ` : "";
			const preview = item.content.replace(/\s+/g, " ").trim();
			const metadata = `${cursor}  ${label}  ${timestamp}  ${elapsed}${toolName}`;
			const rowWidth = Math.max(1, width - 4);
			const previewWidth = Math.max(1, rowWidth - visibleWidth(metadata));
			const previewText = theme.fg(
				selected ? "text" : "muted",
				truncateToWidth(preview, previewWidth, "…"),
			);
			const box = new Box(1, 0, selected ? (text) => theme.bg("selectedBg", text) : undefined);
			box.addChild(new Text(truncateToWidth(`${metadata}${previewText}`, rowWidth, ""), 0, 0));
			container.addChild(box);
		});

		if (this.expanded) {
			const selected = this.items[this.selectedIndex];
			const detail = new Container();
			detail.addChild({ render: (renderWidth) => renderDigestHeader(theme, this.filter, renderWidth), invalidate: () => {} });
			detail.addChild(new Spacer(1));
			const typeLabel = selected.type === "assistant" ? "AI" : selected.type === "user" ? "User" : selected.title;
			detail.addChild(new Text(theme.fg("accent", theme.bold(` ${typeLabel}`)), 1, 0));
			detail.addChild(new Text(theme.fg("muted", ` ${formatTime(selected.timestamp)}${selected.elapsed ? `  •  +${selected.elapsed}` : ""}`), 1, 0));
			detail.addChild(new Spacer(1));
			const clipped = new ClippedText(selected.content, () => this.detailOffset, DETAIL_LINES);
			detail.addChild(clipped);
			detail.addChild(new Spacer(1));
			const lines = detail.render(Math.max(1, width - 2));
			this.detailLineCount = clipped.lineCount;
			const start = Math.min(this.detailOffset + 1, Math.max(1, this.detailLineCount));
			const end = Math.min(this.detailOffset + DETAIL_LINES, this.detailLineCount);
			return frameOverlay(theme, [
				...lines,
				...new Text(theme.fg("dim", ` ${start}–${end} of ${this.detailLineCount} lines`), 1, 0).render(Math.max(1, width - 2)),
				...renderFooter(
					theme,
					[["↑↓", "scroll"], ["PgUp/Dn", "page"], ["home/end", "jump"]],
					[["enter/esc", "back"]],
					Math.max(1, width - 2),
				),
			], width);
		}

		container.addChild(new Spacer(1));
		container.addChild({
			render: (renderWidth) => renderFooter(
				theme,
				[["↑↓", "select"], ["PgUp/Dn", "page"], ["tab", "view"]],
				[["↵", "details"], ["esc", "close"]],
				renderWidth,
			),
			invalidate: () => {},
		});
		return frameOverlay(theme, container.render(Math.max(1, width - 2)), width);
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("digest", {
		description: "Show session messages or context usage",
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

			const view = parseView(args);
			if (!view) {
				ctx.ui.notify("Usage: /digest [all|ai|tool|user|context]", "warning");
				return;
			}

			const branch = ctx.sessionManager.getBranch() as unknown[];
			let currentView: DigestView | undefined = view;
			while (currentView) {
				if (currentView === "context") {
					const usage = ctx.getContextUsage();
					const total = usage?.tokens;
					const limit = usage?.contextWindow;
					const percent = usage?.percent;
					if (
						typeof total !== "number" ||
						typeof limit !== "number" ||
						typeof percent !== "number" ||
						!Number.isFinite(total) ||
						!Number.isFinite(limit) ||
						!Number.isFinite(percent) ||
						limit <= 0
					) {
						ctx.ui.notify("Context usage info not available.", "warning");
						return;
					}

					const activeTools = new Set(pi.getActiveTools());
					const activeToolDefinitions = pi.getAllTools().filter((tool) => activeTools.has(tool.name));
					const breakdown = toContextBreakdown(
						branch,
						ctx.getSystemPrompt(),
						activeToolDefinitions,
						total,
						limit,
						percent,
					);
					currentView = await ctx.ui.custom<DigestView | undefined>(
						(_tui, theme, keybindings, done) =>
							new ContextUsageUI(breakdown, (nextView) => done(nextView), theme, keybindings),
						{
							overlay: true,
							overlayOptions: {
								width: "92%",
								minWidth: 72,
								maxHeight: "94%",
								anchor: "center",
								margin: 1,
							},
						},
					);
					continue;
				}

				const filter = currentView;
				const { items, omittedCount } = toDigestHistory(branch, filter);
				if (items.length === 0) {
					ctx.ui.notify(`No ${FILTER_LABELS[filter]} messages found in the current session branch.`, "warning");
					return;
				}

				currentView = await ctx.ui.custom<DigestView | undefined>(
					(tui, theme, keybindings, done) =>
						new SessionDigestUI(
							items,
							omittedCount,
							filter,
							(nextView) => done(nextView),
							() => tui.requestRender(),
							theme,
							keybindings,
						),
					{
						overlay: true,
						overlayOptions: {
							width: "92%",
							minWidth: 72,
							maxHeight: "94%",
							anchor: "center",
							margin: 1,
						},
					},
				);
			}
		},
	});
}
