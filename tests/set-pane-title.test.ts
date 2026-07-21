import assert from "node:assert/strict";
import test from "node:test";
import { generateAutoTitle } from "../extensions/set-pane-title/index.ts";

function createContext() {
  return {
    model: { provider: "openai-codex", id: "gpt-test" },
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return {
          ok: true,
          apiKey: "test-key",
          headers: { authorization: "Bearer test-key" },
          env: { TEST_ENV: "1" },
        };
      },
    },
  };
}

test("automatic title completion omits unsupported temperature", async () => {
  let receivedOptions: Record<string, unknown> | undefined;
  const fakeComplete = async (_model: unknown, _context: unknown, options: unknown) => {
    receivedOptions = options as Record<string, unknown>;
    return {
      stopReason: "stop",
      content: [{ type: "text", text: "日记写作方法" }],
    };
  };

  const title = await generateAutoTitle(
    "User: 日记怎么写",
    new AbortController().signal,
    createContext() as any,
    fakeComplete as any,
  );

  assert.equal(title, "日记写作方法");
  assert.ok(receivedOptions);
  assert.equal("temperature" in receivedOptions, false);
});

test("automatic title completion surfaces provider errors", async () => {
  const fakeComplete = async () => ({
    stopReason: "error",
    errorMessage: '{"detail":"Unsupported parameter"}',
    content: [],
  });

  await assert.rejects(
    generateAutoTitle(
      "User: 日记怎么写",
      new AbortController().signal,
      createContext() as any,
      fakeComplete as any,
    ),
    /Unsupported parameter/,
  );
});
