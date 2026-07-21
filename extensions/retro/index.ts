import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RETRO_PROMPT = `Analyze the previous session. Find places the agent went in a wrong direction, only to later figure out the right way.

Make recommendations on what could have been added to the repo (for example: documentation, comments, specific files, architectural notes, workflow hints, or conventions) that would have helped the agent reach its goal faster and avoid those detours.

Create the result as a single, beautifully styled HTML file.

HTML requirements:
1. Use HTML5.
2. Load Tailwind CSS via CDN: \`<script src="https://cdn.tailwindcss.com"></script>\`.
3. Use a modern minimalist design with card layouts, generous whitespace, strong visual hierarchy, and responsive layout.
4. Use a professional palette based on Slate/Gray plus Indigo/Blue accents.
5. Prefer Tailwind utility classes directly in the markup.

Critical output instructions:
1. Do NOT print the raw HTML in the chat response.
2. First determine the current session storage folder for this working directory.
   - Pi stores sessions under \`\${PI_CODING_AGENT_SESSION_DIR:-$HOME/.pi/agent/sessions}\`.
   - Session folders are organized by working directory, using the cwd with \`/\` replaced by \`-\`, in the form: \`--<cwd-with-slashes-replaced-by-dashes>--\`.
   - Example: cwd \`/Users/me/project\` maps to session folder \`--Users-me-project--\`.
3. Inside that session folder, find the most recent \`.jsonl\` session file for the current project.
4. Save the HTML report in the SAME folder as that session file.
5. Name the report using the session filename stem plus \`.retro.html\`.
   - Example: if the session file is \`2026-07-07T12-00-00_abcd.jsonl\`, save the report as \`2026-07-07T12-00-00_abcd.retro.html\`.
6. Use tools as needed:
   - use \`bash\` to determine the folder and latest session file
   - use \`write\` to save the HTML file
7. After saving, output ONLY the final clickable file URL, exactly like:
   \`file:///absolute/path/to/the/generated-report.retro.html\`
8. If no persisted session file exists, fall back to saving \`retro.html\` in the current working directory and output its file URL only.`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("retro", {
    description: "Analyze the previous session and save a beautiful HTML retro report",
    handler: async (args, ctx) => {
        const model = ctx.modelRegistry.find("litellm", "Alter claude-sonnet-4-6");
      if (model) {
        const success = await pi.setModel(model);
        if (success) {
          ctx.ui.notify(`Switched to ${model.id} for retro`, "info");
        } else {
          ctx.ui.notify(`No API key for ${model.id}, using current model`, "warn");
        }
      } else {
        ctx.ui.notify("Alter claude-sonnet-4-6 not found, using current model", "warn");
      }

      pi.sendUserMessage(RETRO_PROMPT, { deliverAs: "followUp" });
    },
  });
}
