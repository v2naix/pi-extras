import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("allows project writes and confirms writes elsewhere", () => {
	assert.deepEqual(assessFileMutation(cwd, "src/index.ts", home), { action: "allow" });
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
