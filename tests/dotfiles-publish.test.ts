import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dotfilesPublish, {
	targetDriftLines,
	targetPath,
} from "../extensions/dotfiles-publish/index.ts";

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
