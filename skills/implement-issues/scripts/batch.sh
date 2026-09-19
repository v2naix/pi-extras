#!/usr/bin/env bash
# Git plumbing for implement-issues. Deterministic; no model involvement.
#
#   batch.sh prepare <label> <base> <n>...   create integration worktree/branch
#                                            from <base> (if missing) and one
#                                            worktree per issue from its HEAD
#   batch.sh merge <label> <n>...            merge implement/<n> into the
#                                            integration branch, then drop the
#                                            merged worktrees and branches
#   batch.sh status <label>                  print integration head and lanes
#   batch.sh cleanup <label>                 remove every worktree and branch
#
# Layout (all inside the repository, so cwd-scoped guardrails allow it):
#   .git/implement-issues/<label>/integration       branch implement/<label>
#   .git/implement-issues/<label>/worktrees/<n>     branch implement/<label>-<n>
set -euo pipefail

cmd=${1:?usage: batch.sh <prepare|merge|status|cleanup> <label> ...}
label=${2:?missing label}
root=$(git rev-parse --show-toplevel)
git_dir=$(git -C "$root" rev-parse --git-common-dir)
case $git_dir in /*) ;; *) git_dir=$root/$git_dir ;; esac
base_dir=$git_dir/implement-issues/$label
integration=$base_dir/integration
ibranch=implement/$label
report=.implement-issues-report.md

lane_dir() { echo "$base_dir/worktrees/$1"; }
lane_branch() { echo "$ibranch-$1"; }

case $cmd in
  prepare)
    base=${3:?missing base commit}; shift 3
    mkdir -p "$base_dir/worktrees"
    grep -qxF "$report" "$git_dir/info/exclude" 2>/dev/null || echo "$report" >> "$git_dir/info/exclude"
    if [ ! -d "$integration" ]; then
      git -C "$root" worktree add --quiet -b "$ibranch" "$integration" "$base"
    fi
    head=$(git -C "$integration" rev-parse HEAD)
    for n in "$@"; do
      dir=$(lane_dir "$n")
      [ -d "$dir" ] && { echo "lane $n already exists at $dir" >&2; continue; }
      git -C "$root" worktree add --quiet -b "$(lane_branch "$n")" "$dir" "$head"
      echo "$n $dir $(lane_branch "$n") $head"
    done
    ;;
  merge)
    shift 2
    for n in "$@"; do
      b=$(lane_branch "$n")
      if ! git -C "$integration" merge --no-ff --no-edit -m "Merge $b" "$b"; then
        echo "CONFLICT merging $b into $ibranch in $integration; resolve, commit, then rerun: batch.sh merge $label $*" >&2
        exit 2
      fi
    done
    for n in "$@"; do
      git -C "$root" worktree remove --force "$(lane_dir "$n")"
      git -C "$root" branch -D "$(lane_branch "$n")" >/dev/null
    done
    echo "$ibranch $(git -C "$integration" rev-parse HEAD)"
    ;;
  status)
    echo "integration $ibranch $(git -C "$integration" rev-parse HEAD 2>/dev/null || echo missing) $integration"
    git -C "$root" worktree list | grep -F "$base_dir/worktrees/" || true
    ;;
  cleanup)
    for dir in "$base_dir"/worktrees/* "$integration"; do
      [ -d "$dir" ] && git -C "$root" worktree remove --force "$dir"
    done
    git -C "$root" branch --list "$ibranch-*" "$ibranch" | sed 's/^[* ]*//' | xargs -r git -C "$root" branch -D >/dev/null
    rm -rf "$base_dir"
    echo "removed $ibranch and its lanes"
    ;;
  *) echo "unknown command: $cmd" >&2; exit 1 ;;
esac
