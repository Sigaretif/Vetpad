---
name: git-sync
description: Fast-forward the local default branch to its remote. Run this when /git-ship reports that the default branch is behind.
disable-model-invocation: true
allowed-tools: Bash, AskUserQuestion
---

# /git-sync

Bring the local default branch up to date with `origin`. Fast-forward only — this
skill never merges, never rebases, never rewrites history.

## Procedure

1. `git rev-parse --show-toplevel` — not a repo → abort: "Not a git repository."
2. Resolve DEFAULT the same way `/git-ship` does:
   `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, strip `origin/`;
   fall back to `master`, then `main`.
3. `git branch --show-current`. If it is not DEFAULT, say which branch you are
   switching from, and switch back to it at the very end.
4. `git fetch origin`
5. `git rev-list --count DEFAULT..origin/DEFAULT` — 0 → report
   "DEFAULT is already up to date with origin." and stop.
6. `git status --porcelain` — if the tree is dirty, ask with AskUserQuestion:
   - **Stash, pull, restore (recommended)** — `git stash push -u -m "git-sync"`,
     pull, then `git stash pop`. If `stash pop` conflicts, STOP immediately and say
     so loudly: the changes are safe in the stash, name it, and tell the user to
     resolve the conflict and run `git stash drop` themselves. Never drop a stash
     you could not cleanly pop.
   - **Abort** — change nothing.
   A clean tree skips this question entirely.
7. `git checkout DEFAULT` (if not already there), then `git pull --ff-only origin DEFAULT`.
   If the pull is rejected because the branches diverged, STOP and report it —
   local DEFAULT has commits that are not on the remote, which this skill will not
   resolve. Do not offer to merge or rebase; that is the user's call.
8. Return to the original branch if step 3 moved you, and restore the stash if
   step 6 created one.

## Report

```
<DEFAULT>: <old short hash> → <new short hash>  (N commits)
Tree: clean | restored from stash
On branch: <where the user is now>
```

## Never

- `pull` without `--ff-only`
- `merge`, `rebase`, `reset --hard`, `--force`
- dropping or clearing a stash that did not pop cleanly
