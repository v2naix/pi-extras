import assert from "node:assert/strict";
import test from "node:test";
import promptTemplateExtension, {
	deriveSnippetName,
	parseSnippetStore,
	validateSnippet,
} from "../extensions/prompt-template/index.ts";

const validSnippet = {
	id: "snippet-1",
	name: "  Review checklist  ",
	description: "Check the final answer",
	content: "Review this change carefully.",
	createdAt: "2026-08-11T00:00:00.000Z",
	updatedAt: "2026-08-11T00:00:00.000Z",
};

test("registers the short /pt command", () => {
	const commands: string[] = [];
	promptTemplateExtension({
		registerCommand(name: string) {
			commands.push(name);
		},
		on() {},
	} as any);
	assert.deepEqual(commands, ["pt"]);
});

test("derives names from the first meaningful line", () => {
	assert.equal(deriveSnippetName("\n# Review checklist\nCheck the final answer"), "Review checklist");
	assert.equal(deriveSnippetName("```ts\nconst answer = 42;\n```"), "const answer = 42;");
	assert.equal(deriveSnippetName("\n\n"), "Untitled snippet");
	assert.equal(Array.from(deriveSnippetName("字".repeat(60))).length, 48);
});

test("validates and normalizes persisted snippets", () => {
	assert.deepEqual(validateSnippet(validSnippet), {
		...validSnippet,
		name: "Review checklist",
	});
});

test("rejects empty and oversized persisted snippets", () => {
	assert.equal(validateSnippet({ ...validSnippet, content: "  " }), undefined);
	assert.equal(validateSnippet({ ...validSnippet, name: "x".repeat(81) }), undefined);
	assert.equal(validateSnippet({ ...validSnippet, content: "x".repeat(100_001) }), undefined);
});

test("parses the versioned store and drops malformed entries", () => {
	const snippets = parseSnippetStore(
		JSON.stringify({
			version: 1,
			snippets: [validSnippet, { name: "incomplete" }],
		}),
	);
	assert.equal(snippets.length, 1);
	assert.equal(snippets[0]?.name, "Review checklist");
});

test("rejects unsupported store formats", () => {
	assert.throws(() => parseSnippetStore('{"version":2,"snippets":[]}'), /Unsupported/);
	assert.throws(() => parseSnippetStore('{"version":1,"snippets":{}}'), /Unsupported/);
});
