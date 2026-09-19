# Vetpad — Project Rules

Astro 7 SSR app (React 19 islands, Tailwind 4, Supabase auth) deployed to Cloudflare Workers. Product context: `@context/foundation/prd.md`, `@context/foundation/tech-stack.md`. Setup, env vars and deploy: `@README.md`. Scripts: `@package.json`. CI gate: `@.github/workflows/ci.yml`.

## Hard rules

### The project runs with zero configuration — keep it that way

- The app must start, build, lint and typecheck on a fresh clone with **no `.env`, no `.dev.vars`, no Supabase, no API keys**. Verified in that exact state: `npm run dev`, `npm run build`, `npm run lint` and `npx astro check` all pass, `/` and `/auth/signin` return 200, `/dashboard` redirects to `/auth/signin`, and `src/layouts/Layout.astro` renders the warning banner from `missingConfigs`. Only `npm run smoke` needs a live Supabase.
- **Never refuse to run, build, or implement a task because a secret or an external service is absent.** Missing configuration is a supported, first-class state of this app — not a blocker, and never a reason to stop and ask the user to set something up. Build the feature, let its integration degrade, and surface the gap in the banner.
- Every new integration repeats the existing pattern, in all four places: an `envField(...)` with `optional: true` in `@astro.config.mjs`; a factory that returns `null` when its secrets are missing (`src/lib/supabase.ts`); a null-check at every call site (`src/middleware.ts`, `src/pages/api/auth/signin.ts`); and a `ConfigStatus` entry in `src/lib/config-status.ts` so the absence shows up in the banner instead of as a crash.
- Never make an env field required, never `throw` at module load over a missing secret, and never let a route return 500 because an integration is unconfigured. Degrade the feature, keep the page rendering.

### Secrets and data access

- `createClient()` from `@/lib/supabase` returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` are unset. Null-check it before every use — see `src/middleware.ts` and `src/pages/api/auth/signin.ts`.
- Read those secrets only from `astro:env/server`. They are declared `access: "secret"` in `@astro.config.mjs` — never `process.env`, never client-side.
- `SUPABASE_KEY` is the **anon** key, and requests carry the user's cookie session (`@supabase/ssr` in `src/lib/supabase.ts`). Once tables exist, **row-level security is the only thing protecting data** — there is no authorisation layer in application code to fall back on. Treat a missing or permissive policy as a security bug, not a TODO.
- Never introduce a `service_role` key, and never reach for one to work around a policy that rejects a query: it bypasses RLS entirely. Fix the policy instead.
- Every new table gets `alter table … enable row level security` plus one policy per operation (select/insert/update/delete) and role — no `for all`, no `using (true)`. This lands in the first migration that creates the table, not in a later hardening pass.
- Scope those policies the way the PRD's requirements do. A note: `insert` sets the author from `auth.uid()` and never reassigns it, `update` and `delete` check it (FR-012, FR-015), `select` is open to every authenticated member (FR-013). Offers, searches and criteria: full CRUD for any member (Access Control, Roles) — and deleting an offer takes every member's notes with it, a cascade the PRD weighed and accepted (FR-015). "Flat roles, no restricted destructive actions" is the coarse summary of the same thing: the restriction is authorship, never a role tier.
- `@context/foundation/prd.md` binds this file. Where the PRD leaves something open, point at its open question instead of inventing an answer here; where it looks self-contradictory, fix the PRD rather than writing the resolution into a rule. `@context/foundation/shape-notes.md` is the longer record behind it — useful for _why_ a requirement reads as it does, never a source that overrides it.
- The model-provider key for the AI audit (`@context/foundation/prd.md`, FR-010) follows the zero-config pattern above and is **server-only**. Never call a model provider from a React island — islands ship to the browser and the key would land in the client bundle. Model calls belong in `src/pages/api/` or `src/lib/`. When adding it, remember all six places a secret has to land: `astro.config.mjs` schema, `.env`, `.dev.vars`, `.env.example`, plus the Cloudflare secrets and the GitHub repository secrets that `@.github/workflows/ci.yml` injects into the build.
- Only the listing's text and the team's criteria may be sent to the model provider. **Members' notes never leave the system** (`@context/foundation/prd.md`, Non-Functional Requirements): they are conclusions drawn from the audit, never an input to it (Business Logic). Feeding notes into the audit prompt looks like a quality improvement and is a privacy breach.
- **The advertiser's phone number and name never reach the database.** Both ingestion paths hand them to you: `ad.contactDetails.phones` / `ad.owner.contacts` when fetching otodom directly (`@context/foundation/ingestion/otodom_fetching.md`, section 1), and `sellerPhone` / `agencyName` through the extraction-service fallback — where `agencyName` holds a private seller's own name (`@context/foundation/ingestion/otodom_apify.md`, section 6.1). Drop them at the fetch boundary: no column stores them, no audit prompt receives them, and nothing in the product needs them. FR-004 saves the listing, not the seller.

### Cloudflare Workers runtime

- The deploy target is Cloudflare **Workers**, not Pages: `@wrangler.jsonc` sets `main` to the `@astrojs/cloudflare` server entrypoint and `@README.md` deploys with `npx wrangler deploy`. Never run `wrangler pages deploy`.
- The audit's ~3-minute budget (`@context/foundation/prd.md`, Non-Functional Requirements) fits in one HTTP request: the binding limit is **CPU time**, which waiting on `fetch` does not consume. The concrete ban is the next bullet; any other CPU-bound pass over a full page body gets its per-request CPU number checked in the Workers dashboard before it merges. Current per-plan numbers: <https://developers.cloudflare.com/workers/platform/limits/>.
- Do not parse a whole otodom.pl page inside the Worker: no HTML-parsing dependency (`cheerio`, `node-html-parser`, `linkedom`) enters `@package.json`, and no `src/pages/api/` handler builds a document or walks a DOM over the fetched page. For a single pasted listing (FR-004) the path is section 7.1 of `@context/foundation/ingestion/otodom_fetching.md`: fetch the offer page, pull `__NEXT_DATA__` out with one bounded `RegExp`, parse the JSON — no `buildId`, no pagination, no state. Section 1 of the same file lists the paths `robots.txt` puts off-limits, the GraphQL endpoint among them, and section 9.1 records what this platform does and does not let a scraper do. If ingestion ever stops working — `__NEXT_DATA__` gone, or otodom returning 403 to Cloudflare's egress IPs — the fallback is still not a parser inside the Worker: it is a third-party extraction service the Worker calls with one `fetch`, replacing the otodom scraper rather than sitting beside it. `@context/foundation/ingestion/otodom_apify.md` is the verified path for that, request shape and failure modes included; adopting it is a decision to raise with the user.
- Never use a module-scope variable as a cache, a queue, a lock or a job registry — that state belongs in Postgres.
- Before importing any `node:*` module, verify it is supported under `nodejs_compat` for the `compatibility_date` in `@wrangler.jsonc`. `node:child_process`, `node:worker_threads`, `node:vm` and `node:http2` are non-functional stubs, and they fail on a deployed request — not at `npm run build` or `npx astro check`.
- `.dev.vars` is the workerd half of the local setup (`@README.md`); missing it is the zero-config state above, not a gap to fill.

### Framework

- `output: "server"` is global. Do not add `prerender` exports; no route in `src/` uses one.
- Never write `"use client"` / `"use server"`. This is Astro, not Next.js; the directives do nothing and signal the wrong mental model for the file.

### Git

- Never commit or push directly to `master`, and never rewrite history (`--force`, `--amend`, `reset --hard`, `git branch -D`). Ship with `/git-ship`. The rest of the workflow is in `## Git workflow` below.

## Product invariants

These come from `@context/foundation/prd.md` (Success Criteria → Guardrails, Non-Functional Requirements). Each one looks like a reasonable default to break, and breaking any of them silently is a product failure, not a style slip.

- An attribute the listing does not state is never reported as "no", as `0`, or as any empty-looking falsy value — a fabricated fact could cost the team a flat. That semantic is binding; how it is _shown_ is not (`@context/foundation/prd.md`, Open Questions 2, owner: user). Pick a presentation and say that you picked it.
- **Human-authored notes are never overwritten by machine action.** A re-fetch (FR-009) replaces scraped listing data only; after it, every note reads exactly as its author left it.
- Every _positive_ audit finding — a red flag, a cost, a mandatory condition — carries a **verbatim excerpt** of the listing text it rests on. A finding that cannot be grounded in the text is not reported at all. Missing-data findings carry no excerpt, because an absence cannot be quoted. Two limits keep this extraction rather than inference (FR-011): a cost is reported only where the listing names it — "likely" costs were cut for exactly this reason — and missing-information findings cover only decision-critical attributes (floor, heating, ownership form), not an inventory of everything the text omits.
- A failed fetch is reported explicitly as a fetch problem. **Never create or save a blank, partial or silently empty offer.**
- No machine action re-runs or removes an audit. When the listing or the criteria change, the existing audit is flagged **stale** and the member is prompted to re-run it. Removal is always a deliberate member action; nothing expires on its own.
- Every fetch, re-fetch and audit is a **deliberate manual action** (Non-Goals). No scheduled jobs, no background re-scraping, no notifications.
- Audit correctness outranks audit speed and audit cost (`@context/foundation/prd.md`, Non-Functional Requirements). The audit calls `claude-opus-5`; a slower, pricier verdict that is right about Polish listing terminology is the trade the team chose. Swapping it for a smaller, faster or cheaper model to cut latency or spend is a decision to raise with the user, never a default. No provider SDK is in `@package.json` yet — the change that adds one updates this line to name it.

## Structure

Layout and route protection are in `@README.md`. The part it does not state: `src/middleware.ts` resolves the user into `context.locals.user`, typed in `src/env.d.ts`. shadcn's style, aliases and icon library: `@components.json`. Config: `@astro.config.mjs`, `@wrangler.jsonc`, `supabase/config.toml`.

## Commands

Scripts are in `@package.json`. Two commands CI runs that are **not** npm scripts: `npx astro sync` and `npx astro check` — run both locally before pushing, or the `ci` job fails on something `npm run lint` never sees.

## Conventions

- Import through the `@/*` alias, not deep relative paths.
- Default to `.astro`. Reach for a React island only when the component needs state, effects or DOM event handlers, and mount it with an explicit `client:*` directive — see `src/components/auth/SignInForm.tsx` mounted from `src/pages/auth/signin.astro` with `client:load`.
- React components are `PascalCase.tsx`. A form island default-exports (`src/components/auth/SignInForm.tsx`); a component it composes uses a named export (`src/components/auth/FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx`). `src/lib/` modules are kebab-case.
- Merge Tailwind classes with `cn()` from `@/lib/utils`; never concatenate class strings.
- API routes that back an HTML form submit read `FormData` and report failure by redirecting with `?error=<encoded message>` — never JSON. `src/pages/api/auth/signin.ts` is the reference and `signup.ts` follows it; `signout.ts` has no failure path — it redirects to `/` either way and skips the sign-out when Supabase is unconfigured, which is the zero-config rule above, not a gap to fill. An endpoint driven by `fetch` from a React island (progress polling, autosave, archive) may return JSON; when the first one exists, name it here as the reference instead of inventing a second style.
- Do not add `zod`, `valibot` or another validation library to `@package.json` without the user's explicit go-ahead. Validation is hand-rolled inline today. Expect this to come up for URL normalisation (FR-005) and for parsing the model's structured audit output — raise it as a decision, do not just install one.
- A rule in this file names a reference instance — never a count, never a paraphrase of a file that already states it. Write "`src/pages/api/auth/signin.ts` is the reference", not "all three auth routes". A count drifts silently; a named path fails loudly when it moves.

## Testing

There is no unit-test runner; `scripts/smoke.mjs` is the only test surface — what it covers and what it needs to run: `@README.md`. It is the only command that requires a live Supabase.

- Any change to the surface of `src/pages/api/` — adding a route, removing one, or changing an existing route's contract — must be reflected in `scripts/smoke.mjs`, and in the `smoke` job of `@.github/workflows/ci.yml` if the flow needs different setup.
- Concretely: FR-001 specifies pre-seeded accounts and **no registration**, so removing `/auth/signup` and `/api/auth/signup` will break every step in `scripts/smoke.mjs` that creates, or then reuses, the account it signs up inline. That change has to seed a test account in the CI job instead. Do not leave the smoke job red.
- Do not add `vitest`, `jest` or `playwright` to `@package.json` without the user's explicit go-ahead.

## Git workflow

Changes are written in the `master` working tree and leave it through `/git-ship` — so after shipping, the change is no longer in your tree. The skill's own description is the account of what it does; the part worth knowing before you start is that it stops when `master` is behind `origin`, and `/git-sync` (fast-forward only) is what unblocks it.

- Branch slugs are 2–5 words; `/git-ship` normalises the rest.
- Commit subjects: English, imperative, one line, 70 characters max, no `feat:`/`fix:` prefixes, no trailing period.
- Do not overstate automation. Because every fetch, re-fetch and audit is a deliberate manual action (see Product invariants), a message calling one of them "automatic" misdescribes the product. If the behaviour stops to ask the user, write "offer", "prompt" or "ask".
- PRs target `master`; both CI jobs must pass (`@.github/workflows/ci.yml`).

## Forward-looking (no instances in the repo yet)

When you create the first file in one of these directories, rewrite the entry to state the naming and placement that file uses, naming it inline as the reference instance (the way the entries under Conventions do). If a task decides against the directory, delete the entry in that same change.

- `supabase/migrations/` — create files with `supabase migration new <short_description>`, never by hand. The RLS policy rules every new table has to satisfy are under `### Secrets and data access` above. Only `supabase/config.toml` exists today; the app currently uses Supabase Auth's built-in `auth.users` only.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit — Module 1, Lesson 5

Pick a deployment platform and ship to production with the **infra chain**:

```text
(/10x-init  →  /10x-shape  →  /10x-prd  →  /10x-tech-stack-selector  →  /10x-bootstrapper  →  /10x-agents-md  →  /10x-rule-review  →  /10x-lesson)  →  /10x-infra-research  →  Plan Mode deploy
```

The full Module 1 chain ships from Lessons 1–4 (re-included so you can fix any earlier contract mid-flight). `/10x-infra-research` is the lesson's main topic; the deploy step itself uses the host's built-in **Plan Mode** rather than a dedicated skill — the artifact (`context/deployment/deploy-plan.md`) is what carries forward.

### Task Router — Where to start

| Skill | Use it when |
| --- | --- |
| **Infrastructure (lesson focus)** |  |
| `/10x-infra-research [path-to-tech-stack-or-prd]` | You have a `context/foundation/tech-stack.md` (and ideally a `prd.md`) and need to pick an MVP deployment platform. The skill loads the stack as a hard constraint, runs a 5-question developer interview (persistent connections, cost sensitivity, existing familiarity, global reach, co-location preference), spawns parallel subagent research across six candidate platforms, scores them Pass/Partial/Fail across the five agent-friendly criteria from `references/agent-friendly-criteria.md`, shortlists the top three, and runs a three-lens anti-bias cross-check on the leader (devil's advocate, pre-mortem, unknown unknowns) before writing `context/foundation/infrastructure.md`. Use AFTER `/10x-tech-stack-selector`, BEFORE `/10x-implement`. |
| **Deploy (host built-in, not a skill)** |  |
| Plan Mode deploy | You have `infrastructure.md` + `tech-stack.md` and want a read-only plan reviewed before any mutation hits the platform. Activate the host's plan mode (Claude Code: `Shift+Tab` cycles default → auto-accept → plan; IDE: dedicated button) with the prompt "Wykonajmy pierwsze wdrożenie w oparciu o `@infrastructure.md`, zgodnie ze stackiem z `@tech-stack.md`". Read the plan, demand corrections, approve, then let the agent execute. The approved plan persists at `context/deployment/deploy-plan.md` so the next lesson's milestone planning can reference what's already deployed and which secrets are already wired. |
| **Re-run upstream if needed** |  |
| `/10x-init` / `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-rule-review` / `/10x-lesson` / `/10x-stack-assess` / `/10x-health-check` | Bundled so you can patch any earlier contract mid-flight. If the anti-bias cross-check forces a platform swap that pushes a stack-shaped decision (e.g. "this DB doesn't fit any platform we'd accept"), re-run `/10x-tech-stack-selector` to keep `tech-stack.md` and `infrastructure.md` aligned. |

### How the chain hands off

- `/10x-infra-research` reads `context/foundation/tech-stack.md` (language, framework, runtime, database) as **hard constraints** — platforms that can't run the stack are dropped before scoring. It also reads `context/foundation/prd.md` (scale, latency, uptime expectations) as **soft weights** when scoring. Both inputs are optional but strongly recommended; without them the skill proceeds but warns.
- The skill writes `context/foundation/infrastructure.md` as the third foundation contract: frontmatter (`project`, `researched_at`, `recommended_platform`, `runner_up`, `context_type`, `tech_stack`) plus a body covering recommendation, full platform comparison with scoring matrix, anti-bias findings, operational story (preview / secrets / rollback / approval / logs), and a risk register tying every entry back to the lens that surfaced it. On collision the skill prompts: overwrite, save as `infrastructure-v2.md`, or abort.
- Plan Mode reads `infrastructure.md` and `tech-stack.md` together. The agent emits a step-by-step plan covering automated steps it owns, manual setup gates (account creation, secret configuration), exact deploy commands (Pages vs Workers commands are NOT interchangeable on Cloudflare — the plan must specify), and verification steps. The plan is rejected/edited until it's right; only then does Plan Mode exit and execution begin. The approved plan lands at `context/deployment/deploy-plan.md` and is consumed downstream by milestone-planning skills as ground truth for "what's already deployed".

### What the lesson's skills capture (and what they do NOT)

- **`/10x-infra-research` captures**: platform shortlist scored against five agent-friendly criteria (CLI quality, managed/serverless degree, agent-readable docs, stable/scriptable deploy API, MCP or first-class agent integration), three anti-bias outputs on the leader (numbered weaknesses, 150–200-word failure narrative, 3–5 unknown-unknowns), an operational story with one concrete answer per axis (not categories), and a risk register where every row names its source lens (`Devil's advocate` / `Pre-mortem` / `Unknown unknowns` / `Research finding`). Status of every non-GA feature is captured inline (`beta` / `preview` / `region-limited` / `deprecated`) with the date the status was checked.
- **`/10x-infra-research` does NOT** build Docker images or write Dockerfiles, configure CI/CD pipelines, or plan beyond MVP scope (multi-region HA is explicitly out of scope). It does NOT decide for you — the user accepts, swaps to runner-up, or aborts after the cross-check, and that decision is recorded in the output.
- **Plan Mode** captures: an explicit human gate between "agent has a plan" and "agent mutates production". The artifact (`deploy-plan.md`) is the audit trail for "what was supposed to happen" when the live run goes sideways. Plan Mode does NOT replace `/10x-infra-research` (the platform decision must already be made — Plan Mode plans the deploy, it doesn't pick where to deploy).

### The five agent-friendly criteria (and why they're load-bearing)

The criteria that make `/10x-infra-research`'s scoring matrix are not generic "good platform" axes — they're the specific traits that determine whether an agent can operate this platform from a session without you holding its hand:

1. **CLI-first** — every routine operation has a documented command; the agent doesn't need to click in a panel.
2. **Managed / serverless** — fewer moving pieces means fewer ways the agent (or you) breaks something the platform was supposed to handle.
3. **Agent-readable docs** — markdown / `llms.txt` / GitHub-hosted docs the agent can fetch and parse, not JS-rendered marketing pages.
4. **Stable, scriptable deploy API** — predictable exit codes, structured output, no interactive prompts mid-deploy.
5. **MCP server or first-class agent integration** — bonus, not required. CLI alone is fine for MVP; MCP earns its keep when the agent makes dozens of structured queries against live state.

Hard filters apply before scoring (persistent-connection requirement drops Netlify/Vercel serverless-only; tech-stack runtime mismatch drops the platform entirely). Interview answers reweight criteria after — cost sensitivity penalizes expensive base tiers, familiarity breaks ties, global-reach preference favours edge-native platforms, co-location preference favours integrated databases.

### Anti-bias as a decision discipline (not theatre)

Every research conversation with an LLM has a built-in tilt toward whatever the user already signalled. `/10x-infra-research` runs three structured lenses against the leader BEFORE the file is written, not after:

- **Devil's advocate** — _find the weaknesses, hidden costs, and failure modes specific to deploying `<this stack>` on `<this platform>`_. Output is a numbered list of 3–5 specifics, not categories.
- **Pre-mortem** — _six months later, this decision turned out to be a complete disaster; walk through the assumptions and underestimated risks that led there_. Output is a 150–200-word narrative; narratives surface concrete failure shapes that abstract risk lists hide.
- **Unknown unknowns** — _what's true about this combination that the marketing page and docs don't make obvious?_ Output is 3–5 non-obvious risks.

After the cross-check the user has three real options: **proceed with the leader and absorb the risks into the register**, **swap to runner-up** (and re-run the cross-check on the new leader), or **swap to third place**. The third option is rare; if it never happens across many runs, the cross-check has degraded into a ritual and should be rewritten.

Two additional techniques (no skill required, raw prompts) belong in the same toolbox: forcing the model to compare three alternatives in a markdown table (structure beats "the same answer in different words"), and role-rotation (the same decision through a frontend dev's, security person's, and cost owner's eyes — surface the cost each role pays and propose alternatives if any of them flinch).

### CLI vs MCP for live-infra operability

After deploy, the agent needs a way to talk to the running platform. Two paths, complementary not competing:

- **CLI** (`wrangler`, `flyctl`, `vercel`, `gh`) — explicit and auditable, output stays in the terminal, safer defaults for irreversible actions (e.g. `netlify deploy` is draft by default; `--prod` must be passed). Best for MVP: minimal setup, low context cost (no tool schemas pre-loaded), and the agent has to know the command (which is where a per-tool skill helps).
- **MCP** — a dedicated server exposing structured tools with schemas (`pages_deployments_list`, etc.). Each connected MCP server adds tool definitions to the context window, so cost compounds across servers. Earns its keep when the agent makes many discovery-style queries against live state (logs, deployment diffs) and structured JSON beats parsing CLI output.

Sensible default: start with CLI, add MCP when you notice a recurring pattern of `--help` traversal the agent has to do to answer a class of questions. Anthropic's own [building-agents-that-reach-production](https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp) framing is "API, CLI, and MCP are three complementary paths" — pick by task, not by hype.

### Production-access boundary (minimal permissions, human-on-irreversibles)

Both CLI and MCP can give the agent direct access to production. The lesson sets a default posture:

- **Tokens are scoped, not master keys.** On Cloudflare: an API token limited to Pages or Workers for one project, no DNS, no Workers Secrets for unrelated projects, no billing. AWS / GCP equivalent: scoped IAM role with `console-only-user` or read-only on production, full access on staging.
- **Tokens live in env vars, not in `.mcp.json` committed to the repo.** The agent picks them up via the MCP server or CLI's env-discovery, not via plaintext in conversation.
- **Destructive actions are human-only.** Drop a database, rotate a primary secret, delete a project — those are panel-by-hand operations, even if the agent suggests them. Manual click costs 30 seconds; cleanup after an automated mistake costs hours.

This is the MVP posture. As the project matures, the natural evolution is staging gets full agent access, production becomes read-only — covered in later modules.

### Foundation paths used by this lesson

- `context/foundation/tech-stack.md` — input (Lesson 2 hand-off, hard constraints)
- `context/foundation/prd.md` — input (Lesson 1 hand-off, soft weights)
- `context/foundation/infrastructure.md` — output (the third foundation contract)
- `context/deployment/deploy-plan.md` — output of Plan Mode deploy (audit trail of "what was supposed to happen")
- `context/foundation/lessons.md` — recurring rules & pitfalls (use `/10x-lesson` from Lesson 4 if you spot a class of agent failure during research or deploy)
- `docs/reference/contract-surfaces.md` — load-bearing names registry

### Universal language

The shipped skill carries no 10xDevs / cohort / certification references. The candidate platform list (Cloudflare, Vercel, Netlify, Fly.io, Railway, Render) is the starting research lens, not a recommendation set — the scoring + interview + cross-check pipeline is what's load-bearing, and a platform absent from the default list can be added by extending the research step. The five agent-friendly criteria are the artifact's true core; `/10x-infra-research` re-reads them from `references/agent-friendly-criteria.md` so they evolve as platforms do.

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
