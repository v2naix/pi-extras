---
name: dotfiles-workflow
description: Safely operate the v2naix macOS dotfiles source through its scripts/dotfiles interface. Use when checking, reviewing, editing, applying, updating, diagnosing, or handling drift in that dotfiles repository, including Karabiner/Goku, Yabai, GUI control-plane, secrets, and independent Pi source rules.
license: MIT
compatibility: macOS dotfiles source with Git, chezmoi, and the repository's scripts/dotfiles command.
disable-model-invocation: true
---

# Dotfiles Workflow

Treat `scripts/dotfiles` as the single deep module for the daily workflow. The Skill explains policy and sequencing; it must not reproduce Git, chezmoi, drift classification, security-gate, validator-selection, apply, update, or rollback logic.

## Establish the source and scope

1. Resolve the current Git root and verify it contains `scripts/dotfiles`, `security/managed-paths.txt`, and `docs/daily-workflow.md`. If not, stop rather than guessing another checkout.
2. Read `docs/daily-workflow.md` before changing configuration. Read `.wayfinder/CONTEXT.md` when domain terminology or management ownership matters.
3. Consult `security/managed-paths.txt` before adding a source path. It is an allowlist: an unlisted path requires explicit review, not a blocklist exception.
4. Keep these categories distinct:
   - **Dotfiles 源**: reviewed declarative configuration managed through chezmoi.
   - **独立配置源**: separately versioned owners such as `pi-extras` and `pi-package-catalog`; do not copy their content into Dotfiles.
   - **外部秘密源**: credentials and secret material; record only recovery interfaces, never the secret.
   - **应用控制面**: rebuildable settings and reviewed exports that may be managed.
   - **应用数据面**: user content, history, databases, sessions, caches, and synced data; never import it as configuration.

## Use the standard sequence

Prefer the Pi read-only commands when the extension is loaded:

- `/df-check` for local checks;
- `/df-status` only when a network fetch and remote-ref update are intended;
- `/df-review` for source/rendered diffs, dry-run, and security scanning;
- `/df-verify` and `/df-doctor` only when the Shell core provides those commands.

Otherwise call the same public interface directly:

1. `scripts/dotfiles check` before work. This is local and read-only.
2. `scripts/dotfiles status` only when remote status is needed; it fetches `origin/main` but does not update the work branch.
3. `scripts/dotfiles edit <target>` for a managed target. Do not edit rendered target files as the normal source-editing workflow.
4. `scripts/dotfiles review [target...]` after every source change and before proposing application.
5. `scripts/dotfiles apply [target...]` only when the user explicitly asks to apply and can personally review the full output and type the exact confirmation token.
6. `scripts/dotfiles update` only when the user explicitly asks to update and can review and confirm its fast-forward gate.
7. `scripts/dotfiles rollback <known-good-commit>` only to print the core's recovery plan. Never reinterpret an arbitrary revision as a 已知可用版本.

If the core later adds `verify`, `doctor`, or `finish`, invoke them through `scripts/dotfiles`. Until then, report that the interface is unavailable; do not synthesize an equivalent sequence in the Skill or Extension.

## Handle target drift explicitly

Target drift blocks apply and update. Never import or discard it automatically.

1. Use the core's output and `chezmoi diff` to identify the exact target.
2. Ask the user to classify the change:
   - unwanted target change: explicitly apply that target to discard it;
   - intended static-file change: explicitly add only that target, then run the full review and security gates;
   - rendered template change: manually migrate only the intended source fields, never import the rendered file wholesale;
   - application rewrite: stop and reconsider whether the file or field belongs in the 管理清单.
3. Do not choose a classification from convenience or inferred intent.

## Respect subsystem ownership

Load the subsystem document before touching its source or suggesting validation:

- `docs/keyboard-automation.md`: `karabiner.edn.tmpl` is the rule source; generated `karabiner.json`, backups, logs, and Goku state are disposable outputs. Use `scripts/keyboard-automation`; permissions and physical-key tests remain manual.
- `docs/yabai.md`: use `scripts/yabai-management`. Never automate `sudo`, SIP changes, scripting-addition installation/loading, TCC changes, Dock restart, or Recovery steps. SA work is an explicit high-risk manual branch.
- `docs/application-control-plane.md`: manage only approved per-key preferences and reviewed exports. Never bulk-export preference domains or application-support directories; GUI import, login, licensing, TCC, and representative action checks remain manual.
- `docs/ai-cli.md`: Dotfiles owns only bootstrap/recovery interfaces. Do not modify Pi settings, catalog local choices, trust, provider credentials, histories, sessions, or the contents of independent `pi-extras` and `pi-package-catalog` sources through this workflow.

## Safety rules

- Do not automatically apply, commit, push, import drift, rebase, rewrite history, modify Pi catalog/settings, delete old sources, or delete rollback material.
- Do not bypass `scripts/path-gate`, `scripts/security-gate`, Gitleaks, Git hooks, or an Extension block. Extension guards are defense in depth, not the security authority.
- Do not add secrets, encrypted-secret lookalikes, credentials, login state, machine-local trust, histories, caches, databases, or application data.
- Keep machine differences explicit through declared roles/templates; do not hard-code the current username, Home path, Homebrew prefix, host name, or app availability.
- Distinguish `自动基线完成` from `恢复验收完成`. Files existing or checks passing never substitute for required login, authorization, GUI import, physical-device, or representative workflow validation.
- When a command fails, preserve its exact output and stop at the public interface. Diagnose the core rather than routing around it with ad hoc Git or chezmoi commands.

## Finish a task

Report:

1. the Dotfiles source paths changed;
2. whether target drift existed and how the user classified it;
3. the exact public checks run and their results;
4. whether any network fetch, target application, commit, or push occurred;
5. all remaining manual checkpoints, especially permissions, GUI import, secrets/login, Yabai SA, and physical-device validation.
