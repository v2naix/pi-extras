import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export type GuardrailAssessment =
	| { action: "allow" }
	| { action: "confirm" | "block"; reason: string };

const ALLOW: GuardrailAssessment = { action: "allow" };
const HERDR_BLOCKED_EVENT = "herdr:blocked";
const HERDR_BLOCKED_LABEL = "Waiting for macOS guardrail approval";

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function expandHome(filePath: string, home: string): string {
	if (filePath === "~") return home;
	return filePath.startsWith("~/") ? join(home, filePath.slice(2)) : filePath;
}

function canonicalizeTarget(cwd: string, filePath: string, home: string): string {
	const target = resolve(cwd, expandHome(filePath, home));
	let existing = target;
	const missing: string[] = [];

	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) break;
		missing.unshift(basename(existing));
		existing = parent;
	}

	const canonicalParent = existsSync(existing) ? realpathSync.native(existing) : existing;
	return resolve(canonicalParent, ...missing);
}

function protectedMutationRoots(home: string): string[] {
	return [
		"/System",
		"/Library",
		"/Applications",
		"/bin",
		"/sbin",
		"/usr/bin",
		"/usr/sbin",
		"/etc",
		"/private/etc",
		"/private/var/db",
		"/dev",
		join(home, ".ssh"),
		join(home, ".gnupg"),
		join(home, "Library", "Keychains"),
		join(home, "Library", "LaunchAgents"),
		join(home, "Library", "Application Support", "com.apple.TCC"),
	].map((path) => resolve(path));
}

/** Assess a write/edit target. Pass canonicalPath when the caller already resolved symlinks. */
export function assessFileMutation(
	cwd: string,
	filePath: string,
	home = homedir(),
	canonicalPath?: string,
): GuardrailAssessment {
	const target = canonicalPath ?? resolve(cwd, expandHome(filePath, home));
	const protectedRoot = protectedMutationRoots(home).find((root) => isInside(root, target));

	if (protectedRoot) {
		return {
			action: "block",
			reason: `macOS-sensitive path is protected: ${protectedRoot}`,
		};
	}

	if (!isInside(resolve(cwd), target)) {
		return {
			action: "confirm",
			reason: `file mutation is outside the working directory: ${target}`,
		};
	}

	return ALLOW;
}

function shellWords(text: string): string[] {
	const words: string[] = [];
	let word = "";
	let quote: "'" | '"' | undefined;
	let started = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index]!;
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else if (char === "\\" && quote === '"' && index + 1 < text.length) {
				word += text[++index];
			} else {
				word += char;
			}
			started = true;
		} else if (char === "'" || char === '"') {
			quote = char;
			started = true;
		} else if (char === "\\" && index + 1 < text.length) {
			word += text[++index];
			started = true;
		} else if (/\s/.test(char)) {
			if (started) words.push(word);
			word = "";
			started = false;
		} else {
			word += char;
			started = true;
		}
	}

	if (started) words.push(word);
	return words;
}

function shellCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let start = 0;
	let quote: "'" | '"' | undefined;

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index]!;
		if (char === "\\" && quote !== "'" && index + 1 < command.length) {
			index += 1;
		} else if (quote) {
			if (char === quote) quote = undefined;
		} else if (char === "'" || char === '"') {
			quote = char;
		} else if (char === ";" || char === "|" || char === "&" || char === "\n") {
			segments.push(command.slice(start, index));
			start = index + 1;
		}
	}

	segments.push(command.slice(start));
	return segments;
}

function shellInterpreterPayloads(command: string): string[] {
	const payloads: string[] = [];
	const wrappers = new Set(["command", "builtin", "doas", "nohup", "sudo"]);

	for (const segment of shellCommandSegments(command)) {
		const words = shellWords(segment);
		let index = 0;
		while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) index += 1;
		while (wrappers.has(words[index] ?? "")) index += 1;
		if (words[index] === "env") {
			index += 1;
			while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) index += 1;
		}

		const interpreter = basename(words[index] ?? "");
		if (!new Set(["sh", "bash", "zsh"]).has(interpreter)) continue;
		const commandOption = words
			.slice(index + 1)
			.findIndex((word) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word));
		if (commandOption >= 0) {
			const payload = words[index + commandOption + 2];
			if (payload !== undefined) payloads.push(payload);
		}
	}

	return payloads;
}

function commandPath(token: string, cwd: string, home: string): string | undefined {
	let cleaned = token.replace(/["']/g, "");
	if (/[`{}]/.test(cleaned.replace("${HOME}", ""))) return undefined;

	const globIndex = cleaned.search(/[*?\[]/);
	if (globIndex >= 0) cleaned = cleaned.slice(0, globIndex).replace(/\/+$/, "");
	if (cleaned === "~" || cleaned === "$HOME" || cleaned === "${HOME}") return resolve(home);
	if (cleaned.startsWith("~/")) return resolve(home, cleaned.slice(2));
	if (cleaned.startsWith("$HOME/")) return resolve(home, cleaned.slice(6));
	if (cleaned.startsWith("${HOME}/")) return resolve(home, cleaned.slice(8));
	return resolve(cwd, cleaned || ".");
}

function isCatastrophicTarget(target: string, home: string): boolean {
	const exactRoots = ["/", "/Users", "/Volumes", home].map((path) => resolve(path));
	if (exactRoots.includes(target)) return true;
	return protectedMutationRoots(home).some((root) => isInside(root, target));
}

function assessRecursiveCommandTargets(
	command: string,
	cwd: string,
	home: string,
): GuardrailAssessment | undefined {
	const invocation = /(?:^|&&|\|\||[;|\n])\s*(?:(?:sudo|doas|command|builtin|nohup)\s+)*(?:env(?:\s+[A-Za-z_][A-Za-z0-9_]*=\S+)*\s+)?(rm|chmod|chown)\s+([^;&|\n]+)/gi;

	for (const match of command.matchAll(invocation)) {
		const tool = match[1]?.toLowerCase();
		const words = shellWords(match[2] ?? "");
		const options = words.filter((word) => word.startsWith("-") && word !== "--");
		const recursive = options.some((word) => word === "--recursive" || /^-[A-Za-z]*[rR]/.test(word));
		if (!recursive) continue;

		const targets = words.filter((word) => !word.startsWith("-") && word !== "--");
		for (const word of targets) {
			const target = commandPath(word, cwd, home);
			if (target && isCatastrophicTarget(target, home)) {
				return {
					action: "block",
					reason: `${tool} recursively targets a macOS-sensitive location: ${target}`,
				};
			}
		}

		return {
			action: "confirm",
			reason: `${tool} is recursive and may destroy data`,
		};
	}

	return undefined;
}

const BLOCKED_COMMANDS: Array<[RegExp, string]> = [
	[/\bdiskutil\s+(?:eraseDisk|partitionDisk|secureErase)\b/i, "diskutil would erase or repartition a disk"],
	[/\bdiskutil\s+apfs\s+(?:deleteContainer|deleteVolume)\b/i, "diskutil would delete an APFS container or volume"],
	[/\b(?:g?dd)\b[^\n;&|]*\bof\s*=\s*\/dev\/(?:r?disk)\d*/i, "raw data would be written to a physical disk"],
	[/\b(?:newfs(?:_[A-Za-z0-9]+)?|mkfs(?:\.[A-Za-z0-9]+)?)\b[^\n;&|]*\/dev\/(?:r?disk)\d*/i, "a physical disk would be formatted"],
	[/\bcsrutil\s+(?:disable|authenticated-root\s+disable)\b/i, "System Integrity Protection would be disabled"],
	[/\bspctl\s+--master-disable\b/i, "Gatekeeper would be disabled"],
	[/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb detected"],
	[/(?:^|\s)kill\s+(?:-[A-Za-z0-9]*9\s+)?1(?:\s|$)/i, "command would kill the system launch process"],
	[/(?:>>?|\btee\b(?:\s+-a)?)\s*["']?\/(?:System|Library|Applications|etc|private\/etc|usr\/(?:bin|sbin)|bin|sbin)(?:\/|["'\s]|$)/i, "shell redirection targets a macOS-sensitive path"],
];

const CONFIRM_COMMANDS: Array<[RegExp, string]> = [
	[/(?:^|&&|\|\||[;|\n])\s*(?:sudo|doas)\b/i, "command requests elevated privileges"],
	[/\bfind\b[^\n;&|]*\s-delete\b/i, "find -delete may remove many files"],
	[/\b(?:shutdown|reboot|halt)\b/i, "command would stop or restart the Mac"],
	[/\blaunchctl\s+(?:bootout|unload|disable)\b/i, "command would disable or unload a macOS service"],
	[/\b(?:killall|pkill)\b/i, "command may terminate unrelated processes"],
	[/\bosascript\b/i, "AppleScript can control applications and the system"],
	[/\bsecurity\s+(?:delete-|set-keychain|default-keychain|lock-keychain)/i, "command would modify the macOS keychain"],
	[/\b(?:curl|wget)\b[^\n]*(?:\||\|&)\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i, "downloaded code would be executed directly"],
	[/\bdiskutil\b/i, "diskutil can change disks and volumes"],
];

const MAX_SHELL_INTERPRETER_DEPTH = 8;

function assessBashCommandAtDepth(
	command: string,
	cwd: string,
	home: string,
	depth: number,
): GuardrailAssessment {
	const recursiveAssessment = assessRecursiveCommandTargets(command, cwd, home);
	if (recursiveAssessment?.action === "block") return recursiveAssessment;

	for (const [pattern, reason] of BLOCKED_COMMANDS) {
		if (pattern.test(command)) return { action: "block", reason };
	}

	let nestedConfirmation: GuardrailAssessment | undefined;
	const payloads = shellInterpreterPayloads(command);
	if (payloads.length > 0 && depth >= MAX_SHELL_INTERPRETER_DEPTH) {
		nestedConfirmation = {
			action: "confirm",
			reason: "shell interpreter nesting is too deep to assess safely",
		};
	} else {
		for (const payload of payloads) {
			const assessment = assessBashCommandAtDepth(payload, cwd, home, depth + 1);
			if (assessment.action === "block") return assessment;
			if (assessment.action === "confirm") nestedConfirmation = assessment;
		}
	}

	if (recursiveAssessment) return recursiveAssessment;
	if (nestedConfirmation) return nestedConfirmation;

	for (const [pattern, reason] of CONFIRM_COMMANDS) {
		if (pattern.test(command)) return { action: "confirm", reason };
	}

	return ALLOW;
}

export function assessBashCommand(
	command: string,
	cwd = process.cwd(),
	home = homedir(),
): GuardrailAssessment {
	return assessBashCommandAtDepth(command, cwd, home, 0);
}

function inputPath(input: unknown): string | undefined {
	if (!input || typeof input !== "object" || !("path" in input)) return undefined;
	return typeof input.path === "string" ? input.path : undefined;
}

function inputCommand(input: unknown): string | undefined {
	if (!input || typeof input !== "object" || !("command" in input)) return undefined;
	return typeof input.command === "string" ? input.command : undefined;
}

async function enforce(
	assessment: GuardrailAssessment,
	detail: string,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
) {
	if (assessment.action === "allow") return undefined;
	if (assessment.action === "block") {
		ctx.ui.notify?.(`Blocked: ${assessment.reason}`, "warning");
		return { block: true, reason: `macOS guardrail: ${assessment.reason}` };
	}
	if (!ctx.hasUI) {
		return {
			block: true,
			reason: `macOS guardrail: ${assessment.reason}; blocked because confirmation UI is unavailable`,
		};
	}

	pi.events.emit(HERDR_BLOCKED_EVENT, {
		active: true,
		label: HERDR_BLOCKED_LABEL,
	});
	try {
		const allowed = await ctx.ui.confirm(
			"macOS guardrail",
			`${assessment.reason}\n\n${detail}\n\nAllow once?`,
		);
		return allowed
			? undefined
			: { block: true, reason: `macOS guardrail: ${assessment.reason}; not approved by user` };
	} finally {
		pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
	}
}

export default function macGuardrail(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("mac-guardrail", "mac-guard");
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus("mac-guardrail", undefined);
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nmacOS safety: Do not modify files outside the working directory, request elevated privileges, disable security controls, or perform broad deletion unless the user explicitly requested that exact action. Never try to bypass a blocked guardrail.`,
	}));

	pi.on("tool_call", async (event, ctx) => {
		const home = homedir();
		const canonicalCwd = canonicalizeTarget(ctx.cwd, ".", home);

		if (event.toolName === "bash") {
			const command = inputCommand(event.input);
			if (!command) return undefined;
			return enforce(assessBashCommand(command, canonicalCwd, home), command, ctx, pi);
		}

		if (event.toolName === "write" || event.toolName === "edit") {
			const filePath = inputPath(event.input);
			if (!filePath) return undefined;
			const canonicalPath = canonicalizeTarget(ctx.cwd, filePath, home);
			return enforce(
				assessFileMutation(canonicalCwd, filePath, home, canonicalPath),
				canonicalPath,
				ctx,
				pi,
			);
		}

		return undefined;
	});
}
