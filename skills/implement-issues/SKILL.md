---
name: implement-issues
description: Implement a batch of GitHub issues with a fixed pi-subagents workflow (parallel workers in git worktrees per dependency wave, deterministic merges into an integration branch, host-run test gates, one /code-review at the end) instead of letting the parent design its own orchestration. Use when the user asks to implement a parent issue with sub-issues, or several related issues, in one go.
license: MIT
compatibility: Pi with the pi-subagents extension, gh CLI authenticated for the target repository, git, bash, python3, and a repository whose AGENTS.md documents its test and type-check commands.
disable-model-invocation: true
---

# Implement issues

Wrapper around Matt Pocock's `/implement` and `/code-review` for batches of issues. Those skills stay untouched; this skill fixes the orchestration around them so the parent session stays small, the user's checkout stays free, and the process is the same every run.

Division of labour:

- Parent (you): discover scope, prepare the batch, launch `workflow.js`, read its short result, hand off to `/code-review`, close issues. Nothing else.
- `workflow.js`: groups issues into dependency waves. Each wave runs its issues in parallel, one fresh `worker` per issue in its own worktree, with the repo's test command as a host-run gate. After each wave one integrate child merges the lanes into the integration branch (`scripts/batch.sh` does the git work; the model only resolves conflicts), gated by the same test command, and prepares the next wave. Fail fast.
- Worker: reads its own issue, implements, verifies once, commits on its lane branch. Its report is a file in its worktree; three lines reach the parent.

Do not write a workflow script of your own, do not add per-issue reviewers or a parent verification pass, and never read a worker's diff or source files. If the batch needs something this skill does not do, tell the user instead of improvising.

## 1. Scope

The user names a parent issue or a list of issue numbers. Resolve the repository from `docs/agents/issue-tracker.md` (or `gh repo view`). Produce the plan with the bundled script, which reads only numbers, titles, states and dependency edges:

```bash
python3 <skill-dir>/scripts/issue_graph.py --repo OWNER/NAME 20
```

It expands native sub-issues, falls back to `Part of #N` bodies, orders by native `blockedBy` plus `Blocked by: #N` text, drops closed issues, and reports open blockers outside the batch. Show the user the ordered list and stop on `unresolvedExternalBlockers` or a cycle. Do not read issue bodies yourself.

## 2. Prepare

- AGENTS.md names the verification commands. Default to `make test` and `make typecheck`; pass the documented ones if they differ. If nothing is documented, stop and ask; do not guess or install tools. If a fresh worktree needs a setup step (for example `uv sync --all-packages`), pass it as `setup`.
- Pick `label` (`issue-<parent>` or `issues-<first>-<last>`) and `base` (normally `git rev-parse main`, or the branch the user names; the user's working tree may be dirty, it is not touched).
- Create the integration branch and the first wave's lanes. The first wave is every issue with an empty `blockedBy`, capped by `maxParallel` (default 3):

```bash
bash <skill-dir>/scripts/batch.sh prepare <label> <base> <n> <n>...
```

- Claim the issues per the issue-tracker doc (assign yourself) as the first write.

## 3. Launch

One top-level async call, children only inside it:

```js
subagent({
  workflowScriptPath: "<skill-dir>/workflow.js",
  async: true,
  args: {
    repo, parent, issues,               // from issue_graph.py
    label, base,                         // from step 2
    root: "<absolute repo root>",
    batchScript: "<skill-dir>/scripts/batch.sh",
    test: "make test",
    typecheck: "make typecheck",
    // setup: "uv sync --all-packages",  // optional per-lane setup
    // maxParallel: 3,                   // optional
    // model: "provider/id:effort"       // optional worker override
  }
})
```

Optionally add `usageBudget` or `timeoutMs` on the same call when the user wants a cap. While it runs, answer `need_decision` requests from workers; those are the only messages that need you. Do not poll with `status`, do not read `.implement-issues-report.md` files unless a lane failed.

## 4. Finish

The workflow returns `{ ok, failure, base, branch, integrationDir, implemented, notMerged, results }`.

- Failure: read the failed lane's or integrate child's report file, tell the user what failed and which issues were not merged. Lanes and the integration branch are left in place for inspection. Do not retry automatically.
- Success: all implemented issues are merged on `implement/<label>` in `integrationDir`; `main` is untouched. Review once with `/code-review <base>` from a session whose cwd is `integrationDir` (for example a new Herdr pane there), because that skill diffs against `HEAD`. Then the user merges or fast-forwards the branch; if they ask you to, run `git merge --ff-only implement/<label>` on their branch only when their tree is clean.
- Then, per the issue-tracker doc: comment the commit and validation summary on each implemented issue, close it, and add a batch summary to the parent issue. Do not push unless asked.
- Cleanup, when the user is done with the branch:

```bash
bash <skill-dir>/scripts/batch.sh cleanup <label>
```

## Files

- `workflow.js`: wave loop, worker task template, integrate task template. Edit the templates here when the briefs need to change.
- `scripts/batch.sh`: `prepare`, `merge`, `status`, `cleanup`. All worktrees live under `.git/implement-issues/<label>/`, inside the repository, so cwd-scoped guardrails allow them.
- `scripts/issue_graph.py`: scope and ordering; `--include-closed` for dry runs or reruns.
