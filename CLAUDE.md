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
- `SUPABASE_KEY` is the **publishable** key (`sb_publishable_…`, the key Supabase used to call `anon`), and requests carry the user's cookie session (`@supabase/ssr` in `src/lib/supabase.ts`). Once tables exist, **row-level security is the only thing protecting data** — there is no authorisation layer in application code to fall back on. Treat a missing or permissive policy as a security bug, not a TODO.
- Never introduce a `service_role` / `secret` key (`sb_secret_…`), and never reach for one to work around a policy that rejects a query: it bypasses RLS entirely. Fix the policy instead.
- Every new table gets `alter table … enable row level security` plus one policy per operation (select/insert/update/delete) and role — no `for all`, no `using (true)`. This lands in the first migration that creates the table, not in a later hardening pass.
- The hosted Supabase project runs with **Data API on, automatic exposure of new tables on, and automatic RLS on**. Two things follow. A migration needs no `grant`: Supabase already grants `select/insert/update/delete` on every new `public` table to `anon` and `authenticated`. And because that grant is automatic, **the RLS policy is the single gate, not the second of two** — a table whose policies are missing or permissive is reachable by anyone holding the publishable key, including an unauthenticated visitor. Write the policies in the creating migration and treat a gap as a live exposure, not a TODO.
- Know the two denial signatures, because the tempting fix for both is the one thing that is never the fix. RLS on with no `select` policy returns an **empty array and HTTP 200** — it looks like missing data, not like a permission error. A blocked write fails with `new row violates row-level security policy`. Neither is repaired with a `secret` / `service_role` key; both are repaired in the policy.
- Scope those policies the way the PRD's requirements do. A note: `insert` sets the author from `auth.uid()` and never reassigns it, `update` and `delete` check it (FR-012, FR-015), `select` is open to every authenticated member (FR-013). Offers, searches and criteria: full CRUD for any member (Access Control, Roles) — and deleting an offer takes every member's notes with it, a cascade the PRD weighed and accepted (FR-015). "Flat roles, no restricted destructive actions" is the coarse summary of the same thing: the restriction is authorship, never a role tier.
- `@context/foundation/prd.md` binds this file. Where the PRD leaves something open, point at its open question instead of inventing an answer here; where it looks self-contradictory, fix the PRD rather than writing the resolution into a rule. `@context/foundation/shape-notes.md` is the longer record behind it — useful for _why_ a requirement reads as it does, never a source that overrides it.
- The model-provider key for the AI audit (`@context/foundation/prd.md`, FR-010) follows the zero-config pattern above and is **server-only**. Never call a model provider from a React island — islands ship to the browser and the key would land in the client bundle. Model calls belong in `src/pages/api/` or `src/lib/`. When adding it, remember all six places a secret has to land: `astro.config.mjs` schema, `.env`, `.dev.vars`, `.env.example`, plus the Cloudflare secrets and the GitHub repository secrets that `@.github/workflows/ci.yml` injects into the build.
- Only the listing's text and the team's criteria may be sent to the model provider. **Members' notes never leave the system** (`@context/foundation/prd.md`, Non-Functional Requirements): they are conclusions drawn from the audit, never an input to it (Business Logic). Feeding notes into the audit prompt looks like a quality improvement and is a privacy breach.
- **The advertiser's phone number and name never reach the database.** Both ingestion paths hand them to you: `ad.contactDetails.phones` / `ad.owner.contacts` when fetching otodom directly (`@context/foundation/ingestion/otodom_fetching.md`, section 1), and `sellerPhone` / `agencyName` through the extraction-service fallback — where `agencyName` holds a private seller's own name (`@context/foundation/ingestion/otodom_apify.md`, section 6.1). Drop them at the fetch boundary: no column stores them, no audit prompt receives them, and nothing in the product needs them. FR-004 saves the listing, not the seller.

### Cloudflare Workers runtime

- **Deploying, debugging production, or hitting something that looks like a platform bug: read `@context/foundation/deployment-runbook.md` first.** It records what the platform actually did during the first deploy, including a table of symptoms that name the wrong cause — `1102` reads like an application bug and is a plan limit, a silent Workers Builds is a branch-name default, a paused Supabase project breaks login without raising the config banner. It also holds the rollback, log and contingency procedures, and the trigger conditions for the Apify fallback and for buying Workers Paid.
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

- Never rewrite history (`--force`, `--amend`, `reset --hard`, `git branch -D`), and never commit or push by hand — a change leaves the tree through a skill, never through a raw `git push`.
- Two skills do that, and **the agent asks which one before it starts, every time** — it never picks for the user. `/git-ship` is the reviewed path: a `10x-` branch, a push, a pull request, and the user back on `master` with a clean tree. `/git-land` is the unreviewed one: it commits on `master` and pushes straight to `origin`, no branch and no PR, and it aborts unless the user is already standing on `master`. Neither is the default, because the choice is the user's; when the answer is "whichever", that means `/git-ship`, since a PR can be closed and a push to `master` cannot be taken back. The rest of the workflow is in `## Git workflow` below.

## Product invariants

These come from `@context/foundation/prd.md` (Success Criteria → Guardrails, Non-Functional Requirements). Each one looks like a reasonable default to break, and breaking any of them silently is a product failure, not a style slip.

- An attribute the listing does not state is never reported as "no", as `0`, or as any empty-looking falsy value — a fabricated fact could cost the team a flat. That semantic is binding; how it is _shown_ is not (`@context/foundation/prd.md`, Open Questions 2, owner: user). Pick a presentation and say that you picked it.
- **The source hands you that falsy value already made.** Verified on a live offer 2026-09-20: otodom returns `characteristics.rent` as the string `"0"`, not as an absent key. Mapped straight through, the card reads "Czynsz: 0 zł" — an invented fact about a building where it is almost never true, and the guardrail above is broken by code that looks correct. Treat `"0"` from `rent` as unknown, and audit every other numeric characteristic the same way before trusting it. The trap is documented at the field map in `@context/foundation/ingestion/otodom_fetching.md` § 7.1.
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

Changes are written in the `master` working tree and leave it through one of two skills, and the agent asks which one rather than assuming (see `### Git` above). Each skill's own description is the account of what it does; the parts worth knowing before you start are these. `/git-ship` moves the change onto a branch, so afterwards it is no longer in your tree. `/git-land` leaves it where it is and pushes `master` itself, so afterwards your tree is clean but the change is on the default branch with nothing between it and `origin` — it confirms once before that push. Both stop when `master` is behind `origin`, and `/git-sync` (fast-forward only) is what unblocks them.

- Branch slugs are 2–5 words; `/git-ship` normalises the rest. `/git-land` asks for no slug — it creates no branch.
- Commit subjects: English, imperative, one line, 70 characters max, no `feat:`/`fix:` prefixes, no trailing period.
- Do not overstate automation. Because every fetch, re-fetch and audit is a deliberate manual action (see Product invariants), a message calling one of them "automatic" misdescribes the product. If the behaviour stops to ask the user, write "offer", "prompt" or "ask".
- PRs target `master`; both CI jobs must pass (`@.github/workflows/ci.yml`). A `/git-land` push skips that gate entirely — CI runs on `master` after the fact, so anything that would not survive review belongs in a PR.

## Forward-looking (no instances in the repo yet)

When you create the first file in one of these directories, rewrite the entry to state the naming and placement that file uses, naming it inline as the reference instance (the way the entries under Conventions do). If a task decides against the directory, delete the entry in that same change.

- `supabase/migrations/` — create files with `supabase migration new <short_description>`, never by hand. The RLS policy rules every new table has to satisfy are under `### Secrets and data access` above. The directory does not exist yet; the app currently uses Supabase Auth's built-in `auth.users` only.
- `supabase/seed.sql` is the reference for local-only fixtures: it creates three confirmed `@vetpad.local` accounts so note attribution (FR-013) can be exercised against a local database. It is wired through `[db.seed]` in `supabase/config.toml` and runs on `supabase db reset` and on a fresh `supabase start`. Two rules it carries. Its credentials are published — the repository is public — so nothing that is a real address or a reused password goes in it. And seeds are **not** inherently local: `supabase db reset --linked` wipes the hosted database and runs this file against it. Migrations reach the hosted project with `supabase db push`, which does not run seeds.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
