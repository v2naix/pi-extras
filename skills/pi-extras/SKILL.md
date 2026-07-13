---
name: pi-extras
description: Understands, uses, and maintains this pi-extras Pi package, including its bundled extensions, slash commands, custom tools, package manifest, installation flow, dependencies, and safety constraints. Use when explaining this repository, choosing one of its Pi features, or adding, changing, debugging, testing, or documenting resources in pi-extras.
license: MIT
compatibility: Pi coding agent with Node.js; some extensions additionally require macOS, Zed, yt-dlp, or the external pi-package-catalog repository.
---

# pi-extras

Treat this repository as a personal Pi package, not as a conventional application. It bundles independent resources that Pi loads from the paths declared under `package.json#pi`.

## Start Here

Before changing anything:

1. Read `package.json` and `README.md`.
2. Read the complete target file under `extensions/`.
3. Check nearby resources for repository conventions, but do not couple otherwise independent extensions.
4. For Pi API questions, read the installed Pi documentation rather than guessing:
   - `docs/extensions.md` for extensions, commands, tools, events, and UI
   - `docs/skills.md` for skills
   - `docs/packages.md` for package manifests and installation
   Resolve these below the installed `@earendil-works/pi-coding-agent` package.

## Resource Inventory

| Resource | Pi-facing behavior | Runtime constraints |
| --- | --- | --- |
| `extensions/compact-footer.ts` | Replaces the TUI footer with cwd/git/session/status, context usage, and model details | TUI only; uses Nerd Font glyphs |
| `extensions/copy-all.ts` | `/copy-all` copies user and assistant messages from the active branch | macOS `pbcopy` |
| `extensions/diff.ts` | Tracks files touched by the last agent run; `/diff`, `/diff list`, `/diff clear` inspect/open them | Git for status; Zed CLI `zed` for opening |
| `extensions/package-catalog.ts` | Registers the model-callable `pi_package_catalog` tool | External `~/.pi/pi-package-catalog` or `PI_PACKAGE_CATALOG_DIR` |
| `extensions/retro.ts` | `/retro` asks the agent to create an HTML retrospective beside the latest session file | Preferred model may be unavailable; generated HTML loads Tailwind from CDN |
| `extensions/youtube-transcript.ts` | Registers `youtube_transcript` to download and clean existing YouTube subtitles | `yt-dlp`; subtitles only, no visual analysis |
| `skills/pi-extras/SKILL.md` | Gives Pi this repository-specific operating guide | Loaded through the package manifest |
| `skills/dayone-reader/SKILL.md` | Searches and reads local Day One journals through the independently installed `v2naix/dayone-reader` CLI | macOS, Day One, Python 3.11+, installed reader CLI; creation requires official `dayone` CLI |

## Choose and Use the Existing Feature

- For catalog `status`, `add`, `remove`, `apply`, or eligible `capture` requests, use `pi_package_catalog`; do not directly edit catalog state files.
- Use catalog `capture` only after the user has directly changed resource selections with `pi config`.
- For a YouTube summary, use `youtube_transcript` first when available, summarize its returned text, and disclose that visual-only content was not analyzed.
- Slash commands are interactive user features. Explain the exact command rather than pretending it is a model-callable tool.
- Do not claim optional integrations are portable: `copy-all` is macOS-specific and `diff` opens Zed.

## Modification Workflow

1. Identify whether the request needs an extension, skill, prompt, theme, or documentation change.
2. Keep a small feature as one standalone file. Introduce a directory only when helpers or state make that clearer.
3. Preserve existing command and tool names unless the user explicitly requests a breaking change.
4. Update the inventory in this skill and `README.md` when user-visible behavior, setup, or prerequisites change.
5. If adding a resource type or a non-conventional path, update `package.json#pi`. A manifest entry must point at the actual package-relative directory.
6. Review `git diff` and report platform assumptions and untested interactive behavior.

## Extension Conventions

- For new code, import Pi APIs from `@earendil-works/pi-coding-agent`; use `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, and `typebox` where appropriate.
- Export a default extension factory receiving `ExtensionAPI`.
- Use `StringEnum` for string-enum tool parameters and TypeBox for schemas.
- Throw from tool `execute` to signal failure. Return concise model-facing `content` plus structured `details` when useful.
- Pass abort signals and finite timeouts to external work. Give actionable missing-command errors.
- Truncate potentially large tool output with Pi's truncation helpers and state where full output was saved.
- Assume sibling tool calls can execute concurrently. Serialize shared read-modify-write state; use Pi's file mutation queue when a custom tool mutates files.
- Start long-lived resources at `session_start` or on demand, and release them at `session_shutdown`.
- Guard terminal rendering with `ctx.mode === "tui"`; guard dialogs/notifications with `ctx.hasUI` when non-interactive modes matter.
- Treat extensions and skill instructions as full-user-permission code. Validate untrusted URLs, paths, and subprocess arguments.
- Do not add bundled Pi core packages as ordinary runtime dependencies. If the package needs to declare them, use `peerDependencies` with `"*"`; put true third-party runtime modules in `dependencies`.

## Verification

Run checks appropriate to the change:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")); console.log("package.json ok")'
git diff --check
git status --short
```

For an extension, quick-test only that file when practical:

```bash
pi -e ./extensions/<name>.ts
```

This is an interactive smoke test, not an automated test suite. Exercise the affected command/tool, including cancellation, missing dependencies, empty results, and non-zero subprocess exits. After changing resources in an active local installation, use `/reload` or restart Pi. Validate skill frontmatter (`name`, `description`) and confirm `/skill:pi-extras` appears when skill commands are enabled.

Do not invoke network-dependent behavior merely to test it unless the user asks. Do not publish, install globally, or modify external catalog/settings state without explicit user intent.
