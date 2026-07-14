/**
 * Set a session-scoped task title on the current Herdr pane's agent label.
 *
 * Usage:
 *   /set-pane-title 任务 1
 *   /set-pane-title          (opens an input prompt)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const METADATA_SOURCE = "pi-extras:set-pane-title";

type CurrentPaneResponse = {
  result?: {
    pane?: {
      agent?: string;
      pane_id?: string;
    };
  };
};

export default function setPaneTitleExtension(pi: ExtensionAPI) {
  const paneId = process.env.HERDR_PANE_ID;
  const isInsideHerdr =
    process.env.HERDR_ENV === "1" && typeof paneId === "string" && paneId.length > 0;
  let hasOverride = false;
  let operation = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = operation.then(task, task);
    operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function runHerdr(args: string[]): Promise<string> {
    const result = await pi.exec("herdr", args, { timeout: 5_000 });
    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() || `herdr exited with code ${result.code}`,
      );
    }
    return result.stdout;
  }

  async function setTitle(title: string): Promise<string> {
    return enqueue(async () => {
      const output = await runHerdr(["pane", "current", "--pane", paneId!]);
      const response = JSON.parse(output) as CurrentPaneResponse;
      const pane = response.result?.pane;
      const agent = pane?.agent?.trim();

      if (!agent) {
        throw new Error("Herdr did not report an agent for the current pane");
      }
      if (pane.pane_id && pane.pane_id !== paneId) {
        throw new Error(`Herdr returned unexpected pane ${pane.pane_id}`);
      }

      const label = `${agent} - ${title}`;
      await runHerdr([
        "pane",
        "report-metadata",
        paneId!,
        "--source",
        METADATA_SOURCE,
        "--display-agent",
        label,
      ]);
      hasOverride = true;
      return label;
    });
  }

  async function clearTitle(force = false): Promise<void> {
    if (!isInsideHerdr || (!force && !hasOverride)) return;

    await enqueue(async () => {
      await runHerdr([
        "pane",
        "report-metadata",
        paneId!,
        "--source",
        METADATA_SOURCE,
        "--clear-display-agent",
      ]);
      hasOverride = false;
    });
  }

  pi.registerCommand("set-pane-title", {
    description: "Set the Herdr pane label to <agent> - <title>",
    handler: async (args, ctx) => {
      if (!isInsideHerdr) {
        ctx.ui.notify("This command only works inside a Herdr pane", "error");
        return;
      }

      let title = args.trim();
      if (!title && ctx.hasUI) {
        title = (await ctx.ui.input("Pane title", "例如：任务 1"))?.trim() ?? "";
      }
      if (!title) {
        ctx.ui.notify("Pane title cannot be empty", "warning");
        return;
      }

      try {
        const label = await setTitle(title);
        ctx.ui.notify(`Pane label: ${label}`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to set pane label: ${message}`, "error");
      }
    },
  });

  pi.on("session_start", async () => {
    if (!isInsideHerdr) return;
    try {
      // Remove an override left behind by an abruptly terminated Pi process.
      await clearTitle(true);
    } catch {
      // Herdr may be shutting down or the pane may already be gone.
    }
  });

  pi.on("session_shutdown", async () => {
    try {
      await clearTitle();
    } catch {
      // Closing the pane also discards its metadata, so cleanup is best-effort.
    }
  });
}
