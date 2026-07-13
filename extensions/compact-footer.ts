import { basename, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

function formatCwd(cwd: string): string {
  const current = resolve(cwd);
  return basename(current) || current;
}

function sanitize(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          let location = formatCwd(ctx.cwd);
          const branch = footerData.getGitBranch();
          if (branch) location += ` (${branch})`;

          const sessionName = ctx.sessionManager.getSessionName();
          if (sessionName) location += ` • ${sessionName}`;

          const statuses = [...footerData.getExtensionStatuses().entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => sanitize(text));
          if (statuses.length > 0) location += ` • ${statuses.join(" ")}`;
          location = ` ${location}`;

          const usage = ctx.getContextUsage();
          const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const percent = usage?.percent;
          const percentText = percent == null ? "?" : `${percent.toFixed(1)}%`;
          const contextColor = percent != null && percent > 90
            ? "error"
            : percent != null && percent > 70
              ? "warning"
              : "accent";
          const context = theme.fg(contextColor, theme.bold(percentText))
            + theme.fg("dim", `/${formatTokens(contextWindow)} (auto)`);

          const modelName = ctx.model?.id ?? "no-model";
          const thinking = ctx.model?.reasoning ? pi.getThinkingLevel() : undefined;
          let modelText = thinking
            ? `${modelName} • ${thinking === "off" ? "thinking off" : thinking}`
            : modelName;
          if (ctx.model && footerData.getAvailableProviderCount() > 1) {
            modelText += ` (${ctx.model.provider})`;
          }
          modelText = ` ${modelText}`;

          // Keep context usage first and visible; location and model yield space on narrow terminals.
          const separator = "   ";
          const contextWidth = visibleWidth(context);
          if (width <= contextWidth) return [truncateToWidth(context, width, "")];

          const flexibleWidth = Math.max(0, width - contextWidth - visibleWidth(separator) * 2);
          const cappedModelWidth = Math.min(visibleWidth(modelText), Math.ceil(flexibleWidth * 0.6));
          const locationWidth = Math.min(visibleWidth(location), flexibleWidth - cappedModelWidth);
          const modelWidth = Math.min(visibleWidth(modelText), flexibleWidth - locationWidth);
          const left = truncateToWidth(theme.fg("dim", location), locationWidth, theme.fg("dim", "…"));
          const right = truncateToWidth(theme.fg("dim", modelText), modelWidth, "");
          const segments = [context, left, right].filter((part) => visibleWidth(part) > 0);

          return [truncateToWidth(segments.join(separator), width, "")];
        },
      };
    });
  });
}
