---
name: git-land
description: Commit the current working-tree changes and push them straight to the default branch — no feature branch, no pull request. Aborts unless you are already on the default branch and level with its remote. Pass -m to write the commit subject yourself instead of having a subagent propose one.
argument-hint: "[-m] [optional hint about what the change is]"
disable-model-invocation: true
allowed-tools: Bash, Agent, AskUserQuestion
---

# /git-land

Take everything currently uncommitted, commit it on the default branch you are
already standing on, and push it to `origin`. No branch is created, no pull request
is opened, and the change stays in your working tree's history rather than moving
away from it.

This is the unreviewed path. `/git-ship` is the reviewed one; reach for this only
when the change genuinely does not want a PR.

## Arguments

`$ARGUMENTS` may start with a flag. Parse it before anything else:

- `-m` / `--manual` — **manual naming**. Skip the `git-namer` subagent entirely; the
  user supplies the commit subject. Everything else — preflight, normalisation,
  confirmation, execute, report — is unchanged.
- Anything left after the flag is stripped is the hint. An empty hint is fine.

The flag is recognised only as the first token, so a hint that happens to contain
`-m` mid-sentence stays a hint.

## Token discipline — the point of this skill

**Do NOT run `git diff` yourself**, in either mode. In the default mode, reading the
diff is delegated to the `git-namer` subagent (Haiku, low effort) precisely so the
diff never lands in this expensive context. You run only cheap, short-output
commands. If you catch yourself about to read a diff, dispatch instead.

In manual mode nothing reads the diff at all — not you, not a subagent. The user
already knows what they changed; that is the whole point of the flag. Do not "just
peek" to check their wording.

## Stop conditions

Abort with a one-line explanation, having changed nothing, if any of these hold.
Never "work around" them.

- not inside a git repository
- **the current branch is not the default branch** — this skill never switches
  branches. Abort with: "You are on `<branch>`, not DEFAULT. /git-land only commits
  on DEFAULT; use /git-ship, or check out DEFAULT first." Detached HEAD aborts too.
- nothing to commit
- the local default branch is behind its remote — abort and point at `/git-sync`.
  There is no branch to park on here, so a stale local DEFAULT has to be fixed first.
- there is no `origin` remote — abort. A local-only commit is not what this skill
  promises; the user can commit by hand.
- the user declines the confirmation in Phase 3

Any command in Phase 4 that exits non-zero: STOP, report the exit code and the
last lines of output, and say exactly what state the repo is now in. Do not
continue to the next step and do not try to repair it on your own.

---

## Phase 1 — Preflight (cheap commands only)

Run these and read the output. Do not mutate anything in this phase.

1. `git rev-parse --show-toplevel` — not a repo → abort: "Not a git repository."
2. Resolve the default branch:
   `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` → strip the `origin/`
   prefix. If that fails, fall back to `master` if it exists, else `main`.
   Use this value everywhere below as DEFAULT; never hardcode `master`.
3. `git branch --show-current` — if the result is not DEFAULT, abort per the stop
   condition above. An empty result means detached HEAD → abort. **Do not offer to
   check out DEFAULT**: the uncommitted changes are the user's, and moving them
   between branches is `/git-ship`'s job, not this skill's.
4. `git status --porcelain` — empty → abort: "Nothing to commit, working tree clean."
5. `git remote get-url origin` — fails → abort per the stop condition above.
6. `git fetch origin` then `git rev-list --count HEAD..origin/DEFAULT`.
   If the count is greater than 0, **abort** with:
   "Your DEFAULT is N commits behind origin/DEFAULT. Run /git-sync first, then
   /git-land again." Nothing has been changed at this point, so this is safe.

## Phase 2 — Naming

Two modes. Step 7 picks one; step 10 runs either way.

### Phase 2A — Delegated naming (no `-m`)

7. Dispatch the `git-namer` subagent with the Agent tool, `subagent_type: "git-namer"`.
   The prompt must contain the absolute repo path from step 1, and the user's
   hint if they gave one. Ask for the fixed output block. The agent also returns
   `BRANCH-n` lines — **ignore them**; this skill creates no branch. Do not tell the
   agent to skip them either: it is shared with `/git-ship` and its contract stays put.

8. Read its `RISK:` line. If it is not `NONE`, show the flagged paths and ask with
   AskUserQuestion whether to proceed, gitignore them first, or abort. Do not stage
   anything until this is answered. Weigh this harder than `/git-ship` does: a secret
   pushed to DEFAULT is on the default branch of the remote immediately, with no PR
   in between where someone would have caught it.

9. Ask the naming question in **one** AskUserQuestion call, one question:
   - header `Commit`, the three `COMMIT-n` messages as options. Put the agent's
     SUMMARY in the descriptions.
   Do NOT add a fourth "write my own" option — the tool appends "Other" with a free
   text field automatically.

### Phase 2B — Manual naming (`-m`)

7. Do not dispatch any subagent. Instead, take the risk check yourself from the
   **file names alone** in the `git status --porcelain` output from step 4 — never
   from their contents. Flag a path that looks like a secret or a local-only file:
   `.env*` (other than `.env.example`), `.dev.vars`, `*.pem`, `*.key`, `id_rsa*`,
   `*credentials*`, `*.p12`. If anything is flagged, show the paths and ask with
   AskUserQuestion whether to proceed, gitignore them first, or abort. Do not stage
   anything until this is answered.

8. Ask the naming question in **one** AskUserQuestion call, one question, header
   `Commit`. The free-text "Other" field the tool appends is the expected path here,
   so the options exist only to save typing when one happens to fit. Build them
   mechanically, never by inventing a description of a diff you have not read:
   - from the hint, if the user gave one: its imperative form;
   - from the changed paths in step 4: the common top-level directory or the single
     changed file's stem (e.g. `src/lib/` → `Update src/lib`).

   If that yields fewer than two options, pad with a neutral fallback
   (`Update <top-level path>`) and say in the description that it is a placeholder.
   Never present a mechanical option as if it described the change — the description
   says where it came from ("from your hint", "from the changed paths"), not what the
   change does.

9. Whatever comes back is authoritative. Do not improve the user's commit subject
   beyond the normalisation in step 10, and do not append a body, a `feat:`-style
   prefix or a trailing period.

### Both modes

10. Trim the commit subject to one line, 70 characters max.

## Phase 3 — Confirm

11. This is the step `/git-ship` does not have, and it is the reason this skill is
    safe to hand someone. Pushing to DEFAULT is not reviewable after the fact — there
    is no PR to close and no branch to abandon — so ask with AskUserQuestion, once,
    naming what is about to happen:

    > Commit N file(s) as "<subject>" and push straight to DEFAULT on origin? No PR.

    Options: **Commit and push** / **Abort**. On abort, change nothing and say so.

    Skip this step only if the user's hint explicitly said not to ask.

## Phase 4 — Execute (stop on the first non-zero exit)

12. `git add -A` — `-A`, never `git add .`, so the result does not depend on cwd.
13. `git commit -m "<chosen message>"`
    A pre-commit hook may fail or may rewrite files. On non-zero exit: STOP and report;
    the user is on DEFAULT with changes staged and no commit, so say that plainly.
14. `git push origin DEFAULT`
    If the push is **rejected as non-fast-forward**, someone pushed to DEFAULT between
    step 6 and now. STOP. The commit exists locally and DEFAULT has diverged from its
    remote, which `/git-sync` will refuse to fix. Report exactly that and hand the
    call back to the user — do not pull, do not rebase, do not force.

## Phase 5 — Report

Three lines, nothing more:

```
Commit:  <hash short>  <message>
Pushed:  DEFAULT → origin/DEFAULT  (no PR — this change is on the default branch)
You are on DEFAULT with a clean tree.
```

The second line matters: there was no review gate. Always say so.

## Never

- create, switch to, or delete a branch — if a branch is wanted, the skill is `/git-ship`
- `--force`, `--force-with-lease`, `--amend`, `reset --hard`, or anything that
  rewrites history
- pull, merge or rebase to resolve a rejected push
- committing when a RISK path is unresolved
- pushing without the Phase 3 confirmation
- reading the diff in manual mode to second-guess the subject the user chose
