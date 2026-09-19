---
bootstrapped_at: 2026-09-19T13:15:32Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: vetpad
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Source: `context/foundation/tech-stack.md`

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: vetpad
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Vetpad is a small, shared web app with a hard three-week after-hours deadline, so the
stack was chosen to eliminate setup decisions rather than to maximise flexibility. The
10x Astro Starter ships the four things the PRD makes mandatory — real per-person
authentication (a binding external constraint), a relational store for criteria, offers
and attributed notes, server-side routes that can fetch otodom.pl listings and call a
model provider, and a deploy path — as one pinned, opinionated bundle. It passes all
four agent-friendly gates: TypeScript with explicit schemas at boundaries, strong
layout and routing conventions, heavy representation in training data, and current
version-pinned documentation. Supabase's Postgres plus auth covers Access Control
without hand-rolling identity, and its row-level security is the natural home for the
shared-workspace model. Java + Spring Boot was the familiar alternative but supplies no
frontend, which the timeline cannot absorb. The known tension: Cloudflare's edge runtime
is the tightest option for the PRD's ~3-minute audit budget, and Supabase RLS must be
configured early or authorisation gaps accumulate quietly.

## Pre-scaffold verification

| Signal      | Value                                                          | Severity | Notes                                                                                     |
| ----------- | -------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| npm package | not run                                                         | n/a      | `cmd_template` starts with `git clone`; no npm-distributed `create-*` CLI to resolve        |
| GitHub repo | `przeprogramowani/10x-astro-starter` last pushed 2026-09-12T21:16:08Z | fresh    | from `card.docs_url`; 7 days before run. `gh` CLI unavailable — read-only GitHub REST call used instead |

No stale signal. Proceeded without a heads-up.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (clone starter repo, drop its history, move files up)
**Exit code**: 0
**Files moved**: 30719
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently (no pre-existing `.gitignore` in cwd)
**.bootstrap-scaffold cleanup**: deleted
**Upstream `.git/` handling**: deleted before move-up; no starter history leaked into this directory

### File-by-file move log

| Path                | Resolution              |
| ------------------- | ----------------------- |
| `AGENTS.md`         | moved                   |
| `astro.config.mjs`  | moved                   |
| `CLAUDE.md`         | sidelined → `CLAUDE.md.scaffold` (existing file wins) |
| `components.json`   | moved                   |
| `eslint.config.js`  | moved                   |
| `node_modules/`     | moved (30669 files)     |
| `package.json`      | moved                   |
| `package-lock.json` | moved                   |
| `public/`           | moved (3 files)         |
| `README.md`         | moved                   |
| `scripts/`          | moved (1 file)          |
| `src/`              | moved (26 files)        |
| `supabase/`         | moved (2 files)         |
| `tsconfig.json`     | moved                   |
| `wrangler.jsonc`    | moved                   |
| `.env.example`      | moved                   |
| `.github/`          | moved (1 file)          |
| `.gitignore`        | moved                   |
| `.husky/`           | moved (1 file)          |
| `.nvmrc`            | moved                   |
| `.prettierrc.json`  | moved                   |
| `.vscode/`          | moved (3 files)         |

`context/` was preserved verbatim; the scaffold carried no `context/` paths, so nothing was dropped.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Exit code**: 0
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW (0 INFO)
**Dependency tree**: 804 total (377 prod, 269 dev, 167 optional)
**Direct vs transitive**: not applicable — no findings to split

#### CRITICAL findings

None.

#### HIGH findings

None.

#### MODERATE findings

None.

#### LOW / INFO findings

None.

Raw `metadata.vulnerabilities`: `{"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0, "total": 0}`

## Hints recorded but not acted on

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | true                   |
| has_background_jobs     | false                  |

No CI/CD scaffolding, no auth/AI wiring, and no deployment configuration were derived from these values in v1. They are carried forward here for the future agent-context skill.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` against your existing `CLAUDE.md` (`diff CLAUDE.md CLAUDE.md.scaffold`) and decide which version of each part to keep.
- Copy `.env.example` to `.env` and fill in your Supabase and model-provider credentials.
- Configure Supabase row-level security early — the hand-off flags it as the stack's main tension.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log (currently clean).
