import answerStudio from "./answer-studio/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installHerdrAnswerStudio } from "./core.ts";

/**
 * A self-contained Answer Studio entry point with automatic invocation and
 * Herdr blocked-state integration. Load this instead of another Answer Studio
 * extension.
 */
export default async function (pi: ExtensionAPI) {
  await installHerdrAnswerStudio(pi, answerStudio);
}
