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

### Cloudflare Workers runtime

- The deploy target is Cloudflare **Workers**, not Pages: `@wrangler.jsonc` sets `main` to the `@astrojs/cloudflare` server entrypoint and `@README.md` deploys with `npx wrangler deploy`. `@context/foundation/tech-stack.md` says `cloudflare-pages` in its front matter — that hint is stale; never run `wrangler pages deploy`.
- An HTTP-triggered Worker has no wall-clock limit while the client stays connected. The binding limit is **CPU time**, and waiting on `fetch` does not consume it — so the audit's ~3-minute budget (`@context/foundation/prd.md`, Non-Functional Requirements) fits in a single request, while heavy in-process work does not. Check the current per-plan numbers at <https://developers.cloudflare.com/workers/platform/limits/> rather than assuming them.
- Do not parse a whole otodom.pl page inside the Worker: no HTML-parsing dependency (`cheerio`, `node-html-parser`, `linkedom`) enters `@package.json`, and no `src/pages/api/` handler builds a document or walks a DOM over the fetched page. For a single pasted listing (FR-004) the path is section 7.1 of `@context/foundation/ingestion/otodom_fetching.md`: fetch the offer page, pull `__NEXT_DATA__` out with one bounded `RegExp`, parse the JSON — no `buildId`, no pagination, no state. Section 1 of the same file lists the paths `robots.txt` puts off-limits, the GraphQL endpoint among them. Per-request CPU time is visible in the Workers dashboard — `observability` is enabled in `@wrangler.jsonc`.
- Never use a module-scope variable as a cache, a queue, a lock or a job registry — that state belongs in Postgres.
- Default to Web APIs (`fetch`, `URL`, `crypto.subtle`). Before importing any `node:*` module, verify it is supported under `nodejs_compat` for the `compatibility_date` in `@wrangler.jsonc`; `node:fs` is not.
- Miss `.dev.vars` (the workerd half of the local setup in `@README.md`) and the dev server still starts — the secrets are simply absent, `createClient()` returns `null`, auth is disabled, and the most visible signal is the error banner `src/layouts/Layout.astro` renders from `missingConfigs` (a failing `npm run smoke` is the other).

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
- Audit correctness outranks audit speed and audit cost (`@context/foundation/prd.md`, Non-Functional Requirements). Reach for the most capable model rather than the cheapest or the fastest: a slower, pricier verdict that is right about Polish listing terminology is the trade the team chose.

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

There is no unit-test runner; `scripts/smoke.mjs` is the only test surface — what it covers and what it needs to run: `@README.md`. It is the only command that requires a live Supabase (with email confirmation disabled).

- Any change to the surface of `src/pages/api/` — adding a route, removing one, or changing an existing route's contract — must be reflected in `scripts/smoke.mjs`, and in the `smoke` job of `@.github/workflows/ci.yml` if the flow needs different setup.
- Concretely: FR-001 specifies pre-seeded accounts and **no registration**, so removing `/auth/signup` and `/api/auth/signup` will break every step in `scripts/smoke.mjs` that creates, or then reuses, the account it signs up inline. That change has to seed a test account in the CI job instead. Do not leave the smoke job red.
- Do not add `vitest`, `jest` or `playwright` to `@package.json` without the user's explicit go-ahead.

## Git workflow

Changes are written in the `master` working tree and leave it through `/git-ship` — so after shipping, the change is no longer in your tree. The skill's own description is the account of what it does; the part worth knowing before you start is that it stops when `master` is behind `origin`, and `/git-sync` (fast-forward only) is what unblocks it.

- Branch slugs are 2–5 words; `/git-ship` normalises the rest (the `10x-` prefix, case, ASCII, hyphens, length).
- Commit subjects: English, imperative, one line, 70 characters max, no `feat:`/`fix:` prefixes, no trailing period.
- Do not overstate automation. Because every fetch, re-fetch and audit is a deliberate manual action (see Product invariants), a message calling one of them "automatic" misdescribes the product. If the behaviour stops to ask the user, write "offer", "prompt" or "ask".
- PRs target `master`; both CI jobs must pass (`@.github/workflows/ci.yml`).

## Forward-looking (no instances in the repo yet)

When you create the first file in one of these directories, rewrite the entry to state the naming and placement that file uses, naming it inline as the reference instance (the way the entries under Conventions do). If a task decides against the directory, delete the entry in that same change.

- `supabase/migrations/` — create files with `supabase migration new <short_description>`, never by hand. The RLS policy rules every new table has to satisfy are under `### Secrets and data access` above. Only `supabase/config.toml` exists today; the app currently uses Supabase Auth's built-in `auth.users` only.
