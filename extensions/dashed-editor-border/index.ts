import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DASHED_HORIZONTAL = "╌";

class DashedBorderEditor extends CustomEditor {
  render(width: number): string[] {
    return super
      .render(width)
      .map((line) => line.replaceAll("─", DASHED_HORIZONTAL));
  }
}

export default function dashedEditorBorderExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new DashedBorderEditor(tui, theme, keybindings),
    );
  });
}
