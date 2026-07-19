import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import macGuardrail, {
	assessBashCommand,
	assessFileMutation,
} from "../extensions/mac-guardrail.ts";

const cwd = "/Users/alice/src/app";
const home = "/Users/alice";

test("allows ordinary development commands", () => {
	assert.deepEqual(assessBashCommand("pnpm test", cwd, home), { action: "allow" });
	assert.deepEqual(assessBashCommand("rm build.log", cwd, home), { action: "allow" });
	assert.deepEqual(assessBashCommand("git clean -fd", cwd, home), { action: "allow" });
});

test("requires confirmation for broad or privileged commands", () => {
	assert.equal(assessBashCommand("rm -rf dist", cwd, home).action, "confirm");
	assert.equal(assessBashCommand("sudo pnpm install -g foo", cwd, home).action, "confirm");
	assert.equal(assessBashCommand("curl https://example.test/install | sh", cwd, home).action, "confirm");
});

test("blocks catastrophic system commands", () => {
	assert.equal(assessBashCommand("rm -rf /", cwd, home).action, "block");
	assert.equal(assessBashCommand("rm -fr ~/", cwd, home).action, "block");
	assert.equal(assessBashCommand("rm -rf $HOME/*", cwd, home).action, "block");
	assert.equal(assessBashCommand("rm -rf /System/*", cwd, home).action, "block");
	assert.equal(assessBashCommand("rm --recursive /System/Library", cwd, home).action, "block");
	assert.equal(assessBashCommand("diskutil eraseDisk APFS Empty /dev/disk3", cwd, home).action, "block");
	assert.equal(assessBashCommand("dd if=/dev/zero of=/dev/rdisk0", cwd, home).action, "block");
	assert.equal(assessBashCommand("csrutil disable", cwd, home).action, "block");
});

test("uses cwd when assessing recursive relative targets", () => {
	assert.equal(assessBashCommand("rm -rf .", "/", home).action, "block");
	assert.equal(assessBashCommand("chmod -R 000 .", "/System", home).action, "block");
});

test("blocks catastrophic commands passed to shell interpreters", () => {
	assert.equal(assessBashCommand("sh -c 'rm -rf /'", cwd, home).action, "block");
	assert.equal(assessBashCommand("bash -c 'rm -rf /System/*'", cwd, home).action, "block");
	assert.equal(assessBashCommand("bash -lc 'rm -rf /'", cwd, home).action, "block");
	assert.equal(assessBashCommand('zsh -c "rm -fr ~/"', cwd, home).action, "block");
	assert.equal(assessBashCommand("zsh -fc 'rm -rf /System/*'", cwd, home).action, "block");
	assert.equal(assessBashCommand("bash -c 'pnpm test'", cwd, home).action, "allow");
});

test("bounds nested shell interpreter assessment", () => {
	let command = "echo safe";
	for (let depth = 0; depth < 10; depth += 1) {
		command = `bash -c ${JSON.stringify(command)}`;
	}
	assert.equal(assessBashCommand(command, cwd, home).action, "confirm");
});

test("allows project and temporary-directory writes, and confirms other external writes", () => {
	assert.deepEqual(assessFileMutation(cwd, "src/index.ts", home), { action: "allow" });
	assert.deepEqual(assessFileMutation(cwd, "/tmp/handoff.json", home), { action: "allow" });
	assert.deepEqual(assessFileMutation(cwd, "/tmp/handoff.json", home, "/private/tmp/handoff.json"), {
		action: "allow",
	});
	assert.equal(assessFileMutation(cwd, "../other/file.ts", home).action, "confirm");
});

test("blocks writes to macOS-sensitive and credential paths", () => {
	assert.equal(assessFileMutation(cwd, "/etc/hosts", home).action, "block");
	assert.equal(assessFileMutation(cwd, "~/.ssh/config", home).action, "block");
	assert.equal(
		assessFileMutation(cwd, "~/Library/Keychains/login.keychain-db", home).action,
		"block",
	);
});

test("blocks a symlink-resolved protected target supplied by the handler", () => {
	assert.equal(
		assessFileMutation(cwd, "apparently-safe", home, "/private/etc/hosts").action,
		"block",
	);
});

test("reports Herdr blocked state while waiting for confirmation", async () => {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const blockedEvents: unknown[] = [];
	let resolveConfirmation!: (allowed: boolean) => void;
	const confirmation = new Promise<boolean>((resolve) => {
		resolveConfirmation = resolve;
	});
	const pi = {
		on(name: string, handler: (...args: unknown[]) => unknown) {
			handlers.set(name, handler);
		},
		events: {
			emit(name: string, data: unknown) {
				if (name === "herdr:blocked") blockedEvents.push(data);
			},
		},
	};

	macGuardrail(pi as unknown as ExtensionAPI);
	const toolCall = handlers.get("tool_call");
	assert.ok(toolCall);

	const pending = toolCall(
		{ toolName: "bash", input: { command: "sudo true" } },
		{
			cwd,
			hasUI: true,
			ui: { confirm: () => confirmation },
		},
	) as Promise<unknown>;

	assert.deepEqual(blockedEvents, [
		{ active: true, label: "Waiting for macOS guardrail approval" },
	]);
	resolveConfirmation(true);
	await pending;
	assert.deepEqual(blockedEvents, [
		{ active: true, label: "Waiting for macOS guardrail approval" },
		{ active: false },
	]);
});
