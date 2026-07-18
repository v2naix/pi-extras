import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

type Context = ExtensionCommandContext | ExtensionContext;

type CodeBlock = {
  index: number;
  language: string;
  code: string;
};

type MessageBlocks = {
  label: string;
  blocks: CodeBlock[];
};

const messageCap = 10;

function assistantText(entry: unknown): string {
  if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "message" || !("message" in entry)) {
    return "";
  }

  const message = entry.message;
  if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant" || !("content" in message)) {
    return "";
  }

  const { content } = message;
  if (!Array.isArray(content)) return "";

  return content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(part) && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let fence: { character: "`" | "~"; length: number } | undefined;
  let language = "";
  let lines: string[] = [];

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (!fence) {
      const match = line.match(/^[ \t]*(`{3,}|~{3,})([^\r\n]*)$/);
      if (!match) continue;

      fence = { character: match[1][0] as "`" | "~", length: match[1].length };
      language = match[2].trim().split(/\s+/)[0] || "";
      lines = [];
      continue;
    }

    const closer = new RegExp(`^[ \\t]*${fence.character}{${fence.length},}[ \\t]*$`);
    if (closer.test(line)) {
      blocks.push({ index: blocks.length + 1, language, code: lines.join("\n") });
      fence = undefined;
      language = "";
      lines = [];
    } else {
      lines.push(line);
    }
  }

  return blocks;
}

function recentMessages(ctx: Context): MessageBlocks[] {
  const manager = ctx.sessionManager as { getBranch?: () => unknown[]; getEntries: () => unknown[] };
  const entries = manager.getBranch?.() ?? manager.getEntries();
  const withCode = entries
    .map(assistantText)
    .map(extractCodeBlocks)
    .filter((blocks) => blocks.length > 0)
    .slice(-messageCap);

  return withCode.map((blocks, index) => ({
    label: index === withCode.length - 1 ? "当前回复" : `之前回复 ${withCode.length - index - 1}`,
    blocks,
  }));
}

function displayBlock(block: CodeBlock): string {
  const firstLine = block.code.split("\n").find((line) => line.trim())?.trim().slice(0, 56) || "(空代码块)";
  const lineCount = block.code === "" ? 0 : block.code.split("\n").length;
  return `${block.index}. ${block.language || "text"}，${lineCount} 行：${firstLine}`;
}

function clipboardCommands(): Array<[string, string[]]> {
  if (process.platform === "darwin") return [["pbcopy", []]];
  if (process.platform === "win32") return [["clip.exe", []]];
  if (process.env.WAYLAND_DISPLAY) {
    return [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  }
  return [["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]], ["wl-copy", []]];
}

function copyToClipboard(text: string): string {
  for (const [command, args] of clipboardCommands()) {
    const result = spawnSync(command, args, { input: text, encoding: "utf8", stdio: ["pipe", "ignore", "ignore"] });
    if (!result.error && result.status === 0) return command;
  }

  // OSC 52 is deliberately bounded: some terminals have small clipboard limits.
  const encoded = Buffer.from(text, "utf8").toString("base64");
  if (encoded.length > 100_000) throw new Error("未找到系统剪贴板工具，且内容过大，不能使用 OSC 52");
  process.stdout.write(`\u001b]52;c;${encoded}\u0007`);
  return "OSC 52";
}

async function editCode(code: string, ctx: Context): Promise<string | undefined> {
  // Use Pi's editor rather than executing $EDITOR: no temporary sensitive file,
  // shell parsing, or subprocess is needed.
  return ctx.ui.editor("编辑代码；保存后复制", code);
}

async function chooseCode(messages: MessageBlocks[], ctx: Context): Promise<string | undefined> {
  let message = messages.at(-1);
  if (!message) return undefined;

  if (messages.length > 1) {
    const chosenMessage = await ctx.ui.select("选择包含代码的回复", messages.slice().reverse().map((item) => item.label));
    if (!chosenMessage) return undefined;
    message = messages.find((item) => item.label === chosenMessage);
    if (!message) return undefined;
  }

  if (message.blocks.length === 1) return message.blocks[0].code;

  const all = message.blocks.map((block) => block.code).join("\n\n");
  const selected = await ctx.ui.select("选择要复制的代码块", [
    `全部代码块（${message.blocks.length} 个）`,
    ...message.blocks.map(displayBlock),
  ]);
  if (!selected) return undefined;
  return selected.startsWith("全部代码块") ? all : message.blocks.find((block) => displayBlock(block) === selected)?.code;
}

export default function copyCodeExtension(pi: ExtensionAPI) {
  async function run(args: string, ctx: Context): Promise<void> {
    if ("waitForIdle" in ctx) await ctx.waitForIdle();

    const mode = args.trim().toLowerCase();
    if (mode && mode !== "edit") {
      ctx.ui.notify("用法：/copy-code [edit]", "warning");
      return;
    }

    const messages = recentMessages(ctx);
    if (messages.length === 0) {
      ctx.ui.notify("最近的 Assistant 回复中没有 fenced code block", "warning");
      return;
    }

    let code = await chooseCode(messages, ctx);
    if (code === undefined) return;

    if (mode === "edit") {
      code = await editCode(code, ctx);
      if (code === undefined) {
        ctx.ui.notify("编辑已取消，未复制", "info");
        return;
      }
    }

    try {
      const via = copyToClipboard(code);
      const lines = code === "" ? 0 : code.split("\n").length;
      ctx.ui.notify(`已通过 ${via} 复制 ${lines} 行代码`, "info");
    } catch (error) {
      ctx.ui.notify(`复制失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  pi.registerCommand("copy-code", {
    description: "复制最近 Assistant 回复中的 fenced code block；可传 edit 后编辑再复制",
    handler: run,
  });
  pi.registerShortcut("ctrl+alt+c", {
    description: "复制最近 Assistant 回复中的 fenced code block",
    handler: (ctx) => run("", ctx),
  });
}
