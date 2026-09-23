<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Wklejony URL otodom.pl staje się zapisaną kartą oferty

- **Plan**: context/changes/paste-listing-to-card/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-09-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Evidence

- Automated checks (2026-09-23, commit 7210244): `npm run lint`, `npx astro sync`, `npx astro check` (0 errors, 0 warnings, 0 hints) and `npm run build` pass. `npm run smoke` against local Supabase + `npm run dev` passes all 16 steps.
- Every grep from the plan's success criteria comes back clean: no HTML parser and no validation library in `package.json`; only `import type` in `map.ts`/`fetch.ts`; no `contactDetails|owner|agency` in `src/lib/otodom/`; no `JSON.stringify`/`new Response` in the route; no `fetch(` in the island; one `AbortSignal.timeout`; no `set:html` or `client:` in the card; the README no longer has the "No database tables" sentence; `npm run otodom:inspect` with no argument prints usage.
- Local database: `relrowsecurity = t`; exactly four policies (`r`/`a`/`w`/`d`), all `{authenticated}`; the `offers_freeze_created_by` trigger is present.
- What was left out of scope was respected: no validation library, parser, test runner, new secret or Apify fallback; `api/auth/*`, `seed.sql` and `config-status.ts` are untouched.
- Benign additions beyond the plan: `set search_path = ''` in the trigger function, `referrerpolicy="no-referrer"` in the gallery, `try/catch` around the card's query, and `shape_changed` when `characteristics` is missing.

## Findings

### F1 — Scheme of URLs from the database not checked in `href`/`src`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/offers/OfferGallery.astro:23, src/components/offers/OfferGallery.astro:29, src/pages/offers/[id].astro:84, src/lib/otodom/map.ts:158-168
- **Detail**: The card renders `href={image.large}`, `src={image.thumbnail}` and `href={offer.source_url}` straight from the row. Astro escapes attribute values but does not check the scheme. `mapImages` accepts any non-empty string. The `offers_update_authenticated` policy (`using/with check (auth.uid() is not null)`) lets any logged-in member PATCH `images`/`source_url` directly through PostgREST with the publishable key. A `javascript:…` value would run in another member's session once they click it. With RLS as the only gate, this is the one path from "member data" to "code in someone else's session". The threat model is narrow (three accounts, closed registration), but a stolen session is enough.
- **Fix A ⭐ Recommended**: A guard at render time (a small `safeHttpsUrl()` in `src/lib/`, returning the URL only for `https:`, else `null`) in `OfferGallery.astro` and `[id].astro`, plus an `https:` filter in `mapImages`.
  - Strength: It closes the vector at the point of use, whatever the database holds, including rows planted by a direct PATCH. It needs no migration and is a few lines.
  - Tradeoff: Every future place that renders these fields (S-06 board) has to remember the helper.
  - Confidence: HIGH — standard defence; `new URL()` is already used this way in `url.ts`.
  - Blind spot: No CSP in the response headers has been checked; it could be a second layer.
- **Fix B**: A: plus a new migration with `check (source_url like 'https://www.otodom.pl/pl/oferta/%')`.
  - Strength: The database rejects an invalid `source_url` for every client, not just this page.
  - Tradeoff: A second migration and a `db push` by a human before deploy; `images` (jsonb) cannot be constrained as simply, so it still needs A.
  - Confidence: MEDIUM — the canonical form from `url.ts` makes the constraint safe for existing rows, but hosted data has not been checked.
  - Blind spot: Rows already saved in the hosted database.
- **Decision**: FIXED + ACCEPTED-AS-RULE: Render URLs from database rows only through `safeHttpsUrl` — Fix A: `src/lib/safe-url.ts`, filter in `OfferGallery.astro`, link to the original in `[id].astro` rendered only for `https:`, `httpsUrl()` in `mapImages` (`map.ts`). Rule for S-06/S-08 in `context/foundation/lessons.md`.

### F2 — Implementation deviations not recorded in `plan.md`; resolved-block formatting in the PRD

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/paste-listing-to-card/plan.md (sections Faza 2 and Faza 4), context/foundation/prd.md:177
- **Detail**: Three deliberate deviations are justified and recorded in CLAUDE.md and `otodom_fetching.md`, but the body of the plan still describes the original contract (the implementation commits only ticked Progress):
  - (D1) `[id].astro:32-37` answers 404 with `Astro.response.status = 404` and a not-found branch, not with `return new Response(null, {status: 404})` (required by CLAUDE.md, lint rule).
  - (D2) `map.ts:27-32,128` narrows `target` in `raw` to `OfferType`/`ProperType`, because `target` carries `seller_id` — stricter than the plan.
  - (D3) `fetch.ts:34-41,64-65`: `410` → `not_found`, every non-OK status (5xx too) → `http_denied`, `ad.shouldShowExpiredAdPage` → `expired`.

  Separately: the resolution of Open Question 2 in `prd.md:177` is indented under question 1 and renders as part of it, not as a separate block of resolved questions.
- **Fix**: Add a "Deviations from the plan" section (D1–D3 with justification) to `plan.md` and move the resolved block in `prd.md:177` out of item 1 (no indentation, next to the "Resolved during shaping" block).
- **Decision**: FIXED — section `## Odstępstwa od planu` (D1–D3) before `## Progress` in `plan.md`; block in `prd.md` moved out of item 1 into a separate paragraph.

### F3 — Fetch failure classification blurs the signal for the Apify fallback

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/fetch.ts:33-41
- **Detail**: The plan split failure modes precisely so the team could tell "egress blocked" (the trigger for the Apify fallback, `deployment-runbook.md`) from "the page changed shape". The implementation classifies every 5xx as `http_denied`, i.e. "otodom.pl refused", so a temporary portal outage looks like a block. On top of that, `redirect: "follow"` without checking `response.url`: a removed offer redirecting to a search results page (or a consent/anti-bot page on another host) ends up as `shape_changed` ("otodom may have changed format") instead of "listing does not exist". Real SSRF risk is low (the URL is rebuilt as `https://www.otodom.pl/pl/oferta/<slug>`, and redirects are controlled by otodom).
- **Fix**: After `fetch`, require `new URL(response.url)` to have a host from `ACCEPTED_HOSTS` and a path under `/pl/oferta/`, else `not_found`; give 5xx a separate reason (e.g. `upstream_error`, message "otodom.pl is temporarily unavailable") so `http_denied` stays reserved for 403/429.
  - Strength: It restores the plan's intent — each reason says what to do next, and `http_denied` stays a clean fallback trigger.
  - Tradeoff: A new reason and message means changing `types.ts`, the message table in `api/offers.ts` and the error table in `otodom_fetching.md`.
  - Confidence: MEDIUM — how otodom redirects a removed offer has not been checked live.
  - Blind spot: Whether otodom really redirects removed offers instead of returning 404/410.
- **Decision**: FIXED — a live probe (2026-09-23) showed that a non-existent offer returns a plain `404` with no redirect, so the `response.url` check is a safeguard, not the common path. `upstream_error` for 5xx (`types.ts`, `fetch.ts`, message in `api/offers.ts`); `http_denied` only for 4xx and for a redirect off otodom (no status, message without "(HTTP …)"); redirect onto otodom outside `/(pl/)oferta/<slug>` → `not_found`. Error table in `otodom_fetching.md` § 7.1 and D3 in `plan.md` updated. Every branch checked by calling `fetchOfferAd` in Node with a stubbed `fetch`.

### F4 — Implicit assumptions in the migration: FK without `on delete`, policies depend on anonymous sign-ins being off

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922202756_create_offers.sql:17, :91, :105, :113
- **Detail**:
  - (a) `created_by uuid not null references auth.users (id)` without `on delete` means the default `NO ACTION`: deleting a member who saved an offer fails in Supabase Auth with "Database error deleting user". That arguably protects S-07's "who saved it", but it is an unwritten decision.
  - (b) The policies use `auth.uid() is not null`. If `enable_anonymous_sign_ins` (today `false`, `supabase/config.toml:171`) were switched on, an anonymous user gets the `authenticated` role and a uid, and passes all four policies — full CRUD on the offers.
- **Fix**: At S-07 (or earlier, in a separate migration), record the decision explicitly — `on delete restrict` with a comment — and a comment on the policies tying them to disabled anonymous sign-ins (optionally the condition `coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false`).
  - Strength: Both assumptions become visible where the next agent will look (the migration is the reference instance per CLAUDE.md).
  - Tradeoff: It needs a new migration (never edit an already-applied one) and a `db push`.
  - Confidence: HIGH — both behaviours are documented Supabase/Postgres semantics.
  - Blind spot: Whether the team foresees removing accounts at all (3 fixed accounts).
- **Decision**: FIXED + ACCEPTED-AS-RULE: Declare `on delete` on every author column that references `auth.users` — user decision: the account must be deletable and the offer stays. Migration `20260923153747_offers_keep_after_author_deleted.sql`: `created_by` nullable, FK `on delete set null`, the freeze trigger (now `security definer`) lets null through only when the author's account no longer exists, comment on the policies' dependence on anonymous sign-ins being off. `OfferRow.created_by: string | null`. PRD (Non-Functional Requirements): the offer outlives its author, the UI shows „konto usunięte" (for S-07). Checked locally in a transaction with ROLLBACK: PATCH to null keeps the author, insert without an author is rejected by RLS, deleting the account leaves the offer with `created_by = null`. **The hosted database needs `supabase db push` before the next deploy.**

### F5 — Whitespace regex in `htmlToPlainText` runs in quadratic time

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/map.ts:113
- **Detail**: `.replace(/[ \t ]+\n/g, "\n")` — for a long run of spaces/nbsp not ending in `\n`, the engine starts from every position and backtracks: O(n²). The description is controlled by the advertiser; tens of thousands of spaces could get close to the Free plan's CPU limit (error 1102, `deployment-runbook.md`). Unlikely in practice, but it is the only non-linear pass over foreign text.
- **Fix**: Replace it with a linear pass: `.split("\n").map((line) => line.replace(/[ \t ]+$/, "")).join("\n")`.
- **Decision**: FIXED (differently) — a measurement showed the fix proposed here was just as quadratic (50k spaces + "x": current regex 1505 ms, proposed 2116 ms); `line.trimEnd()` was used instead (0.1 ms). Same finding class, also fixed with the user's approval: `/<[^>]*>/g` → `/<[^<>]*>/g` (50k "<": 1186 ms → 0.3 ms). Output on typical otodom HTML unchanged.

### F6 — `formData()` in the route can end in a 500

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/offers.ts:54
- **Detail**: `await context.request.formData()` throws a `TypeError` for a body that is not a form (e.g. `Content-Type: application/json`), and the route returns 500. Only a hand-crafted request from a logged-in member reaches it. The same pattern is in the reference `src/pages/api/auth/signin.ts:5`, so it is an inherited pattern, not a new mistake.
- **Fix**: Wrap `formData()` in `try/catch` and on error redirect with the message for `empty` (optionally the same in `signin.ts`).
- **Decision**: FIXED (both routes) — `try/catch` around `formData()` in `src/pages/api/offers.ts` (redirect with the `empty` message) and `src/pages/api/auth/signin.ts` (redirect `?error=Invalid sign-in request`). `scripts/smoke.mjs`: a `json` option in `request()` and two steps: "signin rejects a non-form body", "offer save rejects a non-form body".

### F7 — Mapper: price per m² loses its currency, coordinates `0` pass as a fact

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/otodom/map.ts:221-226, :241, :152-156
- **Detail**:
  - The currency is taken only from the `price` entry, and only when the price is known. `price_per_m`'s own `currency` is discarded, so an offer without a price but with a price per m² shows "12 345/m²" with no currency (`[id].astro:47`, `OfferParameters.astro:36`).
  - `coordinate()` accepts `0`, so a placeholder `0,0` would be stored as a location. Not rendered today; S-08 will use it for the map link.
- **Fix**: Fall back to the currency of the `price_per_m` entry when `price_currency` is `null`; treat latitude/longitude `0` (or out of range) as unknown.
- **Decision**: FIXED — `price_currency: priceCurrency ?? pricePerMCurrency` (via `amountWithCurrency("price_per_m")`, no new column); `coordinate()` returns `null` for `0` and outside ±90/±180. Checked in Node on synthetic `ad` payloads.

### F8 — Gaps in verification: no 404 for a valid uuid in smoke, check 2.11 could not be done with the tool

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:88, plan.md Progress 2.11
- **Detail**: The logged-in 404 step only covers `/offers/not-a-uuid`, which is rejected by the regex before the query. The path through the real query and RLS (a valid uuid, no row) has no smoke step. Separately: manual check 2.11 said "compare the phone number and name with what the script shows in the raw payload", but `otodom-inspect.mjs` never prints `owner`/`contactDetails` — the check is marked `[x]` with no tool that allows it. The result is probably correct (the whitelist and the grep in 2.5 prove it structurally), but the evidence is indirect.
- **Fix**: Add to the logged-in group of `scripts/smoke.mjs` a step `GET /offers/${randomUUID()}` → 404; in `plan.md` note that 2.11 was confirmed structurally (the `raw` whitelist + grep 2.5), not by comparing values.
- **Decision**: FIXED — smoke step "offer card 404s on an unknown uuid"; a note on 2.11 in the `## Odstępstwa od planu` section of `plan.md`.

## Triage summary (2026-09-23)

| Decision | Findings |
|---|---|
| Fixed | F2, F3, F6, F7, F8 |
| Fixed differently | F5 (`trimEnd()` instead of the proposed, equally quadratic regex; plus the tag regex) |
| Fixed + rule in `lessons.md` | F1 (Fix A), F4 |
| Skipped | — |

Verification after the fixes: `npm run lint`, `npx astro sync`, `npx astro check` (0 errors, 0 warnings), `npm run build` pass; `npm run smoke` 19/19 PASS (3 new steps). The migration `20260923153747_offers_keep_after_author_deleted.sql` was applied locally with `npx supabase migration up` and checked in a transaction with ROLLBACK.

**Before the next production deploy:** a human runs `supabase db push` for the new migration (`context/foundation/user-manual/apply-database-migrations.md`) — the Worker reads `created_by` as nullable, and without the migration deleting an account still fails.
