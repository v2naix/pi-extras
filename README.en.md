# pi-extras

[中文](README.md)

A personally maintained [Pi](https://pi.dev) package for collecting, maintaining, and distributing reusable Pi skills and extensions. It contains both original resources and reviewed third-party implementations with their provenance and license notices retained.

## Installation

Install from the local development checkout:

```bash
pi install ~/.pi/pi-extras
```

You can also install the Git repository directly or manage the source through `pi-package-catalog`:

```bash
pi install git:github.com/v2naix/pi-extras
```

After resource changes, run `/reload` in Pi or restart it. Update a Git installation with `pi update --extensions`.

## Skills

| Skill | Description | Invocation and requirements |
| --- | --- | --- |
| [`pi-extras`](skills/pi-extras/SKILL.md) | Maintains the Pi resources in this repository. It collects agent-generated or externally obtained skills and extensions in the correct development repository and handles additions, reviews, modifications, replacements, and clean removals. | Loads on demand for relevant maintenance requests or explicitly with `/skill:pi-extras`; requires Git and a writable development checkout of `v2naix/pi-extras`. |
| [`pi-resource-audit`](skills/pi-resource-audit/SKILL.md) | Performs static, evidence-driven audits of Pi extensions, skills, and packages across security, privacy, correctness, quality, supply chain, and Pi API compliance. | Loads on demand for pre-installation risk assessment or local resource review, or explicitly with `/skill:pi-resource-audit`; does not execute audited code by default. |
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
| [`diff.ts`](extensions/diff.ts) | `/diff`, `/diff list`, `/diff clear` | Tracks files touched by the last agent run, lists them, or opens a selected file in Zed. | Git; opening files requires the `zed` CLI. |
| [`mac-guardrail.ts`](extensions/mac-guardrail.ts) | `tool_call` guard | Adds lightweight macOS protection to agent `bash`, `write`, and `edit` calls: blocks clearly catastrophic operations and asks before risky commands or writes outside the working directory. | macOS; confirmation-required actions fail closed in non-interactive modes. |
| [`package-catalog.ts`](extensions/package-catalog.ts) | `pi_package_catalog` tool | Lets the agent inspect, add, remove, apply, or capture shared Pi package catalog configuration while serializing mutations. | A separate `pi-package-catalog` checkout. |
| [`retro.ts`](extensions/retro.ts) | `/retro` | Analyzes detours and possible repository improvements from the latest session and writes an HTML retrospective beside the session file. | Report generation calls a model; the HTML loads Tailwind CSS from a CDN. |
| [`youtube-transcript.ts`](extensions/youtube-transcript.ts) | `youtube_transcript` tool | Downloads and cleans existing YouTube subtitles, prefers creator-provided tracks, and caches complete long transcripts locally. | `yt-dlp` and network access; analyzes subtitles only, not visuals or audio without subtitles. |

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

### macOS Guardrail

`mac-guardrail.ts` follows a low-friction policy: ordinary in-project development proceeds without prompts; recursive deletion, `sudo`, service unloading, disk utilities, and similar risky commands require one-time confirmation. Disk erasure, raw-disk writes, recursive deletion of critical system locations, disabling SIP/Gatekeeper, and direct writes to system directories, SSH/GPG credentials, keychains, and similar paths are always blocked. A plain `mac-guard` label on the right side of the status bar indicates that the extension is loaded.

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
