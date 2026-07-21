import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dotfilesWorkflow, {
	findDotfilesRoot,
	formatWorkflowOutput,
	protectedDotfilesPath,
} from "../extensions/dotfiles-workflow.ts";

function makeDotfilesSource(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-dotfiles-workflow-"));
	for (const directory of [".git", "scripts", "security", "docs", "nested/project"]) {
		mkdirSync(join(root, directory), { recursive: true });
	}
	writeFileSync(join(root, "scripts/dotfiles"), "#!/bin/zsh\n");
	writeFileSync(join(root, "security/managed-paths.txt"), "README.md\n");
	writeFileSync(join(root, "docs/daily-workflow.md"), "# Workflow\n");
	return root;
}

test("discovers only a marked dotfiles Git source", () => {
	const root = makeDotfilesSource();
	try {
		assert.equal(findDotfilesRoot(join(root, "nested/project")), realpathSync.native(root));
		assert.equal(findDotfilesRoot(tmpdir()), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("protects Git metadata but not ordinary source files", () => {
	const root = makeDotfilesSource();
	try {
		const canonicalRoot = realpathSync.native(root);
		assert.equal(
			protectedDotfilesPath(root, ".git/config"),
			join(canonicalRoot, ".git/config"),
		);
		assert.equal(protectedDotfilesPath(root, "docs/daily-workflow.md"), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("combines command output without inventing workflow results", () => {
	assert.equal(formatWorkflowOutput("checked\n", "warning\n"), "checked\nwarning");
	assert.equal(formatWorkflowOutput("", ""), "Command completed without output.");
});

test("slash commands delegate to scripts/dotfiles with no business logic", async () => {
	const root = makeDotfilesSource();
	const commands = new Map<string, any>();
	const execCalls: unknown[][] = [];
	const notifications: Array<[string, string]> = [];
	const pi = {
		registerCommand(name: string, definition: unknown) {
			commands.set(name, definition);
		},
		on() {},
		async exec(command: string, args: string[], options: unknown) {
			execCalls.push([command, args, options]);
			return { stdout: "dotfiles check: clean\n", stderr: "", code: 0, killed: false };
		},
	};

	try {
		const canonicalRoot = realpathSync.native(root);
		dotfilesWorkflow(pi as unknown as ExtensionAPI);
		await commands.get("df-check").handler("", {
			cwd: join(root, "nested"),
			hasUI: true,
			waitForIdle: async () => {},
			ui: {
				setStatus() {},
				notify(message: string, level: string) {
					notifications.push([message, level]);
				},
			},
		});

		assert.deepEqual(execCalls, [[
			join(canonicalRoot, "scripts/dotfiles"),
			["check"],
			{ cwd: canonicalRoot, timeout: 120_000 },
		]]);
		assert.deepEqual(notifications, [["dotfiles check: clean", "info"]]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
