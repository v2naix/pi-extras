import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	Text,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const STORE_VERSION = 1;
const MAX_SNIPPETS = 500;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CONTENT_LENGTH = 100_000;
const STORE_FILE_NAME = "prompt-template-snippets.json";

export interface PromptSnippet {
	id: string;
	name: string;
	description: string;
	content: string;
	createdAt: string;
	updatedAt: string;
}

interface SnippetStore {
	version: typeof STORE_VERSION;
	snippets: PromptSnippet[];
}

function cleanSingleLine(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanForTerminal(value: string): string {
	return value
		.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)?)/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function deriveSnippetName(content: string): string {
	for (const line of content.split("\n")) {
		let candidate = cleanSingleLine(line);
		if (/^(?:```|~~~)/.test(candidate)) continue;
		candidate = candidate.replace(/^(?:(?:#{1,6}|>|[-*+]|\d+[.)])\s+)+/, "").replace(/^`+|`+$/g, "").trim();
		if (!candidate) continue;
		const characters = Array.from(candidate);
		return characters.length > 48 ? `${characters.slice(0, 47).join("")}…` : candidate;
	}
	return "Untitled snippet";
}

function uniqueSnippetName(base: string, snippets: PromptSnippet[]): string {
	if (!findSnippet(snippets, base)) return base;
	for (let index = 2; index <= MAX_SNIPPETS + 1; index += 1) {
		const suffix = ` (${index})`;
		const stem = Array.from(base).slice(0, MAX_NAME_LENGTH - suffix.length).join("");
		const candidate = `${stem}${suffix}`;
		if (!findSnippet(snippets, candidate)) return candidate;
	}
	throw new Error("Could not generate a unique snippet name");
}

export function validateSnippet(input: unknown): PromptSnippet | undefined {
	if (!input || typeof input !== "object") return undefined;
	const value = input as Record<string, unknown>;
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		typeof value.description !== "string" ||
		typeof value.content !== "string" ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string"
	) {
		return undefined;
	}

	const name = cleanSingleLine(value.name);
	const description = cleanSingleLine(value.description);
	if (
		!name ||
		name.length > MAX_NAME_LENGTH ||
		description.length > MAX_DESCRIPTION_LENGTH ||
		!value.content.trim() ||
		value.content.length > MAX_CONTENT_LENGTH
	) {
		return undefined;
	}

	return { ...value, name, description } as PromptSnippet;
}

export function parseSnippetStore(raw: string): PromptSnippet[] {
	const parsed = JSON.parse(raw) as { version?: unknown; snippets?: unknown };
	if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.snippets)) {
		throw new Error(`Unsupported prompt-template store format`);
	}
	return parsed.snippets.slice(0, MAX_SNIPPETS).map(validateSnippet).filter((item): item is PromptSnippet => !!item);
}

function snippetStorePath(): string {
	return join(getAgentDir(), STORE_FILE_NAME);
}

async function loadSnippets(path = snippetStorePath()): Promise<PromptSnippet[]> {
	try {
		return parseSnippetStore(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function saveSnippets(snippets: PromptSnippet[], path = snippetStorePath()): Promise<void> {
	const store: SnippetStore = { version: STORE_VERSION, snippets };
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await rename(temporaryPath, path);
	} catch (error) {
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}

function findSnippet(snippets: PromptSnippet[], name: string): PromptSnippet | undefined {
	const normalized = name.trim().toLocaleLowerCase();
	return snippets.find((snippet) => snippet.name.toLocaleLowerCase() === normalized);
}

function createId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function snippetItems(snippets: PromptSnippet[]): SelectItem[] {
	return [...snippets]
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.map((snippet) => ({
			value: snippet.id,
			label: snippet.name,
			description: snippet.description || truncateToWidth(cleanSingleLine(snippet.content), 80),
		}));
}

async function selectSnippet(
	ctx: ExtensionCommandContext,
	snippets: PromptSnippet[],
	title: string,
): Promise<PromptSnippet | undefined> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("Prompt template browser is only available in TUI mode", "warning");
		return undefined;
	}
	if (snippets.length === 0) {
		ctx.ui.notify("No saved text snippets", "info");
		return undefined;
	}

	const selectedId = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		const list = new SelectList(snippetItems(snippets), Math.min(snippets.length, 12), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • type to search • Enter select • Esc cancel"), 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});

	return selectedId ? snippets.find((snippet) => snippet.id === selectedId) : undefined;
}

async function previewSnippet(ctx: ExtensionCommandContext, snippet: PromptSnippet, action: string): Promise<boolean> {
	if (ctx.mode !== "tui") return false;
	return ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
		let scroll = 0;
		let cachedWidth = 0;
		let bodyLines: string[] = [];

		const rebuild = (width: number) => {
			const contentWidth = Math.max(1, width - 2);
			bodyLines = cleanForTerminal(snippet.content)
				.split("\n")
				.flatMap((line) => wrapTextWithAnsi(line || " ", contentWidth));
			cachedWidth = width;
		};

		return {
			render(width: number) {
				if (cachedWidth !== width) rebuild(width);
				const height = Math.max(5, Math.min(18, bodyLines.length));
				const maxScroll = Math.max(0, bodyLines.length - height);
				scroll = Math.min(scroll, maxScroll);
				const lines = [
					theme.fg("accent", "─".repeat(Math.max(1, width))),
					truncateToWidth(` ${theme.fg("accent", theme.bold(cleanForTerminal(snippet.name)))}`, width),
				];
				if (snippet.description) {
					lines.push(...wrapTextWithAnsi(` ${theme.fg("muted", cleanForTerminal(snippet.description))}`, width));
				}
				lines.push("");
				for (const line of bodyLines.slice(scroll, scroll + height)) lines.push(` ${line}`);
				if (bodyLines.length > height) {
					lines.push(theme.fg("dim", ` ${scroll + 1}-${Math.min(scroll + height, bodyLines.length)} / ${bodyLines.length}`));
				}
				lines.push("", theme.fg("dim", ` ↑↓/PgUp/PgDn scroll • Enter ${action} • Esc cancel`));
				lines.push(theme.fg("accent", "─".repeat(Math.max(1, width))));
				return lines.map((line) => truncateToWidth(line, width));
			},
			invalidate() {
				cachedWidth = 0;
			},
			handleInput(data: string) {
				const page = 10;
				if (matchesKey(data, Key.enter)) return done(true);
				if (matchesKey(data, Key.escape)) return done(false);
				if (matchesKey(data, Key.up)) scroll = Math.max(0, scroll - 1);
				else if (matchesKey(data, Key.down)) scroll = Math.min(Math.max(0, bodyLines.length - 1), scroll + 1);
				else if (matchesKey(data, Key.pageUp)) scroll = Math.max(0, scroll - page);
				else if (matchesKey(data, Key.pageDown)) scroll = Math.min(Math.max(0, bodyLines.length - 1), scroll + page);
				else if (matchesKey(data, Key.home)) scroll = 0;
				else if (matchesKey(data, Key.end)) scroll = Math.max(0, bodyLines.length - page);
				tui.requestRender();
			},
		};
	});
}

export default function promptTemplateExtension(pi: ExtensionAPI) {
	let snippets: PromptSnippet[] = [];

	async function refresh(ctx: ExtensionCommandContext): Promise<boolean> {
		try {
			snippets = await loadSnippets();
			return true;
		} catch (error) {
			ctx.ui.notify(`Failed to load text snippets: ${(error as Error).message}`, "error");
			return false;
		}
	}

	async function invoke(name: string, ctx: ExtensionCommandContext) {
		if (!(await refresh(ctx))) return;
		const snippet = name ? findSnippet(snippets, name) : await selectSnippet(ctx, snippets, "Prompt Templates");
		if (!snippet) {
			if (name) ctx.ui.notify(`Text snippet not found: ${name}`, "error");
			return;
		}
		if (await previewSnippet(ctx, snippet, "fill editor")) {
			ctx.ui.setEditorText(snippet.content);
			ctx.ui.notify(`Filled editor with "${snippet.name}"`, "info");
		}
	}

	async function add(initialContent: string, ctx: ExtensionCommandContext) {
		if (!ctx.hasUI) return;
		if (!(await refresh(ctx))) return;
		if (snippets.length >= MAX_SNIPPETS) {
			ctx.ui.notify(`At most ${MAX_SNIPPETS} snippets can be saved`, "error");
			return;
		}

		const editedContent = initialContent || (await ctx.ui.editor("Snippet content", ""));
		if (editedContent === undefined) return;
		const content = editedContent.trim();
		if (!content || content.length > MAX_CONTENT_LENGTH) {
			ctx.ui.notify(`Content must contain 1-${MAX_CONTENT_LENGTH} characters`, "error");
			return;
		}
		const duplicate = snippets.find((snippet) => snippet.content === content);
		if (duplicate) {
			ctx.ui.notify(`This snippet is already saved as "${duplicate.name}"`, "info");
			return;
		}

		const name = uniqueSnippetName(deriveSnippetName(content), snippets);
		const now = new Date().toISOString();
		const next: PromptSnippet = {
			id: createId(),
			name,
			description: "",
			content,
			createdAt: now,
			updatedAt: now,
		};
		snippets = [...snippets, next];
		try {
			await saveSnippets(snippets);
			ctx.ui.notify(`Saved as "${name}"`, "info");
		} catch (error) {
			ctx.ui.notify(`Failed to save text snippet: ${(error as Error).message}`, "error");
			await refresh(ctx);
		}
	}

	async function remove(name: string, ctx: ExtensionCommandContext) {
		if (!(await refresh(ctx))) return;
		const snippet = name ? findSnippet(snippets, name) : await selectSnippet(ctx, snippets, "Delete Prompt Template");
		if (!snippet) {
			if (name) ctx.ui.notify(`Text snippet not found: ${name}`, "error");
			return;
		}
		if (!(await previewSnippet(ctx, snippet, "review deletion"))) return;
		if (!(await ctx.ui.confirm("Delete snippet?", `Permanently delete "${snippet.name}"?`))) return;
		snippets = snippets.filter((item) => item.id !== snippet.id);
		try {
			await saveSnippets(snippets);
			ctx.ui.notify(`Deleted "${snippet.name}"`, "info");
		} catch (error) {
			ctx.ui.notify(`Failed to delete text snippet: ${(error as Error).message}`, "error");
			await refresh(ctx);
		}
	}

	pi.registerCommand("pt", {
		description: "Save, inspect, invoke, or delete reusable text snippets",
		getArgumentCompletions(prefix) {
			const commands = [
				{ value: "add", label: "add", description: "Save a text snippet" },
				{ value: "delete", label: "delete", description: "Delete a text snippet" },
			];
			const items = [...commands, ...snippetItems(snippets).map((item) => ({ ...item, value: item.label }))];
			const normalized = prefix.toLocaleLowerCase();
			return items.filter((item) => item.value.toLocaleLowerCase().includes(normalized));
		},
		handler: async (args, ctx) => {
			const input = args.trim();
			if (input === "add") return add("", ctx);
			if (input.startsWith("add ")) return add(input.slice(4).trim(), ctx);
			if (input === "delete") return remove("", ctx);
			if (input.startsWith("delete ")) return remove(input.slice(7).trim(), ctx);
			return invoke(input, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			snippets = await loadSnippets();
		} catch (error) {
			ctx.ui.notify(`Failed to load text snippets: ${(error as Error).message}`, "error");
		}
	});
}
