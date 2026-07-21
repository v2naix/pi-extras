import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "dotfiles-workflow";
const COMMAND_TIMEOUT_MS = 120_000;
const REQUIRED_PATHS = [
	"scripts/dotfiles",
	"security/managed-paths.txt",
	"docs/daily-workflow.md",
];

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function canonicalizeTarget(cwd: string, filePath: string): string {
	const target = resolve(cwd, filePath);
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

/** Find the dotfiles source containing cwd. A nested lookalike without a Git root is ignored. */
export function findDotfilesRoot(cwd: string): string | undefined {
	let candidate = resolve(cwd);
	while (true) {
		if (
			existsSync(join(candidate, ".git")) &&
			REQUIRED_PATHS.every((path) => existsSync(join(candidate, path)))
		) {
			return realpathSync.native(candidate);
		}
		const parent = dirname(candidate);
		if (parent === candidate) return undefined;
		candidate = parent;
	}
}

/** Only protect Git internals here; scripts/dotfiles and the repository gates remain authoritative. */
export function protectedDotfilesPath(cwd: string, filePath: string): string | undefined {
	const root = findDotfilesRoot(cwd);
	if (!root) return undefined;
	const target = canonicalizeTarget(cwd, filePath);
	const gitMetadata = join(root, ".git");
	return isInside(gitMetadata, target) ? target : undefined;
}

export function formatWorkflowOutput(stdout: string, stderr: string): string {
	const raw = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
	const truncated = truncateTail(raw || "Command completed without output.", {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!truncated.truncated) return truncated.content;
	return `[Earlier output omitted; showing the last ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}).]\n${truncated.content}`;
}

function inputPath(input: unknown): string | undefined {
	if (!input || typeof input !== "object" || !("path" in input)) return undefined;
	return typeof input.path === "string" ? input.path : undefined;
}

export default function dotfilesWorkflow(pi: ExtensionAPI) {
	function setStatus(ctx: ExtensionContext, text: string | undefined) {
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, text);
	}

	async function runCore(command: string, ctx: ExtensionCommandContext) {
		const root = findDotfilesRoot(ctx.cwd);
		if (!root) {
			ctx.ui.notify(
				"当前目录不在受支持的 Dotfiles 源中；未执行任何命令。",
				"warning",
			);
			return;
		}

		await ctx.waitForIdle();
		setStatus(ctx, `df:${command}…`);
		const result = await pi.exec(join(root, "scripts", "dotfiles"), [command], {
			cwd: root,
			timeout: COMMAND_TIMEOUT_MS,
		});
		const output = formatWorkflowOutput(result.stdout, result.stderr);
		const succeeded = result.code === 0 && !result.killed;
		setStatus(ctx, succeeded ? `df:${command} ✓` : `df:${command} !`);
		ctx.ui.notify(output, succeeded ? "info" : "error");
	}

	const commands = [
		["df-check", "check", "运行 Dotfiles 本地只读检查"],
		["df-status", "status", "检查本地状态并 fetch origin/main 后报告分叉关系"],
		["df-review", "review", "显示完整 source/rendered diff、dry-run 与安全扫描"],
		["df-verify", "verify", "委托 Dotfiles 核心运行 verify（若核心已提供）"],
		["df-doctor", "doctor", "委托 Dotfiles 核心运行 doctor（若核心已提供）"],
	] as const;

	for (const [name, coreCommand, description] of commands) {
		pi.registerCommand(name, {
			description,
			handler: async (args, ctx) => {
				if (args.trim()) {
					ctx.ui.notify(`/${name} 首版不接受参数。`, "warning");
					return;
				}
				await runCore(coreCommand, ctx);
			},
		});
	}

	pi.registerCommand("df-help", {
		description: "显示 Dotfiles Pi 工作流入口和安全边界",
		handler: async (_args, ctx) => {
			const root = findDotfilesRoot(ctx.cwd);
			ctx.ui.notify(
				[
					root ? `Dotfiles 源：${root}` : "Dotfiles 源：当前目录未识别",
					"/df-check   本地只读检查",
					"/df-status  本地检查 + fetch 远端状态",
					"/df-review  diff、dry-run 与安全扫描",
					"/df-verify  委托核心 verify",
					"/df-doctor  委托核心 doctor",
					"",
					"扩展不会 apply、提交、推送、导入漂移或修改 Pi 配置。",
					"verify/doctor 尚未由当前 scripts/dotfiles 提供时会安全失败；扩展不会自行补做业务逻辑。",
				].join("\n"),
				"info",
			);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		setStatus(ctx, findDotfilesRoot(ctx.cwd) ? "df:ready" : undefined);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		setStatus(ctx, undefined);
	});

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
		const filePath = inputPath(event.input);
		if (!filePath) return undefined;
		const blocked = protectedDotfilesPath(ctx.cwd, filePath);
		if (!blocked) return undefined;
		if (ctx.hasUI) ctx.ui.notify(`已阻止直接修改 Dotfiles Git 元数据：${blocked}`, "warning");
		return {
			block: true,
			reason: "dotfiles workflow: direct writes to the source repository's .git metadata are blocked",
		};
	});
}
