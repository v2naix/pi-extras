import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const ANSWER_COMMAND = "answer";
const HERDR_BLOCKED_EVENT = "herdr:blocked";
const ANSWER_STUDIO_BLOCKED_LABEL = "Waiting for Answer Studio response";
const USER_RESPONSE_BLOCKED_LABEL = "Waiting for user response";

type CommandOptions = {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};

export interface AnswerStudioBridge {
  /** Keep Herdr blocked after /answer returns so the normal editor can answer. */
  onSingleQuestion: () => void;
}

export type AnswerStudioFactory = (
  pi: ExtensionAPI,
  bridge: AnswerStudioBridge,
) => void | Promise<void>;

function withoutFencedCodeBlocks(text: string): string {
  let fence: { marker: "`" | "~"; length: number } | undefined;

  return text
    .split("\n")
    .filter((line) => {
      if (fence) {
        const closing = line.match(/^ {0,3}(`+|~+)\s*$/u)?.[1];
        if (
          closing?.[0] === fence.marker &&
          closing.length >= fence.length
        ) {
          fence = undefined;
        }
        return false;
      }

      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
      if (opening) {
        fence = {
          marker: opening[0] as "`" | "~",
          length: opening.length,
        };
        return false;
      }
      return true;
    })
    .join("\n");
}

type AssistantPromptShape = {
  asksQuestion: boolean;
  hasNumberedList: boolean;
};

/**
 * Keep automatic routing deterministic: any visible question blocks Herdr,
 * while only a question accompanied by a 1./2. style list invokes Answer Studio.
 */
export function inspectAssistantPrompt(text: string): AssistantPromptShape {
  const prose = withoutFencedCodeBlocks(text);
  let sawFirstItem = false;
  let hasNumberedList = false;

  for (const line of prose.split("\n")) {
    const number = line.match(/^ {0,3}(\d+)[.)]\s+/u)?.[1];
    if (number === "1") {
      sawFirstItem = true;
    } else if (sawFirstItem && number === "2") {
      hasNumberedList = true;
      break;
    }
  }

  return {
    asksQuestion: /[?？]/u.test(prose),
    hasNumberedList,
  };
}

function latestCompletedAssistant(ctx: ExtensionContext):
  | { id: string; text: string }
  | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const message = entry.message;
    if (message.stopReason !== "stop") return undefined;
    const text = message.content
      .filter(
        (content): content is { type: "text"; text: string } =>
          content.type === "text",
      )
      .map((content) => content.text)
      .join("\n")
      .trim();
    return text ? { id: entry.id, text } : undefined;
  }
  return undefined;
}

/**
 * Loads Answer Studio through a narrow registration proxy so its command
 * handler can be used both by `/answer` and by the automatic trigger. Pi's
 * sendUserMessage() deliberately bypasses slash-command dispatch, so sending
 * the literal string `/answer` here would incorrectly start a model turn.
 */
export async function installHerdrAnswerStudio(
  pi: ExtensionAPI,
  answerStudioFactory: AnswerStudioFactory,
) {
  let answerHandler: CommandOptions["handler"] | undefined;
  let processedAssistantId: string | undefined;
  let blockedLabel: string | undefined;
  let keepBlockedAfterAnswer = false;

  const setBlocked = (
    active: boolean,
    label = USER_RESPONSE_BLOCKED_LABEL,
  ) => {
    const nextLabel = active ? label : undefined;
    if (nextLabel === blockedLabel) return;

    // Herdr treats blocked events as reference-counted acquisitions/releases.
    // Changing a label therefore has to release the old acquisition before
    // acquiring the new one; two consecutive active:true events would leak a
    // blocked reference after the user submits their answer.
    if (blockedLabel !== undefined) {
      pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
    }
    blockedLabel = nextLabel;
    if (nextLabel !== undefined) {
      pi.events.emit(HERDR_BLOCKED_EVENT, { active: true, label: nextLabel });
    }
  };

  const invokeAnswer = async (
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> => {
    if (!answerHandler) {
      throw new Error("Answer Studio /answer handler is unavailable");
    }

    keepBlockedAfterAnswer = false;
    setBlocked(true, ANSWER_STUDIO_BLOCKED_LABEL);
    let completed = false;
    try {
      await answerHandler(args, ctx);
      completed = true;
      if (keepBlockedAfterAnswer) {
        setBlocked(true, USER_RESPONSE_BLOCKED_LABEL);
      }
    } finally {
      if (!completed || !keepBlockedAfterAnswer) {
        setBlocked(false);
      }
    }
  };

  const companionPi = new Proxy(pi, {
    get(target, property, receiver) {
      if (property !== "registerCommand") {
        return Reflect.get(target, property, receiver);
      }

      return (name: string, options: CommandOptions) => {
        if (name !== ANSWER_COMMAND) {
          target.registerCommand(name, options);
          return;
        }

        answerHandler = options.handler;
        target.registerCommand(name, {
          ...options,
          handler: invokeAnswer,
        });
      };
    },
  });

  await answerStudioFactory(companionPi, {
    onSingleQuestion: () => {
      keepBlockedAfterAnswer = true;
    },
  });
  if (!answerHandler) {
    throw new Error(
      "Answer Studio did not register /answer; bundled implementation is invalid",
    );
  }

  pi.on("session_start", (_event, ctx) => {
    processedAssistantId = undefined;
    keepBlockedAfterAnswer = false;
    setBlocked(false);

    const assistant = latestCompletedAssistant(ctx);
    if (!assistant) return;

    processedAssistantId = assistant.id;
    if (inspectAssistantPrompt(assistant.text).asksQuestion) {
      setBlocked(true, USER_RESPONSE_BLOCKED_LABEL);
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const assistant = latestCompletedAssistant(ctx);
    if (!assistant || assistant.id === processedAssistantId) return;

    processedAssistantId = assistant.id;
    const prompt = inspectAssistantPrompt(assistant.text);
    if (!prompt.asksQuestion) return;

    if (!prompt.hasNumberedList) {
      setBlocked(true, USER_RESPONSE_BLOCKED_LABEL);
      return;
    }

    // Answer Studio 0.1.2 only consumes ExtensionContext members. Capturing
    // its registered handler avoids copying the companion implementation.
    await invokeAnswer("", ctx as ExtensionCommandContext);
  });

  pi.on("agent_start", () => {
    keepBlockedAfterAnswer = false;
    setBlocked(false);
  });

  pi.on("session_shutdown", () => {
    keepBlockedAfterAnswer = false;
    setBlocked(false);
  });
}
