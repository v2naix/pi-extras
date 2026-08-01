import { basename, resolve } from "node:path";
import type { ExecResult, ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { findDotfilesRoot } from "../dotfiles-workflow/index.ts";

const MAX_DIALOG_CHARS = 7000;

type Goal = "publish" | "apply" | "check";
type Relation = "equal" | "ahead" | "behind" | "diverged" | "unknown";

interface RepoState {
	branch: string;
	head: string;
	sourceStatus: string;
	targetStatus: string;
	relation: Relation;
	ahead: number;
	behind: number;
}

function compact(text: string, limit = MAX_DIALOG_CHARS): string {
	const trimmed = text.trim();
	if (trimmed.length <= limit) return trimmed || "（无输出）";
	return `…（省略前 ${trimmed.length - limit} 个字符）\n${trimmed.slice(-limit)}`;
}

export function targetDriftLines(status: string): string[] {
	return status
		.split("\n")
		.filter((line) => line.length >= 3 && line[0] !== " ");
}

export function targetPath(line: string): string {
	return line.slice(3);
}

export default function dotfilesPublishExtension(pi: ExtensionAPI) {
	async function exec(root: string, command: string, args: string[], timeout = 120_000): Promise<ExecResult> {
		return pi.exec(command, args, { cwd: root, timeout });
	}

	async function mustExec(
		root: string,
		command: string,
		args: string[],
		label: string,
		timeout = 120_000,
	): Promise<ExecResult> {
		const result = await exec(root, command, args, timeout);
		if (result.code !== 0) {
			throw new Error(`${label}失败（exit ${result.code}）\n${compact(`${result.stdout}\n${result.stderr}`)}`);
		}
		return result;
	}

	async function relation(root: string): Promise<{ relation: Relation; ahead: number; behind: number }> {
		const remote = await exec(root, "git", ["rev-parse", "--verify", "refs/remotes/origin/main"]);
		if (remote.code !== 0) return { relation: "unknown", ahead: 0, behind: 0 };
		const counts = await mustExec(
			root,
			"git",
			["rev-list", "--left-right", "--count", "HEAD...refs/remotes/origin/main"],
			"计算远端关系",
		);
		const [ahead = 0, behind = 0] = counts.stdout.trim().split(/\s+/).map(Number);
		const value: Relation = ahead === 0 && behind === 0 ? "equal" : ahead > 0 && behind === 0 ? "ahead" : ahead === 0 ? "behind" : "diverged";
		return { relation: value, ahead, behind };
	}

	async function state(root: string): Promise<RepoState> {
		const [branch, head, source, target, remote] = await Promise.all([
			mustExec(root, "git", ["branch", "--show-current"], "读取分支"),
			mustExec(root, "git", ["rev-parse", "--short=12", "HEAD"], "读取 HEAD"),
			mustExec(root, "git", ["status", "--short", "--untracked-files=all"], "读取 Git 状态"),
			mustExec(root, "chezmoi", ["status", "--no-pager"], "读取 chezmoi 状态"),
			relation(root),
		]);
		return {
			branch: branch.stdout.trim(),
			head: head.stdout.trim(),
			sourceStatus: source.stdout.trimEnd(),
			targetStatus: target.stdout.trimEnd(),
			...remote,
		};
	}

	function stateSummary(current: RepoState, remoteFresh: boolean): string {
		const relationText: Record<Relation, string> = {
			equal: "与 origin/main 一致",
			ahead: `领先 ${current.ahead} 个提交`,
			behind: `落后 ${current.behind} 个提交`,
			diverged: `已分叉：领先 ${current.ahead}，落后 ${current.behind}`,
			unknown: "origin/main 尚不可用",
		};
		return [
			`分支：${current.branch || "detached HEAD"}`,
			`HEAD：${current.head}`,
			`远端：${relationText[current.relation]}${remoteFresh ? "（已刷新）" : "（本地缓存）"}`,
			"",
			"Git source：",
			compact(current.sourceStatus || "干净", 2500),
			"",
			"chezmoi target/source：",
			compact(current.targetStatus || "无漂移", 2500),
		].join("\n");
	}

	async function chooseGoal(ctx: ExtensionCommandContext): Promise<Goal | undefined> {
		const choice = await ctx.ui.select("选择本次操作终点", [
			"发布到远端：审阅 → 应用 → 测试/安全扫描 → 提交 → 同步 → push",
			"仅应用：审阅并 apply，不提交、不推送",
			"仅检查：测试和完整安全扫描，不修改状态",
			"取消",
		]);
		if (!choice || choice === "取消") return undefined;
		if (choice.startsWith("发布")) return "publish";
		if (choice.startsWith("仅应用")) return "apply";
		return "check";
	}

	async function importTargetDrift(
		root: string,
		destination: string,
		drift: string[],
		ctx: ExtensionCommandContext,
	): Promise<boolean> {
		let imported = 0;
		for (const line of drift) {
			const path = targetPath(line);
			const absolutePath = resolve(destination, path);
			const deleted = line[0] === "D";
			const [diff, sourcePathResult] = await Promise.all([
				exec(root, "chezmoi", ["diff", "--", absolutePath], 180_000),
				mustExec(root, "chezmoi", ["source-path", "--", absolutePath], `定位 source ${path}`),
			]);
			if (diff.code !== 0) {
				throw new Error(`无法审核本机变化 ${path}\n${compact(`${diff.stdout}\n${diff.stderr}`)}`);
			}
			const sourcePath = sourcePathResult.stdout.trim();
			const template = basename(sourcePath).endsWith(".tmpl");
			const action = deleted
				? "从 source 删除此项（接受本机删除）"
				: template
					? "用本机内容替换模板（移除模板属性）"
					: "导入此项到 source";
			const choice = await ctx.ui.select(
				`审核本机变化：${path}\nsource：${sourcePath}\n${template ? "注意：当前 source 是模板，直接导入会将其替换为普通文件。\n" : ""}\n${compact(`${diff.stdout}\n${diff.stderr}`)}`,
				[action, "跳过此项", "停止审核"],
			);
			if (!choice || choice === "停止审核") break;
			if (choice === "跳过此项") continue;
			if (deleted) {
				const confirmed = await ctx.ui.confirm(
					"确认从 source 删除？",
					`${path}\n\n这会让该文件不再由 chezmoi 管理，并作为仓库删除进入后续审核。`,
				);
				if (!confirmed) continue;
				await mustExec(root, "chezmoi", ["forget", "--", absolutePath], `导入本机删除 ${path}`);
			} else {
				if (template) {
					const confirmed = await ctx.ui.confirm(
						"确认移除模板属性？",
						`${path}\n\nsource 模板将被本机渲染后的内容替换为普通文件。后续 Git 审核仍可取消提交，但扩展不会自动恢复模板。`,
					);
					if (!confirmed) continue;
				}
				const addArgs = ["add", "--verbose", "--no-tty", "--secrets", "error"];
				if (template) addArgs.push("--force");
				addArgs.push("--", absolutePath);
				await mustExec(root, "chezmoi", addArgs, `导入本机变化 ${path}`, 180_000);
			}
			imported++;
		}

		const remainingStatus = await mustExec(root, "chezmoi", ["status", "--no-pager"], "复查 chezmoi 状态");
		const remaining = targetDriftLines(remainingStatus.stdout);
		if (remaining.length > 0) {
			ctx.ui.notify(
				`${imported > 0 ? `已导入 ${imported} 项；` : ""}仍有 ${remaining.length} 项本机变化未处理，已停止发布：\n${remaining.map(targetPath).join("\n")}`,
				"warning",
			);
			return false;
		}
		ctx.ui.notify(`已逐项审核并导入 ${imported} 项本机变化`, "info");
		return true;
	}

	async function resolveTargetDrift(root: string, current: RepoState, ctx: ExtensionCommandContext): Promise<boolean> {
		const drift = targetDriftLines(current.targetStatus);
		if (drift.length === 0) return true;
		const paths = drift.map(targetPath);
		const destinationResult = await mustExec(
			root,
			"chezmoi",
			["execute-template", "{{ .chezmoi.destDir }}"],
			"读取 chezmoi 目标目录",
		);
		const destination = destinationResult.stdout.trim();
		if (!destination) throw new Error("chezmoi 目标目录为空");
		const choice = await ctx.ui.select(`发现 ${paths.length} 个目标漂移，如何处理？`, [
			"逐项审核并导入本机变化到 source",
			"用 source 覆盖列出的漂移目标",
			"停止：保留本机变化",
			"取消",
		]);
		if (choice === "逐项审核并导入本机变化到 source") {
			return importTargetDrift(root, destination, drift, ctx);
		}
		if (choice !== "用 source 覆盖列出的漂移目标") {
			ctx.ui.notify(`未修改目标：\n${paths.join("\n")}`, "warning");
			return false;
		}
		const confirmed = await ctx.ui.confirm(
			"确认覆盖目标",
			`以下本机变化会被 source 覆盖：\n${paths.join("\n")}\n\n该操作不可由扩展自动撤销，继续吗？`,
		);
		if (!confirmed) return false;
		for (const path of paths) {
			await mustExec(root, "chezmoi", ["apply", "--verbose", "--parent-dirs", "--", resolve(destination, path)], `恢复目标 ${path}`);
		}
		ctx.ui.notify("目标漂移已按 source 恢复", "info");
		return true;
	}

	async function reviewAndApply(
		root: string,
		ctx: ExtensionCommandContext,
		forceReview = false,
	): Promise<boolean> {
		const status = await mustExec(root, "chezmoi", ["status", "--no-pager"], "读取 chezmoi 状态");
		const hasRenderedChanges = Boolean(status.stdout.trim());
		if (!hasRenderedChanges && !forceReview) return true;
		const review = await exec(root, "scripts/dotfiles", ["review"], 180_000);
		if (review.code !== 0) throw new Error(`review 未通过\n${compact(`${review.stdout}\n${review.stderr}`)}`);
		const confirmed = await ctx.ui.confirm(
			hasRenderedChanges ? "应用 chezmoi 变更？" : "远端整合后审阅通过？",
			hasRenderedChanges
				? `${compact(`${review.stdout}\n${review.stderr}`)}\n\n确认后扩展会向统一入口传入 APPLY。`
				: `${compact(`${review.stdout}\n${review.stderr}`)}\n\n没有待应用的渲染变更；确认后继续验证。`,
		);
		if (!confirmed) return false;
		if (!hasRenderedChanges) return true;
		const applied = await exec(
			root,
			"/bin/zsh",
			["-c", "printf 'APPLY\\n' | scripts/dotfiles apply"],
			180_000,
		);
		if (applied.code !== 0) throw new Error(`apply 失败\n${compact(`${applied.stdout}\n${applied.stderr}`)}`);
		ctx.ui.notify("chezmoi 配置已应用", "info");
		return true;
	}

	async function validate(root: string, ctx: ExtensionCommandContext): Promise<void> {
		ctx.ui.setStatus("dotfiles-publish", "dotfiles: tests");
		await mustExec(root, "tests/run.sh", [], "测试", 10 * 60_000);
		ctx.ui.setStatus("dotfiles-publish", "dotfiles: security scan");
		await mustExec(root, "scripts/security-gate", ["--all"], "完整安全扫描", 10 * 60_000);
		ctx.ui.notify("测试和完整安全扫描通过", "info");
	}

	async function commitIfNeeded(root: string, ctx: ExtensionCommandContext): Promise<boolean> {
		const source = await mustExec(root, "git", ["status", "--short", "--untracked-files=all"], "读取 Git 状态");
		if (!source.stdout.trim()) return true;
		const stat = await mustExec(root, "git", ["diff", "--stat", "HEAD"], "生成变更摘要");
		const message = await ctx.ui.input("提交信息", "例如：更新 dotfiles 配置");
		if (!message?.trim()) return false;
		const confirmed = await ctx.ui.confirm("暂存并提交全部受管变更？", `${compact(stat.stdout)}\n\ncommit: ${message.trim()}`);
		if (!confirmed) return false;
		await mustExec(root, "git", ["add", "-A"], "暂存变更");
		await mustExec(root, "scripts/security-gate", ["--staged"], "暂存区安全扫描", 180_000);
		await mustExec(root, "git", ["commit", "-m", message.trim()], "提交变更", 180_000);
		ctx.ui.notify("变更已提交", "info");
		return true;
	}

	async function fetchRemote(root: string): Promise<void> {
		await mustExec(root, "git", ["fetch", "--prune", "origin", "main"], "刷新 origin/main", 180_000);
	}

	async function reconcile(root: string, ctx: ExtensionCommandContext): Promise<boolean> {
		const remote = await relation(root);
		if (remote.relation === "equal" || remote.relation === "ahead") return true;
		if (remote.relation === "unknown") throw new Error("fetch 后 origin/main 仍不可用");
		if (remote.relation === "behind") {
			const ok = await ctx.ui.confirm("接受远端快进？", `本地落后 origin/main ${remote.behind} 个提交，将执行 ff-only。`);
			if (!ok) return false;
			await mustExec(root, "git", ["merge", "--ff-only", "refs/remotes/origin/main"], "快进 main", 180_000);
			return true;
		}

		const ok = await ctx.ui.confirm(
			"远端已经分叉",
			`本地领先 ${remote.ahead}、落后 ${remote.behind}。扩展将先创建 safety/diverged-* 分支，再 rebase origin/main；冲突时立即停止。继续吗？`,
		);
		if (!ok) return false;
		const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
		const safety = `safety/diverged-${stamp}`;
		await mustExec(root, "git", ["branch", safety, "HEAD"], "创建分叉安全分支");
		const rebased = await exec(root, "git", ["rebase", "refs/remotes/origin/main"], 10 * 60_000);
		if (rebased.code !== 0) {
			throw new Error(`rebase 冲突或失败，已保留 ${safety}；请解决或 abort 后重新运行命令。\n${compact(`${rebased.stdout}\n${rebased.stderr}`)}`);
		}
		ctx.ui.notify(`rebase 完成；安全分支：${safety}`, "info");
		return true;
	}

	async function push(root: string, ctx: ExtensionCommandContext): Promise<boolean> {
		const final = await state(root);
		if (final.relation === "equal") {
			ctx.ui.notify("origin/main 已经是当前 HEAD，无需 push", "info");
			return true;
		}
		if (final.relation !== "ahead") throw new Error(`push 前远端关系不是“仅领先”，当前为 ${final.relation}`);
		const log = await mustExec(root, "git", ["log", "--oneline", "refs/remotes/origin/main..HEAD"], "读取待推送提交");
		const ok = await ctx.ui.confirm(
			"最终确认：推送到 origin/main？",
			`将推送 ${final.ahead} 个提交：\n${compact(log.stdout)}\n\n这是流程最后一步。`,
		);
		if (!ok) return false;
		await mustExec(root, "git", ["push", "origin", "HEAD:main"], "推送 origin/main", 10 * 60_000);
		ctx.ui.notify("已推送到 origin/main", "info");
		return true;
	}

	pi.registerCommand("dotfiles-publish", {
		description: "交互检查、应用、提交并安全推送 dotfiles 到 origin/main",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/dotfiles-publish 只能在 Pi TUI 中运行", "error");
				return;
			}
			ctx.ui.setStatus("dotfiles-publish", "dotfiles: inspect");
			try {
				const root = findDotfilesRoot(ctx.cwd);
				if (!root) throw new Error("当前目录不在受支持的 Dotfiles 源中");
				let current = await state(root);
				if (current.branch !== "main") throw new Error(`只允许从 main 发布；当前分支为 ${current.branch || "detached HEAD"}`);

				const refresh = await ctx.ui.confirm("Dotfiles 当前状态", `${stateSummary(current, false)}\n\n刷新 origin/main 后选择操作意图？`);
				if (!refresh) return;
				ctx.ui.setStatus("dotfiles-publish", "dotfiles: fetch");
				await fetchRemote(root);
				current = await state(root);
				const goal = await chooseGoal(ctx);
				if (!goal) return;

				const proceed = await ctx.ui.confirm("已刷新状态", `${stateSummary(current, true)}\n\n执行所选流程？`);
				if (!proceed) return;
				if (goal === "check") {
					await validate(root, ctx);
					return;
				}
				if (!(await resolveTargetDrift(root, current, ctx))) return;
				if (!(await reviewAndApply(root, ctx))) return;
				if (goal === "apply") return;

				await validate(root, ctx);
				if (!(await commitIfNeeded(root, ctx))) return;
				ctx.ui.setStatus("dotfiles-publish", "dotfiles: reconcile");
				await fetchRemote(root);
				const beforeReconcileHead = (await state(root)).head;
				if (!(await reconcile(root, ctx))) return;

				// A fast-forward or rebase may change both rendered configuration and gates.
				current = await state(root);
				if (current.head !== beforeReconcileHead) {
					if (!(await resolveTargetDrift(root, current, ctx))) return;
					if (!(await reviewAndApply(root, ctx, true))) return;
					await validate(root, ctx);
				}
				await push(root, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			} finally {
				ctx.ui.setStatus("dotfiles-publish", undefined);
			}
		},
	});
}
