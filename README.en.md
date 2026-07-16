# pi-extras

[中文](README.md)

A personally maintained [Pi](https://pi.dev) package for collecting, maintaining, and distributing reusable Pi skills and extensions. It contains both original resources and reviewed third-party implementations with their provenance and license notices retained.

## Installation

When installing from the local development checkout, install runtime dependencies first; Pi does not do this for local path packages:

```bash
cd ~/.pi/pi-extras
pnpm install
pi install .
```

You can also install the Git repository directly or manage the source through `pi-package-catalog`; Git installs install runtime dependencies automatically:

```bash
pi install git:github.com/v2naix/pi-extras
```

After resource changes, run `/reload` in Pi or restart it. Update a Git installation with `pi update --extensions`.

## Skills

| Skill | Description | Invocation and requirements |
| --- | --- | --- |
| [`pi-extras`](skills/pi-extras/SKILL.md) | Maintains the Pi resources in this repository. It collects agent-generated or externally obtained skills and extensions in the correct development repository and handles additions, reviews, modifications, replacements, and clean removals. | Loads on demand for relevant maintenance requests or explicitly with `/skill:pi-extras`; requires Git and a writable development checkout of `v2naix/pi-extras`. |
| [`pi-resource-audit`](skills/pi-resource-audit/SKILL.md) | Performs static, evidence-driven audits of Pi extensions, skills, and packages across security, privacy, correctness, quality, supply chain, and Pi API compliance; defaults to fast screening and escalates for high-risk signals or explicit full-review requests. | Loads on demand for pre-installation risk assessment or local resource review, or explicitly with `/skill:pi-resource-audit`; does not execute audited code by default. |
| [`dayone-new`](skills/dayone-new/SKILL.md) | Creates local Day One entries through the official `dayone` CLI, with journals, tags, dates, time zones, all-day status, stars, coordinates, and attachments. Entry text is passed only through stdin, and creation is treated as non-idempotent. | Explicit invocation only with `/skill:dayone-new`; requires macOS, Day One, and its official CLI. |
| [`dayone-reader`](skills/dayone-reader/SKILL.md) | Searches and reads local Day One data through the independent [`v2naix/dayone-reader`](https://github.com/v2naix/dayone-reader) CLI. Supports journals, tags, recent entries, keyword search, on-this-day results, and individual entries; never modifies or deletes entries. | Explicit invocation only with `/skill:dayone-reader`; requires macOS, Day One, Python 3.11+, and the reader CLI. |

### Day One setup

`dayone-new` invokes `/usr/local/bin/dayone` by default. Set `DAYONE_CLI` to another absolute path when needed. It cannot read, modify, or delete existing entries and never creates an entry during testing.

`dayone-reader` invokes `~/.local/bin/dayone-reader` by default. Set `DAYONE_READER_CLI` to another absolute path when needed. Install the CLI with:

```bash
uv tool install git+https://github.com/v2naix/dayone-reader
```

The reader accesses the local Day One database directly. It does not use the network, create a full-text index, or read attachment contents.

## Extensions

| Extension | Interface | Description | Main requirements |
| --- | --- | --- | --- |
| [`compact-footer.ts`](extensions/compact-footer.ts) | TUI footer | Replaces the footer with a compact line showing the working directory, Git branch, session name, extension statuses, context usage, model, and thinking level. | TUI only; a Nerd Font is recommended. |
| [`copy-all.ts`](extensions/copy-all.ts) | `/copy-all` | Copies all user and assistant messages from the active session branch to the system clipboard. | macOS `pbcopy`. |
| [`dashed-editor-border.ts`](extensions/dashed-editor-border.ts) | TUI editor | Changes the input editor's top and bottom borders from solid to dashed while preserving its colors, input behavior, and shortcuts. | TUI only; do not enable it alongside another extension that replaces the editor component. |
| [`diff.ts`](extensions/diff.ts) | `/diff`, `/diff list`, `/diff clear` | Tracks files touched by the last agent run, lists them, or opens a selected file in Zed. | Git; opening files requires the `zed` CLI. |
| [`herdr-answer-studio`](extensions/herdr-answer-studio/index.ts) | `/answer`, automatic invocation, `herdr:blocked` bridge | Bundles a locally maintained Answer Studio fork: multiple questions open the answer UI, while a single question keeps the normal editor and continues synchronizing Herdr's waiting state. | Herdr with its Pi integration; do not load another Answer Studio extension separately. |
| [`set-pane-title.ts`](extensions/set-pane-title.ts) | `/set-pane-title [text]` | Temporarily sets the Herdr pane's top-left agent label to “current agent - input text”; repeated calls use the latest value, and session changes or exit clear it. | Herdr with its Pi integration; invocation without an argument requires an interactive UI. |
| [`mac-guardrail.ts`](extensions/mac-guardrail.ts) | `tool_call` guard | Adds lightweight macOS protection to agent `bash`, `write`, and `edit` calls: blocks clearly catastrophic operations and asks before risky commands or writes outside the working directory. | macOS; confirmation-required actions fail closed in non-interactive modes. |
| [`package-catalog.ts`](extensions/package-catalog.ts) | `pi_package_catalog` tool | Lets the agent inspect, add, remove, apply, or capture shared Pi package catalog configuration while serializing mutations. | A separate `pi-package-catalog` checkout. |
| [`retro.ts`](extensions/retro.ts) | `/retro` | Analyzes detours and possible repository improvements from the latest session and writes an HTML retrospective beside the session file. | Report generation calls a model; the HTML loads Tailwind CSS from a CDN. |
| [`session-digest.ts`](extensions/session-digest.ts) | `/digest [all\|ai\|tool\|user\|context]` | Filters and browses messages from the current session branch in a paged overlay; the `context` argument shows context usage and token distribution. | TUI only; displays at most the latest 500 messages per message filter and limits displayed content per entry. |
| [`skill-visibility.ts`](extensions/skill-visibility.ts) | `/skill-visibility` | Reads every skill in the current environment and provides a searchable secondary configuration screen for hiding selected skills from the system prompt while preserving `/skill:name` invocation. | Configuration UI requires TUI mode; selections are stored globally in the Pi agent directory. |
| [`todo.ts`](extensions/todo.ts) | `todo` tool, `/todos` | Pi's minimal official todo example: manages branch-local tasks through `add`, `toggle`, `list`, and `clear`, with an interactive list. | Adds no workflow prompt guidance; do not enable it alongside another extension that registers `todo` or `/todos`. |
| [`youtube-transcript.ts`](extensions/youtube-transcript.ts) | `youtube_transcript` tool | Downloads and cleans existing YouTube subtitles, prefers creator-provided tracks, and caches complete long transcripts locally. | `yt-dlp` and network access; analyzes subtitles only, not visuals or audio without subtitles. |

### Skill system-prompt visibility

Pi's current extension API cannot register nested menus inside the built-in `pi config` UI. Enable `skill-visibility.ts` in `pi config`, then open the extension's own secondary configuration screen with `/skill-visibility`. The screen reads all user, project, and package skills loaded in the current session, supports search, and persists each choice by the skill file path.

A skill set to “manual invocation only” is removed from the model-visible `<available_skills>` list while `/skill:name` remains available. Configuration is written to `~/.pi/agent/skill-visibility.json` (the actual location follows Pi's agent directory), so no third-party skill file is modified and package updates do not erase the selection. Skills that already declare `disable-model-invocation: true` are shown as intrinsically hidden and are not overridden in the opposite direction.

### Session Digest

The message browser in `session-digest.ts` is adapted from `disler/pi-vs-claude-code` at commit `32dfe122cb6d444e91c68b32597274a725d81fa3`; its context-usage view is adapted from `ttttmr/pi-context` v2.1.0. The relevant MIT license and attribution are retained in [`extensions/session-digest.LICENSE`](extensions/session-digest.LICENSE). This collected version uses the current Pi package imports, removes the source project's theme-map dependency, and adds content bounds, terminal-control sanitization, sensitive tool-argument redaction, configurable keybindings, and bounded pagination. `/digest` opens the User view by default and accepts `all`, `ai`, `tool`, `user`, or `context` to open a specific view. Both the message and context views provide `A`, `U`, `T`, `C`, and `D` shortcuts for switching directly to AI, User, Tool, Context, or All; tool-call and user-turn footer counts are no longer shown. `/digest context` shows the same style of context-usage grid as `pi-context`'s `/context`, estimating token distribution across System Prompt, System Tools, Tool Call, Messages, Other, and Available. The message list follows the context view's restrained palette: AI uses the accent color, Tool uses the success color, User uses the normal text color, and message previews have stronger contrast. In the All view, User and AI entries are distinguished by `[user]` and `[ai]`, followed only by the full timestamp and elapsed time—never `User Prompt` or `Assistant`; Tool entries keep the tool name for identification. The dedicated User and AI views omit labels and full timestamps and show only elapsed time without a plus sign or parentheses; the first entry shows `0s` when no predecessor exists. A dashed rule fills the space before each duration, aligning it to the right edge and making message boundaries clearer. Times use the machine's local time zone and always display as `00:00:00`–`23:59:59`.

The extension only reads the current session branch; it does not write session data or access the network. Tool results may themselves contain sensitive material, so take care before expanding details while screen sharing or around observers.

### Minimal todo

`todo.ts` is vendored unchanged from the [official todo example](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/examples/extensions/todo.ts) in `@earendil-works/pi-coding-agent` v0.80.6. The original file's SHA-256 is `e46824d00217e25242c186d41837cc84ca81b23f978500323448502a9a424ee2`, and its upstream MIT license is retained in [`extensions/todo.LICENSE`](extensions/todo.LICENSE). It registers only a compact tool definition, with no `promptSnippet` or `promptGuidelines`; task state lives in tool result details so it follows the active session branch.

The extension conflicts with other extensions that use the `todo` tool name or `/todos` command name. Load it in isolation for a temporary trial, and disable `@juicesharp/rpiv-todo` or any other conflicting extension before enabling it normally.

### Package Catalog setup

`package-catalog.ts` invokes the following script by default:

```text
~/.pi/pi-package-catalog/scripts/catalog.ts
```

Set `PI_PACKAGE_CATALOG_DIR` if the catalog is installed elsewhere. The tool supports:

- `status`: show enablement on the current machine;
- `add` / `remove`: add or remove shared package sources;
- `apply`: merge the shared catalog and machine-local choices into Pi settings;
- `capture`: save machine-local choices after the user has run `pi config` directly and changed resource selections.

The user should run the interactive `pi config` flow directly in a terminal; the tool intentionally does not start a nested Pi TUI.

### Herdr questionnaire state bridge

`herdr-answer-studio` is an integrated entry point. It bundles a locally maintained fork based on `@petechu/pi-answer-studio` 0.1.2, no longer depends on that npm package, and routes both manual `/answer` and automatic invocation through the same controlled handler. When the text editor is active, unmodified left/right arrows move the text cursor; when the choices UI is active, they still change questions, and `Tab` / `Shift+Tab` remain available for question navigation. After the agent fully settles, a question mark or a common Chinese or English request-for-input phrase opens Answer Studio directly; the literal `/answer` is never sent to the model as a user message. Herdr reports `blocked` while either entry path owns the UI, returns to `working` when submission starts the follow-up agent, and clears the override after cancellation, empty extraction, or failure so Herdr can return to `done` or `idle`. Each assistant message is triggered at most once per runtime. Do not also load another Answer Studio extension, or Pi will register duplicate commands. It does not modify Herdr's managed integration file. Without the Herdr integration, sidebar state synchronization has no visible effect; reinstalling or updating that integration does not require reapplying this extension. Source attribution and MIT terms are in [`extensions/herdr-answer-studio/answer-studio.LICENSE`](extensions/herdr-answer-studio/answer-studio.LICENSE).

### macOS Guardrail

`mac-guardrail.ts` follows a low-friction policy: ordinary in-project development proceeds without prompts; recursive deletion, `sudo`, service unloading, disk utilities, and similar risky commands require one-time confirmation. Disk erasure, raw-disk writes, recursive deletion of critical system locations, disabling SIP/Gatekeeper, and direct writes to system directories, SSH/GPG credentials, keychains, and similar paths are always blocked. A theme-aware `mac-guard` label on the right side of the status bar indicates that the extension is loaded.

This is defense in depth, not a macOS sandbox. It cannot reliably understand every obfuscated shell command, code executed inside an interpreter, or the side effects of unknown third-party tools, so it cannot mathematically guarantee that the system will never be damaged. Keep independent backups such as Time Machine, and use a container, virtual machine, or OS-level sandbox when stronger isolation is required.

## Repository structure

```text
extensions/   Pi extensions
skills/       Pi skills and their scripts, references, and assets
```

The package may add `prompts/` and `themes/` when needed. Pi loads resources through the `pi` manifest in [`package.json`](package.json).

## Security and maintenance

- Extensions execute with the current user's permissions, and skills can instruct the agent to run commands. Review provenance and implementation before use.
- When importing third-party resources, verify the license, retain attribution, and inspect dependencies, subprocesses, network access, credential handling, and filesystem writes.
- The writable `v2naix/pi-extras` development checkout is the source of truth. Do not edit Pi-managed clones under `~/.pi/agent/git/` or `~/.pi/agent/npm/`.
- Do not trigger network-dependent, destructive, or non-idempotent behavior merely for testing.

This repository is licensed under the [MIT License](LICENSE). Adapted third-party files may contain their own retained copyright and license notices.
