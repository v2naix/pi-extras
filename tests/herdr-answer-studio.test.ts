import assert from "node:assert/strict";
import test from "node:test";
import { installHerdrAnswerStudio } from "../extensions/herdr-answer-studio/core.ts";

function assistantQuestion(text = "Which stack should I use?") {
  return {
    type: "message",
    id: "assistant-1",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text }],
    },
  };
}

function createHarness() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const commands = new Map<string, any>();
  const blockedEvents: unknown[] = [];
  let blockedCount = 0;
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
        if (name !== "herdr:blocked") return;
        blockedEvents.push(data);
        blockedCount = (data as { active?: boolean })?.active
          ? blockedCount + 1
          : Math.max(0, blockedCount - 1);
      },
    },
    sendUserMessage(text: string) {
      sentUserMessages.push(text);
    },
  };
  return {
    pi,
    handlers,
    commands,
    blockedEvents,
    getBlockedCount: () => blockedCount,
    sentUserMessages,
  };
}

const ctx = {
  mode: "tui",
  sessionManager: { getBranch: () => [assistantQuestion()] },
  ui: { notify() {} },
};

const multipleQuestionCtx = {
  ...ctx,
  sessionManager: {
    getBranch: () => [
      assistantQuestion(
        "Please answer:\n1. Which database should I use?\n2. Which runtime should I target?",
      ),
    ],
  },
};

test("ignores question-like text inside fenced code blocks", async () => {
  const harness = createHarness();
  let answerInvocations = 0;
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      async handler() {
        answerInvocations += 1;
      },
    });
  });

  const codeBlockCtx = {
    ...ctx,
    sessionManager: {
      getBranch: () => [
        {
          ...assistantQuestion(),
          message: {
            ...assistantQuestion().message,
            content: [
              {
                type: "text",
                text: "复制以下提示词：\n```markdown\n1. 哪些内容属于本次规范\n2. 哪些内容应明确列入 Out of scope\n```",
              },
            ],
          },
        },
      ],
    },
  };

  const agentSettled = harness.handlers.get("agent_settled");
  assert.ok(agentSettled);
  await agentSettled({}, codeBlockCtx);

  assert.equal(answerInvocations, 0);
  assert.deepEqual(harness.blockedEvents, []);
});

test("ignores question marks inside tilde-fenced code blocks", async () => {
  const harness = createHarness();
  let answerInvocations = 0;
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      async handler() {
        answerInvocations += 1;
      },
    });
  });

  const codeBlockCtx = {
    ...ctx,
    sessionManager: {
      getBranch: () => [
        {
          ...assistantQuestion(),
          message: {
            ...assistantQuestion().message,
            content: [
              {
                type: "text",
                text: "Example:\n~~~text\nWould you enable this?\nWhich mode should I use?\n~~~",
              },
            ],
          },
        },
      ],
    },
  };

  const agentSettled = harness.handlers.get("agent_settled");
  assert.ok(agentSettled);
  await agentSettled({}, codeBlockCtx);

  assert.equal(answerInvocations, 0);
  assert.deepEqual(harness.blockedEvents, []);
});

test("restores blocked state for the latest question after reload", async () => {
  const harness = createHarness();
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", { async handler() {} });
  });

  const sessionStart = harness.handlers.get("session_start");
  assert.ok(sessionStart);
  await sessionStart({ reason: "reload" }, ctx);

  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for user response" },
  ]);
});

test("does not invoke extraction for a single question", async () => {
  const harness = createHarness();
  let answerInvocations = 0;
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      async handler() {
        answerInvocations += 1;
      },
    });
  });

  const agentSettled = harness.handlers.get("agent_settled");
  assert.ok(agentSettled);
  await agentSettled({}, ctx);

  assert.equal(answerInvocations, 0);
  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for user response" },
  ]);
});

test("does not extract when one decision is framed and then confirmed", async () => {
  const harness = createHarness();
  let answerInvocations = 0;
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      async handler() {
        answerInvocations += 1;
      },
    });
  });

  const repeatedQuestionCtx = {
    ...ctx,
    sessionManager: {
      getBranch: () => [
        assistantQuestion(
          "先确定最根本的语义：timestamp 应表示哪个时刻？\n\n建议采用最近一次成功提交 meaningful change 的 UTC 时间。\n\n是否确认采用这个定义？",
        ),
      ],
    },
  };
  const agentSettled = harness.handlers.get("agent_settled");
  assert.ok(agentSettled);
  await agentSettled({}, repeatedQuestionCtx);

  assert.equal(answerInvocations, 0);
  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for user response" },
  ]);
});

test("invokes extraction for a question followed by a numbered list", async () => {
  const harness = createHarness();
  let answerInvocations = 0;
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      async handler() {
        answerInvocations += 1;
      },
    });
  });

  const optionsCtx = {
    ...ctx,
    sessionManager: {
      getBranch: () => [
        assistantQuestion(
          "Which database should I use?\n1. PostgreSQL\n2. MySQL",
        ),
      ],
    },
  };
  const agentSettled = harness.handlers.get("agent_settled");
  assert.ok(agentSettled);
  await agentSettled({}, optionsCtx);

  assert.equal(answerInvocations, 1);
  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for Answer Studio response" },
    { active: false },
  ]);
});

test("does not invoke extraction for a numbered list without a question", async () => {
  const harness = createHarness();
  let answerInvocations = 0;
  await installHerdrAnswerStudio(harness.pi as any, (pi) => {
    pi.registerCommand("answer", {
      async handler() {
        answerInvocations += 1;
      },
    });
  });

  const listCtx = {
    ...ctx,
    sessionManager: {
      getBranch: () => [assistantQuestion("Options:\n1. PostgreSQL\n2. MySQL")],
    },
  };
  const agentSettled = harness.handlers.get("agent_settled");
  assert.ok(agentSettled);
  await agentSettled({}, listCtx);

  assert.equal(answerInvocations, 0);
  assert.deepEqual(harness.blockedEvents, []);
});

test("automatically extracts a numbered questionnaire without messaging the model", async () => {
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
  await agentSettled({}, multipleQuestionCtx);

  assert.equal(answerInvocations, 1);
  assert.deepEqual(harness.sentUserMessages, []);
  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for Answer Studio response" },
    { active: false },
  ]);
});

test("keeps Herdr blocked when extraction yields a single question", async () => {
  const harness = createHarness();
  await installHerdrAnswerStudio(harness.pi as any, (pi, bridge) => {
    pi.registerCommand("answer", {
      async handler() {
        bridge.onSingleQuestion();
      },
    });
  });

  const agentSettled = harness.handlers.get("agent_settled");
  assert.ok(agentSettled);
  await agentSettled({}, multipleQuestionCtx);

  assert.deepEqual(harness.blockedEvents, [
    { active: true, label: "Waiting for Answer Studio response" },
    { active: false },
    { active: true, label: "Waiting for user response" },
  ]);
  assert.equal(harness.getBlockedCount(), 1);

  const agentStart = harness.handlers.get("agent_start");
  assert.ok(agentStart);
  await agentStart({}, multipleQuestionCtx);
  assert.equal(
    harness.getBlockedCount(),
    0,
    "submitting the user's answer must release every Herdr blocked reference",
  );
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
  await installHerdrAnswerStudio(harness.pi as any, (pi, bridge) => {
    pi.registerCommand("answer", {
      async handler() {
        bridge.onSingleQuestion();
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
