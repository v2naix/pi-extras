import answerStudio from "@petechu/pi-answer-studio";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installHerdrAnswerStudio } from "./core.ts";

/**
 * A self-contained Answer Studio entry point with automatic invocation and
 * Herdr blocked-state integration. Load this instead of loading the companion
 * package as a separate extension.
 */
export default async function (pi: ExtensionAPI) {
  await installHerdrAnswerStudio(pi, answerStudio);
}
