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
		["check", "运行 Dotfiles 本地只读检查"],
		["status", "检查本地状态并 fetch origin/main 后报告分叉关系"],
		["review", "显示完整 source/rendered diff、dry-run 与安全扫描"],
		["verify", "委托 Dotfiles 核心运行 verify（若核心已提供）"],
		["doctor", "委托 Dotfiles 核心运行 doctor（若核心已提供）"],
	] as const;
	const agentCommands = [
		[
			"applyLocal",
			"处理干净当前的状态，需要 APPLY 自己 APPLY 就行，所有文件改动以本地文件为准。",
		],
		[
			"applySource",
			"处理干净当前的状态，需要 APPLY 自己 APPLY 就行，所有文件改动以仓库 source 为准。",
		],
	] as const;

	function showHelp(ctx: ExtensionCommandContext) {
		const root = findDotfilesRoot(ctx.cwd);
		ctx.ui.notify(
			[
				root ? `Dotfiles 源：${root}` : "Dotfiles 源：当前目录未识别",
				"检查 → 编辑源 → 审阅 → 应用 → 功能验证 → 提交 → 推送 → 检查 CI",
				"",
				"/dw check   本地只读检查",
				"/dw status  本地检查 + fetch 远端状态",
				"/dw review  diff、dry-run 与安全扫描",
				"/dw verify  委托核心 verify",
				"/dw doctor       委托核心 doctor",
				"/dw applyLocal   让 Agent 以本地文件为准处理并按需 apply",
				"/dw applySource  让 Agent 以仓库 source 为准处理并按需 apply",
				"",
				"扩展不会直接 apply、提交、推送、导入漂移或修改 Pi 配置。",
				"verify/doctor 尚未由当前 scripts/dotfiles 提供时会安全失败；扩展不会自行补做业务逻辑。",
			].join("\n"),
			"info",
		);
	}

	pi.registerCommand("dw", {
		description: "运行 Dotfiles 工作流子命令，或显示帮助",
		getArgumentCompletions: (prefix) => {
			const subcommands = [
				...commands.map(([command]) => command),
				...agentCommands.map(([command]) => command),
				"help",
			];
			const matches = subcommands.filter((command) => command.startsWith(prefix));
			return matches.length > 0
				? matches.map((command) => ({ value: command, label: command }))
				: null;
		},
		handler: async (args, ctx) => {
			const command = args.trim();
			if (!command || command === "help") {
				showHelp(ctx);
				return;
			}
			const agentCommand = agentCommands.find(([candidate]) => candidate === command);
			if (agentCommand) {
				if (ctx.isIdle()) {
					pi.sendUserMessage(agentCommand[1]);
				} else {
					pi.sendUserMessage(agentCommand[1], { deliverAs: "followUp" });
				}
				return;
			}
			const matched = commands.find(([candidate]) => candidate === command);
			if (!matched) {
				ctx.ui.notify(`未知的 /dw 子命令：${command}`, "warning");
				return;
			}
			await runCore(matched[0], ctx);
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
