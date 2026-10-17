---
name: git-ship
description: Ship work through a reviewed branch, in one of two modes. On the default branch — move what origin does not have yet, local commits (e.g. from /10x-implement) and uncommitted changes alike, onto a new 10x- branch, commit what is uncommitted, push, optionally create the pull request with gh once the user says so (opening one starts the paid AI review), and return to the default branch level with its remote. On an existing 10x- branch that tracks origin (a pull request already open) — commit what is uncommitted, push to that branch with a plain push, report the PR's link and stay on the branch. Pass -m to name the branch and the commit yourself instead of having a subagent propose names.
argument-hint: "[-m] [optional hint about what the change is]"
disable-model-invocation: true
allowed-tools: Bash, Agent, AskUserQuestion
---

# /git-ship

Take everything the remote does not have yet — local commits and anything still
uncommitted — and push it somewhere a reviewer will see it. Where that is depends
on the branch the user stands on:

- **Default mode** (on DEFAULT) — park the change on a fresh `10x-` branch, push
  it, offer to create the PR, and leave the user back on the default branch,
  level with its remote, with a clean tree.
- **PR-branch mode** (on an existing `10x-` branch tracking `origin`) — commit
  onto that branch, push it, point at its open PR, and leave the user on the
  branch. This is the way to add a commit to an open pull request.

The change has up to two parts, and either may be empty:

- **Local commits** — commits on the current branch that its remote counterpart
  (`origin/DEFAULT` in default mode, `origin/<branch>` in PR-branch mode) does not
  have. `/10x-implement` makes these: one per phase, plus an epilogue. They are
  shipped as they are — never squashed, reworded or re-created — because
  `plan.md`'s `## Progress` rows point at their SHAs.
- **Uncommitted work** — whatever `git status --porcelain` shows. This gets one
  new commit on the branch, as before.

## Arguments

`$ARGUMENTS` may start with a flag. Parse it before anything else:

- `-m` / `--manual` — **manual naming**. Skip the `git-namer` subagent entirely; the
  user supplies the branch slug and the commit subject. Everything else — preflight,
  normalisation, execute, report — is unchanged.
- Anything left after the flag is stripped is the hint. An empty hint is fine.

The flag is recognised only as the first token, so a hint that happens to contain
`-m` mid-sentence stays a hint.

## Token discipline — the point of this skill

**Do NOT run `git diff` yourself**, in either naming mode — and do not run `git show`
or `git log -p` on the local commits either. In the default naming mode, reading the
diff is delegated to the `git-namer` subagent (Haiku, low effort) precisely so the
diff never lands in this expensive context. You run only cheap, short-output
commands: `git log --oneline` over the local commits is fine, their contents are
not. If you catch yourself about to read a diff, dispatch instead.

In manual mode nothing reads the diff at all — not you, not a subagent. The user
already knows what they changed; that is the whole point of the flag. Do not "just
peek" to check their wording.

## Stop conditions

Abort with a one-line explanation, having changed nothing, if any of these hold.
Never "work around" them.

- not inside a git repository
- detached HEAD
- the current branch is not DEFAULT and either is not named `10x-…` or has no
  upstream `origin/<branch>`
- nothing to ship: no uncommitted changes **and** no local commits ahead of
  BASE (step 5)
- the current branch is behind BASE
- the user declines a confirmation

Any command in Phase 3 that exits non-zero: STOP, report the exit code and the
last lines of output, and say exactly what state the repo is now in. Do not
continue to the next step and do not try to repair it on your own. The one
exception is `gh` in step 16, which never stops the run.

---

## Phase 1 — Preflight (cheap commands only)

Run these and read the output. Do not mutate anything in this phase.

1. `git rev-parse --show-toplevel` — not a repo → abort: "Not a git repository."
2. Resolve the default branch:
   `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` → strip the `origin/`
   prefix. If that fails, fall back to `master` if it exists, else `main`.
   Use this value everywhere below as DEFAULT; never hardcode `master`.
3. `git status --porcelain` — record whether it is empty as DIRTY (non-empty) or
   CLEAN. Do not abort yet; local commits may still need shipping.
4. `git branch --show-current` — pick the mode. Ask nothing here.
   - An empty result means detached HEAD → abort: "Detached HEAD — check out a
     branch first."
   - DEFAULT → **default mode**: ON_DEFAULT is true, BASE is `origin/DEFAULT`.
   - Anything else → **PR-branch mode** candidate, ON_DEFAULT is false. Read the
     upstream with `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}`.
     The branch must be named `10x-…` and its upstream must be `origin/<branch>`;
     BASE is then `origin/<branch>`. Otherwise abort with one line, nothing
     changed: "<branch> is not a 10x- branch tracking origin — /git-ship ships
     from DEFAULT or onto an open 10x- PR branch."
5. `git fetch origin`, then count both directions against BASE:
   `git rev-list --count HEAD..BASE` → BEHIND, and
   `git rev-list --count BASE..HEAD` → AHEAD (the local commits).
   - Default mode, BEHIND > 0 → **abort** with: "Your DEFAULT is N commits behind
     origin/DEFAULT. Run /git-sync first, then /git-ship again." If AHEAD > 0 as
     well, add: "DEFAULT has diverged from origin/DEFAULT — /git-sync will refuse
     too; this needs your call." Nothing has been changed at this point, so this
     is safe.
   - PR-branch mode, BEHIND > 0 → **abort** with: "<branch> is N commits behind
     origin/<branch>. Run `git pull --ff-only`, then /git-ship again." Nothing has
     been changed. Where DEFAULT stands against `origin/DEFAULT` does not matter
     in this mode — do not check it and do not mention it.
   - AHEAD > 0 → also run `git --no-pager log --oneline BASE..HEAD` →
     the LOCAL list. One subject line per commit; that is all you read about them.
   - CLEAN and AHEAD is 0 → abort: "Nothing to ship: working tree clean and
     <current branch> is level with BASE."
   If there is no `origin` remote (default mode only — PR-branch mode already
   aborted in step 4), note it, set AHEAD to 0, abort if CLEAN, and otherwise
   carry on — Phase 3 will stop at the push.

## Phase 2 — Naming

What needs a name depends on the mode and the two parts:

- **Default mode, DIRTY** → a branch name and a commit subject (as always).
- **Default mode, CLEAN, AHEAD > 0** → a branch name only. There is nothing to
  commit; the local commits already carry their own messages, and they are never
  reworded. Skip the `git-namer` dispatch (it reads the working tree, which is
  empty) and skip every commit-subject question below.
- **PR-branch mode, DIRTY** → a commit subject only. The branch already exists:
  skip every branch question and the local-commit branch options, the branch half
  of step 9 and all of step 10. The risk check (step 7 in 2A, step 6 in 2B) runs
  exactly as in default mode.
- **PR-branch mode, CLEAN, AHEAD > 0** → nothing to name. Skip Phase 2 except
  step 11, and go to Phase 3.

Step 6 picks a naming mode; steps 9–11 run either way.

### Local-commit branch options (default mode, whenever AHEAD > 0)

Build these mechanically from the LOCAL list, never from commit contents:

- `/10x-implement` subjects look like `<type>(<change-id>): <phase title> (p<N>)`.
  If the local commits share one `(<change-id>)` scope, that change-id is the
  first branch option — description "from the /10x-implement commits". If they
  carry several change-ids, offer the most recent one and say in the description
  that the branch will carry more than one change.
- Otherwise, the slugified subject of the oldest local commit — description
  "from the first local commit".

In mode 2A these join the agent's `BRANCH-n` options (at most four options in
total — drop the agent's last ones to make room). In mode 2B and in the
CLEAN-with-commits case they are the options.

### Phase 2A — Delegated naming (no `-m`)

6. If DIRTY: dispatch the `git-namer` subagent with the Agent tool,
   `subagent_type: "git-namer"`. The prompt must contain the absolute repo path
   from step 1, and the user's hint if they gave one. Ask for the fixed output
   block. The agent sees only the uncommitted part — that is correct: its
   `COMMIT-n` lines name the one new commit, not the local commits.
   If CLEAN: do not dispatch; go to step 8 with the local-commit options.

7. Read its `RISK:` line. If it is not `NONE`, show the flagged paths and ask with
   AskUserQuestion whether to proceed, gitignore them first, or abort. Do not stage
   anything until this is answered.

8. Ask the naming questions in **one** AskUserQuestion call:
   - header `Branch` — default mode only; in PR-branch mode the agent's
     `BRANCH-n` lines are ignored — the branch options (agent's `BRANCH-n` slugs
     and/or the local-commit options), each shown with the `10x-` prefix already
     applied. Put the agent's SUMMARY (or the option's origin) in the descriptions.
   - header `Commit`, the three `COMMIT-n` messages as options — only when DIRTY.
   Do NOT add a "write my own" option — the tool appends "Other" with a free
   text field automatically.

### Phase 2B — Manual naming (`-m`)

6. Do not dispatch any subagent. If DIRTY, take the risk check yourself from the
   **file names alone** in the `git status --porcelain` output from step 3 — never
   from their contents. Flag a path that looks like a secret or a local-only file:
   `.env*` (other than `.env.example`), `.dev.vars`, `*.pem`, `*.key`, `id_rsa*`,
   `*credentials*`, `*.p12`. If anything is flagged, show the paths and ask with
   AskUserQuestion whether to proceed, gitignore them first, or abort. Do not stage
   anything until this is answered.

7. Ask the naming questions in **one** AskUserQuestion call, the same headers as
   2A — `Branch` in default mode only, and `Commit` only when DIRTY. The free-text
   "Other" field the tool appends is the expected path here, so the options exist
   only to save typing when one happens to fit. Build them mechanically, never by
   inventing a description of a diff you have not read:
   - from the hint, if the user gave one: its slugified form as a branch option, its
     imperative form as a commit option;
   - the local-commit branch options above, when AHEAD > 0;
   - from the changed paths in step 3: the common top-level directory or the single
     changed file's stem (e.g. `src/lib/` → `update-src-lib`).

   If that yields fewer than two options for a question, pad with a neutral fallback
   (`10x-manual-change` / `Update <top-level path>`) and say in the description that
   it is a placeholder. Never present a mechanical option as if it described the
   change — the description says where it came from ("from your hint", "from the
   changed paths", "from the /10x-implement commits"), not what the change does.

8. Whatever comes back is authoritative. Do not improve the user's commit subject
   beyond the normalisation in step 9, and do not append a body, a `feat:`-style
   prefix or a trailing period.

### Both naming modes

9. Normalise the chosen branch name (default mode only): force the `10x-` prefix,
   lowercase, ASCII only, hyphens for spaces, strip diacritics, max 44 characters
   total. Trim the commit subject to one line, 70 characters max.

10. Default mode only — check the branch name: `git rev-parse --verify --quiet <name>`.
    If it already exists, append `-2` (then `-3`, ...) until free, and say which
    name you settled on.

11. If AHEAD > 0, show the LOCAL list in your message before Phase 3 — one line
    per commit. In default mode, say that these commits go onto the branch as they
    are, and that local DEFAULT is pointed back at `origin/DEFAULT` afterwards; in
    PR-branch mode, say that they are pushed to `origin/<branch>` as they are. No
    extra question: choosing a name in step 8 is the go-ahead, and in PR-branch
    mode with nothing to name, running the skill on that branch is.

## Phase 3 — Execute (stop on the first non-zero exit)

12. Default mode only: `git checkout -b <branch>` — the branch starts at HEAD, so it
    already holds every local commit, and the uncommitted changes carry over with it.
    In PR-branch mode `<branch>` below is the current branch.
13. Only if DIRTY: `git add -A` — `-A`, never `git add .`, so the result does not
    depend on cwd.
14. Only if DIRTY: `git commit -m "<chosen message>"`
    A pre-commit hook may fail or may rewrite files. On non-zero exit: STOP and report;
    the user is now on the branch with changes staged, so say that plainly — and,
    in default mode with AHEAD > 0, that local DEFAULT still holds the local
    commits too.
15. Push, never with a force flag:
    - default mode: `git push -u origin HEAD`
    - PR-branch mode: `git push` — the upstream is `origin/<branch>`, checked in
      step 4, and step 5 proved the push is a fast-forward.
16. Surface the pull request.

    **PR-branch mode.** If `command -v gh` succeeds, run
    `gh pr view --json url -q .url`; a URL in its output is the PR link. If `gh`
    is missing, or the command fails or prints nothing (not logged in, no PR for
    the branch), build the link as below. Ask nothing — the PR, if there is one,
    already exists.

    **Default mode.** First the link. GitHub prints the ready-made one in the
    `git push` output from step 15:

    ```
    remote: Create a pull request for '<branch>' on GitHub by visiting:
    remote:      https://github.com/<owner>/<repo>/pull/new/<branch>
    ```

    Take that URL verbatim from the push output.

    If the push output did not contain one (the branch already existed upstream, or
    the host is not GitHub), build it from `git remote get-url origin` instead:
    strip any `.git` suffix and any `git@host:` form down to `https://<host>/<owner>/<repo>`,
    then append `/compare/DEFAULT...<branch>`.

    Then the offer to create the PR. Only if `command -v gh` succeeds **and**
    `gh auth status` exits 0, ask with AskUserQuestion: "Utworzyć PR teraz?
    Otwarcie PR-a uruchamia płatne AI review (.github/workflows/review.yml)",
    with two options — `Utwórz` (create the PR now) and `Tylko link` (open it
    yourself from the link). Without `gh`, or without a login, do not ask; the
    link is the result.
    - `Utwórz` → `gh pr create --base DEFAULT --head <branch> --fill`; the URL it
      prints is the PR link. If it exits non-zero, do not stop: report the link
      built above and the last lines `gh` printed.
    - `Tylko link` → the link built above.

    The answer covers this one run. Never create a PR without `Utwórz` in this
    run, and never treat a missing PR as a failed run — the branch is pushed
    either way, which is the part that mattered.
17. Only in default mode and if AHEAD > 0 — **take the local commits off DEFAULT.**
    They now live on the pushed branch; leaving them on DEFAULT as well would let
    a later `/git-land` publish them unreviewed. Still standing on the new branch:
    1. Verify the branch really holds them before moving anything:
       `git rev-parse HEAD` must equal `git rev-parse origin/<branch>`, and
       `git merge-base --is-ancestor DEFAULT HEAD` must exit 0. If either check
       fails, STOP: report that the commits are still on DEFAULT and on the
       branch, and do not move DEFAULT.
    2. `git branch -f DEFAULT origin/DEFAULT` — points local DEFAULT back at its
       remote. This is a ref move, not a history rewrite: no commit is dropped or
       re-created, every local commit keeps its SHA on the pushed branch, and the
       SHAs in `## Progress` stay valid. It is the only forced ref move this skill
       makes, and only under the two checks above.
18. Default mode only: `git checkout DEFAULT`. In PR-branch mode the user stays
    on `<branch>`.

## Phase 4 — Report

Four lines, nothing more.

Default mode:

```
Branch:  10x-<slug>  (pushed)
Commits: <N> local + <new short hash> <message>   # drop whichever part is empty
PR:      <the PR URL from gh pr create — or the pull/new or compare URL: open it to create the PR>
You are back on <DEFAULT>, level with origin/<DEFAULT> — the changes live on the branch, not here.
```

That last line matters: the user's working tree — and local DEFAULT — no longer
contain the change they just shipped. Always state it. When `gh pr create`
failed, add what it returned after the `PR:` line.

PR-branch mode:

```
Branch:  <branch>  (pushed to origin/<branch>; you are still on it)
Commits: <N> local + <new short hash> <message>   # drop whichever part is empty
PR:      <the URL from gh pr view — or the pull/new or compare URL>
AI review: not started by this push (review.yml has no `synchronize`) — label the PR `ai-cr:review` yourself for a new, paid run.
```

## Never

- `--force`, `--force-with-lease`, `--amend`, `reset --hard`, `rebase`, or anything
  that rewrites history — the step-17 `git branch -f` is a ref move under explicit
  checks, and it is the only one
- squashing, rewording or re-creating the local commits
- pushing to DEFAULT
- pushing in PR-branch mode to anything but the branch's own upstream
  `origin/<branch>`, or from a branch not named `10x-…`
- committing when a RISK path is unresolved
- creating a pull request without the user's `Utwórz` in this run, or adding the
  `ai-cr:review` label — both start a paid review
- deleting the branch you just created
- reading the diff — or the local commits' contents — in manual mode to
  second-guess the name the user chose
