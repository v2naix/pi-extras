import {
  CustomEditor,
  type ExtensionAPI,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

const DASHED_HORIZONTAL = "╌";

class DashedBorderEditor extends CustomEditor {
  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);

    const colorBorder = this.borderColor;
    this.borderColor = (text: string) =>
      colorBorder(text.replaceAll("─", DASHED_HORIZONTAL));
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
