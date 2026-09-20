---
name: git-ship
description: Move the current working-tree changes off the default branch onto a new 10x- branch, commit them, push, open a pull request, and return to the default branch. Pass -m to name the branch and the commit yourself instead of having a subagent propose names.
argument-hint: "[-m] [optional hint about what the change is]"
disable-model-invocation: true
allowed-tools: Bash, Agent, AskUserQuestion
---

# /git-ship

Take everything currently uncommitted, park it on a fresh `10x-` branch, push it,
open a PR, and leave the user back on the default branch with a clean tree.

## Arguments

`$ARGUMENTS` may start with a flag. Parse it before anything else:

- `-m` / `--manual` — **manual naming**. Skip the `git-namer` subagent entirely; the
  user supplies the branch slug and the commit subject. Everything else — preflight,
  normalisation, execute, report — is unchanged.
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
- nothing to commit
- the local default branch is behind its remote
- the user declines a confirmation

Any command in Phase 3 that exits non-zero: STOP, report the exit code and the
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
3. `git status --porcelain` — empty → abort: "Nothing to commit, working tree clean."
4. `git branch --show-current` — if it is not DEFAULT, ask with AskUserQuestion:
   commit onto the current branch instead (skip branch creation in Phase 3), or abort.
   An empty result means detached HEAD → abort.
5. `git fetch origin` then `git rev-list --count HEAD..origin/DEFAULT`.
   If the count is greater than 0, **abort** with:
   "Your DEFAULT is N commits behind origin/DEFAULT. Run /git-sync first, then
   /git-ship again." Nothing has been changed at this point, so this is safe.
   If there is no `origin` remote, note it and carry on — Phase 3 will stop at the push.

## Phase 2 — Naming

Two modes. Step 6 picks one; steps 9 and 10 run either way.

### Phase 2A — Delegated naming (no `-m`)

6. Dispatch the `git-namer` subagent with the Agent tool, `subagent_type: "git-namer"`.
   The prompt must contain the absolute repo path from step 1, and the user's
   hint if they gave one. Ask for the fixed output block.

7. Read its `RISK:` line. If it is not `NONE`, show the flagged paths and ask with
   AskUserQuestion whether to proceed, gitignore them first, or abort. Do not stage
   anything until this is answered.

8. Ask both naming questions in **one** AskUserQuestion call, two questions:
   - header `Branch`, the three `BRANCH-n` slugs as options, each shown with the
     `10x-` prefix already applied. Put the agent's SUMMARY in the descriptions.
   - header `Commit`, the three `COMMIT-n` messages as options.
   Do NOT add a fourth "write my own" option — the tool appends "Other" with a free
   text field automatically.

### Phase 2B — Manual naming (`-m`)

6. Do not dispatch any subagent. Instead, take the risk check yourself from the
   **file names alone** in the `git status --porcelain` output from step 3 — never
   from their contents. Flag a path that looks like a secret or a local-only file:
   `.env*` (other than `.env.example`), `.dev.vars`, `*.pem`, `*.key`, `id_rsa*`,
   `*credentials*`, `*.p12`. If anything is flagged, show the paths and ask with
   AskUserQuestion whether to proceed, gitignore them first, or abort. Do not stage
   anything until this is answered.

7. Ask both naming questions in **one** AskUserQuestion call, two questions, the same
   headers as 2A — `Branch` and `Commit`. The free-text "Other" field the tool appends
   is the expected path here, so the options exist only to save typing when one
   happens to fit. Build them mechanically, never by inventing a description of a
   diff you have not read:
   - from the hint, if the user gave one: its slugified form as a branch option, its
     imperative form as a commit option;
   - from the changed paths in step 3: the common top-level directory or the single
     changed file's stem (e.g. `src/lib/` → `update-src-lib`).

   If that yields fewer than two options for a question, pad with a neutral fallback
   (`10x-manual-change` / `Update <top-level path>`) and say in the description that
   it is a placeholder. Never present a mechanical option as if it described the
   change — the description says where it came from ("from your hint", "from the
   changed paths"), not what the change does.

8. Whatever comes back is authoritative. Do not improve the user's commit subject
   beyond the normalisation in step 9, and do not append a body, a `feat:`-style
   prefix or a trailing period.

### Both modes

9. Normalise the chosen branch name: force the `10x-` prefix, lowercase, ASCII only,
   hyphens for spaces, strip diacritics, max 44 characters total. Trim the commit
   subject to one line, 70 characters max.

10. Check the branch name: `git rev-parse --verify --quiet <name>`. If it already
    exists, append `-2` (then `-3`, ...) until free, and say which name you settled on.

## Phase 3 — Execute (stop on the first non-zero exit)

11. `git checkout -b <branch>` — carries the uncommitted changes over with it.
12. `git add -A` — `-A`, never `git add .`, so the result does not depend on cwd.
13. `git commit -m "<chosen message>"`
    A pre-commit hook may fail or may rewrite files. On non-zero exit: STOP and report;
    the user is now on the new branch with changes staged, so say that plainly.
14. `git push -u origin HEAD`
15. Surface the pull-request link. Do NOT shell out to `gh` — it is not installed here,
    and the push already gives you what you need.

    GitHub prints the ready-made link in the `git push` output from step 14:

    ```
    remote: Create a pull request for '<branch>' on GitHub by visiting:
    remote:      https://github.com/<owner>/<repo>/pull/new/<branch>
    ```

    Take that URL verbatim from the push output and put it in the report.

    If the push output did not contain one (the branch already existed upstream, or
    the host is not GitHub), build it from `git remote get-url origin` instead:
    strip any `.git` suffix and any `git@host:` form down to `https://<host>/<owner>/<repo>`,
    then append `/compare/DEFAULT...<branch>`.

    Opening the link in a browser is the user's step. Never treat a missing PR as a
    failed run — the branch is pushed either way, which is the part that mattered.
16. `git checkout DEFAULT`

## Phase 4 — Report

Four lines, nothing more:

```
Branch:  10x-<slug>  (pushed)
Commit:  <hash short>  <message>
PR:      <the pull/new or compare URL — open it to create the PR>
You are back on <DEFAULT> — the changes live on the branch, not here.
```

That last line matters: the user's working tree no longer contains the change they
just shipped. Always state it.

## Never

- `--force`, `--force-with-lease`, `--amend`, `reset --hard`, or anything that
  rewrites history
- pushing to DEFAULT
- committing when a RISK path is unresolved
- deleting the branch you just created
- reading the diff in manual mode to second-guess the name the user chose
