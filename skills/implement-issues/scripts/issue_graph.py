#!/usr/bin/env python3
"""Print the issues to implement, in dependency order, as JSON for workflow.js.

Usage:
  issue_graph.py --repo OWNER/NAME 20            # parent issue: expand its sub-issues
  issue_graph.py --repo OWNER/NAME 21 22 23      # explicit list

Reads only issue numbers, titles, states and dependency edges through `gh api`.
Never reads issue bodies; the worker reads its own issue.
"""
import argparse
import json
import re
import subprocess
import sys


def gh_json(*args):
    out = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"gh api failed: {' '.join(args)}\n{out.stderr.strip()}")
    return json.loads(out.stdout)


def graphql(query):
    return gh_json("graphql", "-f", f"query={query}")["data"]


def issue_meta(owner, name, number):
    data = graphql(
        f'{{ repository(owner:"{owner}",name:"{name}") {{ issue(number:{number}) {{'
        " number title state body"
        " subIssues(first:50){ nodes{ number } }"
        " blockedBy(first:50){ nodes{ number } }"
        " } } }"
    )["repository"]["issue"]
    blocked = {n["number"] for n in data["blockedBy"]["nodes"]}
    # Textual fallback used by docs/agents/issue-tracker.md when native
    # dependencies are unavailable: "Blocked by: #12, #13".
    for m in re.finditer(r"Blocked by:\s*((?:#\d+[,\s]*)+)", data.get("body") or ""):
        blocked.update(int(x) for x in re.findall(r"#(\d+)", m.group(1)))
    return {
        "number": data["number"],
        "title": data["title"],
        "state": data["state"],
        "children": [n["number"] for n in data["subIssues"]["nodes"]],
        "blockedBy": sorted(blocked),
    }


def text_children(repo, number):
    """Fallback for repos that mark sub-tasks with 'Part of #N' in the body."""
    q = f'repo:{repo} is:issue "Part of #{number}" in:body'
    data = gh_json("-X", "GET", "search/issues", "-f", f"q={q}", "-f", "per_page=100")
    return sorted(
        item["number"] for item in data.get("items", [])
        if re.search(rf"Part of #{number}\b", item.get("body") or "")
    )


def topo(issues):
    remaining = dict(issues)
    ordered = []
    while remaining:
        ready = [
            n for n, it in remaining.items()
            if not any(d in remaining for d in it["blockedBy"])
        ]
        if not ready:
            raise SystemExit(f"dependency cycle among issues {sorted(remaining)}")
        for n in sorted(ready):
            ordered.append(remaining.pop(n))
    return ordered


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="OWNER/NAME")
    ap.add_argument("numbers", nargs="+", type=int)
    ap.add_argument("--include-closed", action="store_true",
                    help="keep closed issues in the plan (rerun or dry run)")
    args = ap.parse_args()
    owner, name = args.repo.split("/", 1)

    metas = {n: issue_meta(owner, name, n) for n in args.numbers}
    parent = None
    if len(args.numbers) == 1:
        only = metas[args.numbers[0]]
        children = only["children"] or text_children(args.repo, only["number"])
        if children:
            parent = metas.pop(only["number"])
            metas = {n: issue_meta(owner, name, n) for n in children}

    keep = (lambda it: True) if args.include_closed else (lambda it: it["state"] == "OPEN")
    skipped = [n for n, it in metas.items() if not keep(it)]
    open_issues = {n: it for n, it in metas.items() if keep(it)}
    ordered = topo(open_issues)

    external = sorted({
        d for it in ordered for d in it["blockedBy"] if d not in open_issues and d not in skipped
    })
    print(json.dumps({
        "repo": args.repo,
        "parent": parent["number"] if parent else None,
        "issues": [
            {"number": it["number"], "title": it["title"], "blockedBy": it["blockedBy"]}
            for it in ordered
        ],
        "skippedClosed": sorted(skipped),
        "unresolvedExternalBlockers": external,
    }, ensure_ascii=False, indent=2))
    if external:
        print(f"warning: open blockers outside scope: {external}", file=sys.stderr)


if __name__ == "__main__":
    main()
