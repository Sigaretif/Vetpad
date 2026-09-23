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
- **The advertiser's phone number and name never reach the database.** Both ingestion paths hand them to you: `ad.contactDetails.phones` / `ad.owner.contacts` when fetching otodom directly (`@context/foundation/ingestion/otodom_fetching.md`, section 1), and `sellerPhone` / `agencyName` through the extraction-service fallback — where `agencyName` holds a private seller's own name (`@context/foundation/ingestion/otodom_apify.md`, section 6.1). Drop them at the fetch boundary: no column stores them, no audit prompt receives them, and nothing in the product needs them. FR-004 saves the listing, not the seller. The rule covers the structured fields and the `raw` column: `raw` is built from a whitelist of `ad` keys, never by deleting known fields, and `target` is narrowed to `OfferType`/`ProperType` because it repeats the seller's account id (`src/lib/otodom/map.ts` is the reference). What happens to a contact the advertiser typed into the listing's own text is decided in `@context/foundation/prd.md`, Non-Functional Requirements — follow it there.

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
- A page that has to answer 404 sets `Astro.response.status = 404` and renders its not-found branch; a top-level `return` in `.astro` frontmatter crashes the `@typescript-eslint/no-misused-promises` rule in `npm run lint`. `src/pages/offers/[id].astro` is the reference.

### Git

- Never rewrite history (`--force`, `--amend`, `reset --hard`, `git branch -D`), and never commit or push by hand — commits and pushes go through a skill, never through a raw `git commit` or `git push`.
- `/10x-implement` is the skill that commits during implementation: its phase-end commit ritual and its epilogue commit land on the branch you are standing on — normally local `master` — and stay local. It never pushes. Local `master` ahead of `origin/master` by those commits is an expected state, not a mess to clean up by hand.
- Two skills push, and **the agent asks which one before it starts, every time** — it never picks for the user. Both take the local commits ahead of `origin/master` (typically `/10x-implement`'s) together with anything still uncommitted; either part may be empty. `/git-ship` is the reviewed path: a `10x-` branch, a push, a pull request, and the user back on `master` — level with `origin/master` — with a clean tree. `/git-land` is the unreviewed one: it commits what is uncommitted on `master` and pushes `master` straight to `origin`, local commits included, no branch and no PR, and it aborts unless the user is already standing on `master`. Neither is the default, because the choice is the user's; when the answer is "whichever", that means `/git-ship`, since a PR can be closed and a push to `master` cannot be taken back. The rest of the workflow is in `## Git workflow` below.

## Product invariants

These come from `@context/foundation/prd.md` (Success Criteria → Guardrails, Non-Functional Requirements). Each one looks like a reasonable default to break, and breaking any of them silently is a product failure, not a style slip.

- An attribute the listing does not state is never reported as "no", as `0`, or as any empty-looking falsy value — a fabricated fact could cost the team a flat. The presentation is settled in `@context/foundation/prd.md` (Open Questions, resolved block); `src/components/offers/Unstated.astro` is the reference.
- **The source hands you that falsy value already made.** Verified on a live offer 2026-09-20: otodom returns `characteristics.rent` as the string `"0"`, not as an absent key. Mapped straight through, the card reads "Czynsz: 0 zł" — an invented fact about a building where it is almost never true, and the guardrail above is broken by code that looks correct. It also omits the key entirely, and sends `"1"` on a rental. Every numeric characteristic goes through one function — key absent, empty, unparseable or `≤ 0` is unknown — `numericOrUnknown` in `src/lib/otodom/map.ts`. The traps are documented at `@context/foundation/ingestion/otodom_fetching.md` § 7.1.
- **Only a sale of a flat is saved** (`@context/foundation/prd.md`, FR-005). A rental or another property type is refused after the fetch with nothing stored. The discriminator is `ad.adCategory`, never `ad.category` — the latter's `name` is an empty array, so a gate built on it passes everything (`@context/foundation/ingestion/otodom_fetching.md` § 7.4).
- **Human-authored notes are never overwritten by machine action.** A re-fetch (FR-009) replaces scraped listing data only; after it, every note reads exactly as its author left it.
- Every _positive_ audit finding — a red flag, a cost, a mandatory condition — carries a **verbatim excerpt** of the listing text it rests on. A finding that cannot be grounded in the text is not reported at all. Missing-data findings carry no excerpt, because an absence cannot be quoted. Two limits keep this extraction rather than inference (FR-011): a cost is reported only where the listing names it — "likely" costs were cut for exactly this reason — and missing-information findings cover only decision-critical attributes (floor, heating, ownership form), not an inventory of everything the text omits.
- A failed fetch is reported explicitly as a fetch problem. **Never create or save a blank, partial or silently empty offer.**
- No machine action re-runs or removes an audit. When the listing or the criteria change, the existing audit is flagged **stale** and the member is prompted to re-run it. Removal is always a deliberate member action; nothing expires on its own.
- Every fetch, re-fetch and audit is a **deliberate manual action** (Non-Goals). No scheduled jobs, no background re-scraping, no notifications.
- Audit correctness outranks audit speed and audit cost (`@context/foundation/prd.md`, Non-Functional Requirements). The audit calls `claude-opus-5`; a slower, pricier verdict that is right about Polish listing terminology is the trade the team chose. Swapping it for a smaller, faster or cheaper model to cut latency or spend is a decision to raise with the user, never a default. No provider SDK is in `@package.json` yet — the change that adds one updates this line to name it.

## Structure

Layout and route protection are in `@README.md`. The part it does not state: `src/middleware.ts` resolves the user into `context.locals.user`, typed in `src/env.d.ts`. shadcn's style, aliases and icon library: `@components.json`. Config: `@astro.config.mjs`, `@wrangler.jsonc`, `supabase/config.toml`.

- `src/lib/otodom/` is the ingestion module: URL normalisation, the page fetch, and the mapper that holds the flat-sale gate, the unknown-not-zero rule and the personal-data whitelist. `src/pages/api/offers.ts` is the reference domain form route (one distinguishable `?error=` message per failure reason), and `src/pages/offers/[id].astro` is the offer card page, protected through `PROTECTED_ROUTES` in `src/middleware.ts`.
- `supabase/migrations/` — create files with `supabase migration new <short_description>`, never by hand. `supabase/migrations/20260922202756_create_offers.sql` is the reference for a new table: RLS enabled and one policy per operation for `authenticated` in the creating migration, none for `anon`, per the rules under `### Secrets and data access`. Migrations reach the hosted project with `supabase db push`, run by a human before the Worker that needs them deploys (`@context/foundation/deployment-runbook.md`).
- `supabase/seed.sql` is the reference for local-only fixtures: it creates three confirmed `@vetpad.local` accounts so note attribution (FR-013) can be exercised against a local database. It is wired through `[db.seed]` in `supabase/config.toml` and runs on `supabase db reset` and on a fresh `supabase start`. Two rules it carries. Its credentials are published — the repository is public — so nothing that is a real address or a reused password goes in it. And seeds are **not** inherently local: `supabase db reset --linked` wipes the hosted database and runs this file against it; `supabase db push` does not run seeds. `scripts/smoke.mjs` signs in with `sigaretif1@vetpad.local` from this file, so removing or renaming that account breaks the smoke job.

## Commands

Scripts are in `@package.json`. Two commands CI runs that are **not** npm scripts: `npx astro sync` and `npx astro check` — run both locally before pushing, or the `ci` job fails on something `npm run lint` never sees.

## Conventions

- Import through the `@/*` alias, not deep relative paths.
- Default to `.astro`. Reach for a React island only when the component needs state, effects or DOM event handlers, and mount it with an explicit `client:*` directive — see `src/components/auth/SignInForm.tsx` mounted from `src/pages/auth/signin.astro` with `client:load`.
- React components are `PascalCase.tsx`. A form island default-exports (`src/components/auth/SignInForm.tsx`); a component it composes uses a named export (`src/components/auth/FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx`). `src/lib/` modules are kebab-case.
- Merge Tailwind classes with `cn()` from `@/lib/utils`; never concatenate class strings.
- API routes that back an HTML form submit read `FormData` and report failure by redirecting with `?error=<encoded message>` — never JSON. `src/pages/api/auth/signin.ts` is the reference; `signout.ts` has no failure path — it redirects to `/` either way and skips the sign-out when Supabase is unconfigured, which is the zero-config rule above, not a gap to fill. An endpoint driven by `fetch` from a React island (progress polling, autosave, archive) may return JSON; when the first one exists, name it here as the reference instead of inventing a second style.
- Do not add `zod`, `valibot` or another validation library to `@package.json` without the user's explicit go-ahead. Validation is hand-rolled inline today — `src/lib/otodom/url.ts` is the reference for URL normalisation (FR-005). Expect this to come up again for parsing the model's structured audit output — raise it as a decision, do not just install one.
- A rule in this file names a reference instance — never a count, never a paraphrase of a file that already states it. Write "`src/pages/api/auth/signin.ts` is the reference", not "all three auth routes". A count drifts silently; a named path fails loudly when it moves.

### UI

- A new view is built only from the tokens in `src/styles/global.css` — role classes such as `bg-card`, `text-muted-foreground`, `text-link` — and the components in `src/components/ui`. A colour literal in a view (`white/10`, `blue-100/80`, a hex) is a bug. The dark theme is the only one; `class="dark"` in `src/layouts/Layout.astro` switches it on.
- A new app view renders inside `src/layouts/AppLayout.astro` (frame, Topbar, a `notice` slot for page banners); `src/pages/offers/[id].astro` is the reference. `bg-cosmic` and `backdrop-blur` on the views not yet migrated are legacy, not a pattern to copy.
- A missing primitive comes from `npx shadcn add <name>`, followed in the same change by the ritual the CLI makes necessary here: import `cn` from `@/lib/utils`, delete `"use client"`, import `Slot` from `@radix-ui/react-slot` (`src/components/ui/button.tsx` is the reference), and drop the `cn` and `radix-ui` packages from `@package.json` if the CLI added them.
- A change to how the offer card looks goes through `/dev/offer-card` (`src/pages/dev/offer-card.astro`, fixtures in `src/pages/dev/_offer-fixtures.ts`): screenshot every state. A new card state gets a fixture there. The page renders under `astro dev` only and answers 404 everywhere else, which `scripts/smoke.mjs` checks on the production preview.

## Testing

There is no unit-test runner; `scripts/smoke.mjs` is the only test surface — what it covers and what it needs to run: `@README.md`. It is the only command that requires a live Supabase.

- Any change to the surface of `src/pages/api/` — adding a route, removing one, or changing an existing route's contract — must be reflected in `scripts/smoke.mjs`, and in the `smoke` job of `@.github/workflows/ci.yml` if the flow needs different setup.
- `scripts/smoke.mjs` signs in with an account from `supabase/seed.sql` and checks that registration is closed, both in the app's routes and in Supabase Auth (FR-001). A change that re-enables registration, or removes that account from the seed, turns the smoke job red.
- Do not add `vitest`, `jest` or `playwright` to `@package.json` without the user's explicit go-ahead.
- `scripts/otodom-inspect.mjs` (`npm run otodom:inspect -- <url>`) is a debugging tool that hits the live portal, not a test surface: it never runs in CI, and smoke must never reach otodom.pl.

## Git workflow

Changes are written in the `master` working tree, may be committed there phase by phase by `/10x-implement`, and leave it through one of two skills, and the agent asks which one rather than assuming (see `### Git` above). Each skill's own description is the account of what it does; the parts worth knowing before you start are these. `/git-ship` moves the change — local commits and uncommitted work alike — onto a branch, so afterwards it is no longer in your tree: it points local `master` back at `origin/master` once the branch is pushed. That is a ref move, not a rewrite — the commits keep their SHAs on the branch, so the SHAs `/10x-implement` wrote into `## Progress` stay valid. `/git-land` leaves it where it is and pushes `master` itself, so afterwards your tree is clean but the change is on the default branch with nothing between it and `origin` — it confirms once before that push, listing the local commits it is about to publish. Both stop when `master` is behind `origin`, and `/git-sync` (fast-forward only) is what unblocks them — unless `master` also carries local commits, in which case the two have diverged, `/git-sync` refuses too, and the call is the user's.

- Branch slugs are 2–5 words; `/git-ship` normalises the rest. `/git-land` asks for no slug — it creates no branch. When the change folder is known, its `<change-id>` is the natural slug.
- Commit subjects: English, imperative, one line, 70 characters max, no `feat:`/`fix:` prefixes, no trailing period. The one exception is `/10x-implement`: its commits use the skill's own Conventional-Commits form, `<type>(<change-id>): <phase title> (p<N>)`, and that format wins for the commits it authors.
- Do not overstate automation. Because every fetch, re-fetch and audit is a deliberate manual action (see Product invariants), a message calling one of them "automatic" misdescribes the product. If the behaviour stops to ask the user, write "offer", "prompt" or "ask".
- PRs target `master`; both CI jobs must pass (`@.github/workflows/ci.yml`). A `/git-land` push skips that gate entirely — CI runs on `master` after the fact, so anything that would not survive review belongs in a PR.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 4

Prepare for a harder implementation stream with the **research-backed planning chain**:

```
internal research (/10x-research) + external research (exa.ai, Context7) -> /10x-plan -> /10x-implement -> success
```

The lesson focus is distinguishing internal from external research and using evidence to back planning decisions.

### Task Router - Where to start

| Skill                                                            | Use it when                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Internal research (lesson focus)**                             |                                                                                                                                                                                                                                                |
| `/10x-research <change-id>`                                      | You need evidence from the existing codebase — patterns, conventions, integration points, or existing implementations. Runs parallel sub-agents over the repo and writes structured findings to `research.md`.                                 |
| **External research (lesson focus)**                             |                                                                                                                                                                                                                                                |
| exa.ai                                                           | You need AI-native web search for library comparisons, best practices, or ecosystem context that the codebase cannot answer.                                                                                                                   |
| Context7 (`resolve-library-id` → `get-library-docs`)             | You need live, current documentation for a specific library or framework. Resolves a library ID first, then fetches relevant doc pages.                                                                                                        |
| **Framing spare wheel**                                          |                                                                                                                                                                                                                                                |
| `/10x-frame <change-id>`                                         | The plan won't converge, the plan doesn't deliver expected results, or persistent drift keeps breaking the implementation. Use as an escape hatch on a separate problem (demonstrated on Space Explorers example), not as pre-research ritual. |
| **Planning and execution**                                       |                                                                                                                                                                                                                                                |
| `/10x-plan <change-id>` / `/10x-implement <change-id> phase <n>` | Use the same planning and execution chain from Lesson 2, now with upstream research evidence feeding the plan.                                                                                                                                 |

### Research discipline

- Internal research (`/10x-research`) answers "what does our codebase already do?" — patterns, schemas, conventions, integration points.
- External research (exa.ai, Context7) answers "what should we do?" — library capabilities, API docs, ecosystem best practices.
- Combine both as evidence-backed input to `/10x-plan`. A plan without research evidence on a non-trivial stream is a guess.
- Agent-friendly docs (`llms.txt`, markdown-for-agents, `/md` endpoints) are a quality signal for library selection — libraries that publish agent-readable docs integrate faster.

### `/10x-frame` as spare wheel

Three triggers for reaching for `/10x-frame`:

1. The plan won't converge — research keeps opening more questions instead of narrowing to a contract.
2. The plan doesn't deliver — implementation repeatedly fails to meet success criteria.
3. Persistent drift — the implementation keeps diverging from the plan in ways that suggest the problem was mis-framed.

Demonstrated on a Space Explorers example, not the SRS path. It is an escape hatch, not a mandatory step.

### Paths used by this lesson

- `context/changes/<change-id>/research.md` - internal research output
- `context/changes/<change-id>/frame.md` - framing output when needed
- `context/changes/<change-id>/plan.md` - evidence-backed implementation contract
- `context/foundation/lessons.md` - recurring rules and pitfalls

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
