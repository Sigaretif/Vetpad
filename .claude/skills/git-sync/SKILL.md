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
4. `git fetch --prune origin` — `--prune` matters: the remote deletes merged
   branches automatically, and without it every dead `origin/*` ref lingers forever.
   It only ever removes remote-tracking refs; it never touches a local branch or a commit.
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
9. Offer to clean up. After the prune in step 4, list local branches whose upstream
   is gone — these are the ones the remote deleted after their pull request merged:
   `LC_ALL=C git branch -vv | grep ': gone]'`. The `LC_ALL=C` is load-bearing, not
   decoration: `git branch -vv` prints a TRANSLATED string, so on a Polish system the
   marker reads `: nie ma]` and an unprefixed grep silently matches nothing — reporting
   "no branches to clean up" while leaving real ones behind. A false negative with no
   error is the worst failure mode here, so force the locale on every command whose
   human-readable output you parse. If there are any, name them and ask with
   AskUserQuestion whether to delete them. On yes, delete them with `git branch -d`
   (never `-D`): `-d` refuses any branch not fully merged into DEFAULT, which is
   exactly the safety net you want here. Report any branch git refused and leave it
   alone. Never delete the branch the user is currently on, and never delete DEFAULT.

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
- `git branch -D` — forced branch deletion, under any circumstances
- deleting a branch the user did not confirm in step 9
- parsing translated git output: prefix `LC_ALL=C` on any command you grep, or use a
  porcelain/plumbing form (`--porcelain`, `rev-list`, `for-each-ref`) that never translates
