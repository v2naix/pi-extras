import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ASK_USER_TOOL = "ask_user_question";
const HERDR_BLOCKED_EVENT = "herdr:blocked";
const BLOCKED_LABEL = "Waiting for questionnaire response";

/**
 * Bridges the third-party rpiv questionnaire tool to Herdr's Pi integration.
 *
 * Herdr's managed Pi extension listens for `herdr:blocked`, while
 * @juicesharp/rpiv-ask-user-question exposes only a prompt-open event and no
 * matching prompt-close event. The Pi tool lifecycle therefore provides the
 * reliable start/end pair needed to avoid leaving Herdr in a stale state.
 */
export default function (pi: ExtensionAPI) {
  const activeCalls = new Set<string>();

  pi.on("tool_execution_start", (event) => {
    if (event.toolName !== ASK_USER_TOOL || activeCalls.has(event.toolCallId)) {
      return;
    }

    activeCalls.add(event.toolCallId);
    pi.events.emit(HERDR_BLOCKED_EVENT, {
      active: true,
      label: BLOCKED_LABEL,
    });
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== ASK_USER_TOOL || !activeCalls.delete(event.toolCallId)) {
      return;
    }

    pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
  });

  pi.on("session_shutdown", () => {
    for (const _toolCallId of activeCalls) {
      pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
    }
    activeCalls.clear();
  });
}
