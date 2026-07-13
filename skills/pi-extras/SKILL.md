---
name: pi-extras
description: Curates reusable Pi skills and extensions in the canonical v2naix/pi-extras repository. Use when an agent has created or obtained a Pi resource that should be collected there, or when adding, importing, modifying, replacing, or removing a skill or extension from that collection.
license: MIT
compatibility: Pi coding agent with Git and a writable canonical checkout of v2naix/pi-extras.
---

# Maintain pi-extras

Use this skill to maintain the `pi-extras` collection. Its job is repository curation: place reusable Pi resources in the correct development repository, keep them maintainable, and remove them cleanly when no longer wanted.

Do not use this skill as an inventory of the collection. Discover current resources from the verified checkout, `package.json`, and the filesystem; do not add a list of bundled resources to this file.

## Find the Correct Repository

This skill may be loaded from a managed Pi package clone. Managed clones are runtime installations and may be reset or cleaned by Pi, so they are never valid write targets.

1. Use `$PI_EXTRAS_REPO` when set; otherwise use `~/.pi/pi-extras`.
2. Resolve it with `git -C <target> rev-parse --show-toplevel`.
3. Verify that `git -C <target> remote get-url origin` identifies `v2naix/pi-extras`.
4. Perform all reads, writes, tests, Git operations, and repository-relative path resolution from that verified root.
5. Never modify a copy under `~/.pi/agent/git/` or `~/.pi/agent/npm/`.
6. If the canonical checkout is missing, points to another repository, or has unrelated changes that make the operation unsafe, stop and explain instead of falling back to an installed copy.

Before collecting a resource here, confirm that this is its correct home:

- Put reusable personal Pi resources in `pi-extras`.
- Keep project-specific resources in that project's repository.
- Keep an independently maintained application or library in its own source repository; include only the Pi-facing integration here when appropriate.
- Do not edit installed package clones or external package-catalog/settings state as a substitute for changing the source repository.

## Inspect Before Changing

1. Read `AGENTS.md`, `package.json`, and the relevant repository documentation.
2. Read the complete resource and its scripts, references, assets, tests, and neighboring files that establish conventions.
3. For a generated or third-party resource, inspect the source before running it. Check provenance, license, dependencies, subprocesses, network access, credential handling, filesystem writes, and platform assumptions.
4. Read the installed Pi documentation for the affected resource type rather than guessing about APIs or layout:
   - `docs/skills.md`
   - `docs/extensions.md`
   - `docs/packages.md`
   - other linked Pi documentation when the implementation uses those APIs
5. Check for collisions with existing skill names, slash commands, custom tools, shortcuts, files, and dependencies.

## Add or Import

When the user asks to “收录”, add, or import a resource:

1. Bring the complete maintainable source into the canonical checkout; do not leave it dependent on temporary agent output or an installed clone.
2. Put skills under `skills/<name>/SKILL.md`, with helper scripts, references, and assets inside that skill directory. Put small extensions under `extensions/<name>.ts`; use a directory and entry point only when multiple files make that clearer.
3. Preserve required copyright, license, and attribution notices. Record the source and pinned revision in the resource or repository documentation when code came from elsewhere.
4. Adapt hard-coded paths and assumptions for packaged use. Skill-relative files must resolve from the skill directory; package paths must be relative to the repository root.
5. Include only source and required assets. Exclude secrets, local state, caches, sessions, downloaded artifacts, and generated dependency directories.
6. Add true third-party runtime modules to `dependencies`. Pi core packages belong in `peerDependencies` with `"*"` when they need to be declared, not in ordinary runtime dependencies.
7. Update `package.json#pi` only when the current manifest does not already discover the resource. Update user-facing documentation for setup, provenance, compatibility, or behavior, keep `README.md` and `README.en.md` synchronized, but do not add an inventory to this skill.

Treat “收录” as a request to make the resource durable in this repository. After validation, commit only the intended files and push the current branch to `origin` unless the user asks for a local-only change. Do not manually synchronize Pi's managed clone; use Pi's package update flow and reload or restart Pi when the installed copy must be refreshed.

## Modify or Replace

- Change the canonical source, not the installed copy.
- Preserve existing skill, command, and tool names unless the user requests a breaking change.
- Keep independent resources independent; do not introduce shared infrastructure without a concrete need.
- Update bundled scripts, references, tests, dependencies, manifest entries, and documentation together when the change affects them.
- Re-review safety boundaries when expanding capabilities, especially for shell execution, network access, credentials, destructive actions, or non-idempotent operations.
- Do not commit or push an ordinary modification unless the user requests publication.

## Remove

When removing a skill or extension:

1. Confirm the exact resource and whether any files or dependencies are shared.
2. Search the repository for its paths, names, commands, tools, documentation, manifest entries, tests, and dependencies.
3. Delete the resource's owned files and remove only references and dependencies that are now unused.
4. Keep unrelated resources and external user data untouched. Removing source from this repository does not authorize editing Pi settings, package-catalog state, managed clones, or application data.
5. Validate that package discovery and the remaining resources still work.

A request to remove a resource from the collection authorizes the repository deletion, but not a commit or push unless the user explicitly asks for it.

## Validate and Review

Choose checks that match the affected resource:

- Skills: validate frontmatter, names, descriptions, relative paths, required files, and safe command examples.
- Extensions: check imports, schemas, cancellation, subprocess failures, output truncation, runtime dependencies, and non-TUI behavior where relevant.
- Package changes: verify that every manifest path exists and that JSON parses.
- Imported code: ensure retained attribution and license terms are compatible with redistribution.

At minimum run from the canonical root:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")); console.log("package.json ok")'
git diff --check
git status --short
```

Use an isolated smoke test for each changed resource when practical:

```bash
pi --no-skills --skill ./skills/<skill-name>
pi --no-extensions -e ./extensions/<extension-file>.ts
```

Do not invoke network-dependent, destructive, or non-idempotent behavior merely for testing. Finish by reviewing `git diff` and reporting what changed, what was tested, and any remaining platform or interactive assumptions.
