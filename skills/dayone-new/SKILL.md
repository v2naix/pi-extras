---
name: dayone-new
description: Creates entries in the local Day One app through its official dayone CLI, with journals, tags, dates, time zones, all-day status, stars, coordinates, and attachments. Use only when the user asks to write, save, add, or log a Day One entry.
disable-model-invocation: true
license: MIT
compatibility: macOS with Day One installed and its official dayone CLI available at /usr/local/bin/dayone or DAYONE_CLI.
---

# Day One New

Use this skill's `scripts/dayone` wrapper, resolving the path relative to this `SKILL.md`. It executes only the fixed `/usr/local/bin/dayone` default or an absolute path in `$DAYONE_CLI`; it never searches `PATH`. The official CLI's `$DAYONE_APP_PATH` override remains available.

The CLI can create entries but cannot read, update, or delete them. Use `dayone-reader` for local journal lookup when that separate skill and CLI are available. If the wrapper reports a missing executable, stop and explain that the official CLI must be installed or enabled from Day One. Do not install anything unless the user explicitly asks.

## Safety

- Create an entry only after an explicit user request. If the user asks for a draft or their intent is ambiguous, return proposed text without invoking the CLI.
- Treat creation as non-idempotent. Invoke the CLI exactly once per requested entry. If the result is interrupted or uncertain, do not retry automatically; ask the user to check Day One first to avoid duplicates.
- Never create a test entry while checking this skill. Use only `--help` or `--version` for diagnostics.
- Never put entry text in command arguments, shell source, logs, or environment variables. Provide it through standard input.
- Do not add tags, a journal, dates, location, stars, or attachments unless requested or already unambiguous from context. Confirm ambiguous dates, time zones, journal names, and locations before creation.
- Attach only files the user explicitly selected. Check that each path is the intended readable file; the CLI accepts at most 10 attachments.
- Report the CLI's actual success or error. Do not claim that an entry was created after a non-zero or uncertain result.

## Private stdin workflow

When the execution tool cannot directly supply stdin:

1. Create an empty private temporary file and note the returned path:

   ```bash
   umask 077; mktemp "${TMPDIR:-/tmp}/pi-dayone.XXXXXX"
   ```

2. Put the entry body into that file with a direct file-writing tool, not a shell command.
3. Redirect the file to the wrapper and always remove it afterward:

   ```bash
   draft='/exact/path/returned/above'
   trap 'rm -f -- "$draft"' EXIT HUP INT TERM
   /absolute/path/to/this/skill/scripts/dayone [options] new < "$draft"
   ```

Preserve the user's wording and line breaks unless they asked for editing. An empty body is valid only when the user clearly intends an attachment-only or otherwise blank entry.

## Command construction

All options precede `new`. The body comes from stdin:

```bash
/absolute/path/to/this/skill/scripts/dayone [options] new < "$draft"
```

This option reference was verified against the currently installed official CLI, version `2026.13.1764`. If another machine has a different version, inspect the non-mutating `--help` output before relying on version-sensitive behavior.

| Purpose | Syntax |
| --- | --- |
| Existing journal | `-j "Journal Name"` or `--journal "Journal Name"` |
| One or more tags | `-t "tag one" "tag two"` or `--tags ...` |
| Local date/time | `-d "yyyy-mm-dd [hh:mm[:ss]] [AM\|PM]"` or `--date ...` |
| UTC ISO 8601 date | `--isoDate=yyyy-mm-ddThh:mm:ssZ` |
| Entry time zone | `-z "Area/Location"` or `--time-zone "Area/Location"`; GMT offsets are also accepted |
| All-day entry | `--all-day` |
| Starred entry | `-s` or `--starred` |
| Location | `--coordinate LATITUDE LONGITUDE` |
| Attachments | `-a "/path/one" "/path/two"` or `--attachments ...` |

Tags and attachments consume one or more following values. Put a final `--` before `new` when either list is the last option, so the command is not consumed as another value:

```bash
/absolute/path/to/this/skill/scripts/dayone \
  -j "Personal" -s -t "reflection" "weekly review" -- \
  new < "$draft"
```

For attachments, supported categories are photo/image, video, audio, and PDF. The body may contain the literal `[{attachment}]` placeholder to position an attachment; otherwise let Day One place it normally.

Use `--date` for a user-local date and `--isoDate` only when the user supplied or requested an exact UTC instant. Add `--time-zone` only when the intended entry time zone is known. `--all-day` ignores specific times.

For diagnostics, `-h`/`--help` (or the `help` command) prints usage, `-v`/`--version` prints the loaded CLI version, and `--verbose` adds stderr logging. Although the official CLI accepts positional body text and `--no-stdin`, this skill must not use either: keep the body on stdin.
