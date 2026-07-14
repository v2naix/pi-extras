import assert from "node:assert/strict";
import test from "node:test";
import { installHerdrAnswerStudio } from "../extensions/herdr-answer-studio/core.ts";

function assistantQuestion() {
  return {
    type: "message",
    id: "assistant-1",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "Which stack should I use?" }],
    },
  };
}

function createHarness() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const commands = new Map<string, any>();
  const blockedEvents: unknown[] = [];
  const sentUserMessages: string[] = [];
  const pi = {
    on(name: string, handler: (...args: any[]) => unknown) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    events: {
      emit(name: string, data: unknown) {
        if (name === "herdr:blocked") blockedEvents.push(data);
      },
    },
    sendUserMessage(text: string) {
      sentUserMessages.push(text);
    },
  };
  return { pi, handlers, commands, blockedEvents, sentUserMessages };
}

const ctx = {
  mode: "tui",
  sessionManager: { getBranch: () => [assistantQuestion()] },
  ui: { notify() {} },
};

test("automatic invocation calls the captured handler without messaging the model", async () => {
  const harness = createHarness();
  let answerInvocations = 0;
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      description: "test answer command",
      async handler() {
        answerInvocations += 1;
      },
    });
  });

  const agentSettled = harness.handlers.get("agent_settled");
  assert.ok(agentSettled);
  await agentSettled({}, ctx);

  assert.equal(answerInvocations, 1);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for Answer Studio response" },
    { active: false },
  ]);
});

test("keeps /answer registered and blocked during manual invocation", async () => {
  const harness = createHarness();
  let answerInvocations = 0;
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      async handler() {
        answerInvocations += 1;
      },
    });
  });

  const answer = harness.commands.get("answer");
  assert.ok(answer);
  await answer.handler("", ctx);
  assert.equal(answerInvocations, 1);
  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for Answer Studio response" },
    { active: false },
  ]);
});

test("clears blocked state when Answer Studio fails", async () => {
  const harness = createHarness();
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      async handler() {
        throw new Error("studio failed");
      },
    });
  });

  const answer = harness.commands.get("answer");
  await assert.rejects(answer.handler("", ctx), /studio failed/);
  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for Answer Studio response" },
    { active: false },
  ]);
});

test("fails at load time when the companion does not register /answer", async () => {
  const harness = createHarness();
  await assert.rejects(
    installHerdrAnswerStudio(harness.pi as any, () => {}),
    /did not register \/answer/,
  );
});
