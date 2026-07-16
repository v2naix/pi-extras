import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const ANSWER_COMMAND = "answer";
const HERDR_BLOCKED_EVENT = "herdr:blocked";
const BLOCKED_LABEL = "Waiting for Answer Studio response";

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

/**
 * Keep this deliberately conservative: Answer Studio performs the authoritative
 * extraction after the bridge sees a likely question.
 */
export function likelyAsksForInput(text: string): boolean {
  if (/[?？]/u.test(text)) return true;

  return text.split("\n").some((line) => {
    const trimmed = line
      .trim()
      .replace(/^(?:[-*+] |\d+[.)]\s*|#{1,6}\s*)/u, "");
    return /^(?:请(?:选择|确认|告诉|提供|回答)|你(?:希望|想要|是否|能否)|您(?:希望|是否|能否)|是否|要不要|哪(?:个|些|种|一)|what\b|which\b|would you|do you|should (?:i|we)|can you|could you|please (?:choose|confirm|provide|tell|select))/iu.test(
      trimmed,
    );
  });
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
  let studioActive = false;
  let keepBlockedAfterAnswer = false;

  const setStudioActive = (active: boolean) => {
    if (active === studioActive) return;
    studioActive = active;
    pi.events.emit(HERDR_BLOCKED_EVENT, {
      active,
      ...(active ? { label: BLOCKED_LABEL } : {}),
    });
  };

  const invokeAnswer = async (
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> => {
    if (!answerHandler) {
      throw new Error("Answer Studio /answer handler is unavailable");
    }

    keepBlockedAfterAnswer = false;
    setStudioActive(true);
    let completed = false;
    try {
      await answerHandler(args, ctx);
      completed = true;
    } finally {
      if (!completed || !keepBlockedAfterAnswer) {
        setStudioActive(false);
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

  pi.on("session_start", () => {
    processedAssistantId = undefined;
    keepBlockedAfterAnswer = false;
    setStudioActive(false);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const assistant = latestCompletedAssistant(ctx);
    if (
      !assistant ||
      assistant.id === processedAssistantId ||
      !likelyAsksForInput(assistant.text)
    ) {
      return;
    }

    processedAssistantId = assistant.id;
    // Answer Studio 0.1.2 only consumes ExtensionContext members. Capturing
    // its registered handler avoids copying the companion implementation.
    await invokeAnswer("", ctx as ExtensionCommandContext);
  });

  pi.on("agent_start", () => {
    keepBlockedAfterAnswer = false;
    if (studioActive) setStudioActive(false);
  });

  pi.on("session_shutdown", () => {
    keepBlockedAfterAnswer = false;
    setStudioActive(false);
  });
}
