# Apify ingestion fallback with a switchable mode — Implementation Plan

## Overview

The plan adds a second way to fetch an otodom.pl listing, used for both adding an offer (FR-004) and re-fetching one (FR-009). The second way is the Apify actor `apify/cheerio-scraper` (ID `YrQuEkowkNCLdk4j2`), run with our own fixed `pageFunction` through the `RESIDENTIAL`/`PL` proxy. It returns otodom's own `pageProps.ad`, narrowed to a whitelist inside Apify, so the existing classifier, `mapAdToOffer`, the FR-005 gate, the lost-facts rule and `listingFingerprint` all run unchanged on its result.

A singleton row in `public.ingestion_settings` selects the mode: `direct_with_fallback`, `apify_only` or `direct_only` (the kill switch). Members can read the row, and only the owner changes it, in Supabase Studio. `APIFY_TOKEN` follows the zero-config pattern. The change also rewrites the rules and documents that still say the fallback "replaces the scraper rather than sitting beside it".

The binding inputs are:

- `change.md`;
- `research.md`;
- `spike-apify.md`, which wins wherever it disagrees with the research;
- the user's planning decisions of 2026-10-17, written into this plan and into `plan-brief.md` (Key Decisions); they are binding.

The plan runs unattended under `/10x-goal-implement`. Every step that needs a production secret, a `db push`, a deploy or the paid code-reviewer evals is a Manual row. Live calls happen only in Phase 3, within the budget set out under **Live-call budget and pacing**.

## Prerequisites (manual)

Each step is marked as verified or unverified against public documentation and the 2026-10-17 spike.

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status 2026-10-17                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P1  | **Apify account, Free plan.** Open `https://console.apify.com/sign-up` and choose **Sign up** with email and password, **Continue with Google** or **Continue with GitHub**. For email, confirm it through the verification link (a **Resend verification email** button exists). The Free plan has no card and includes **$5 of usage per month**. Usage does not roll over, and the platform is blocked until the next cycle once it is spent. _(verified: docs.apify.com/platform/console, apify.com/pricing)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Done by the user** (spike)                                                                                       |
| P2  | **Scoped API token.** Go to Console → **Settings** → **API & Integrations**. The page name is verified; the address `https://console.apify.com/settings/integrations` is unverified. Then: (1) click the create-token button (label _unverified_, likely "+ Create new token"); (2) give it a description, e.g. `vetpad-ingestion`, and an expiration date (_verified_: expiration is supported); (3) switch on **Limit token permissions** (_verified_); (4) under **Resource-specific permissions** add the Actor `YrQuEkowkNCLdk4j2` with **Run**. "Run" is _verified_. The add-by-ID control is _unverified_, and the form wants the technical ID, not `apify/cheerio-scraper`. (5) Set **Actor execution** to **Full access** (_verified_ option; the spike verified that Restricted makes actors fail with `insufficient permissions`). (6) Set **Default run storages access** to **ON**, the toggle captioned "…write access to the run default storages" (_verified_); `run-sync-get-dataset-items` reads that dataset. (7) Save (label _unverified_). The Run permission on `ir34sMIv8mrbL0ojO` (trev0n), left over from the spike, may be removed. | **Done by the user** (spike, Run on both actors)                                                                   |
| P3  | **One-time full-permission approval.** cheerio-scraper runs user-supplied code, so Apify treats it as a full-permission actor. Open `https://console.apify.com/actors/YrQuEkowkNCLdk4j2?approvePermissions=true` and approve. Until then every run answers 403 `full-permission-actor-not-approved`. _(verified in the spike)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Done by the user**                                                                                               |
| P4  | **Monthly usage limit.** Go to Console → **Billing** → **Limits** tab (_verified_: "You can adjust the platform usage limits"; over the limit "Apify platform services will be suspended"). The labels "Edit limit" and "Custom usage limit" are _unverified_, and so is whether the Free plan can lower the limit below its hard $5. If it can, set a limit such as $2. The equivalent API is `PUT /v2/users/me/limits` with `maxMonthlyUsageUsd` (_verified_).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Not done                                                                                                           |
| P5  | **Reading the cost of a run.** Go to Console → **Runs**; the **Usage** column shows each run's cost (_verified_ by the user in the spike). A scoped token cannot list runs through the API (`insufficient-permissions`). Use this page to fill in the cost column of `live-calls.md` after Phase 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Known                                                                                                              |
| P6  | **Token into the local environment.** Add `APIFY_TOKEN=apify_api_…` to `.env` and `.dev.vars`. Both are git-ignored, and workerd reads only `.dev.vars` when that file exists. After a change, rebuild before `npm run preview`. _(verified: Cloudflare docs; CLAUDE.md)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Done by the user** 2026-10-17 (the user's record)                                                                |
| P7  | **Listings for Phase 3.** Add three otodom offer addresses to `.env` (git-ignored; they never enter the repository): `APIFY_VERIFY_SALE_URL` (a live flat for sale), `APIFY_VERIFY_RENTAL_URL` (a live flat for rent) and `APIFY_VERIFY_EXPIRED_URL` (an expired offer). Without P6 and P7, Phase 3 records "skipped" and its live checks move to the Manual rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Done by the user** 2026-10-17: sale 200 (`FLAT/SELL`), rental 200 (`FLAT/RENT`), expired 410 (the user's record) |
| P8  | **Production secret.** After the Phase 6 deploy prerequisites, run `npx wrangler secret put APIFY_TOKEN` and paste the token. This creates a new Worker version and deploys it immediately; with gradual deployments use `npx wrangler versions secret put` instead (_verified_: developers.cloudflare.com/workers/configuration/secrets/). Never GitHub secrets, never CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Manual row 6.x                                                                                                     |

P1–P3, P6 and P7 are the user's own record of 2026-10-17, so Phase 3 makes its live calls in the unattended run; `SKIPPED` is the fallback only if a listing has gone stale by then.

## Live-call budget and pacing

This section records the user's authorisation of 2026-10-17. It is scoped to this change and covers nothing else.

**Where live calls happen.** Only in Phase 3, through `scripts/apify-verify.mjs`. Never in `npm test`, `npm run smoke`, Playwright, CI or any other phase. The final Manual row (6.x) is a run the user starts and is not counted here.

**Expected calls:**

| Target        | Expected | Of which                                                                                                                                |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Apify         | 6        | 1 with an invalid token (refused before start, not billed, does not reach otodom) and 5 that may reach otodom (including `run-timeout`) |
| otodom direct | 1        |                                                                                                                                         |

**Limits:**

- Apify: 15 calls — every request sent to `api.apify.com`, billed or not. The limit may be raised **once** to 25, after which the script stops and the remainder becomes a Manual row.
- otodom direct: the same, 15 raised once to 25.
- The script enforces both: it counts rows in `live-calls.md`, and a raise is one recorded `--raise-budget` row per target.

**Pacing, enforced by the script:**

- Calls are strictly sequential, never parallel.
- There are at least 30 s between two requests that reach otodom. Every direct request and every Apify run that starts counts; an Apify call refused before start does not.
- A normal browser User-Agent is used: the direct leg calls `fetchOfferAd` from `src/lib/otodom/fetch.ts`, which already sends the module's private `REQUEST_HEADERS` (not exported, and not to be).
- Only `/pl/oferta/…` paths are requested, which robots.txt allows (`otodom_fetching.md` §1). Search, `/api/query` and map views are never touched.
- The same listing is never fetched again from the same target just to repeat a result. The no-repeat key is **(target, case, listing ID)**: a case never runs twice (`ALREADY_RECORDED`, see Phase 3), while different cases may share a listing — `redirect` on the sale listing is a different question from `sale`, not a repeat of its result.
- `invalid-token` sends the sale address with a junk token. Apify refuses it before any run starts, so it reaches no otodom page and counts toward neither the no-repeat rule nor the 30 s pacing. It **does** count toward the Apify budget, which counts every request sent to `api.apify.com`, billed or not.

**Stop rule.** On the first 403, 429 or `cf-mitigated` answer from otodom, on either leg, the script records `BLOCKED` and refuses every later otodom-reaching call in this change: each later otodom-reaching case prints `BLOCKED` without calling. Nothing retries around a block.

**Record.**

- Every call is a row in `context/changes/otodom-apify-fallback/live-calls.md`, written **before** the call with its purpose and completed after it.
- Each row holds: time, target (`otodom`/`apify`), case, purpose, listing ID token only (e.g. `ID4Da0W`, never a URL or any listing text), `billed` (yes/no), `reached_otodom` (yes/no), result (status, reason, booleans), Apify cost if known (filled later from Console, P5), and the running count against the limit.
- Raw responses go only to a directory outside the repository (`os.tmpdir()` unless `APIFY_VERIFY_OUT` is set).

**Missing prerequisites.** With no `APIFY_TOKEN`, or no address for a case, that case makes no call, is recorded and printed as `SKIPPED`, and moves to the Phase 3 Manual row.

## Current State Analysis

**Ingestion path.** `ingestOffer` (`src/lib/otodom/index.ts:35-46`) normalises the address, calls `fetchOfferAd` (`src/lib/otodom/fetch.ts:133-222`) and then `mapAdToOffer` (`src/lib/otodom/map.ts:215-309`). Both routes hand it one `AbortSignal.timeout(45_000)`: `src/pages/api/offers.ts:91` and `src/pages/api/offer-refetch.ts:148`.

**Classification.** `fetchOfferAd` classifies in a fixed order, and the first match wins:

1. a thrown error is `timeout` or `network` (:137-145);
2. `cf-mitigated` is `challenged` (:168);
3. an off-otodom landing is `http_denied` (:171);
4. 404/410 is `not_found` (:172);
5. a status of 500 or above is `upstream_error` (:175);
6. any other non-2xx is `http_denied` (:177);
7. a `/wyniki` landing is `not_found` (:180);
8. an elsewhere or unparseable landing, or another listing's token, is `unexpected_landing` (:182-187);
9. a body read error is `timeout` or `network` (:189-194);
10. no marker is `data_missing` (:199);
11. an unparseable marker, a missing `pageProps` or a missing ad is `shape_changed` (:207, :212, :221);
12. the expired flag is `expired` (:217, :220).

The helpers are `readLanding` (:108-123), `withoutSlugs` (:86-99), `isAbort` (:39-44) and `errorEvidence` (:70-78).

**Import constraint.** `fetch.ts`, `map.ts`, `url.ts` and `types.ts` hold only `import type`, because `scripts/otodom-inspect.mjs:11-13` loads them under Node type stripping. A type import is erased; a value import with the repository's extensionless style (`./fetch`, as in `index.ts:1-4`) would not resolve under Node ESM, which is why a module the scripts load takes values only through an explicit `.ts` specifier (Phase 2 §2). `node --check` only parses and never resolves imports, so it cannot prove a module loads. `index.ts` is imported by the two routes, by `failure.ts` (type only) and by tests. It is not imported by the inspect script.

**Failure tables.** `IngestFailureReason` (`index.ts:10`) feeds three exhaustive tables in `src/lib/otodom/failure.ts`:

- `addFailureMessage` (:15-52);
- `refetchFailureMessage` (:59-96);
- `INGEST_OUTCOME` (:116-133).

`fetchFields` (:140-155) maps `FetchEvidence` (`types.ts:27-44`) onto log fields.

**Log whitelist.** `logEvent` keeps only the names in `FIELDS` (`src/lib/log.ts:9-58`).

**The "45 seconds" deadline appears in:**

- `src/pages/api/offers.ts:89,91`;
- `src/pages/api/offer-refetch.ts:146,148`;
- `src/lib/otodom/failure.ts:44,88`;
- `scripts/otodom-inspect.mjs:31`;
- `src/components/offers/RefetchForm.tsx:23`;
- `src/pages/dev/forms.astro:391`;
- `tests/pages/api/offers.test.ts:431,462`;
- `tests/pages/api/offer-refetch.test.ts:595`;
- `tests/lib/otodom/failure.test.ts:53,119`.

**Zero-config reference.** The pattern to follow is the audit key:

- `astro.config.mjs:21` (`envField.string({context:"server", access:"secret", optional:true})`);
- `createAuditProvider` returns `null` (`src/lib/audit/provider.ts:46,111-123`);
- the `ConfigStatus` entry and `isAuditAvailable()` (`src/lib/config-status.ts:3-37`);
- `tests/setup.ts:7-12` and `tests/setup.test.ts`.

**Singletons.**

- The boolean-PK singleton pattern is in `supabase/migrations/20261007073258_create_audit_settings.sql`: `:18-26` for the key, the RLS comment block at `:108-131`, and the anonymous sign-in block at `:144-151`.
- The precedent for a table with a `select` policy only is `criteria_revision` (`20260927144141_create_team_criteria.sql:340-351`).
- The `audit_settings` signature trigger raises 42501 without `auth.uid()` (`:86-88`) and must not be copied.
- The newest migration is `20261011160031_offers_archive.sql`.

**Settings reader.** `loadAuditSettings` (`src/lib/audit/settings.ts:115-147`) returns its result as `{state:"error", failure: ReadFailure}` (`src/lib/criteria.ts:303-310`) and is tested in `tests/lib/audit/settings.test.ts`.

**`/criteria`.**

- `src/pages/criteria.astro:12-34` loads the criteria and the audit settings with `Promise.all`.
- `src/components/criteria/CriteriaView.astro:208-277` renders the audit section with `data-audit-settings-state`.
- `/dev/criteria` (`src/pages/dev/criteria.astro:32-115`, `src/pages/dev/_criteria-fixtures.ts:150-204`) enumerates the states.
- `tests/components/criteria/CriteriaView.test.ts` is the render test.

**Smoke.** It never reaches otodom (`scripts/smoke.mjs:1-11,103-107`). Its singleton RLS steps are:

- `criteria_revision` read-only: `:1153-1162` and `:1766-1776`;
- `audit_settings`: `:1176-1192` and `:2028-2050`;
- the page marker: `:2109-2113`.

The CI smoke job runs `supabase start`, which applies every migration (`.github/workflows/ci.yml:41-44`).

**Tests.** `stubFetch` (`tests/fixtures/http.ts:53-86`) fails a test on any unplanned request. `tests/fixtures/anthropic.ts:49-68,217-246` is the reference for a paid vendor. The guard at `tests/pages/api/offer-refetch.test.ts:1020-1032` asserts that every recorded request is to otodom, a stored read or an offer write.

**Environment.** `.env` and `.dev.vars` hold no `APIFY_TOKEN` (checked 2026-10-17). No roadmap item carries this change ID. The parked entry is `context/foundation/roadmap.md:264`, with Open Question 4 at `:246` and the S-02 unknown at `:107`.

## Desired End State

- **`direct_with_fallback`** (seeded), with a token: a member's add or re-fetch fetches directly, with a 20 s deadline. When that ends in `challenged`, `http_denied`, `timeout`, `network` or `data_missing`, the Worker makes exactly one Apify run with a 40 s client deadline (Apify `timeout=30`). It classifies the returned item with the same taxonomy and maps the same `ad`. A success reads exactly like a direct success.
- **`apify_only`** makes no direct request. **`direct_only`**, a missing token, or a failed read of the mode behaves as today, with the whole 60 s budget and never an Apify request.
- **Every ingest log entry** says:
  - which mode was configured, which ran, and why they differ;
  - the state of the mode read;
  - which leg produced the outcome;
  - why the fallback ran;
  - Apify's status, its error type and the kind of Apify failure;
  - each leg's duration.
- **`/criteria`** shows the configured and the effective mode, read-only, under `data-ingestion-settings-state`, `data-ingestion-mode` and `data-ingestion-mode-effective`.
- **CLAUDE.md, the reviewer's criteria, the PRD, the roadmap, the runbook and `otodom_apify.md`** describe the fallback as sitting beside the direct scraper. CLAUDE.md records the Apify paid-call rule together with this change's authorisation.

**Verification.**

- `npm test`, `npm run lint`, `npx astro sync`, `npx astro check` and `npm run build` pass with no secrets.
- Phase 3's live comparison shows `ad` JSON-equal on a live sale, `not_for_sale` on a rental and `not_found` on an expired offer.
- After the Manual rows: smoke is green, the migration is pushed, the secret is set, the evals have been run by the user, and one real fallback run has been made.

### Key Discoveries:

- Splitting `fetchOfferAd` into a check of the answer (status, landing, `cf-mitigated`, listing token) and a check of the payload (marker, parse, `pageProps`, ad, expired) lets the Apify leg feed both from one item (`fetch.ts:147-221`). Apify cannot feed `cf-mitigated`, `retry-after`, `content-type` or the body length.
- The spike's `pageFunction` turns a missing `pageProps` into `ad_missing` (`?? {}`). Adding `pagePropsPresent` keeps the `page_props_missing` detail. Its `typeof src === "object"` accepts an array, so the Worker still checks `isRecord` on everything in the item.
- In `offers.ts` the mode read sits after the duplicate precheck (:87) and before `started` (:89), so a duplicate never consults or pays for anything. In `offer-refetch.ts` it sits after normalising (:144). In both routes it comes after the session check and URL validation, so smoke's existing requests, which are refused before the network, never touch it.
- No run id comes back from `run-sync-get-dataset-items` (Apify API reference), so no run-id field is added.
- An Apify-side error arrives as HTTP 201 with `{"#error": true, "#debug": {…}}`, and `#debug.errorMessages` hold stack traces (`spike-apify.md:70-72`).

## What We're NOT Doing

- No `trev0n/otodom-scraper`, and no second mapper: the spike rejected that actor.
- No admin panel or form for the mode, and no Studio link or project ref on the page.
- No retry of a paid call by the Worker, and no Apify call at all in `direct_only`, with no token, or on a failed mode read.
- No fallback on `shape_changed`, `not_found`, `expired`, `upstream_error`, `unexpected_landing`, URL refusals or `not_for_sale`/`not_a_flat`.
- No async Apify runs, webhooks, run ids or module-scope cache. Nothing such as a memo of "direct failed recently".
- No HTML parser dependency in the Worker. Cheerio runs inside Apify and does not enter `package.json`.
- No `APIFY_TOKEN` in CI, GitHub secrets, `review.yml` or the code-reviewer package.
- No cost figures or source badge in the UI.
- No visual gate or screenshots (the user's choice: the section is read-only text with no interaction, so a 7-state matrix would be mostly „nie dotyczy”). One Manual look at `/dev/criteria` replaces them.

## Implementation Approach

The work runs bottom-up, with each phase green on its own:

1. **The mode table** and the pure function that turns (mode read, token present) into the configured mode, the effective mode and a reason. Both the routes and the view use that function.
2. **The Apify leg, offline:**
   - the classifier split, with the direct behaviour pinned by the existing tests;
   - the deadlines module, and a Node-loadable request module holding the fixed `pageFunction` and the request;
   - a token-holding leg built per request.
3. **Live verification** of that exact request module, through a script that enforces the budget.
4. **Orchestration in `ingestOffer`** and the routes: deadlines, triggers, the choice of the member's reason, the new log fields, and route tests for every mode.
5. **The view.**
6. **The rules and documents**, with every step that needs the user as a Manual row.

## Critical Implementation Details

- **Ordering.** The mode read and the token check happen after every free refusal (session, form, URL, precheck or stored-row read), so a request that would be refused anyway never reads the table and never reaches Apify. The direct deadline is chosen from the **effective** mode. That deadline is 20 s only when an Apify leg can follow; otherwise it is the whole 60 s budget.
- **The `pageFunction` is code.** It is one fixed string constant in the repository, reviewed like code and never built from input; it is assembled once at module load from the exported key lists in `apify-request.ts` (Phase 2 §4), so there is one whitelist, not a list in code plus a copy in a string. The actor runs with full account permissions while the function executes (P3). Only the start URL varies, and it is always the output of `normalizeOfferUrl`.
- **Apify's words never reach a log or a member.** No `error.message`, no `#debug` and no response body text reaches `logEvent` or a member. Only `apify_status`, the `error.type` token (`apify_error_type`) and our own `apify_failure` token do.

## Phase 1: The mode table and its read

### Overview

Create `public.ingestion_settings` and the reader. Add the pure function that decides the effective mode, its tests, the smoke steps for its RLS, and the CLAUDE.md exception the table relies on.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_create_ingestion_settings.sql`, created with `npx supabase migration new create_ingestion_settings`, never by hand.

**Intent**: A singleton holding the ingestion mode. Members read it, and nobody but the owner, acting as `postgres` in Studio, can change it.

**Contract**:

- **Table and key.** `id boolean primary key default true` with `constraint ingestion_settings_singleton check (id)`, and `mode text not null` with `constraint ingestion_settings_mode_known check (mode in ('direct_with_fallback','apify_only','direct_only'))`. Seeded with `insert … values (true, 'direct_with_fallback')`.
- **RLS.** `enable row level security` and one policy, `ingestion_settings_select_authenticated` (`for select to authenticated using (auth.uid() is not null)`).
- **What is deliberately absent:**
  - no insert, update or delete policy;
  - no `anon` policy;
  - no trigger and no `updated_by` column (a Studio edit has no `auth.uid()`).
- **Comments.** The RLS comment block from `20261007073258_create_audit_settings.sql:108-122`, adapted. It states that the denial of every write is the design (owner edits in Studio as `postgres`, which has `bypassrls`), that it must not be "fixed" with policies, and the two denial signatures. One paragraph says why next to the table: this is an operational setting no member may change (a cost switch), never data members are meant to write — the narrow exception CLAUDE.md states (§5 below). The anonymous sign-ins block (`:144-151`), adapted.

#### 2. Reader and effective mode

**File**: `src/lib/ingestion-settings.ts` (new; island-safe, with `@/lib/supabase` imported as `import type` only)

**Intent**: Read the mode. A failed read is its own state with a reason, never the default. Also decide the mode that actually runs, which both the routes and `/criteria` call so the two never disagree.

**Contract**:

- **Closed list.** `INGESTION_MODES = ["direct_with_fallback","apify_only","direct_only"] as const`, with a comment saying it mirrors `ingestion_settings_mode_known`.
- **Labels.** Polish labels for each mode, e.g. „najpierw bezpośrednio, potem Apify”, „tylko Apify”, „tylko bezpośrednio”.
- **The read.** `loadIngestionSettings(supabase: SupabaseClient | null): Promise<IngestionSettingsResult>`, where the result is `{state:"ok", mode}` or `{state:"error", read:"error"|"missing_row"|"off_list", failure: ReadFailure}`. It mirrors `loadAuditSettings`'s branches: no client gives `error` with `detail:"unconfigured"`, a query error gives `error` with `dbCode`/`dbStatus`, no row gives `missing_row`, a value outside the list gives `off_list`, and a throw gives `error`. It never throws.
- **The effective mode.** `resolveIngestionMode(settings, apifyAvailable: boolean): { configured: IngestionMode | null; effective: IngestionMode; reason: "apify_unconfigured" | "mode_read_failed" | null; read: "ok"|"error"|"missing_row"|"off_list" }`:
  - A failed read gives `effective:"direct_only"` and `reason:"mode_read_failed"`.
  - An ok read with no token gives `effective:"direct_only"` and, when the configured mode is not `direct_only`, `reason:"apify_unconfigured"`.
  - Otherwise `effective = configured`.

#### 3. Tests

**Files**: `tests/lib/ingestion-settings.test.ts` (new)

**Intent**: Follow `tests/lib/audit/settings.test.ts`.

**Contract**:

- Every failed read stands beside the read that succeeds: a null client makes 0 requests; a 500, an empty answer, two rows, `{}`, `null` and text each make 1 request.
- Each off-list value stands beside a control.
- `resolveIngestionMode` has one case per (read state × token × configured mode) with expected values written by hand.
- A test keeps `INGESTION_MODES` and the migration's check list in step, by reading the migration file's `check (mode in (…))` text.

#### 4. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Prove the table's RLS from both sides, the way `criteria_revision` and `audit_settings` are proved.

**Contract**:

- **Constant.** `INGESTION_SETTINGS = "ingestion_settings?id=eq.true"` and an `observedIngestionSettings()` snapshot reader.
- **Steps:**
  - anon select gives `{200, rows:0}`;
  - a member select gives `{200, rows:1}`;
  - a member PATCH of `mode` gives `{200, rows:0, snapshot:"same"}`;
  - an anon PATCH gives `{200, rows:0, snapshot:"same"}`;
  - a member POST gives `{403, errorCode:"42501", snapshot:"same"}`;
  - a member DELETE with `return=representation` gives `{200, rows:0, snapshot:"same"}`.
- **Header.** The header comment gains a paragraph for these steps and states that smoke never reaches Apify. The smoke job has no token.

#### 5. The RLS exception in CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: No later subagent of the unattended run reads a rule that the new table breaks and "repairs" it with policies. This edit lands in this phase, in the same commit as the migration; the reviewer's matching criterion stays in Phase 6 §2, with the other criteria the evals measure together.

**Contract**:

- The RLS bullet (:20) widens its exception — today only a table written by a `security definer` trigger may have no write policies — to also cover "a table changed only by the owner in Supabase Studio (`postgres`, `bypassrls`), with a `select` policy for `authenticated` and nothing else", naming `supabase/migrations/*_create_ingestion_settings.sql` as the reference.
- The exception stays narrow and says why: it is for operational settings no member may change (the ingestion mode, a cost switch), never for data members are meant to write — a table members should write still needs one policy per operation.
- It states that the missing write policies are the design and must not be "fixed", and that a member's write is denied the usual two ways (update/delete reach 0 rows, insert fails 42501).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Smoke script parses: `node --check scripts/smoke.mjs`
- Migration file exists and matches the naming: `ls supabase/migrations/*_create_ingestion_settings.sql`
- CLAUDE.md's RLS exception names the new migration: `grep -n "create_ingestion_settings" CLAUDE.md`

#### Manual Verification:

- `npm run smoke` passes against a local Supabase (`supabase start` applies the new migration), or the CI `smoke` job is green on the pull request

---

## Phase 2: The Apify leg, offline

### Overview

Add `APIFY_TOKEN` in the zero-config way, add the deadlines module, split the classifier with the direct behaviour unchanged, add the Node-loadable request module with the fixed `pageFunction`, and add the token-holding leg that reads Apify's answer. Everything is tested against synthetic fixtures.

### Changes Required:

#### 1. Zero-config token

**Files**: `astro.config.mjs`, `src/lib/config-status.ts`, `tests/setup.ts`, `tests/setup.test.ts`, `.env.example`

**Intent**: Missing `APIFY_TOKEN` is a supported state. It degrades to direct and shows in the banner.

**Contract**:

- `astro.config.mjs` gains `APIFY_TOKEN: envField.string({ context:"server", access:"secret", optional:true })`.
- `config-status.ts` gains an entry `{ name:"Apify", configured:Boolean(APIFY_TOKEN), message:"Brak tokenu Apify (APIFY_TOKEN) — zapasowe pobieranie ogłoszeń jest wyłączone." }` and `export function isApifyAvailable(): boolean`, with a doc comment mirroring `isAuditAvailable()`. That comment says a view asks this function and never imports the Apify module. It also says the banner says only whether the token is set and never that it works.
- `tests/setup.ts` mocks `APIFY_TOKEN: undefined`. `tests/setup.test.ts` asserts that it is undefined and that `createApifyLeg()` returns `null`.
- `.env.example` gains an empty `APIFY_TOKEN=` with a one-line comment.

#### 2. Deadlines

**File**: `src/lib/otodom/deadlines.ts` (new; import-free — constants and their order comment only, so the import chain ends here; following `src/lib/audit/failure.ts:12-30`), `tests/lib/otodom/deadlines.test.ts` (new)

**Intent**: Named constants with their order stated and tested. They exist from this phase on because `apify-request.ts` (§4) needs `APIFY_RUN_TIMEOUT_S` here and Phase 3 runs it live.

**Contract**:

- **Constants:**
  - `INGEST_ACTION_BUDGET_MS = 60_000`;
  - `DIRECT_BEFORE_FALLBACK_MS = 20_000`;
  - `APIFY_CLIENT_DEADLINE_MS = 40_000`;
  - `APIFY_RUN_TIMEOUT_S = 30`.
- **The order, as a comment:**
  - `APIFY_RUN_TIMEOUT_S * 1000 < APIFY_CLIENT_DEADLINE_MS`;
  - `DIRECT_BEFORE_FALLBACK_MS + APIFY_CLIENT_DEADLINE_MS <= INGEST_ACTION_BUDGET_MS`;
  - the direct-only deadline (`INGEST_ACTION_BUDGET_MS`) `>= 45_000`, never less tolerant than before.
- **Who uses it.** `apify-request.ts` imports `APIFY_RUN_TIMEOUT_S` as `import { APIFY_RUN_TIMEOUT_S } from "./deadlines.ts"`, and `scripts/otodom-inspect.mjs` imports `INGEST_ACTION_BUDGET_MS` from `../src/lib/otodom/deadlines.ts` in place of its own `45_000` (`otodom-inspect.mjs:31`). The explicit `.ts` specifier is what Node's type stripping resolves, and Astro's tsconfig allows it (`allowImportingTsExtensions`, `node_modules/astro/tsconfigs/base.json:10`). Vitest, `npx astro check` and `npm run lint` must pass with it; if a lint rule rejects the specifier, that is a STOP to report, not a rule to disable.
- **Test.** `tests/lib/otodom/deadlines.test.ts` pins the order.

#### 3. Classifier split

**File**: `src/lib/otodom/fetch.ts`

**Intent**: One taxonomy for both legs. The direct path's observable behaviour does not change at all.

**Contract**:

- Two exported pure functions; `fetch.ts` keeps `import type` only:
  - `classifyAnswer({status, requestedUrl, landedUrl, cfMitigated?, retryAfter?, contentType?})` returns `FetchOfferFailure | null` together with the answered evidence. It covers the checks currently at :168-187.
  - `classifyPayload({markerPresent, parseError, pagePropsPresent, ad, pagePropsExpired}, evidence)` returns a `FetchOfferResult`. It covers :196-221.
- `fetchOfferAd` calls the first, reads the body and runs the `RegExp` and `JSON.parse`, then calls the second.
- Every existing test in `tests/lib/otodom/fetch.test.ts`, `tests/pages/api/offers.test.ts` and `tests/pages/api/offer-refetch.test.ts` passes **unmodified**.
- New unit tests feed both functions directly, one case per branch.

#### 4. Node-loadable request module

**File**: `src/lib/otodom/apify-request.ts` (new; value imports only from import-free sibling modules — here `./deadlines.ts` — always through a `.ts` specifier, never `astro:*`, `@/…` or a package, so `scripts/apify-verify.mjs` can load it under Node)

**Intent**: The one definition of what we send to Apify. Both the Worker and the verification script use it.

**Contract**:

- **Constants:**
  - `APIFY_ACTOR_ID = "YrQuEkowkNCLdk4j2"`;
  - `APIFY_ENDPOINT` = `https://api.apify.com/v2/acts/YrQuEkowkNCLdk4j2/run-sync-get-dataset-items`, built with the actor ID;
  - `APIFY_RUN_PARAMS`, holding `maxTotalChargeUsd=0.05`, `timeout=APIFY_RUN_TIMEOUT_S` (from `./deadlines.ts`), and `memory=1024`;
  - `APIFY_AD_KEYS`, `APIFY_LOCATION_KEYS` (`coordinates`, `reverseGeocoding`, `address`) and `APIFY_TARGET_KEYS` (`OfferType`, `ProperType`): the whitelist, exported, with `APIFY_AD_KEYS` matching the spike's `KEEP` (`spike-apify.md:98-99`);
  - `APIFY_PAGE_FUNCTION`, a fixed string assembled at module load from those lists (`JSON.stringify` of the arrays into the fixed source text). It is still one fixed string with no input in it.
- **The `pageFunction`.** The spike's function (`spike-apify.md:95-118`) with two changes. It reads the status as `response.status`, and it also returns `pagePropsPresent`. Its whitelist is the exported lists above, and it never copies `owner`, `contactDetails` or `agency`. It narrows `target` to `APIFY_TARGET_KEYS` and `location` to `APIFY_LOCATION_KEYS`.
- **The request.** `buildApifyRequest(normalizedUrl): {url, body}`. The body is `{startUrls:[{url}], pageFunction, proxyConfiguration:{useApifyProxy:true, apifyProxyGroups:["RESIDENTIAL"], apifyProxyCountry:"PL"}, maxRequestsPerCrawl:1, maxRequestRetries:1, maxConcurrency:1}`. The token is never part of the URL.
- **Reading the answer.** `readApifyAnswer(httpStatus, json, requestedUrl)` is pure. It returns either an item to classify or an Apify failure `{apifyFailure: "http"|"empty_dataset"|"malformed_item"|"run_error", apifyStatus?, apifyErrorType?}`. It runs only after `isRecord` and type checks on every field, and it handles four cases:
  - **non-2xx:** the `error.type` token is read, and `error.message` is never read;
  - **`[]`:** `empty_dataset`;
  - **an `#error` item:** `run_error`, which the leg maps to `http_denied` with no status because Apify reached otodom, and the member reads the reason of the path that reached otodom;
  - **an item whose `requestedUrl` differs from the URL sent:** `malformed_item`.

#### 5. Token-holding leg

**File**: `src/lib/otodom/apify.ts` (new; server-only, imports `APIFY_TOKEN` from `astro:env/server`)

**Intent**: The one module that holds the token and talks to Apify, following `createAuditProvider`.

**Contract**:

- `createApifyLeg(): ApifyLeg | null` returns `null` without a token and otherwise builds a fresh leg per call. Nothing is held at module scope.
- `ApifyLeg.fetchAd(url, signal): Promise<ApifyLegResult>` makes exactly one `fetch` with `Authorization: Bearer`. It maps the result as follows:
  - an item becomes `classifyAnswer`, then `classifyPayload`, giving the same `FetchOfferResult` union as the direct leg, with `source:"apify"` evidence;
  - an Apify failure, an abort or a network error becomes `{ok:false, reachedOtodom:false, apifyFailure, apifyStatus?, apifyErrorType?}`, with `timeout`/`network` taken from the abort/`isAbort` distinction.
- It never retries.

#### 6. Lint guard

**File**: `eslint.config.js`, `tests/eslint.config.test.ts`

**Intent**: Keep the token module out of page renders and islands, the way `auditNoNotesConfig` keeps notes out of the audit.

**Contract**:

- A config such as `apifyServerOnlyConfig` makes an import of `@/lib/otodom/apify` an error under `src/components/**`, `src/layouts/**` and `src/pages/**/*.astro`.
- `tests/eslint.config.test.ts` gains a rejected sample beside an allowed one, the allowed one in `src/pages/api/offers.ts`.

#### 7. Fixture and tests

**Files**: `tests/fixtures/apify.ts` (new), `tests/lib/otodom/apify.test.ts` (new), `tests/lib/otodom/apify-request.test.ts` (new)

**Intent**: Synthetic, hand-written fixtures, never a recorded payload, mirroring `tests/fixtures/anthropic.ts`.

**Contract**:

- **Exports:**
  - `APIFY_TEST_TOKEN` (worth nothing), `isApifyRequest` and `apifyCalls`;
  - `apifyItem(ad, overrides)`, whose `ad` is built from `flatSaleAd` **with** `owner`/`contactDetails`/`agency`/`target.seller_id` still present. That is a would-be leak, so the Worker's own whitelist is what the canary test proves;
  - `apifyRunError()`, the `#error` item;
  - `apifyError(status, type, messageCanary)` for 401 `user-or-token-not-found`, 403 `insufficient-permissions`, 403 `full-permission-actor-not-approved`, 400 `run-failed` (the run-timeout shape observed live on 2026-10-17, added in Phase 3 as `apifyRunTimeout()`), 402, 408 and 429;
  - `apifyEmpty()` and `apifySilence({signal})`;
  - item variants: a rental, `status: 410`, a `/wyniki` landing, an expired flag, no marker, `parseError`, and no `pageProps`.
- **Tests:**
  - every mapping in `readApifyAnswer` and the leg;
  - the request carries the Bearer header, carries no token in the URL, and carries the run parameters, proxy group and retries named above, read back from the stub's recorded request;
  - an Apify `message` canary never appears in the result.
- **The `pageFunction` test** evaluates `APIFY_PAGE_FUNCTION` against a stub context (a minimal `$` returning a synthetic `__NEXT_DATA__` with seller canaries). It asserts that the output carries no canary, that the output `ad` has no key outside `APIFY_AD_KEYS`/`APIFY_LOCATION_KEYS`/`APIFY_TARGET_KEYS`, and that `pagePropsPresent`, `pagePropsExpired`, `parseError` and `status` are right, beside a control showing that the input held the canaries.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including every pre-existing ingestion and route test unmodified: `npm test`
- Lint passes, including the new import guard: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Build passes with no secrets: `npm run build`
- The inspect script loads every import under Node (offline): `node scripts/otodom-inspect.mjs --help`
- The request and deadlines modules load under Node: `node --input-type=module -e "await import('./src/lib/otodom/apify-request.ts'); await import('./src/lib/otodom/deadlines.ts')"`

---

## Phase 3: Live verification within the budget

### Overview

Prove the committed request module against the real Apify and otodom, within the budget and pacing above. Only conclusions enter the repository.

### Changes Required:

#### 1. Verification script

**File**: `scripts/apify-verify.mjs` (new)

**Intent**: The only place a live call in this change is made. It enforces the budget, the pacing and the record itself, so an unattended run cannot exceed them.

**Contract**:

- **Inputs.** It reads `APIFY_TOKEN` and `APIFY_VERIFY_{SALE,RENTAL,EXPIRED}_URL` from `.env` (`node --env-file-if-exists=.env`). It imports `src/lib/otodom/apify-request.ts`, `fetch.ts`, `url.ts` and `map.ts` the way `otodom-inspect.mjs` does.
- **Modes:**
  - `--check-log` is offline. It fails when `live-calls.md` is missing. It validates `live-calls.md`:
    - the counts are within the limits, with at most one raise per target;
    - no row contains `http`, `otodom.pl/` or `/oferta/`, and there is no listing text — listing ID tokens only, so gate 3.10 cannot be broken by the script itself;
    - rows with `reached_otodom: yes` are at least 30 s apart (pacing is checked only between those rows);
    - every row has its case and its purpose;
    - no (target, case, listing ID) has two completed rows;
    - nothing that reaches otodom follows a `BLOCKED` row.
  - `--check-expected` is offline and reads only `live-calls.md`. It compares each recorded case with the case table below:
    - it passes when every recorded case matches its expected result, or is `SKIPPED`, `BLOCKED` or `STALE`;
    - a listing that is no longer what its variable claims (`sale` or `rental` answering 410, `expired` answering 200) is reported as **`STALE`**: the listing moved, not the code. It passes, and the case moves to the Manual row with "replace the address in `.env`";
    - it **fails** on any other mismatch, and the unattended run then follows the STRUCTURAL rule (STOP) rather than changing the classifier, the `pageFunction` or the expectations to fit.
  - `--case <invalid-token|sale|rental|expired|redirect|run-timeout>` makes at most one call.
- **Before each call** it writes the row's purpose and checks the limit, the 30 s wait (it sleeps), `BLOCKED` and the no-repeat rule, then completes the row. Raw JSON goes to `APIFY_VERIFY_OUT` or `os.tmpdir()`, never into the repository.
- **Exit codes of `--case`** (binding: a gate re-run after a self-fix must cost nothing):
  - **0, call made and result recorded.**
  - **0, `ALREADY_RECORDED`:** the case already has a completed row. No call is made and the recorded result is reprinted. A repeat is never a failure, otherwise every gate re-run after a self-fix would fail or pay again.
  - **0, `SKIPPED`:** no token or no address for that case. Recorded; the case moves to the Manual row.
  - **0, `BLOCKED`:** otodom answered 403, 429 or `cf-mitigated` — a fact about the world, not a code defect. Recorded; every later otodom-reaching case prints `BLOCKED` without calling; the remaining cases move to the Manual row.
  - **≠0 only for a refusal that means the run must stop:** the budget is exhausted (after the one allowed raise), or `live-calls.md` is malformed or contradicts the rules.
- **Output.** It prints conclusions only: status, landing kind, reason, `ad` keys, booleans, and whether the payloads are equal.

**The cases:**

| Case            | What it calls                                                                                                                                                                                                                                                                                                          | Expected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invalid-token` | Apify with a junk token on the sale address (refused before start: `billed: no`, `reached_otodom: no`)                                                                                                                                                                                                                 | 401 `user-or-token-not-found` → `apifyFailure:"http"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sale`          | Direct fetch (`fetchOfferAd`), then Apify, with 30 s between                                                                                                                                                                                                                                                           | (1) every key of `APIFY_AD_KEYS`/`APIFY_LOCATION_KEYS`/`APIFY_TARGET_KEYS` that the direct `ad` has is present in the Apify `ad` and JSON-equal — the set comes from the exported lists, never from the Apify item's own keys, so a key Apify silently dropped is still compared; (2) the Apify `ad` has **no** key outside the lists (the leak check: `owner`, `contactDetails`, `agency`, a full `target`); (3) the two `OfferInsert`s `mapAdToOffer` makes from the two `ad`s are deep-equal — this decides the case                                                                                                                                                                                                                                                        |
| `rental`        | Apify                                                                                                                                                                                                                                                                                                                  | `not_for_sale`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `expired`       | Apify                                                                                                                                                                                                                                                                                                                  | `status` 410 → `not_found`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `redirect`      | Apify on the sale URL with an altered slug and the same ID                                                                                                                                                                                                                                                             | `loadedUrl` lands on the same listing token → accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `run-timeout`   | Apify with the same request as `sale` built by `buildApifyRequest`, only the run `timeout=` overridden to `1` by the script (the override exists in the script alone, never in `apify-request.ts`); counts toward the Apify budget and, since the run may reach otodom, toward the 30 s pacing (`reached_otodom: yes`) | It records what `run-sync-get-dataset-items` actually answers when a run exceeds its timeout — observed on 2026-10-17 as **HTTP 400 with `error.type` `run-failed`** (the user's decision of 2026-10-17 accepts this as the expected shape; 408 and 201 with an empty dataset stay covered by fixtures). `readApifyAnswer` and the leg must classify it as an Apify failure that did not reach otodom (`apifyFailure: "http"`, `apifyStatus: 400`, `apifyErrorType: "run-failed"`); any other classification is a mismatch → STOP. On a match the main agent pins the observed shape (status and `error.type` token only, never a message) as `apifyRunTimeout()` in `tests/fixtures/apify.ts` with one test in `tests/lib/otodom/apify.test.ts`, within Phase 3's touched set |

#### 2. Record and conclusions

**Files**: `context/changes/otodom-apify-fallback/live-calls.md` (new; written by the script), `context/changes/otodom-apify-fallback/live-verification.md` (new; conclusions, written by the main agent from the recorded results). Both are in the phase's touched set and land in the phase's commit.

**Intent**: An auditable trail, and the evidence that the committed request module behaves as the fixtures assume.

**Contract**:

- `live-calls.md` has a header holding the limits and the rules, then the table described under **Live-call budget and pacing**.
- `live-verification.md` holds listing ID tokens only, never a URL or a path shape (the rule `--check-log` enforces on `live-calls.md`), and gives one paragraph per case: the result, what it proves, and anything unexpected, written as a mismatch rather than adapted silently.
- If the expected result does not occur, `--check-expected` fails and the unattended run follows the STRUCTURAL rule (STOP) rather than changing the classifier, the `pageFunction` or the expectations to fit.
- **Residual risk**, stated in `live-verification.md`: a run that times out _after_ otodom answered (rare, since a normal run takes 2–9 s) stays covered by fixtures only; `run-timeout` verifies only a run that times out before it reaches otodom.
- A case that ends `SKIPPED`, `BLOCKED` or `STALE` is named in both files and listed by name in the Phase 3 Manual row, so the closing checklist says exactly which live checks the user still owes.

### Success Criteria:

#### Automated Verification:

- Script parses: `node --check scripts/apify-verify.mjs`
- Live case `invalid-token`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case invalid-token`
- Live case `sale`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case sale`
- Live case `rental`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case rental`
- Live case `expired`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case expired`
- Live case `redirect`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case redirect`
- Live case `run-timeout`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case run-timeout`
- The call log exists and obeys the budget and pacing: `node scripts/apify-verify.mjs --check-log`
- Every recorded case matches its expected result, or is `SKIPPED`/`BLOCKED`/`STALE`: `node scripts/apify-verify.mjs --check-expected`
- No listing address in the change folder: `! grep -rE "otodom\.pl/(pl/)?oferta" context/changes/otodom-apify-fallback/`
- Unit tests still pass: `npm test`

#### Manual Verification:

- The user reads `live-calls.md` and `live-verification.md`, fills in each Apify run's cost from Console → Runs → Usage, and confirms the six cases. This row is closed — every live case run, with no mismatch, and every `SKIPPED`/`BLOCKED`/`STALE` case completed — **before** the change leaves through `/git-ship` or `/git-land` (row 6.8 names it as its precondition). Every case recorded as `SKIPPED`, `BLOCKED` or `STALE` is named here by the run; the user completes it (for `STALE`: replace the address in `.env`) with the same `--case` command, within the same budget

---

## Phase 4: The fallback in both routes

### Overview

Choose the deadline from the effective mode, fall back on the agreed triggers, choose which reason the member reads, log the configured and the effective mode with the reason they differ, the state of the mode read, the source, the fallback reason, Apify's status and error type and each path's duration, and prove every mode with route tests that count requests and writes.

### Changes Required:

#### 1. Deadlines

**File**: none new. `src/lib/otodom/deadlines.ts` and its test already exist from Phase 2 §2; `ingestOffer` (§2 below) takes `INGEST_ACTION_BUDGET_MS`, `DIRECT_BEFORE_FALLBACK_MS` and `APIFY_CLIENT_DEADLINE_MS` from it.

#### 2. Orchestration

**File**: `src/lib/otodom/index.ts`

**Intent**: One function owns the sequence, so the two routes do not each decide it.

**Contract**:

- **Signature.** `ingestOffer(rawUrl, { mode: ResolvedIngestionMode, apify: ApifyLeg | null }): Promise<IngestResult>`. It creates its own signals from the deadlines; the routes no longer create any signal of their own (`AbortSignal.timeout(45_000)` goes from both).
- **How a leg's deadline is made.** The `src/pages/api/audits.ts:260-275` pattern, whose doc comment states why (cleared the moment the call ends, and a test can move it): one small helper, e.g. `legDeadline(ms): { signal, clear }` in `src/lib/otodom/index.ts` (not in the import-free `deadlines.ts`), owns an `AbortController` plus a `setTimeout` that calls `abort(new DOMException("…", "TimeoutError"))`, so `isAbort` (`src/lib/otodom/fetch.ts:39-44`) keeps reading a deadline as `timeout` — a fallback trigger. Both legs go through it, with `clear()` in `finally`; there is no second copy of the pattern, and `AbortSignal.timeout` is not used for the legs. The direct leg's timer is cleared **before** the Apify leg starts, and the Apify leg gets a fresh controller with the full `APIFY_CLIENT_DEADLINE_MS`: a direct timeout never eats into Apify's budget, and the two legs' aborts are told apart in the log by `source`.
- **`direct_only`:** a direct leg with `INGEST_ACTION_BUDGET_MS`.
- **`apify_only`:** an Apify leg with `APIFY_CLIENT_DEADLINE_MS` and no direct request.
- **`direct_with_fallback`:** a direct leg with `DIRECT_BEFORE_FALLBACK_MS`. Only when its reason is in `FALLBACK_TRIGGERS = {challenged, http_denied, timeout, network, data_missing}` does an Apify leg follow with `APIFY_CLIENT_DEADLINE_MS`. The trigger set is a named, exported constant.
- **Mapping.** `mapAdToOffer` runs unchanged on whichever leg returned an `ad`.
- **Which reason the member reads**, decided by `chooseOutcome(direct, apify)`, a pure function exported for tests:
  - If the Apify leg reached otodom (an item was classified, or `run_error`), its reason wins and `source` is `"apify"`.
  - If it did not, the direct reason wins and `source` is `"direct"`.
  - In `apify_only` with no reach, the reason is `extraction_failed`.
  - Direct `data_missing` followed by Apify `data_missing` keeps `reason:"data_missing"` and `source:"apify"`, with `detail:"both_sources"`.
- **Return value.** `IngestResult` carries `source`, `fallbackReason?`, `apifyStatus?`, `apifyErrorType?`, `apifyFailure?`, `directDurationMs?` and `apifyDurationMs?` for the log. On a fallback, the evidence (landed fields, marker) is the final leg's.

#### 3. The new reason and the member's sentences

**File**: `src/lib/otodom/failure.ts`, `src/lib/otodom/types.ts` (or `index.ts:10`)

**Intent**: One neutral sentence for the only case where no path has a reason about the listing — `apify_only` when Apify never reached otodom — and the timeout sentence without a number of seconds. The sentence names no vendor, configuration or cost; `apify_only` never falls back to a hidden direct request, because the owner sets it precisely to stop our own requests to otodom.

**Contract**:

- `IngestFailureReason` gains `extraction_failed`, with `INGEST_OUTCOME` set to `failed`.
- **Add:** „Nie udało się pobrać ogłoszenia z otodom.pl. Nic nie zostało zapisane — spróbuj ponownie później, a jeśli problem się powtarza, daj znać administratorowi.”
- **Re-fetch:** the same opening, ending with `KEPT`.
- **Timeout**, add and re-fetch: the number is removed, e.g. „Pobieranie ogłoszenia trwało zbyt długo. Nic nie zostało zapisane — spróbuj ponownie.” and its `KEPT` variant.
- `RefetchForm.tsx:23` and `src/pages/dev/forms.astro:391` say „do około minuty” in place of „45 s”.
- **Tests of the new sentences** assert the new text exactly (`toBe(…)`, or `toContain` of the full new sentence), never a negative assertion on "45", which gate 4.5 would match.
- `fetchFields` and `FetchEvidence` gain `source`.

#### 4. Log fields

**File**: `src/lib/log.ts`

**Intent**: Every field the log needs to tell the configured mode from the effective one, a failed mode read from a mode that is off, and which path produced the outcome, in the whitelist.

**Contract**:

- **New `FIELDS`:**
  - `source`;
  - `fallback_reason`;
  - `apify_status`, `apify_error_type` and `apify_failure` (`http|empty_dataset|malformed_item|run_error|timeout|network`, our own token, distinct from Apify's `error.type`);
  - `ingestion_mode`, `ingestion_mode_effective`, `ingestion_mode_reason` and `ingestion_mode_read`;
  - `direct_duration_ms` and `apify_duration_ms`.
- `db_code` and `db_status` already exist for a failed mode read.
- `error_message` is never filled from an Apify response or an Apify-side exception.

#### 5. Routes

**Files**: `src/pages/api/offers.ts`, `src/pages/api/offer-refetch.ts`

**Intent**: Read the mode at the agreed place, build the leg, hand both to `ingestOffer`, and log the outcome.

**Contract**:

- **Where the read goes.** In `offers.ts` it sits after the precheck (:87) and before `started`. In `offer-refetch.ts` it sits after normalisation (:144) and before `started`.
- **The sequence.** The route calls `loadIngestionSettings(supabase)`, then `resolveIngestionMode(settings, isApifyAvailable())`, then `createApifyLeg()` only when the effective mode needs it.
- **What the log carries:**
  - `started` carries `ingestion_mode`, `ingestion_mode_effective`, `ingestion_mode_reason` and `ingestion_mode_read`, and on `error` also `db_code`/`db_status`;
  - every outcome entry carries those fields together with `source`, `fallback_reason`, `apify_*` and the durations.
- **Severity.** A configuration-fault `apify_error_type` (`user-or-token-not-found`, `insufficient-permissions`, `full-permission-actor-not-approved`, or status 402) is logged at `error` even when the member's reason comes from the direct leg. `run-failed` (400) is logged at `error` too, but it is **not** a configuration fault: it means the run itself ended without a dataset — it exceeded `timeout=` or the actor crashed — and the runbook row says how to tell the two apart.
- **Comments.** The two route comments that say the fetch "may take 45 s" (`src/pages/api/offers.ts:89`, `src/pages/api/offer-refetch.ts:146`) are rewritten to name the deadline constants instead of a number.
- **Unchanged.** The redirect and message contracts are unchanged, apart from the new reason.

#### 6. Route tests

**Files**: `tests/pages/api/offers.test.ts`, `tests/pages/api/offer-refetch.test.ts`, `tests/pages/api/offers.unconfigured.test.ts`, `tests/pages/api/offer-refetch.unconfigured.test.ts` (new where absent), `tests/lib/otodom/failure.test.ts`, `tests/lib/otodom/index.test.ts` (new)

**Intent**: Every scenario states how many requests reached otodom and Apify, and how many writes happened, beside what it claims.

**Contract**:

- **Stubs.** They plan the `ingestion_settings` read. Existing scenarios run under the seeded mode with no token, so they behave as today and add 0 Apify requests.
- **The `astro:env/server` mocks.** In `tests/pages/api/offers.test.ts` (:36-39) and `tests/pages/api/offer-refetch.test.ts` the mock gains `ANTHROPIC_API_KEY: undefined` and an `APIFY_TOKEN` getter switched per scenario, following the hoisted toggle in `tests/pages/api/audits.test.ts:55-62`; the "on" value is `APIFY_TEST_TOKEN` from `tests/fixtures/apify.ts`. Without both entries Vitest throws `No "…" export is defined on the mock` as soon as a route imports `config-status.ts` (which reads both keys at load, `config-status.ts:1,22`) or `apify.ts`. The toggle defaults to **off** and is reset in `beforeEach`, so every pre-existing scenario runs with no token and keeps its 0 Apify requests without being edited. `isApifyAvailable()` and `createApifyLeg()` read `APIFY_TOKEN` at call time, never into a module-scope value, so the getter decides per scenario.
- **Zero-config files.** The token-off exits that only the zero-config state reaches get their cases in `tests/pages/api/offers.unconfigured.test.ts` and `tests/pages/api/offer-refetch.unconfigured.test.ts` (both exist), per CLAUDE.md's Testing rule: the toggle covers the scenario matrix, those files cover the module loaded with no token at all.
- **Other importers.** Any other test file that ends up importing `config-status.ts` through the routes (grep the routes' importers under `tests/`) gets the same two mock entries in this phase, so `npm test` stays green at the phase boundary.
- **The guard at `offer-refetch.test.ts:1020-1032`** is widened deliberately: the mode read is allowed, Apify requests are allowed, and `offer_notes`/`offer_audits` stay forbidden.
- **New scenarios in both routes**, each a row with otodom N, Apify N and writes N:

  | Scenario                                                                                                                                                                                                                           | otodom | Apify | writes               |
  | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | -------------------- |
  | `direct_with_fallback` with token: direct 403, `cf-mitigated`, 429, off-otodom landing, timeout, network or `data_missing`, then an Apify success; no seller canary in the row sent, `source:"apify"` and `fallback_reason` logged | 1      | 1     | 1                    |
  | Direct 404, 410, `expired`, 503, `unexpected_landing`, `shape_changed`, rental or house: no fallback                                                                                                                               | 1      | 0     | 0                    |
  | Direct 403, then Apify 410: the member reads not-found                                                                                                                                                                             | 1      | 1     | 0                    |
  | Direct 403, then Apify `run_error`: the member reads `http_denied`                                                                                                                                                                 | 1      | 1     | 0                    |
  | Direct 403, then Apify 400 `run-failed`, 401, 402, 403 (both types), 408, 429, network, empty or malformed: the member reads the direct reason; `apify_failure` and `apify_error_type` logged at `error` for configuration faults  | 1      | 1     | 0                    |
  | Direct and Apify both `data_missing`: `detail:"both_sources"`                                                                                                                                                                      | 1      | 1     | 0                    |
  | `apify_only` success                                                                                                                                                                                                               | 0      | 1     | 1                    |
  | `apify_only`, Apify never reaches otodom: the member reads the `extraction_failed` sentence                                                                                                                                        | 0      | 1     | 0                    |
  | `direct_only` with token, direct 403                                                                                                                                                                                               | 1      | 0     | 0                    |
  | No token, configured `apify_only`: `ingestion_mode_effective:"direct_only"`, reason `apify_unconfigured`                                                                                                                           | 1      | 0     | as the case requires |
  | Mode read `error`, `missing_row` or `off_list` (each): `mode_read_failed` and `ingestion_mode_read` logged                                                                                                                         | 1      | 0     | as the case requires |
  | Duplicate by address in `offers.ts` (the mode table is not read)                                                                                                                                                                   | 0      | 0     | 0                    |

- **Deadlines.** Boundary tests with fake timers on a silent stub (the `vi.useFakeTimers` set of `tests/pages/api/audits.test.ts:87`), each stating the requests made:
  - direct at 19 999 ms (no fallback yet) and 20 000 ms (`timeout`, then exactly one Apify request) in `direct_with_fallback` with a token;
  - direct at 59 999 and 60 000 ms in `direct_only`, with no token, and on a failed read (0 Apify requests);
  - Apify at 39 999 and 40 000 ms: the leg ends as `apifyFailure: "timeout"`, and the member reads the direct reason, or `extraction_failed` in `apify_only`;
  - after the action resolves, no timer is pending (`vi.getTimerCount() === 0`).
- **Log privacy.** `SCENARIOS` gain Apify rows. `APIFY_TEST_TOKEN` and the Apify `message` canary join the forbidden strings.
- **`tests/lib/otodom/index.test.ts`** gives `chooseOutcome` one case per branch. Each states the reason the member reads, `source` and `fallback_reason`.

### Success Criteria:

#### Automated Verification:

- Unit and route tests pass: `npm test`
- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Build passes with no secrets: `npm run build`
- No "45" deadline literal is left: `! grep -rnE --exclude=deadlines.ts --exclude=deadlines.test.ts '\b45( sekund|_000| s([^a-z]|$))' src scripts/otodom-inspect.mjs tests` (the deadlines module and its test keep `45_000` as the floor they pin; the pattern also catches "45 s" at the end of a line, and it was checked to give the same hits under GNU grep and under the ugrep wrapper that `grep` is in the agent's shell — a `(^|[^0-9])` prefix combined with `$` matches nothing under ugrep, so it must not be used)

---

## Phase 5: The mode on `/criteria`

### Overview

A read-only section after the audit settings shows the configured mode and the effective one, with its own attributes and states.

### Changes Required:

#### 1. Page and view

**Files**: `src/pages/criteria.astro`, `src/components/criteria/CriteriaView.astro`

**Intent**: Members see which mode is set and which runs, and that the database administrator changes it.

**Contract**:

- **Page.** `criteria.astro` adds `loadIngestionSettings(supabase)` to the `Promise.all`, passes `resolveIngestionMode(settings, isApifyAvailable())` as a new `ingestion` prop, and never imports the Apify module.
- **Section.** It follows the audit section (:277) and is built from the existing `sectionClass`, `Card`, `<dl>`, `Alert` and `CircleAlert` only. It carries `data-criteria-section="ingestion"`, `data-ingestion-settings-state="ok"|"error"`, `data-ingestion-mode` (only when ok) and `data-ingestion-mode-effective`. No attribute stands in for another.
- **Copy.** The configured mode's label is shown, and when it differs from the effective one: „Obecnie działa: tylko bezpośrednio — brak klucza Apify” (`apify_unconfigured`), or, on a failed read, an Alert: „Nie udało się odczytać trybu pobierania — aplikacja pobiera ogłoszenia tylko bezpośrednio.” plus „Tryb zmienia administrator bazy w Supabase.”
- **What is left out.** No form, no Studio link, no project ref and no cost.

#### 2. Kitchen sink and fixtures

**Files**: `src/pages/dev/criteria.astro`, `src/pages/dev/_criteria-fixtures.ts`

**Intent**: Every state of the section is visible at `/dev/criteria`.

**Contract**:

- `State` gains `ingestion`, and every entry gets a default.
- New states: `ingestion-direct-with-fallback`, `ingestion-apify-only`, `ingestion-direct-only`, `ingestion-unconfigured` (configured differs from effective) and `ingestion-read-error`.

#### 3. Tests and smoke

**Files**: `tests/components/criteria/CriteriaView.test.ts`, `scripts/smoke.mjs`

**Intent**: A failed read is never shown as a mode, and production renders the marker.

**Contract**:

- **Render test.** `view()` defaults `ingestion`. A new describe covers:
  - every mode;
  - configured differing from effective (`apify_unconfigured`);
  - a failed read, which shows no `data-ingestion-mode` and shows the alert, beside its control.
- **Smoke.** The existing criteria page step's `bodyIncludes` gains `data-ingestion-settings-state="ok"`, `data-ingestion-mode="direct_with_fallback"` and `data-ingestion-mode-effective="direct_only"`. The smoke job has no token, so this is the zero-config proof.

### Success Criteria:

#### Automated Verification:

- Render and unit tests pass: `npm test`
- Lint passes, including `tokensOnlyConfig`: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Build passes: `npm run build`
- Smoke script parses: `node --check scripts/smoke.mjs`

#### Manual Verification:

- The user opens `/dev/criteria` under `npm run dev` and looks at the new section in every state once
- `npm run smoke` passes against a local Supabase (or the CI `smoke` job is green)

---

## Phase 6: Rules, documents, and the steps that are the user's

### Overview

Bring every rule and document in step with the code, then list the remaining production steps as Manual rows.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: The rules describe the fallback that now exists.

**Contract**:

- **Workers bullet (:34).** "…replacing the otodom scraper rather than sitting beside it… adopting it is a decision to raise with the user" becomes the fallback sitting beside the direct scraper. It is selected by `public.ingestion_settings`, uses `apify/cheerio-scraper` with the fixed `pageFunction` in `src/lib/otodom/apify-request.ts` through the `RESIDENTIAL` proxy, and was adopted by the user on 2026-10-17. It is still never a parser inside the Worker, and cheerio does not enter `package.json`.
- **Seller-data bullet (:27).** `sellerPhone`/`agencyName` and the extraction service are replaced by: the `pageFunction` whitelist inside Apify, plus `mapAdToOffer`'s own whitelist as the second line of defence; `owner`, `contactDetails` and `agency` are never copied.
- **Secrets (:25).**
  - "Six places" now applies to the audit key alone.
  - A new sentence: `APIFY_TOKEN` has five places (`astro.config.mjs`, `.env`, `.dev.vars`, `.env.example`, Cloudflare secret) and **never CI**. The reason is stated: Astro reads `access:"secret"` at runtime, so the build needs no value; keeping it out of CI means no CI step can start a paid run; a change is the user's decision.
  - The "two keys never cross" rule becomes three: `APIFY_TOKEN` never enters `review.yml` or the code-reviewer package.
- **Paid calls.** "Nothing reaches the model provider on its own" gains a sibling rule for Apify:
  - no test, script, smoke step or CI step starts an Apify run;
  - `tests/fixtures/apify.ts` is the reference;
  - a real run is the user's deliberate action;
  - the only named exception is `scripts/apify-verify.mjs` within this change's budget: 15 calls per target, raised once to 25, otodom paced at 30 s, a stop on the first block, every call recorded in `live-calls.md`, authorised 2026-10-17 for `otodom-apify-fallback` only.
- **Structure.** New reference bullets:
  - `src/lib/ingestion-settings.ts`, with the failed read degrading to direct and the reason why it departs from `loadAuditSettings`: the audit cannot guess a paid model, while the direct fetch is free and is what the app did before;
  - `supabase/migrations/*_create_ingestion_settings.sql` as the reference for an owner-only singleton;
  - `src/lib/otodom/apify.ts` and `apify-request.ts`;
  - `src/lib/otodom/deadlines.ts` and its order;
  - `chooseOutcome` and the trigger set;
  - `data-ingestion-*` on `/criteria`.
- **Testing.** Smoke never reaches Apify, and steps prove the mode table's RLS. Route tests state Apify request counts.

#### 2. Reviewer's criteria

**File**: `packages/code-reviewer/src/prompts/system.ts`

**Intent**: Kept in step with CLAUDE.md, as its last convention requires.

**Contract**:

- **Automatic-fail 2 (:30)** is widened the way CLAUDE.md:20 was in Phase 1 §5: a table changed only by the owner in Supabase Studio (`postgres`, `bypassrls`), with a `select` policy for `authenticated` and nothing else, is not a failure; the exception is narrow (operational settings no member may change, never data members are meant to write) and the missing write policies are the design.
- **Automatic-fail 9 (:37)** extends from the model provider to any paid vendor (Apify).
- **Correctness (:45-46).** The flat-sale gate on `ad.adCategory` applies to both legs' `ad`.
- **New correctness line.** An Apify item is read only through `isRecord` checks; `#error` and an empty dataset are fetch failures, never data; no Apify `error.message`/`#debug` reaches a log.
- **Idiomaticity (:89).** The fallback beside the scraper is named as sanctioned, not a "parallel mechanism". The `pageFunction` is a fixed reviewed string.
- **Zero-config (:61)** names `APIFY_TOKEN`.
- **Tests (:109).** A test that can reach Apify is a blocker.

#### 3. PRD, roadmap and runbook

**Files**: `context/foundation/prd.md`, `context/foundation/roadmap.md`, `context/foundation/deployment-runbook.md`

**Intent**: The product, the plan of record and the operations guide match.

**Contract**:

- **PRD.**
  - Access Control (l.146) gains one line: the ingestion mode is set by the database administrator (the owner) in Supabase, not by a member, and it is an operational setting, not a product role.
  - NFR l.124 names the extraction service as used through the fallback.
- **Roadmap.**
  - The Parked entry (:264) is removed or marked "Adopted 2026-10-17 — `otodom-apify-fallback`".
  - Open Question 4 (:246) and the S-02 unknown (:107) gain the 2026-10-17 resolution.
- **Runbook, "Ingestion starts failing" (:183-301):**
  - the mode switch is the operational lever: in Studio, Table Editor → `ingestion_settings` → `mode`, with `direct_only` as the kill switch;
  - one symptom row per `apify_error_type` with its fix: `user-or-token-not-found` → re-issue the token; `insufficient-permissions` → add Run on the actor; `full-permission-actor-not-approved` → the approval URL; 402 → raise the limit or wait for the cycle; `run-failed` (400) → open that run in Console → Runs: status TIMED-OUT means `timeout=30` was too short (compare `apify_duration_ms`), status FAILED means the actor or the `pageFunction` broke (read the run's Log tab) — a run of either kind is billed;
  - the `both_sources` row: switch to `direct_only` until the parser is fixed;
  - the token rotation order: issue the new token with the same scope, `wrangler secret put`, update `.env` and `.dev.vars`, then delete the old one;
  - :288-301 rewritten from "a decision to raise" to "adopted".
- **Runbook secrets section.** "Current state" (:30) and the six-places section (:358-370) are updated, and the README:185 heading drift is fixed.

#### 4. Ingestion documents, README and test plan

**Files**: `context/foundation/ingestion/otodom_apify.md`, `context/foundation/ingestion/otodom_fetching.md`, `context/foundation/ingestion/README.md`, `README.md`, `context/foundation/test-plan.md`, `context/foundation/infrastructure.md`

**Intent**: The verified path is documented as what the code does.

**Contract**:

- **`otodom_apify.md`** is rewritten around the spike:
  - §2: the actor `apify/cheerio-scraper` with our `pageFunction`; trev0n rejected, and why;
  - §3: the token's scope and the full-permission approval;
  - §4: the request, which points at `apify-request.ts`;
  - §5: `#error` and the residential proxy;
  - §6: `ad` identical, and personal data narrowed inside Apify;
  - §7: per-usage cost;
  - §10: the spike log plus Phase 3's conclusions.
- **`otodom_fetching.md`.** The stale :733 row and :639-641 point at the fallback as it now exists.
- **Ingestion `README.md`.** :10-11 no longer says "only source".
- **`README.md`:**
  - a "Fallback ingestion (Apify)" section modelled on :171-193;
  - the Secrets list (:217), with `APIFY_TOKEN` and never CI;
  - the schema paragraph (:119) gains the table;
  - the smoke description (:223) gains the steps;
  - the CI text (:264).
- **`test-plan.md`** (:48, :70, :185-188, :867) and **`infrastructure.md:241`.** The fallback's tests now exist; point at them.

### Success Criteria:

#### Automated Verification:

- The old rule is gone: `! grep -n "rather than sitting beside it" CLAUDE.md`
- The reviewer package's offline checks pass: `npm --prefix packages/code-reviewer/evals run preflight`
- Repository tests, lint and types still pass: `npm test && npm run lint && npx astro check`
- No `trev0n` actor left as the recommended route: `! grep -rn "trev0n~otodom-scraper/run-sync" CLAUDE.md README.md context/foundation/deployment-runbook.md`

#### Manual Verification:

- The user runs the code-reviewer evals (`npm run eval` in `packages/code-reviewer/evals/`) on the current and the changed `system.ts` against the baseline in `packages/code-reviewer/evals/README.md` (paid; the agent only ran `preflight`)
- `npx supabase db push --dry-run` lists the new migration; with the user's consent `npx supabase db push`, before the Worker that reads the table deploys
- The user sets `APIFY_TOKEN` with `npx wrangler secret put APIFY_TOKEN` (P8) and sets the Apify monthly limit (P4)
- Precondition: Phase 3's Manual row (3.12) is closed — every live case run with no mismatch, `SKIPPED`/`BLOCKED`/`STALE` cases completed. Then the change reaches production through the user's chosen path (`/git-ship` or `/git-land`, asked first), and the deploy follows `deployment-runbook.md`
- `/criteria` in production shows `data-ingestion-mode-effective="direct_with_fallback"` once the secret is set
- One real fallback run, started by the user: with the mode set to `apify_only` in Studio, add one live flat-sale listing and confirm the card, a `source:"apify"` entry in the Worker logs and one run in Console → Runs; then set the mode back to `direct_with_fallback`. This proves the deployed Worker, secret, approval, proxy and mapper together. It costs about $0.002 and is not part of the Phase 3 budget

---

## Testing Strategy

### Unit Tests:

- `resolveIngestionMode`: one case per read state × token × mode.
- `loadIngestionSettings`: every failed read beside a success.
- `classifyAnswer`/`classifyPayload`: one case per branch, with the direct path's existing tests unmodified.
- `readApifyAnswer` and the leg: every HTTP error type, `#error`, empty, malformed, abort and network.
- The `pageFunction`, evaluated on a stub: no canary passes, beside a control showing the input held them.
- `chooseOutcome`: one case per branch.
- The deadline order.

### Integration Tests:

- Route tests in both routes, one row per mode and outcome, each stating otodom N, Apify N and writes N.
- The seller canary search on the row actually sent.
- The log-privacy scenarios with the token and the Apify message canary.
- Render tests of the `/criteria` section.
- Smoke: the mode table's RLS from both sides and the page markers, never reaching Apify or otodom.

### Manual Testing Steps:

1. Read `live-calls.md` and `live-verification.md` and fill in the costs (Phase 3).
2. Look at `/dev/criteria` (Phase 5).
3. Run the evals, `db push`, set the secret and the limit, and deploy (Phase 6).
4. Make one real fallback run in `apify_only`, then restore `direct_with_fallback` (Phase 6).

## Performance Considerations

- CPU stays far below Workers Free's 10 ms. The Apify item is 20–30 KB of JSON against 530–560 KB of HTML on the direct leg (`spike-apify.md:68`).
- Waiting on `fetch` costs no CPU, and there is no wall-time cap for HTTP-triggered Workers.
- At most about 10 subrequests per action, against the limit of 50.
- A fallback adds 5–9 s of wall time (the spike).

## Migration Notes

The migration must be pushed before the Worker that reads the table is deployed. If the order is reversed, the table is missing; that is the `error` read state, which degrades to `direct_only` and keeps working. Rollback is to set the mode to `direct_only` in Studio. Removing the code is not required.

## References

- Change: `context/changes/otodom-apify-fallback/change.md`
- Spike (supersedes research): `context/changes/otodom-apify-fallback/spike-apify.md`
- Research: `context/changes/otodom-apify-fallback/research.md`
- Ingestion core: `src/lib/otodom/index.ts:35-46`, `src/lib/otodom/fetch.ts:133-222`, `src/lib/otodom/map.ts:215-309`, `src/lib/otodom/failure.ts:15-155`
- Singleton references: `supabase/migrations/20261007073258_create_audit_settings.sql`, `supabase/migrations/20260927144141_create_team_criteria.sql:340-351`
- Paid-vendor fixture reference: `tests/fixtures/anthropic.ts`
- Prior changes: `context/archive/2026-10-06-otodom-fetch-sub-reasons/plan.md`, `context/archive/2026-10-09-refetch-and-stale-audit/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The mode table and its read

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 2a85105
- [x] 1.2 Lint passes: `npm run lint` — 2a85105
- [x] 1.3 Types check: `npx astro sync && npx astro check` — 2a85105
- [x] 1.4 Smoke script parses: `node --check scripts/smoke.mjs` — 2a85105
- [x] 1.5 Migration file exists and matches the naming: `ls supabase/migrations/*_create_ingestion_settings.sql` — 2a85105
- [x] 1.6 CLAUDE.md's RLS exception names the new migration: `grep -n "create_ingestion_settings" CLAUDE.md` — 2a85105

#### Manual

- [ ] 1.7 `npm run smoke` passes against a local Supabase, or the CI `smoke` job is green on the pull request

### Phase 2: The Apify leg, offline

#### Automated

- [x] 2.1 Unit tests pass, including every pre-existing ingestion and route test unmodified: `npm test` — 6ea6b92
- [x] 2.2 Lint passes, including the new import guard: `npm run lint` — 6ea6b92
- [x] 2.3 Types check: `npx astro sync && npx astro check` — 6ea6b92
- [x] 2.4 Build passes with no secrets: `npm run build` — 6ea6b92
- [x] 2.5 The inspect script loads every import under Node (offline): `node scripts/otodom-inspect.mjs --help` — 6ea6b92
- [x] 2.6 The request and deadlines modules load under Node: `node --input-type=module -e "await import('./src/lib/otodom/apify-request.ts'); await import('./src/lib/otodom/deadlines.ts')"` — 6ea6b92

### Phase 3: Live verification within the budget

#### Automated

- [x] 3.1 Script parses: `node --check scripts/apify-verify.mjs` — 1cc2820
- [x] 3.2 Live case `invalid-token`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case invalid-token` — 1cc2820
- [x] 3.3 Live case `sale`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case sale` — 1cc2820
- [x] 3.4 Live case `rental`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case rental` — 1cc2820
- [x] 3.5 Live case `expired`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case expired` — 1cc2820
- [x] 3.6 Live case `redirect`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case redirect` — 1cc2820
- [x] 3.7 Live case `run-timeout`: `node --env-file-if-exists=.env scripts/apify-verify.mjs --case run-timeout` — 1cc2820
- [x] 3.8 The call log exists and obeys the budget and pacing: `node scripts/apify-verify.mjs --check-log` — 1cc2820
- [x] 3.9 Every recorded case matches its expected result, or is `SKIPPED`/`BLOCKED`/`STALE`: `node scripts/apify-verify.mjs --check-expected` — 1cc2820
- [x] 3.10 No listing address in the change folder: `! grep -rE "otodom\.pl/(pl/)?oferta" context/changes/otodom-apify-fallback/` — 1cc2820
- [x] 3.11 Unit tests still pass: `npm test` — 1cc2820

#### Manual

- [ ] 3.12 The user reads `live-calls.md` and `live-verification.md`, fills in each run's cost from Console → Runs → Usage, and confirms the six cases; every case recorded as `SKIPPED`, `BLOCKED` or `STALE` (named by the run) is completed with the same `--case` command — closed before row 6.8

### Phase 4: The fallback in both routes

#### Automated

- [x] 4.1 Unit and route tests pass: `npm test` — dd9a0a1
- [x] 4.2 Lint passes: `npm run lint` — dd9a0a1
- [x] 4.3 Types check: `npx astro sync && npx astro check` — dd9a0a1
- [x] 4.4 Build passes with no secrets: `npm run build` — dd9a0a1
- [x] 4.5 No "45" deadline literal is left: `! grep -rnE --exclude=deadlines.ts --exclude=deadlines.test.ts '\b45( sekund|_000| s([^a-z]|$))' src scripts/otodom-inspect.mjs tests` (the deadlines module and its test keep `45_000` as the floor they pin) — dd9a0a1

### Phase 5: The mode on `/criteria`

#### Automated

- [x] 5.1 Render and unit tests pass: `npm test`
- [x] 5.2 Lint passes, including `tokensOnlyConfig`: `npm run lint`
- [x] 5.3 Types check: `npx astro sync && npx astro check`
- [x] 5.4 Build passes: `npm run build`
- [x] 5.5 Smoke script parses: `node --check scripts/smoke.mjs`

#### Manual

- [ ] 5.6 The user opens `/dev/criteria` under `npm run dev` and looks at the new section in every state once
- [ ] 5.7 `npm run smoke` passes against a local Supabase (or the CI `smoke` job is green)

### Phase 6: Rules, documents, and the steps that are the user's

#### Automated

- [ ] 6.1 The old rule is gone: `! grep -n "rather than sitting beside it" CLAUDE.md`
- [ ] 6.2 The reviewer package's offline checks pass: `npm --prefix packages/code-reviewer/evals run preflight`
- [ ] 6.3 Repository tests, lint and types still pass: `npm test && npm run lint && npx astro check`
- [ ] 6.4 No `trev0n` actor left as the recommended route: `! grep -rn "trev0n~otodom-scraper/run-sync" CLAUDE.md README.md context/foundation/deployment-runbook.md`

#### Manual

- [ ] 6.5 The user runs the code-reviewer evals on the current and the changed `system.ts` against the baseline (paid)
- [ ] 6.6 `npx supabase db push --dry-run`, then with the user's consent `npx supabase db push`, before the Worker deploys
- [ ] 6.7 The user sets `APIFY_TOKEN` with `npx wrangler secret put APIFY_TOKEN` and sets the Apify monthly limit
- [ ] 6.8 Precondition: row 3.12 is closed. The change reaches production through the user's chosen path (`/git-ship` or `/git-land`), and the deploy follows the runbook
- [ ] 6.9 `/criteria` in production shows `data-ingestion-mode-effective="direct_with_fallback"` once the secret is set
- [ ] 6.10 One real fallback run started by the user in `apify_only` on a live flat sale, then the mode restored to `direct_with_fallback`
