# Vetpad — Project Rules

Astro 7 SSR app (React 19 islands, Tailwind 4, Supabase auth) deployed to Cloudflare Workers. Product context: `@context/foundation/prd.md`, `@context/foundation/tech-stack.md`. Setup, env vars and deploy: `@README.md`. Scripts: `@package.json`. CI gate: `@.github/workflows/ci.yml`.

## Hard rules

### The project runs with zero configuration — keep it that way

- The app must start, build, lint and typecheck on a fresh clone with **no `.env`, no `.dev.vars`, no Supabase, no API keys**. Verified in that exact state: `npm run dev`, `npm run build`, `npm run lint`, `npx astro check` and `npm test` all pass, `/` and `/auth/signin` return 200, `/dashboard` redirects to `/auth/signin`, and `src/layouts/Layout.astro` renders the warning banner from `missingConfigs`. Only `npm run smoke` and `npm run test:db` need a live local Supabase.
- **Never refuse to run, build, or implement a task because a secret or an external service is absent.** Missing configuration is a supported, first-class state of this app — not a blocker, and never a reason to stop and ask the user to set something up. Build the feature, let its integration degrade, and surface the gap in the banner.
- Every new integration repeats the existing pattern, in all four places: an `envField(...)` with `optional: true` in `@astro.config.mjs`; a factory that returns `null` when its secrets are missing (`src/lib/supabase.ts`); a null-check at every call site (`src/middleware.ts`, `src/pages/api/auth/signin.ts`); and a `ConfigStatus` entry in `src/lib/config-status.ts` so the absence shows up in the banner instead of as a crash.
- Never make an env field required, never `throw` at module load over a missing secret, and never let a route return 500 because an integration is unconfigured. Degrade the feature, keep the page rendering.

### Secrets and data access

- `createClient()` from `@/lib/supabase` returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` are unset. Null-check it before every use — see `src/middleware.ts` and `src/pages/api/auth/signin.ts`.
- Read those secrets only from `astro:env/server`. They are declared `access: "secret"` in `@astro.config.mjs` — never `process.env`, never client-side.
- `SUPABASE_KEY` is the **publishable** key (`sb_publishable_…`, the key Supabase used to call `anon`), and requests carry the user's cookie session (`@supabase/ssr` in `src/lib/supabase.ts`). Once tables exist, **row-level security is the only thing protecting data** — there is no authorisation layer in application code to fall back on. Treat a missing or permissive policy as a security bug, not a TODO.
- Never introduce a `service_role` / `secret` key (`sb_secret_…`), and never reach for one to work around a policy that rejects a query: it bypasses RLS entirely. Fix the policy instead.
- Every new table gets `alter table … enable row level security` plus one policy per operation (select/insert/update/delete) and role — no `for all`, no `using (true)`. This lands in the first migration that creates the table, not in a later hardening pass. A table written only by a `security definer` trigger has no insert/update/delete policies at all — that denial is intended, not a gap to fill; `supabase/migrations/20260926185936_create_members.sql` is the reference.
- The hosted Supabase project runs with **Data API on, automatic exposure of new tables on, and automatic RLS on**. Two things follow. A migration needs no `grant`: Supabase already grants `select/insert/update/delete` on every new `public` table to `anon` and `authenticated`. And because that grant is automatic, **the RLS policy is the single gate, not the second of two** — a table whose policies are missing or permissive is reachable by anyone holding the publishable key, including an unauthenticated visitor. Write the policies in the creating migration and treat a gap as a live exposure, not a TODO.
- Know the two denial signatures, because the tempting fix for both is the one thing that is never the fix. RLS on with no `select` policy returns an **empty array and HTTP 200** — it looks like missing data, not like a permission error. A blocked write fails with `new row violates row-level security policy`. Neither is repaired with a `secret` / `service_role` key; both are repaired in the policy.
- Scope those policies the way the PRD's requirements do. A note: `insert` sets the author from `auth.uid()` and never reassigns it, `update` and `delete` check it (FR-012, FR-015), `select` is open to every authenticated member (FR-013). Offers, searches and criteria: full CRUD for any member (Access Control, Roles) — and deleting an offer takes every member's notes with it, a cascade the PRD weighed and accepted (FR-015). Criteria are split as FR-002 splits them: any member edits the team's shared limits, while a member's additional requirements are written, edited and deleted only by their author, and read by everyone. "Flat roles, no restricted destructive actions" is the coarse summary of the same thing: the restriction is authorship, never a role tier.
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
- `src/pages/dashboard.astro` is the shared offer board (FR-006). `src/lib/offer-board.ts` is the reference for its sort (`?sort=&dir=`, unknown values last via `nullsFirst: false`) and holds `auditStatus()`, the swap point S-04 replaces with a real audit status; `src/components/offers/AuditStatusBadge.astro` is the one place that status gets a label. The board's container carries `data-board-state="ok"|"error"`, which `scripts/smoke.mjs` checks, because a failed read renders with 200 just like an empty board; `data-limits-state` beside it does the same for the team's limits, whose failed read is never shown as "no breaches".
- `supabase/migrations/20260927144141_create_team_criteria.sql` is the reference for a singleton the team shares: the migration inserts the one row, members get `select` and `update` policies and no `insert`/`delete` (clearing the limits is an update that writes nulls), and the criteria revision counter has no write policy at all — only a `security definer` trigger bumps it, and only on a real change. `src/lib/criteria.ts` is the reference for reading the criteria (a failed read is its own state, never "no limits"; `/criteria` carries it as `data-criteria-state`) and `src/lib/team-limits.ts` for comparing an offer with the limits (only a stated fact breaks one). Breaches always come back in the order `city`, `price_above`, `price_below`, `area_below`. For limits the form and the table's checks do not allow, the function judges each price bound on its own — an inverted range can yield both price marks — reads an empty city limit as no limit, and compares a city limit containing a comma as a whole, so it marks every offer with a stated location; `tests/lib/team-limits.test.ts` is the reference. S-04 reads the criteria through `src/lib/criteria.ts` and stores `criteria_revision.revision` with the audit, and S-09 compares that revision to flag the audit stale, rather than building a second mechanism.
- `public.members` (`supabase/migrations/20260926185936_create_members.sql`) and `src/lib/members.ts` are the reference for naming a member — S-05's note author and S-10's archiver reuse them rather than building a second mechanism. The name is the email address. A `null` author column is a deleted account, rendered „osoba z usuniętym kontem”. A failed read, a missing `members` row or a `null` email is the `unknown` variant: it names nobody and is never shown as a deleted account. `scripts/smoke.mjs` checks the table's RLS from both sides, since a blocked read answers 200 with `[]`.
- `supabase/migrations/20260926202537_create_offer_notes.sql` is the reference for a table restricted by authorship: `select` open to every signed-in member, `insert`/`update`/`delete` policies on `author_id = auth.uid()`, and a freeze trigger that keeps what a row is about and who wrote it on update, letting `author_id` go `null` only through `on delete set null` once the account is gone; `supabase/migrations/20260927133501_offer_notes_server_timestamps.sql` adds the insert half, so the row's dates are always the database's. `src/lib/notes.ts` is the reference for reading an offer's notes (a failed read is its own state, never "no notes"), and `resolveAuthors` in `src/lib/members.ts` for naming many authors with one query — S-09 and S-11 reuse them rather than building a second mechanism. `src/components/offers/OfferView.astro` puts the offer card beside the team column; the audit S-04 adds goes into that column above the notes, where `src/components/offers/OfferNotes.astro` marks the spot.
- `supabase/migrations/` — create files with `supabase migration new <short_description>`, never by hand. `supabase/migrations/20260922202756_create_offers.sql` is the reference for a new table: RLS enabled and one policy per operation for `authenticated` in the creating migration, none for `anon`, per the rules under `### Secrets and data access`. Migrations reach the hosted project with `npx supabase db push` before the Worker that needs them deploys (`@context/foundation/deployment-runbook.md`). A human or the agent may run it, but the agent never pushes without the user's consent: it runs `npx supabase db push --dry-run`, shows the list of migrations matched against `supabase/migrations/`, asks, and pushes only on a yes — every time, since consent to one push does not carry to the next. It stops without asking when the list holds anything unexpected. `supabase login` and `supabase link` are one-time, interactive steps and stay the user's (`npx supabase projects list` shows the project ref). `supabase db reset --linked` is never run, by anyone.
- `supabase/seed.sql` is the reference for local-only fixtures: it creates three confirmed `@vetpad.local` accounts so note attribution (FR-013) can be exercised against a local database. It is wired through `[db.seed]` in `supabase/config.toml` and runs on `supabase db reset` and on a fresh `supabase start`. Two rules it carries. Its credentials are published — the repository is public — so nothing that is a real address or a reused password goes in it. And seeds are **not** inherently local: `supabase db reset --linked` wipes the hosted database and runs this file against it; `supabase db push` does not run seeds. `scripts/smoke.mjs` signs in with `sigaretif1@vetpad.local` and `sigaretif2@vetpad.local` from this file, so removing or renaming either account breaks the smoke job. `scripts/account-deletion.sql` deletes `sigaretif3@vetpad.local` inside a transaction it rolls back, and refuses to run without that account and `sigaretif1@vetpad.local`, so removing or renaming the third account breaks the same job.

## Commands

Scripts are in `@package.json`. Two commands CI runs that are **not** npm scripts: `npx astro sync` and `npx astro check` — run both locally before pushing, or the `ci` job fails on something `npm run lint` never sees. The `ci` job also runs `npm test`, after `npx astro check` and before `npm run build`, with no secrets.

## Conventions

- Import through the `@/*` alias, not deep relative paths.
- Default to `.astro`. Reach for a React island only when the component needs state, effects or DOM event handlers, and mount it with an explicit `client:*` directive — see `src/components/auth/SignInForm.tsx` mounted from `src/pages/auth/signin.astro` with `client:load`.
- React components are `PascalCase.tsx`. A form island default-exports (`src/components/auth/SignInForm.tsx`); a component it composes uses a named export from `src/components/form/` (`FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx`, `ServerError.tsx`). `src/lib/` modules are kebab-case.
- Merge Tailwind classes with `cn()` from `@/lib/utils`; never concatenate class strings.
- API routes that back an HTML form submit read `FormData` and report failure by redirecting with `?error=<encoded message>` — never JSON. `src/pages/api/auth/signin.ts` is the reference; `signout.ts` has no failure path — it redirects to `/` either way and skips the sign-out when Supabase is unconfigured, which is the zero-config rule above, not a gap to fill. A page with two forms tells their errors apart with `&form=<name>` after `?error=`, since the page cannot read the `#` fragment; `src/pages/api/criteria.ts` is the reference. A form with more than one action carries it in a controlled hidden `intent` field, never only in the submit button's `name`/`value`: the island disables the button on submit, and Firefox leaves a disabled submitter out of the form data — `src/components/criteria/TeamLimitsForm.tsx` is the reference. An endpoint driven by `fetch` from a React island (progress polling, autosave, archive) may return JSON; when the first one exists, name it here as the reference instead of inventing a second style.
- Do not add `zod`, `valibot` or another validation library to `@package.json` without the user's explicit go-ahead. Validation is hand-rolled inline today — `src/lib/otodom/url.ts` is the reference for URL normalisation (FR-005). Expect this to come up again for parsing the model's structured audit output — raise it as a decision, do not just install one.
- A rule in this file names a reference instance — never a count, never a paraphrase of a file that already states it. Write "`src/pages/api/auth/signin.ts` is the reference", not "all three auth routes". A count drifts silently; a named path fails loudly when it moves.

### UI

- A new view is built only from the tokens in `src/styles/global.css` — role classes such as `bg-card`, `text-muted-foreground`, `text-link` — and the components in `src/components/ui`. A colour literal in a view (`white/10`, `blue-100/80`, a hex) is a bug. The dark theme is the only one; `class="dark"` in `src/layouts/Layout.astro` switches it on.
- `npm run lint` enforces the previous rule: `tokensOnlyConfig` in `@eslint.config.js` fails a Tailwind palette utility (border sides, rings and ring offsets included), an arbitrary colour in brackets (hex, `rgb()`/`hsl()`/`oklch()`…, `color-mix()`), a colour in a `style` attribute, `bg-cosmic` or `backdrop-blur` anywhere under `src/`. Its `ignores` list is empty and nothing is ever added to it — a lint error there is fixed with a token, not with an exception.
- A new app view renders inside `src/layouts/AppLayout.astro` (frame, Topbar, a `notice` slot for page banners); `src/pages/offers/[id].astro` is the reference.
- A missing primitive comes from `npx shadcn add <name>`, followed in the same change by the ritual the CLI makes necessary here: import `cn` from `@/lib/utils`, delete `"use client"`, import `Slot` from `@radix-ui/react-slot` (`src/components/ui/button.tsx` is the reference), and drop the `cn` and `radix-ui` packages from `@package.json` if the CLI added them. For `label`, the ritual goes one step further: the CLI's `Label` wraps `@radix-ui/react-label` through the `radix-ui` package, and it is rewritten to a native `<label>` with the registry's classes instead (`src/components/ui/label.tsx` is the reference) — no `@radix-ui/react-label` in `@package.json`.
- A primitive whose behaviour lives in a Radix package other than `react-slot` (dialog, alert-dialog, popover, select, dropdown-menu…) keeps Radix — the user chose it on 2026-09-26 over native `<dialog>`/`<select>`, for the focus trapping, Escape handling and accessibility it brings, so the plan does not ask again. The ritual changes for it in one place: instead of dropping Radix, install the per-primitive package the component needs (`@radix-ui/react-dialog`, …) and import from it, the way `button.tsx` imports `Slot` from `@radix-ui/react-slot`; the umbrella `radix-ui` package the CLI adds is still dropped, and the plan names the new dependency.
- A change to how the offer card looks goes through `/dev/offer-card` (`src/pages/dev/offer-card.astro`, fixtures in `src/pages/dev/_offer-fixtures.ts`): when the change is gated (see the last point below), screenshot every state there. A new card state gets a fixture there. The page renders under `astro dev` only and answers 404 everywhere else, which `scripts/smoke.mjs` checks on the production preview.
- A change to how `SignInForm`, `AddOfferForm`, `NoteEditor`, `TeamLimitsForm` or `RequirementsEditor` looks goes through `/dev/forms` (`src/pages/dev/forms.astro`) the same way: it renders each of these forms in every named state, built from the same `src/components/form/` composites the forms use in production. A new form state gets a section there. Same dev-only/404 rule as the card kitchen sink, checked by the same `scripts/smoke.mjs`.
- A change to how the offer board looks goes through `/dev/board` (`src/pages/dev/board.astro`) the same way: every board state (list, empty, read error, sort controls, and the row states) renders there from `src/pages/dev/_offer-fixtures.ts` through the production components. A new board state — S-10's archive among them — gets a section there. Same dev-only/404 rule, checked by the same `scripts/smoke.mjs`.
- A change to how `/criteria` looks goes through `/dev/criteria` (`src/pages/dev/criteria.astro`, fixtures in `src/pages/dev/_criteria-fixtures.ts`) the same way: every state of the view renders there through `CriteriaView`, and its forms' own states are on `/dev/forms`. A new criteria state gets a section there. Same dev-only/404 rule, checked by the same `scripts/smoke.mjs`.
- Whether a change that alters a view runs the visual gate is the user's call, not a default: `/10x-plan` asks and records the answer in the plan. A gated change carries in its plan the 7-state matrix (default, hover, focus, disabled, error, empty, loading) with every absent state named „nie dotyczy” and its reason, screenshots every state with `scripts/ui-screenshots.mjs` into its change folder, and re-runs the gate after `/10x-impl-review` triage changed the view, before the commit. A gated new view with more than one state gets its own `/dev/<view>` page on the pattern of `/dev/offer-card` (dev-only, 404 elsewhere, a step in `scripts/smoke.mjs`) and a set in `scripts/ui-screenshots.mjs`. An ungated change still passes `npm run lint` and keeps the existing kitchen sinks rendering — a new card or form state gets its fixture or section either way.

## Testing

`npm test` (Vitest, configured in `vitest.config.ts`) runs the unit and render tests under `tests/`, with no network and no secrets; `scripts/smoke.mjs` and `scripts/account-deletion.sql` are the test surfaces that need a live local Supabase — what they cover and what they need to run: `@README.md`.

- Any change to the surface of `src/pages/api/` — adding a route, removing one, or changing an existing route's contract — must be reflected in `scripts/smoke.mjs`, and in the `smoke` job of `@.github/workflows/ci.yml` if the flow needs different setup.
- `scripts/smoke.mjs` signs in with an account from `supabase/seed.sql` and checks that registration is closed, both in the app's routes and in Supabase Auth (FR-001). A change that re-enables registration, or removes that account from the seed, turns the smoke job red.
- `scripts/smoke.mjs` also creates two fixture offers as the first seeded account, straight through the Data API, puts a note of each seeded account (the second is `sigaretif2@vetpad.local`) on both, and judges every write that could reach another member's row in `public.offer_notes`, `public.offers` and `public.member_requirements` by whole rows: `withSnapshot` in that file is the reference for comparing another member's rows before and after a step, and its control steps fail the run when the comparison stops seeing a change. It deletes both offers again as its last notes steps — which is why it never runs against production. It also changes the team's shared limits and saves requirements for both seeded accounts; its cleanup writes back the limits it read at the start and deletes both accounts' requirements, so requirements typed by hand for those accounts in the local database do not survive a run.
- `scripts/account-deletion.sql` (`npm run test:db`) is the test surface for what an account deletion leaves behind — the `on delete` actions on `auth.users`, which the publishable key cannot reach. It needs `psql` and the local database, runs in the `smoke` job of `@.github/workflows/ci.yml` before the build, and is not part of `npm test`. The whole file is one transaction that ends in `ROLLBACK`; a check added to it stays inside that transaction, and the script is never pointed at the hosted database. A new column that references `auth.users` gets a case there in the change that creates it.
- A write path gets its isolation check where `context/foundation/test-plan.md` §6.3 puts it, and a denied write is recognised by its row count, never by its status alone — a denied update or delete answers like a successful one.
- Do not add `jest` or `playwright` to `@package.json` without the user's explicit go-ahead. `vitest` had that go-ahead on 2026-09-30 (`testing-ingestion-guardrails`).
- A test lives under `tests/` at the path of the `src/` file it covers, and `context/foundation/test-plan.md` §6 is the cookbook for adding one. `tests/fixtures/otodom.ts` is the reference for ingestion fixtures: synthetic, hand-written from `@context/foundation/ingestion/otodom_fetching.md` § 7 with seller canaries, never a recorded payload — the repository is public and a live listing carries a real advertiser's phone and name. `tests/pages/api/offers.test.ts` is the reference for a route test stubbed at the HTTP edge (`tests/fixtures/http.ts`), never by mocking `@/lib/*`. `tests/pages/api/criteria.test.ts` is the reference for a route whose write reached zero rows: the database answers `200` with `[]`, and the route reports a failed save. `tests/components/offers/render.test.ts` is the reference for rendering a view through the Container API. `tests/setup.ts` puts every test in the zero-config state by mocking `astro:env/server`; a test that needs a configured client overrides it with its own `vi.mock`, and `tests/setup.test.ts` fails if the default goes.
- Mutation testing is Stryker (`stryker.config.json`; `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` had the user's go-ahead on 2026-10-01). It is a selective, local gate — never a CI step, never part of `npm test`, and its score is never a target: run it narrowed to the module a change or a `context/foundation/test-plan.md` risk touches (`npx stryker run --mutate "src/lib/otodom/map.ts"`, or `"path:start-end"` for a line range), then judge each survived mutant by the workflow under `### Mutation testing (Stryker)` below. The report lands in `reports/mutation/mutation.html`; `reports/` and `.stryker-tmp/` are git-ignored. A module that only `scripts/smoke.mjs` exercises reports "no coverage", because Stryker sees `npm test` alone — that is a statement about the unit layer, not a missing-test finding by itself.
- `scripts/stryker-vitest5-runner.mjs` is why `testRunner` in `stryker.config.json` reads `vitest5`, not `vitest`: the stock runner filters tests by a name joined with spaces, Vitest 5 matches names joined with `" > "`, so every test inside a `describe` is skipped and every mutant is reported as survived. The plugin wraps the stock runner and runs the whole test files that cover a mutant instead. Do not "simplify" the config back to `vitest` while that mismatch stands — the symptom is a score near zero with survivors that cannot be real, such as `if (true) return null` in `src/lib/safe-url.ts`. Once the upstream runner supports Vitest 5, delete the plugin, set `testRunner` back to `vitest`, and remove this bullet. Stryker copies the project into a sandbox, so a new top-level directory the tests do not need goes into `ignorePatterns` there — a symlink inside one aborts the run with `EISDIR`.
- `scripts/otodom-inspect.mjs` (`npm run otodom:inspect -- <url>`) is a debugging tool that hits the live portal, not a test surface: it never runs in CI, and smoke must never reach otodom.pl.
- `scripts/ui-screenshots.mjs` (`node scripts/ui-screenshots.mjs gate context/changes/<change-id>/screenshots` — the output directory is required) takes the `/dev/offer-card` screenshots the UI rules above ask for — a debugging tool, not a test surface: it signs in with a `supabase/seed.sql` account against `npm run dev` and never runs in CI. Its output directory git-ignores `*offer-real*`, because those shots show a third-party listing. The `forms` set takes the `/dev/forms` screenshots the same way, plus a forced `:hover` on a state: a shot's `hover: "<CSS selector>"` field drives that element's `:hover` through CDP (`CSS.forcePseudoState`) instead of a real pointer, which headless Chrome has none of.

## Git workflow

Changes are written in the `master` working tree, may be committed there phase by phase by `/10x-implement`, and leave it through one of two skills, and the agent asks which one rather than assuming (see `### Git` above). Each skill's own description is the account of what it does; the parts worth knowing before you start are these. `/git-ship` moves the change — local commits and uncommitted work alike — onto a branch, so afterwards it is no longer in your tree: it points local `master` back at `origin/master` once the branch is pushed. That is a ref move, not a rewrite — the commits keep their SHAs on the branch, so the SHAs `/10x-implement` wrote into `## Progress` stay valid. `/git-land` leaves it where it is and pushes `master` itself, so afterwards your tree is clean but the change is on the default branch with nothing between it and `origin` — it confirms once before that push, listing the local commits it is about to publish. Both stop when `master` is behind `origin`, and `/git-sync` (fast-forward only) is what unblocks them — unless `master` also carries local commits, in which case the two have diverged, `/git-sync` refuses too, and the call is the user's.

- Branch slugs are 2–5 words; `/git-ship` normalises the rest. `/git-land` asks for no slug — it creates no branch. When the change folder is known, its `<change-id>` is the natural slug.
- Commit subjects: English, imperative, one line, 70 characters max, no `feat:`/`fix:` prefixes, no trailing period. The one exception is `/10x-implement`: its commits use the skill's own Conventional-Commits form, `<type>(<change-id>): <phase title> (p<N>)`, and that format wins for the commits it authors.
- Do not overstate automation. Because every fetch, re-fetch and audit is a deliberate manual action (see Product invariants), a message calling one of them "automatic" misdescribes the product. If the behaviour stops to ask the user, write "offer", "prompt" or "ask".
- PRs target `master`; both CI jobs must pass (`@.github/workflows/ci.yml`). A `/git-land` push skips that gate entirely — CI runs on `master` after the fact, so anything that would not survive review belongs in a PR.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 2

Lesson 2 is about **writing tests that actually protect code** — not just maximise coverage. The oracle problem and vibe-testing anti-patterns explain why LLM-generated tests fail on real code; the risk-first quality contract from Lesson 1 is the fix.

```
context/foundation/test-plan.md (§3 Phased Rollout)
        │
        ▼  (one rollout phase at a time)
   /10x-research  ──►  research.md  (oracle source: what code should do, not what it does)
        │
        ▼
   /10x-plan  ──►  plan.md  (cost × signal, two-layer strategy, ordered phases)
        │
        ▼
   /10x-implement  or  /10x-tdd   ──►  working tests + §6 cookbook update
```

`/10x-tdd` is an **optional test-first mode**, not a replacement for the chain. It reads the same `plan.md`, writes to the same `## Progress` section, and covers the same phases as `/10x-implement`. Use it only when you can name the first failing assertion before writing any code.

### Task Router — Where to start

| Skill / Prompt | Use it when |
| --- | --- |
| `/10x-research` | Before writing any test for a risk. Research produces the oracle — what behaviour a test must prove — from sources (PRD, tech-stack, docs), not from the implementation shape. Also reveals whether a risk is already covered or has two separate faces (one safe, one real). |
| `/10x-plan` | Research is done. Plan decomposes the risk into ordered phases: environment setup first, then rules that depend on it, then hermetic stubs for failures that real infra cannot trigger, then cookbook update. Each phase names the behaviour it asserts and the regression it catches. |
| `/10x-implement` | Default executor for plan phases. Use for environment setup, existing code, scaffolding, and any phase where you cannot define a red test before writing code. |
| `/10x-tdd` | Optional. Use instead of `/10x-implement` for a phase where you can name the first red test in one sentence. Agent writes the failing test first, then the minimal code to green it, then refactors. Stops at the assertion before touching the implementation — that pause is the point. |
| `m3l2-ad-hoc-testing` prompt | You have a single file and want tests now, without the full research→plan→implement cycle. The prompt forces oracle-from-sources (reads PRD + TECH_STACK before asserting), behavioural assertions, edge cases from risk, and a regression table. Use it knowing you are trading depth for speed. |

### When to use `/10x-tdd` vs `/10x-implement`

The deciding question: *Can you name the first red test in one sentence?*

Good conditions for `/10x-tdd`:
- "promuje wyłącznie drafty w stanie `accepted`, a `pending`/`rejected` nigdy nie trafiają do talii"
- "zwraca `ok: true` i loguje `orphan_review_state`, gdy upsert stanu powtórek padnie w trakcie zapisu"
- "zwraca 401, gdy użytkownik nie ma dostępu do kursu"
- "resetuje interwał powtórki do jednego dnia, gdy ocena wynosi 0"

Each of these names an observable outcome, not an internal detail. If you cannot produce a sentence like this, stay on `/10x-implement` or return to `/10x-research`.

`/10x-tdd` is **not suited** for: environment setup, CI/CD config, documentation, thin wiring where the test would just rewrite the implementation, or a spike where you are still discovering the contract.

You can mix both modes in one plan:

```
/10x-implement <change-id> phase 1   # environment
/10x-tdd       <change-id> phase 2   # contract (new code)
/10x-tdd       <change-id> phase 3   # contract (API endpoint)
/10x-implement <change-id> phase 4   # cookbook + plan sync
```

Both write progress to the same `## Progress` section in `plan.md`.

### Two-layer test strategy (cost × signal)

For each risk, pick the **cheapest test that gives a real signal**. Do not default to e2e "because it's safest", and do not chase coverage percentage.

| Layer | When to use | When NOT to use |
| --- | --- | --- |
| Integration (real DB / real infra) | The rule involves DB constraints, cascades, real SQL, or unique constraints that a mock would lie about. | Auth flows gated by RLS that belong to a separate phase; anything where setup cost exceeds signal value. |
| Hermetic (stub client) | Partial failures that real infra cannot trigger easily (e.g. second operation in a sequence fails). | Rules that depend on actual DB state — a stub will lie about constraint violations and cascades. |

A non-atomic save sequence (multiple independent operations without a transaction) means: write hermetic tests for partial-failure branches, not integration tests that force a mid-sequence error.

### Oracle rules

- The oracle — what the code *should* do — must come from sources: PRD, docs, tech-stack constraints, domain knowledge. It must **not** come from reading the implementation.
- If the implementation has a bug, copying its output as the expected value produces a mirror test that passes against the bug.
- When sources do not resolve the expected behaviour unambiguously, **stop and ask** rather than guessing.
- Research's job is to surface the oracle before any test is written.

### Vibe-testing anti-patterns to avoid

| Anti-pattern | How it looks | What to do instead |
| --- | --- | --- |
| Mirror implementation | Assertion computes the expected value with the same logic as the tested code. | Assert against a value derived from the oracle (PRD / domain rule), not from the implementation. |
| Happy paths only | Tests only pass valid inputs; edge cases absent. | Add at least one edge case per risk: `null`, empty, dependency error, invalid input. |
| Redundant copies | Six nearly identical tests checking the same absence of a sentinel. | One parameterised test (`it.each`) per property; each test catches a different regression. |

### Mutation testing (Stryker) — selective quality gate

Coverage says "this line was executed". Mutation score says "would a test fail if I broke this line?" Use Stryker as a **selective gate** after a risk phase, not as a CI gate on every commit.

Workflow:
1. Tests pass for the risk phase.
2. Run `npx stryker run --mutate "path/to/file.ts"` (narrow scope to the changed module).
3. Open the HTML report; find survived mutants.
4. For each survived mutant ask: "Would this change hurt a user or the business?"
   - Yes → add an assertion that kills the mutant.
   - No (equivalent mutant or cosmetic change) → ignore consciously.
5. Do not chase 100% mutation score. A test that pins implementation details to kill a cosmetic mutant is itself a vibe test.

The integration gate can stay **ad hoc** (not on every commit) when running local infra is expensive. Mark it accordingly in `test-plan.md §4`.

### Lesson boundaries

- Do not configure hooks, hook lifecycle, or debugging hooks. That is Lesson 3.
- Do not configure MCP servers, Playwright API, e2e code, or multimodal scenario code. That is Lesson 4.
- Do not run the bug-to-fix-to-regression-test workflow. That is Lesson 5.
- Do not author CI/CD pipelines from scratch. That is Module 1 Lesson 5 / Module 2 Lesson 5.
- Do not run `/10x-test-plan` to change the risk strategy. That is Lesson 1. Use `/10x-test-plan --status` to read current state.
- Do not write tests without a research step unless using the ad-hoc prompt with full awareness of its trade-offs.

### Paths used by this lesson

- `context/foundation/test-plan.md` — §3 rollout state; §6 cookbook (filled in as phases ship)
- `context/changes/<change-id>/research.md` — oracle source per rollout phase
- `context/changes/<change-id>/plan.md` — ordered phases with `## Progress` as execution state
- `.claude/prompts/m3l2-ad-hoc-testing.md` — ad-hoc file-level testing prompt

<!-- END @przeprogramowani/10x-cli -->
