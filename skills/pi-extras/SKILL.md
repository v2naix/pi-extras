---
name: pi-extras
description: Understands, uses, and maintains this pi-extras Pi package, including its bundled extensions, slash commands, custom tools, package manifest, installation flow, dependencies, and safety constraints. Use when explaining this repository, choosing one of its Pi features, or adding, changing, debugging, testing, or documenting resources in pi-extras.
disable-model-invocation: true
license: MIT
compatibility: Pi coding agent with Node.js; some extensions additionally require macOS, Zed, yt-dlp, network access, local Codex CLI sessions, or the external pi-package-catalog repository.
---

# pi-extras

Treat this repository as a personal Pi package, not as a conventional application. It bundles independent resources that Pi loads from the paths declared under `package.json#pi`.

## Repository Identity and Write Target

This skill may be loaded from Pi's managed Git package clone at `~/.pi/agent/git/github.com/v2naix/pi-extras`. That directory is a disposable runtime installation, not the development checkout. Pi may reset and clean it during package reconciliation.

For every request that adds, imports, changes, removes, tests, documents, commits, or publishes a pi-extras resource:

1. Use `$PI_EXTRAS_REPO` when it is set; otherwise use `~/.pi/pi-extras` as the canonical development checkout.
2. Resolve the target with `git -C <target> rev-parse --show-toplevel` and verify that `remote.origin.url` identifies `v2naix/pi-extras` before writing.
3. Never write, copy files, commit, or push from any path under `~/.pi/agent/git/` or `~/.pi/agent/npm/`, even when this `SKILL.md` was loaded from there.
4. If the canonical checkout is missing, has the wrong remote, or contains unrelated changes that make the requested edit unsafe, stop and explain the problem. Do not fall back to the managed clone.
5. Resolve repository-relative paths such as `package.json`, `README.md`, `extensions/`, and `skills/` against the verified canonical checkout, not against this skill's installed location.

In this personal collection, a request to “收录”, import, or add a resource means to make it durable in the canonical repository: review its source and license, add it there, update the relevant inventory/documentation, validate it, commit the requested changes, and push the current branch to `origin` unless the user explicitly asks for a local-only change. Do not manually synchronize the managed clone; use Pi's package update flow and `/reload` or a restart when the installed copy also needs refreshing.

## Start Here

Before changing anything:

1. Locate and verify the canonical development checkout as described above.
2. Read its `package.json` and `README.md`.
3. Read the complete target resource under `extensions/`, `skills/`, or the relevant resource directory.
4. Check nearby resources for repository conventions, but do not couple otherwise independent resources.
5. For Pi API questions, read the installed Pi documentation rather than guessing:
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
| `extensions/usage.ts` | `/usage` asks the agent to summarize Pi and Codex CLI token usage and estimated cost over 1, 7, 30, and 90 days | Reads local session JSONL; current pricing lookup requires models.dev network access |
| `extensions/youtube-transcript.ts` | Registers `youtube_transcript` to download and clean existing YouTube subtitles | `yt-dlp`; subtitles only, no visual analysis |
| `skills/pi-extras/SKILL.md` | Gives Pi this repository-specific operating guide | Loaded through the package manifest |
| `skills/dayone-new/SKILL.md` | Creates local Day One entries through the official `dayone` CLI | macOS, Day One, official CLI; creation is non-idempotent |
| `skills/dayone-reader/SKILL.md` | Searches and reads local Day One journals through the independently installed `v2naix/dayone-reader` CLI | macOS, Day One, Python 3.11+, installed reader CLI |

## Choose and Use the Existing Feature

- For catalog `status`, `add`, `remove`, `apply`, or eligible `capture` requests, use `pi_package_catalog`; do not directly edit catalog state files.
- Use catalog `capture` only after the user has directly changed resource selections with `pi config`.
- For a YouTube summary, use `youtube_transcript` first when available, summarize its returned text, and disclose that visual-only content was not analyzed.
- `/usage` is an interactive slash command that delegates local session parsing and models.dev pricing lookup to the agent; it is not a model-callable reporting tool.
- Use `dayone-new` only for explicit entry-creation requests and `dayone-reader` for journal lookup; never retry an uncertain creation automatically.
- Slash commands are interactive user features. Explain the exact command rather than pretending it is a model-callable tool.
- Do not claim optional integrations are portable: `copy-all` is macOS-specific and `diff` opens Zed.

## Modification Workflow

1. Identify whether the request needs an extension, skill, prompt, theme, or documentation change.
2. Keep a small feature as one standalone file. Introduce a directory only when helpers or state make that clearer.
3. Preserve existing command and tool names unless the user explicitly requests a breaking change.
4. Update the inventory in this skill and `README.md` when user-visible behavior, setup, or prerequisites change.
5. If adding a resource type or a non-conventional path, update `package.json#pi`. A manifest entry must point at the actual package-relative directory.
6. Review `git status` and `git diff` in the canonical checkout and report platform assumptions and untested interactive behavior.
7. For a “收录”, import, or add request, commit only the intended files and push to `origin` after validation. For ordinary debugging or local edits, do not commit or push unless requested.

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

Do not invoke network-dependent behavior merely to test it unless the user asks. A “收录”, import, add-and-publish, or explicit push request supplies intent to commit and push this repository; otherwise do not publish, install globally, or modify external catalog/settings state without explicit user intent.
