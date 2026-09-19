// implement-issues workflow: wave-based parallel implementation in git
// worktrees, with a deterministic merge between waves.
//
//   wave k = every issue whose blockers are all merged
//   each issue in a wave: one fresh worker in its own worktree, host-run test gate
//   after the wave: one integrate child merges the lanes into the integration
//   branch (batch.sh does the git work; the model only resolves conflicts),
//   gated by the test command, then prepares the next wave's worktrees
//
// The user's checkout is never touched. Review happens once, after this script
// returns, via /code-review on the integration branch.
//
// args (plain JSON, from scripts/issue_graph.py plus the parent):
//   repo        "OWNER/NAME"
//   label       batch label, e.g. "issue-20" (branch implement/<label>)
//   issues      [{ number, title, blockedBy: [] }] in dependency order
//   parent      parent issue number or null
//   base        commit SHA the integration branch was created from
//   root        absolute repository root (the parent's cwd)
//   batchScript absolute path to scripts/batch.sh
//   test        verification command, e.g. "make test"
//   typecheck   optional type-check command, e.g. "make typecheck"
//   setup       optional command a lane needs before tests, e.g. "uv sync --all-packages"
//   maxParallel optional cap per wave (default 3)
//   agent       optional worker agent name (default "worker")
//   model       optional exact "provider/id[:effort]" for workers

if (!args.test) throw new Error("args.test is required: it is the host-run gate for every lane and merge");
const agent = args.agent || "worker";
const verify = args.typecheck ? `\`${args.typecheck}\` and \`${args.test}\` once each` : `\`${args.test}\` once`;
const verifyReport = args.typecheck ? `<${args.typecheck} result>; <${args.test} result>` : `<${args.test} result>`;
const baselineNote = args.typecheck ? ` ${args.typecheck} may report pre-existing errors listed in AGENTS.md; the bar is no new errors.` : "";
const maxParallel = args.maxParallel || 3;
const laneDir = (n) => `${args.root}/.git/implement-issues/${args.label}/worktrees/${n}`;
const integrationDir = `${args.root}/.git/implement-issues/${args.label}/integration`;
const results = [];
const merged = new Set();
let pending = args.issues.slice();
let wave = 0;
let failure = null;

// The parent already ran `batch.sh prepare` for the first wave.
while (pending.length && !failure) {
  const ready = pending
    .filter((i) => (i.blockedBy || []).every((d) => merged.has(d) || !args.issues.some((x) => x.number === d)))
    .slice(0, maxParallel);
  if (!ready.length) {
    failure = { reason: "no issue is unblocked; remaining " + pending.map((i) => i.number).join(", ") };
    break;
  }
  wave += 1;

  const settled = await runs.all(ready.map((issue) => {
    const launch = {
      key: "implement-" + issue.number,
      agent,
      context: "fresh",
      worktree: false,
      cwd: laneDir(issue.number),
      outputMode: "file-only",
      output: laneDir(issue.number) + "/.implement-issues-report.md",
      gate: args.test,
      task: workerTask(issue),
    };
    if (args.model) launch.model = args.model;
    return launch;
  }));

  const waveEntries = settled.map((r, k) => ({
    number: ready[k].number,
    wave,
    ok: !!r.ok,
    runId: r.runId,
    report: r.outputReference || null,
    summary: String(r.output || "").split("\n").slice(0, 3).join(" ").slice(0, 300),
  }));
  results.push(...waveEntries);
  waveEntries.forEach((e) => emit("issue-done", e));

  const failed = waveEntries.filter((e) => !e.ok).map((e) => e.number);
  if (failed.length) { failure = { reason: "issues failed: " + failed.join(", ") }; break; }

  const done = ready.map((i) => i.number);
  pending = pending.filter((i) => !done.includes(i.number));
  const next = pending
    .filter((i) => (i.blockedBy || []).every((d) => merged.has(d) || done.includes(d) || !args.issues.some((x) => x.number === d)))
    .slice(0, maxParallel)
    .map((i) => i.number);

  const integrate = await runs.run("integrate-wave-" + wave, {
    agent,
    context: "fresh",
    worktree: false,
    cwd: integrationDir,
    outputMode: "file-only",
    output: integrationDir + "/.implement-issues-report.md",
    gate: args.test,
    task: integrateTask(done, next),
  });
  const entry = { wave, ok: !!integrate.ok, runId: integrate.runId, merged: done, prepared: next,
    summary: String(integrate.output || "").split("\n").slice(0, 3).join(" ").slice(0, 300) };
  emit("wave-integrated", entry);
  results.push({ integrate: entry });
  if (!integrate.ok) { failure = { reason: "integration of wave " + wave + " failed" }; break; }
  done.forEach((n) => merged.add(n));
}

return {
  ok: !failure,
  failure,
  base: args.base,
  branch: "implement/" + args.label,
  integrationDir,
  implemented: [...merged],
  notMerged: args.issues.map((i) => i.number).filter((n) => !merged.has(n)),
  results,
};

function workerTask(issue) {
  const parent = args.parent ? ` It is part of #${args.parent}; read that parent issue too, but implement only #${issue.number}.` : "";
  const setup = args.setup ? `\nThis worktree is fresh: run \`${args.setup}\` once before anything else.` : "";
  return `# TASK

Implement GitHub issue #${issue.number} in ${args.repo}: ${issue.title}${parent}
Your cwd is a dedicated git worktree on branch implement/${args.label}-${issue.number}, branched from the batch's integration branch, which already contains the issues this one depends on. Stay inside this directory. Pull in the issue with \`gh issue view ${issue.number} --comments\`.${setup}

# CONTEXT

Read AGENTS.md first and obey its verification and issue-tracker rules. Read CONTEXT.md and docs/adr/ if they exist. Then load only what this issue touches: use grep and line-ranged reads on the files you will change and their tests. Do not cat whole files or directories.

# EXECUTION

Red-green-refactor where a test seam exists: write one failing test, make it pass, repeat, then refactor. Do not test private helpers.
Before committing, run ${verify}.${baselineNote} Do not fix unrelated failures and do not change verification commands, dependency manifests, or lockfiles.

# COMMIT

Commit on the current branch with a conventional-commit message that references #${issue.number}. Add files explicitly; never add .implement-issues-report.md. Leave the tree clean. Do not push, do not close or comment on the issue, do not touch notebooks/ or any other worktree.

# BLOCKERS

If the issue needs a product or architecture decision it does not settle, use contact_supervisor with reason need_decision and wait. Ordinary environment or path fixes need no approval.

# REPORT

Final response, at most 25 lines:
Implemented #${issue.number}: <one line>
Commit: <sha>
Changed files: <paths>
Validation: ${verifyReport}
Open risks: <or none>`;
}

function integrateTask(done, next) {
  const setup = args.setup ? ` If tests need it, run \`${args.setup}\` first.` : "";
  return `# TASK

Integrate wave ${wave} of batch ${args.label} in ${args.repo}. Your cwd is the integration worktree on branch implement/${args.label}. Stay inside it.

1. Run: \`${args.batchScript} merge ${args.label} ${done.join(" ")}\`
   On exit 2 a merge conflict is left in this worktree. Resolve it preserving the intent of every merged issue (read the conflicting hunks and the relevant tests, not whole files), commit with \`git commit --no-edit\`, then rerun the same command until it succeeds.
2. Run ${verify}.${setup} If the merged result fails a test that each lane passed alone, fix the interaction in this worktree with a small commit; do not revert a lane.
3. ${next.length ? `Run: \`${args.batchScript} prepare ${args.label} HEAD ${next.join(" ")}\` to create the next wave's worktrees from the merged head.` : "This is the last wave; nothing to prepare."}

Do not push, do not touch issues, do not modify other worktrees, never add .implement-issues-report.md.

# REPORT

Final response, at most 15 lines:
Merged: ${done.map((n) => "#" + n).join(", ")} -> <integration head sha>
Conflicts: <files, or none>
Validation: ${verifyReport}
Prepared: ${next.length ? next.map((n) => "#" + n).join(", ") : "none"}`;
}
