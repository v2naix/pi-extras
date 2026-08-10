import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
import dotfilesPublish, {
	targetDriftLines,
	targetPath,
} from "../extensions/dotfiles-publish/index.ts";

initTheme("dark", false);

function runCustomUi(factory: any, onActive?: (active: boolean) => void): Promise<unknown> {
	onActive?.(true);
	return new Promise((resolve) => {
		let component: { dispose?: () => void } | undefined;
		const done = (value: unknown) => {
			queueMicrotask(() => component?.dispose?.());
			onActive?.(false);
			resolve(value);
		};
		component = factory(
			{ requestRender() {} },
			{ fg(_color: string, text: string) { return text; } },
			{},
			done,
		);
	});
}

test("parses only target-side chezmoi drift and preserves explicit paths", () => {
	const status = [
		"M  .config/zed/settings.json",
		" M .config/nvim/init.lua",
		"D  Documents/file with spaces.txt",
	].join("\n");
	const drift = targetDriftLines(status);
	assert.deepEqual(drift, [
		"M  .config/zed/settings.json",
		"D  Documents/file with spaces.txt",
	]);
	assert.deepEqual(drift.map(targetPath), [
		".config/zed/settings.json",
		"Documents/file with spaces.txt",
	]);
});

test("interactively reviews and imports target changes without requiring shell commands", async () => {
	const root = await mkdtemp(join(tmpdir(), "dotfiles-publish-"));
	try {
		await Promise.all([
			mkdir(join(root, ".git")),
			mkdir(join(root, "scripts"), { recursive: true }),
			mkdir(join(root, "security"), { recursive: true }),
			mkdir(join(root, "docs"), { recursive: true }),
		]);
		await Promise.all([
			writeFile(join(root, "scripts/dotfiles"), ""),
			writeFile(join(root, "security/managed-paths.txt"), ""),
			writeFile(join(root, "docs/daily-workflow.md"), ""),
		]);

		const commands = new Map<string, any>();
		const execCalls: Array<[string, string[]]> = [];
		const notifications: Array<[string, string]> = [];
		let imported = false;
		const pi = {
			registerCommand(name: string, definition: unknown) {
				commands.set(name, definition);
			},
			async exec(command: string, args: string[]) {
				execCalls.push([command, args]);
				if (command === "git" && args[0] === "branch") return result("main\n");
				if (command === "git" && args[0] === "rev-parse" && args.includes("--short=12")) return result("abc123\n");
				if (command === "git" && args[0] === "rev-list") return result("0 0\n");
				if (command === "git" && args[0] === "status") return result("");
				if (command === "chezmoi" && args[0] === "status") return result(imported ? "" : "M  .config/app.conf\n");
				if (command === "chezmoi" && args[0] === "execute-template") return result(`${root}/home\n`);
				if (command === "chezmoi" && args[0] === "diff") return result("-old\n+new\n");
				if (command === "chezmoi" && args[0] === "source-path") return result(`${root}/dot_config/app.conf\n`);
				if (command === "chezmoi" && args[0] === "add") {
					imported = true;
					return result("");
				}
				return result("");
			},
		};
		const result = (stdout: string) => ({ stdout, stderr: "", code: 0, killed: false });

		dotfilesPublish(pi as unknown as ExtensionAPI);
		await commands.get("dotfiles-publish").handler("", {
			mode: "tui",
			cwd: root,
			ui: {
				setStatus() {},
				custom: runCustomUi,
				notify(message: string, level: string) {
					notifications.push([message, level]);
				},
				async confirm() {
					return true;
				},
				async select(title: string) {
					if (title === "选择本次操作终点") return "仅应用：审阅并 apply，不提交、不推送";
					if (title.startsWith("发现 1 个目标漂移")) return "逐项审核并导入本机变化到 source";
					if (title.startsWith("审核本机变化：.config/app.conf")) return "导入此项到 source";
					throw new Error(`unexpected selection: ${title}`);
				},
			},
		});

		assert.equal(imported, true);
		assert.ok(execCalls.some(([command, args]) => command === "chezmoi" && args.join(" ") === `diff -- ${root}/home/.config/app.conf`));
		assert.ok(execCalls.some(([command, args]) => command === "chezmoi" && args.join(" ") === `add --verbose --no-tty --secrets error -- ${root}/home/.config/app.conf`));
		assert.ok(notifications.some(([message, level]) => message === "已逐项审核并导入 1 项本机变化" && level === "info"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("blocks editor input while long-running validation is active", async () => {
	const root = await mkdtemp(join(tmpdir(), "dotfiles-publish-progress-"));
	let releaseTests: (() => void) | undefined;
	try {
		await Promise.all([
			mkdir(join(root, ".git")),
			mkdir(join(root, "scripts"), { recursive: true }),
			mkdir(join(root, "security"), { recursive: true }),
			mkdir(join(root, "docs"), { recursive: true }),
		]);
		await Promise.all([
			writeFile(join(root, "scripts/dotfiles"), ""),
			writeFile(join(root, "security/managed-paths.txt"), ""),
			writeFile(join(root, "docs/daily-workflow.md"), ""),
		]);

		const commands = new Map<string, any>();
		let testsStarted = false;
		let blockingUiActive = false;
		let validationWasBlocked = false;
		const testsBlocked = new Promise<void>((resolve) => {
			releaseTests = resolve;
		});
		const result = (stdout = "") => ({ stdout, stderr: "", code: 0, killed: false });
		const pi = {
			registerCommand(name: string, definition: unknown) {
				commands.set(name, definition);
			},
			async exec(command: string, args: string[]) {
				if (command === "git" && args[0] === "branch") return result("main\n");
				if (command === "git" && args[0] === "rev-parse" && args.includes("--short=12")) return result("abc123\n");
				if (command === "git" && args[0] === "rev-parse") return result("abc123\n");
				if (command === "git" && args[0] === "rev-list") return result("0 0\n");
				if (command === "git" && args[0] === "status") return result();
				if (command === "chezmoi" && args[0] === "status") return result();
				if (command === "tests/run.sh") {
					testsStarted = true;
					validationWasBlocked = blockingUiActive;
					await testsBlocked;
					return result();
				}
				return result();
			},
		};

		dotfilesPublish(pi as unknown as ExtensionAPI);
		const run = commands.get("dotfiles-publish").handler("", {
			mode: "tui",
			cwd: root,
			ui: {
				setStatus() {},
				notify() {},
				async confirm() {
					return true;
				},
				async select(title: string) {
					if (title === "选择本次操作终点") {
						return "发布到远端：审阅 → 应用 → 测试/安全扫描 → 提交 → 同步 → push";
					}
					throw new Error(`unexpected selection: ${title}`);
				},
				async custom(factory: any) {
					return runCustomUi(factory, (active) => {
						blockingUiActive = active;
					});
				},
			},
		});

		for (let attempt = 0; attempt < 20 && !testsStarted; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		assert.equal(testsStarted, true, "workflow never reached its long-running validation");
		assert.equal(validationWasBlocked, true, "validation left the editor active instead of showing blocking progress");
		releaseTests();
		releaseTests = undefined;
		await run;
	} finally {
		releaseTests?.();
		await rm(root, { recursive: true, force: true });
	}
});

test("registers one explicit publish command and fails closed without the TUI", async () => {
	const commands = new Map<string, any>();
	let execCount = 0;
	const notifications: Array<[string, string]> = [];
	const pi = {
		registerCommand(name: string, definition: unknown) {
			commands.set(name, definition);
		},
		async exec() {
			execCount++;
			return { stdout: "", stderr: "", code: 0, killed: false };
		},
	};

	dotfilesPublish(pi as unknown as ExtensionAPI);
	assert.deepEqual([...commands.keys()], ["dotfiles-publish"]);
	await commands.get("dotfiles-publish").handler("", {
		mode: "print",
		ui: {
			notify(message: string, level: string) {
				notifications.push([message, level]);
			},
		},
	});

	assert.equal(execCount, 0);
	assert.deepEqual(notifications, [[
		"/dotfiles-publish 只能在 Pi TUI 中运行",
		"error",
	]]);
});
