# Commute times (FR-016) Implementation Plan

## Overview

The team keeps up to six named points (a name and an address) on `/criteria`. On an offer's card a member deliberately presses „Policz dojazdy”, and the Worker asks Google Routes API for the time and distance from the flat to every point, by public transport and by car. The card then shows a table with a mode switch and one Google map with the active mode's routes in their own colours. **Nothing Google returns is stored.** The result lives in the island until the page is reloaded. The feature follows the zero-config pattern with two Google keys. Because Google's daily quotas cannot be lowered on a pay-as-you-go account (checked in the console 2026-10-26), the application keeps its own cap: at most 300 Routes calls a day, Warsaw time, counted in Postgres and reserved before the first call.

Every product decision is recorded in `context/foundation/prd.md`: FR-016, FR-014, the Non-Functional Requirements and the 2026-10-26 entry of the „Resolved during implementation” block. The research behind it is `context/changes/commute-times/research.md`.

## Current State Analysis

- **No table holds places.** The offer's location is stored in four columns: `location_label`, `street_name`, `latitude`, `longitude` (`supabase/migrations/20260922202756_create_offers.sql:51-55`). Nothing reads the coordinates today (research §6).
- **`/criteria` reads its sections in one `Promise.all`** (`src/pages/criteria.astro:16-20`) and whitelists `?form=` values (`:27-29`). Each section of `src/components/criteria/CriteriaView.astro` carries its own `data-*-state` (limits/requirements at `:124`, audit settings at `:228`, ingestion at `:299`).
- **The closest UI for an editable list** is `RequirementsEditor.tsx` with `RequirementsCard.tsx`: a card per row, an action slot, an inline edit form with a hidden `intent`. It deletes through `window.confirm` (`:86`), which predates the `ConfirmDialog` rule, so the new editor does not copy that part. `src/pages/api/requirements.ts` handles `intent=save|delete`.
- **`src/pages/api/audits.ts` is the reference paid route.** It checks the session, the free refusals, then the key, logs `started`, makes the calls without retry, and writes one log entry on every way out. It answers with an NDJSON stream that is always `200` (`:28-34`, `:296-378`). The browser side lives in `src/lib/audit/stream.ts`: `classifyAuditAnswer` (`:37-45`) and `followAuditStream` (`:93-122`).
- **Zero-config has four places**:
  - schema: `astro.config.mjs:17-24`;
  - a factory that returns `null`: `createApifyLeg` in `src/lib/otodom/apify.ts:54-56`;
  - a null-check at every call site;
  - a `ConfigStatus` entry: `src/lib/config-status.ts:11-32`, with the banner at `src/layouts/Layout.astro:23-35`.
- **ESLint guards:**
  - `auditNoNotesConfig` (`eslint.config.js:121-140`) and `apifyServerOnlyConfig` (`:208-224`).
  - Blocks whose `files` overlap must merge their `no-restricted-imports` patterns, because flat config replaces a rule's options instead of adding to them (comment `:112-120`).
  - `tokensOnlyConfig` (`:87-105`).
- **Logging:** `src/lib/log.ts:9-69` is a whitelist, `FIELDS`. A key not on it is dropped.
- **Tests:**
  - `tests/setup.ts:7-13` mocks `astro:env/server` with every secret undefined.
  - `tests/fixtures/apify.ts` is the model for a stub of a paid service with a request counter.
  - `tests/pages/api/audits.unconfigured.test.ts` is the model for a test of the zero-config exit.
- **Smoke** (`scripts/smoke.mjs`):
  - `requestAuditOfMissingOffer` (`:938-956`) is the reference for a paid route.
  - The member-requirements RLS steps (`:1886-1975`) are the reference for judging a team table from every side with `withSnapshot` (`:681`).
- **The offer card's team column** is in `src/components/offers/OfferView.astro:111-129`: `OfferAudit` above `OfferNotes`.

## Desired End State

**On `/criteria`:**

- A section „Punkty dojazdu” lists the team's points, oldest first.
- Any member adds, edits and deletes any point. Delete is confirmed in `ConfirmDialog`.
- A seventh point is refused with its own sentence.
- The section carries `data-commute-points-state="ok"|"error"`.

**On an offer's card**, a section „Dojazdy” below the notes:

- It carries `data-commute-available`, `data-commute-origin` (`coordinates`/`address`/`none`), `data-commute-archived` and `data-commute-points-state`.
- With the server key set, a live offer that has a route start and at least one readable point offers „Policz dojazdy”. Otherwise the section says why the button is not offered: no key, archived, no start, no points, or the points cannot be read.
- After a calculation the island shows:
  - the table for the chosen mode (Komunikacja / Samochód) with time and distance per point, „brak trasy” or the rejected-address sentence;
  - the departure day used for public transport;
  - the start used (coordinates or label + street) and the „szacunek okolicy, nie budynku” sentence;
  - Google attribution.
- Only after the result, and only with the browser key set, the island loads one Google map. The map shows the active mode's routes in `--route-1..6` colours, a pin at each point's route end and a pin at the start.
- A reload shows the idle section again.
- A calculation that would take the day past `COMMUTE_DAILY_CALL_LIMIT` (300 Routes calls, Europe/Warsaw day) is refused before any call with „Dzienny limit liczenia dojazdów zespołu został wyczerpany — spróbuj jutro.”, and no member can reset or raise the counter through the Data API.

**Zero-config:**

- With no keys, every page renders.
- The banner names both missing Google keys.
- No request reaches Google from any test, smoke step, `/dev` page or screenshot run.

**Verification:**

- `npm run lint`, `npx astro sync`, `npx astro check`, `npm test` and `npm run build` pass with no `.env`.
- `npm run smoke` passes against local Supabase.
- One real calculation, run by the user (Phase 6), shows the table and the map.

### Key Discoveries:

- **Empty `routes` means no route.** In `computeRoutes`, an empty or absent `routes` array means "no route could be found". No top-level status field exists (developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes). Treat an absent `routes` the same as `[]`.
- **An address Google cannot read may come back two ways** (UNVERIFIED in the docs): either HTTP 400 `INVALID_ARGUMENT`, or 200 with empty `routes`. The outcome rule below handles both.
- **Error body shape** (routes/handle-errors): `{"error":{"code","message","status"}}`. Only `error.status` is read. `error.message` can quote the request, which holds an address.
- **Polyline colours must be hex.** `google.maps.Polyline` `strokeColor` accepts hex only ("#FFFFFF"; no named colours). The `oklch` tokens are converted in the browser.
- **`@vis.gl/react-google-maps` ≥ 1.8** exports `Polyline` with `encodedPath`, which loads the `geometry` library itself.
  - `AdvancedMarker` needs a Map ID, so the plan uses `Marker`: deprecated since 2024-02, not scheduled for removal, with at least 12 months' notice.
  - `colorScheme="DARK"` works without a Map ID.
  - `APIProvider`'s `apiKey` is read on the first render only.
- **Workers Free allows 50 subrequests per invocation**, and Supabase calls count toward them (developers.cloudflare.com/workers/platform/limits/, 2026-10-12). The 6-point cap gives 12 Routes calls plus a handful of Supabase reads.
- **`criteria_revision` is bumped only by the four triggers** in `20260927144141_create_team_criteria.sql:238-263`. The new table adds none.
- **Google's daily quotas cannot be changed on this account.** On a pay-as-you-go account the console shows „Limitu nie można dostosować” for „Directions – ComputeRoutes per request quota per day” and for the Maps JavaScript API limits, and Billing's spend caps do not cover Google Maps Platform (checked by the user 2026-10-26; `context/foundation/user-manual/set-up-google-maps.md`, step 5). The free allowance is 10 000 Essentials requests and 10 000 map loads a month; 31 × 300 = 9 300 stays under it.
- **No route calls `supabase.rpc` yet.** The reservation is the first one, so its error reading (`error.code`, a thrown exception, an off-shape answer) is written fresh in `src/lib/commute/usage.ts`, on the pattern of writes judged by their code in `src/lib/audit/store.ts`.
- **`tests/setup.ts` must name every new secret**, or a local `.env` leaks into tests. `tests/setup.test.ts` guards it.
- **TRANSIT `departureTime`** is RFC 3339. A future time up to 100 days ahead is valid. `routingPreference` is allowed only for DRIVE/TWO_WHEELER, and setting it for TRANSIT fails the request.

## What We're NOT Doing

- **No storage of any Google output.** No times, distances, polylines, `place_id` or coordinates in the database, `localStorage` or `sessionStorage`. No freshness, fingerprint or revision counter, and `criteria_revision` is untouched.
- No Geocoding API, Route Matrix, Places or Directions API.
- No `routingPreference` and no `TRAFFIC_AWARE*` (it would move the request to the Pro SKU), no `transitPreferences`, no alternative routes.
- No route description or steps (EEA SST §20.1), no turn-by-turn, no transit lines.
- No retry of a Google call. No lock in the database against a double press: the button is disabled while running. The hard cap is the application's daily counter (`public.commute_usage`), not Google's quotas, which this account cannot lower.
- No refund of a reservation: calls Google failed, rejected or never answered stay counted. No per-member limit, no counter shown in the UI, no owner-editable limit row — a permanent change of the limit is a migration and the TS constant together.
- No commute data on the board, no map of all offers, no calculation started by anything but the button.
- No Polish public-holiday calendar. The departure day is the first Monday–Friday after today.
- No author or editor signature on points. A point belongs to the team, so no column references `auth.users`.
- No `client:only`, no CSP.
- No visual gate: the user declined it 2026-10-26. Kitchen-sink entries are still added.
- No Playwright spec. No spec presses „Policz dojazdy”.
- No GitHub secret, no `.github/workflows/ci.yml` step, nothing in `review.yml` or `packages/code-reviewer/` for either Google key.

## Implementation Approach

The feature is built bottom-up, and every phase is green on its own:

1. the team's data;
2. the Google client and the pure rules, offline;
3. the paid route behind every free refusal;
4. the card's view;
5. the rules and docs that make the next agent keep it that way;
6. the user's one real calculation.

The route mirrors `src/pages/api/audits.ts` but stays simpler. There is no claim, no audit row and no heartbeat; its one write is the reservation of 2N calls on the day's counter, made after the key check and before `started`. The calls take seconds and run in parallel with per-call deadlines. One log entry before the calls (`started`), and one on every way out.

**Outcome rule.** The rule that turns 2N call results into a result or a failure is a pure function, `decideCommuteOutcome` in `src/lib/commute/outcome.ts`. It applies these steps in order:

1. Any call that ended in anything but `200` or `400` (401/403/429/5xx, timeout, network error, unreadable body) fails the whole calculation.
2. If every point got `400` in one mode, the whole calculation fails (`request_rejected`). The fault is in our request, not in an address.
3. A point with `400` in exactly one mode fails the whole calculation (`request_rejected`). Its address is the same in both modes, so the fault again lies in the request.
4. A point with `400` in both modes becomes the row „Google odrzucił adres tego punktu — sprawdź go w /criteria”.
5. A `200` with empty or absent `routes` becomes „brak trasy” for that point and mode.
6. Otherwise the point and mode get time, distance and polyline.

With a single point that Google rejects in both modes, step 2 fires before step 4. The member then reads the whole-failure sentence. This precedence is deliberate (the user's decision of 2026-10-26).

**Departure time.** `nextWorkingDayAt8Warsaw(now)` returns the first Monday–Friday strictly after today's date in Europe/Warsaw, at 08:00 local time, as RFC 3339 with that day's offset. Examples:

- Mon 07:00 → Tue 08:00
- Fri → Mon
- Sat/Sun → Mon
- Fri 2026-10-23 → Mon 2026-10-26 08:00+01:00 (after the DST change)

**Route start.** `commuteOrigin(row)`:

- `latitude` and `longitude` both finite → `{ kind: "coordinates" }` (`location.latLng`);
- else a non-blank `location_label` → `{ kind: "address" }`, label plus `street_name` when present, as `waypoint.address`;
- else `null`, which is the refusal `no_origin`.

**Daily limit.** `public.reserve_commute_calls(n)` adds `n` to today's row of `public.commute_usage` in one statement — `insert … on conflict (day) do update set calls = commute_usage.calls + excluded.calls where commute_usage.calls + excluded.calls <= <limit> returning calls` — and raises `VP003` when no row comes back. The day is `(now() at time zone 'Europe/Warsaw')::date`, taken in the database, never from the caller. A reservation is never given back. The map is bounded by the same counter: it is created only after a successful calculation, and a mode switch never creates a second `google.maps.Map` (Phase 4), so map loads a day ≤ successful presses ≤ 150.

**The browser key.** `GOOGLE_MAPS_BROWSER_KEY` is `server/secret`, read at runtime in `src/lib/commute/browser-key.ts`. `src/pages/offers/[id].astro` passes it down to the map island as a prop. This is the one narrow, deliberate exception to "never client-side". The key is public by design and restricted by referrer and to the Maps JavaScript API. CLAUDE.md records the exception.

## Critical Implementation Details

- **What the browser may see.** The island receives the point names (they head the table) and the route geometry. It never receives the points' addresses. Nothing returned by the route is written anywhere: no `localStorage`, no `sessionStorage`, no query string.
- **When the map script may load.** The map island mounts only when a result exists, so Google's script is never requested on opening a card. `CommuteRunner`'s `preview` prop renders a result without mounting `CommuteMap` at all. It shows a placeholder box instead, so `/dev` pages under `astro dev` with a local key never bill Dynamic Maps.
- **Colours.** Tokens are `oklch` and `strokeColor` needs hex. The island reads `--route-N` with `getComputedStyle(document.documentElement)`, paints one pixel on a 1×1 canvas and reads it back with `getImageData`. A pure `rgbaToHex` turns the bytes into hex. Never parse the `oklch` string.
- **Ordering inside the route.** The free refusals stay ahead of the key check, so a nonexistent offer gets the same answer with and without a key: session, then `isUuid`, then the offer read (`offer_not_found`), then `offer_archived`, then `no_origin`, then the points read (`points_unreadable`), then `no_points` / `too_many_points`. The key comes after all of these, and the reservation after the key — an unconfigured application never touches the counter. A test asserts it: a missing offer with and without a key gives the same line, 0 Google requests and 0 reservations.
- **The counter never lets a call through on doubt.** A reservation answered with anything but the new total — `VP003`, any other Postgres error, a thrown exception, a network error, an answer that does not read as an integer — ends the action before `started`, and no request reaches Google. `VP003` is `daily_limit`; everything else is `usage_unavailable`.
- **The limit lives in two places, changed together:** `COMMUTE_DAILY_CALL_LIMIT` in `src/lib/commute/failure.ts` and the literal in `reserve_commute_calls`, as `AUDIT_STALE_ATTEMPT_MS` stands in `src/lib/audit/failure.ts` and its migration. A test reads the migration file and fails when the two differ.

## Phase 1: Team data — points with CRUD on `/criteria`, and the daily call counter

### Overview

The team's points exist, are protected by RLS, are capped at six, and are editable on `/criteria`. The audit cannot read them. The day's counter of Routes calls exists, and only its `security definer` function writes it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<ts>_create_commute_points.sql` (created with `supabase migration new create_commute_points`)

**Intent**: A team-owned table with full CRUD for `authenticated`, nothing for `anon`, and server-set dates. A cap of six that the Data API cannot bypass.

**Contract**:

- `public.commute_points(id uuid pk default gen_random_uuid(), name text not null, address text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`.
- Checks:
  - `name`: trimmed length 1–60, and equal to its trim;
  - `address`: trimmed length 1–200.
- `enable row level security`, plus four policies `to authenticated` (select/insert/update/delete), each `using (auth.uid() is not null)` and, where applicable, `with check (auth.uid() is not null)`. Never `using (true)` (CLAUDE.md). This follows `create_offers.sql:84-113`: any member edits any point, so a signed-in session is the only restriction, exactly as on `offers`.
- A `before insert` trigger with `security definer` and an empty `search_path`:
  - takes a transaction advisory lock, counts the rows, and raises SQLSTATE `VP002` when six exist;
  - sets `created_at` and `updated_at` to `now()`.
- A `before update` trigger keeps `id` and `created_at` and sets `updated_at = now()`.
- No trigger touches `criteria_revision`.
- No grant: CLAUDE.md, automatic exposure.

#### 1a. Migration: the daily counter

**File**: `supabase/migrations/<ts>_create_commute_usage.sql` (created with `supabase migration new create_commute_usage`)

**Intent**: The application's daily cap on Routes calls, which Google's console cannot set on this account. Members read the counter and cannot write it; only the reservation function does, atomically. On the pattern of `supabase/migrations/20260926185936_create_members.sql` (a table written only by a `security definer` function, no write policies — the denial is intended).

**Contract**:

- `public.commute_usage(day date primary key, calls integer not null check (calls >= 0), updated_at timestamptz not null default now())`. One row per Europe/Warsaw day; no row means 0 calls.
- `enable row level security`; one policy, `commute_usage_select_authenticated` `for select to authenticated using (auth.uid() is not null)`. No insert/update/delete policy, nothing for `anon`.
- `public.commute_usage_day(at timestamptz) returns date` (`stable`, empty `search_path`): `(at at time zone 'Europe/Warsaw')::date`. Its own function so `test:db` can check the boundary without moving the clock.
- `public.reserve_commute_calls(n integer) returns integer`, `security definer`, `search_path` pinned to empty, every name schema-qualified:
  - `auth.uid()` null → raise `42501`;
  - `n` null or outside 1..12 (`2 × COMMUTE_POINTS_MAX`) → raise `22023`;
  - one `insert … on conflict (day) do update … where commute_usage.calls + excluded.calls <= 300 returning calls`; the day is `public.commute_usage_day(now())`;
  - no row returned → raise SQLSTATE `VP003` (message without numbers the member would read; the route never shows it);
  - returns the day's new total.
- The limit `300` is a literal in this function, with a comment naming `COMMUTE_DAILY_CALL_LIMIT` in `src/lib/commute/failure.ts`. `revoke execute … from public, anon`, `grant execute … to authenticated`.
- The owner resets or lowers a day's count in Supabase Studio as `postgres` (`bypassrls`); a permanent change of the limit is a new migration that replaces the function, together with the TS constant.
- A member who calls the function through the Data API only spends the team's allowance — it can never reset or raise it. That is accepted: the same member can already press the button.

#### 2. Read module

**File**: `src/lib/commute/points.ts`

**Intent**: The one reader of `public.commute_points`, on the pattern of `loadCriteria` (`src/lib/criteria.ts:214-269`). A failed read is its own state, never "no points".

**Contract**:

- `COMMUTE_POINTS_MAX = 6`.
- `type CommutePoint = { id, name, address }`.
- `loadCommutePoints(supabase | null): Promise<{ state: "ok"; points: CommutePoint[] } | { state: "error" }>`, ordered by `created_at, id`.
- No client, a Postgres error, a thrown exception and a row that does not read (a non-string name or address) all give `error`.

#### 3. Form route

**File**: `src/pages/api/commute-points.ts`

**Intent**: Save (insert or update) and delete a point from a native form POST, on the pattern of `src/pages/api/requirements.ts` and `src/pages/api/criteria.ts`.

**Contract**:

- `intent` is `save` (default) or `delete`. `id` is empty for a new point and a uuid for an edit or delete.
- Every failure redirects to `/criteria?error=<msg>&form=points#punkty`, with one distinct sentence per reason:
  - not configured;
  - unreadable form;
  - empty or too long name/address (checked before the write);
  - `VP002` → „Zespół ma już 6 punktów — usuń któryś, żeby dodać nowy.”;
  - `23514` (check) and `42501` (RLS);
  - zero rows on update → the point was deleted in the meantime;
  - DB error.
- Delete:
  - filtered by `id`, with `.select("id")`;
  - zero rows → `/criteria?point=gone#punkty`, never reported as a deletion;
  - success → `/criteria#punkty`.
- No session → `/auth/signin`.
- One `logEvent` per way out (`event: "commute_point"`), with `outcome`, `intent`, `reason` and `db_code`. Never the name or the address.

#### 4. View and island

**Files**:

- `src/components/criteria/CommutePointsEditor.tsx` (form island, default export);
- `src/components/criteria/DeletePointForm.tsx` (wraps `ConfirmDialog`, on the pattern of `DeleteOfferForm.tsx`);
- `src/components/criteria/CriteriaView.astro`;
- `src/pages/criteria.astro`.

**Intent**: A section `id="punkty"` „Punkty dojazdu” with `data-commute-points-state`. It lists every point as a card with „Edytuj” (inline form) and „Usuń” (`ConfirmDialog`, a native POST with hidden `intent=delete`, `id`). It has an add form while fewer than six exist, and at six a sentence saying the cap is reached. Read error → destructive Alert and no forms. `?point=gone` → a notice through a whitelist.

**Contract**:

- `criteria.astro` adds `loadCommutePoints` to the `Promise.all` and `points` to the `form` whitelist.
- Names and addresses render as text only.
- Built from `src/components/form/` composites and `src/components/ui`. The hidden `intent` is a controlled field (`TeamLimitsForm.tsx` pattern).
- `CommutePointsEditor` and `DeletePointForm` are added to the list in CLAUDE.md's `/dev/forms` bullet (Phase 5).

#### 5. Lint: the audit never reads points

**File**: `eslint.config.js`, `tests/eslint.config.test.ts`

**Intent**: Extend `auditNoNotesConfig` with a pattern rejecting `@/lib/commute/points` (and every `@/lib/commute/*`) under `src/lib/audit/**` and in `src/pages/api/audits.ts`, merged into the same block.

**Contract**:

- The block's comment names both protected modules.
- The test lints a sample under an existing audit file path.
- A rejected `@/lib/commute/points` import stands beside an allowed `@/lib/criteria` import.

#### 6. Kitchen sinks

**Files**: `src/pages/dev/criteria.astro`, `src/pages/dev/_criteria-fixtures.ts`, `src/pages/dev/forms.astro`

**Intent**: Fixtures and sections for every state of the points section:

- `/dev/criteria`: none, some, six (cap reached), read error, `?point=gone`.
- `/dev/forms`: the editor's add, edit, server error and pending states, and `?open=delete-point` for the dialog.

**Contract**: The state lists in these files gain entries. No new page.

#### 7. Tests

**Files**: `tests/lib/commute/points.test.ts`, `tests/pages/api/commute-points.test.ts`, `tests/components/criteria/` (render test where one exists for `CriteriaView`, else `tests/components/offers/render.test.ts` style)

**Intent**:

- **Read:** every failure stands beside an ok-empty read.
- **Route:** each failure reason gives its own redirect; `VP002`; zero-row update and delete; delete filtered by id; no name or address in any log entry (canary strings).
- **Render:** `data-commute-points-state` and no `set:html` for the texts.

**Contract**: Stubbed at the HTTP edge (`tests/fixtures/http.ts`). An `isCommutePointsRequest` helper is added there.

#### 8. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Judge `public.commute_points` from both sides, on the requirements steps' pattern (`:1886-1975`), and read the section's state.

**Contract**:

- The publishable key alone reads nothing and changes nothing (judged by row count).
- Member 1 creates a point through `POST /api/commute-points`, and member 2 reads it.
- Member 2 updates and deletes member 1's point. This succeeds by design, and is judged by `withSnapshot` together with its control step.
- A seventh insert through the Data API fails with `VP002`, after six were made. Cleanup deletes the run's points and restores the starting set.
- `/criteria` carries `data-commute-points-state="ok"`.
- The steps stand with the criteria steps, before audit freshness, and change no criteria row.
- **The counter**, on the pattern of the step "member cannot change the ingestion mode":
  - the publishable key alone reads no row of `public.commute_usage` and its call of `reserve_commute_calls` is refused;
  - a member's update, insert and delete of the counter are each judged by the table's snapshot (`withSnapshot`), with a control step;
  - a member's `reserve_commute_calls` with `n = 0` and `n = 13` is refused (`22023`) and the snapshot is unchanged.
  - Smoke makes no successful reservation, so a run leaves the local counter as it found it.

#### 9. Database rules that depend on time

**Files**: `scripts/commute-usage.sql`, `package.json` (`test:db` gains `-f scripts/commute-usage.sql` in the same `psql` call)

**Intent**: The rules the publishable key cannot reach or wait for, on the discipline of `scripts/audit-state.sql`: one transaction ending in `ROLLBACK`, the local database only, a refusal without the seeded accounts, checks as `DO` blocks raising `commute-usage: [<check>] …`, members signed in through `pg_temp.sign_in` and `set local role authenticated`.

**Contract**: Checks:

- `commute_usage_day`: `2026-10-25 22:59:59Z` → `2026-10-25` and `23:00:00Z` → `2026-10-26` (CET); `2026-07-01 21:59:59Z` → `2026-07-01` and `22:00:00Z` → `2026-07-02` (CEST).
- A row for yesterday at 300 does not block today: a reservation of 2 returns 2.
- Today at 298: a reservation of 2 returns 300; then a reservation of 1 raises `VP003` and the row still reads 300. Today at 299: a reservation of 2 raises `VP003`, the row still reads 299.
- Without a session: `42501`. `n` of 0, 13 and null: `22023`.
- As `authenticated`, a direct update, insert and delete of `public.commute_usage` reach no row or fail with `42501`.
- `anon` cannot execute the function.

### Success Criteria:

#### Automated Verification:

- Both migrations apply on a fresh local database: `npx supabase db reset`
- Lint passes, including the new audit/points rule: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Unit, route and render tests pass: `npm test`
- Build passes with no `.env`: `npm run build`
- Smoke passes against local Supabase, including the points RLS steps, the counter's snapshot steps and `data-commute-points-state="ok"`: `npm run smoke`
- The counter's rules hold in the database — Warsaw day boundary, the refusal at the limit, a member cannot write the counter: `npm run test:db`

#### Manual Verification:

- On `/criteria` under `npm run dev`: add, edit and delete a point (the dialog confirms); a seventh is refused with its sentence
- `/dev/criteria` and `/dev/forms` render every new state, and `?open=delete-point` opens the dialog

**Implementation Note**: After automated verification passes, pause for the human's manual confirmation before Phase 2.

---

## Phase 2: Google integration, offline

### Overview

Both keys follow the zero-config pattern. The one module that talks to Routes exists with its classification. The pure rules (departure time, origin, outcome) and the test stub are ready. Nothing calls them yet.

### Changes Required:

#### 1. Zero-config keys

**Files**: `astro.config.mjs`, `src/lib/config-status.ts`, `.env.example`, `tests/setup.ts`, `tests/setup.test.ts`

**Intent**: Two optional secrets, two banner entries, and one availability question per key.

**Contract**:

- `GOOGLE_MAPS_SERVER_KEY` and `GOOGLE_MAPS_BROWSER_KEY` as `envField.string({ context: "server", access: "secret", optional: true })`.
- `configStatuses` gains „Google Maps — trasy” (server key) and „Google Maps — mapa” (browser key).
- `isCommuteAvailable()` returns true iff the server key is set. `isCommuteMapAvailable()` returns true iff the browser key is set.
- `.env.example` gets both keys, commented, with one line each on what they are for and that they never go to CI.
- `tests/setup.ts` names both keys as `undefined`. `tests/setup.test.ts` asserts that both helpers say false.

#### 2. Routes client

**File**: `src/lib/commute/google.ts`

**Intent**: The one module that reads `GOOGLE_MAPS_SERVER_KEY` and talks to Routes. It makes one `fetch` per call, never retries, and never reads `error.message`.

**Contract**:

- `createRoutesClient(): RoutesClient | null` returns `null` without the key, and builds per request, never at module scope.
- `RoutesClient.computeRoute({ origin, destinationAddress, mode: "TRANSIT" | "DRIVE", departureTime?, signal })` POSTs to `https://routes.googleapis.com/directions/v2:computeRoutes`:
  - headers `X-Goog-Api-Key` and `X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline`;
  - body with `origin`, `destination: { address }`, `travelMode`, `regionCode: "pl"`, and `departureTime` for TRANSIT only. No `routingPreference`.
- The answer is classified into exactly one result:
  - `{ kind: "route", durationSeconds, distanceMeters, encodedPolyline }`: `duration` is parsed from the `"123s"` form, and a route that does not read is classified `unreadable`;
  - `{ kind: "no_route" }`: `200` with empty or absent `routes`;
  - `{ kind: "rejected", googleStatus }`: `400`, with `googleStatus` taken from `error.status`, enum-checked, else `null`;
  - `{ kind: "failed", reason: "denied" | "quota" | "unavailable" | "timeout" | "unreadable", httpStatus, googleStatus }`: 401/403 `denied`, 429 `quota`, other non-2xx `unavailable`, abort/timeout `timeout`, bad JSON `unreadable`.
- `COMMUTE_CALL_DEADLINE_MS = 10_000` goes in `src/lib/commute/failure.ts`.

#### 3. Pure rules

**Files**:

- `src/lib/commute/departure.ts`: `nextWorkingDayAt8Warsaw(now: Date): { rfc3339: string; date: string }`, built with `Intl.DateTimeFormat` in `Europe/Warsaw` (`timeZoneName: "longOffset"`). No date library.
- `src/lib/commute/origin.ts`:
  - `COMMUTE_OFFER_COLUMNS = ["id", "archived_at", "latitude", "longitude", "location_label", "street_name"]`;
  - `readCommuteOffer(row)`;
  - `commuteOrigin(row)` per the Implementation Approach. `numeric` columns may arrive as strings from PostgREST, so they are parsed as finite numbers.
- `src/lib/commute/outcome.ts`: `decideCommuteOutcome(points, calls)` → `{ kind: "result", rows } | { kind: "failed", reason }`, the ordered rule from the Implementation Approach.
  - Each row is `{ pointId, name, transit: Cell, drive: Cell }` with `Cell = { kind: "route", … } | { kind: "no_route" } | { kind: "address_rejected" }`.
- `src/lib/commute/failure.ts` holds:
  - every reason the action ends without a result: `offer_not_found`, `offer_archived`, `no_origin`, `points_unreadable`, `no_points`, `too_many_points`, `not_configured`, `daily_limit`, `usage_unavailable`, `request_rejected`, `denied`, `quota`, `unavailable`, `timeout`, `unreadable`;
  - `daily_limit` reads „Dzienny limit liczenia dojazdów zespołu został wyczerpany — spróbuj jutro.”; `usage_unavailable` says the calculation could not be checked against the team's daily limit and nothing was sent to Google;
  - `COMMUTE_DAILY_CALL_LIMIT = 300`, paired with the literal in `reserve_commute_calls` (Critical Implementation Details);
  - one Polish sentence per reason (`commuteFailureMessage`);
  - the deadlines.
  - It is import-free, because the island imports it.

- `src/lib/commute/usage.ts`: `reserveCommuteCalls(supabase, n): Promise<{ kind: "reserved"; total: number } | { kind: "limit" } | { kind: "failed"; dbCode: string | null }>`. One `supabase.rpc("reserve_commute_calls", { n })`, no retry. `VP003` → `limit`; any other error, a thrown exception or a `data` that is not a non-negative integer → `failed`. Never reads `error.message` or `details` into the result.

**Intent**: Every decision the user made about time, start, partial failure and the daily limit lives in a function testable without a network.

**Contract**: As listed. The modules hold no I/O except `google.ts` and `usage.ts`.

#### 4. Lint guards

**Files**: `eslint.config.js`, `tests/eslint.config.test.ts`

**Intent**: Keep the key module out of views, and keep notes out of everything that talks to Google.

**Contract**:

- `apifyServerOnlyConfig` becomes one merged block (renamed `paidServiceServerOnlyConfig`, comment updated). It rejects both `otodom/apify` and `commute/google` under `src/components/**`, `src/layouts/**` and `src/pages/**/*.astro`.
- A new `commuteNoNotesConfig` rejects the notes module under `src/lib/commute/**` and in `src/pages/api/commute.ts`. If its `files` overlap another `no-restricted-imports` block, the patterns are merged.
- Tests: each rejected import stands beside an allowed one, linted under an existing file's path.

#### 5. Log whitelist

**File**: `src/lib/log.ts`

**Intent**: The fields the commute route and the points route log, and nothing that identifies a place.

**Contract**: Adds `intent`, if not present, plus:

- `commute_points` (count), `commute_origin` (`coordinates`/`address`);
- `commute_routes`, `commute_no_route`, `commute_address_rejected` (counts);
- `google_http_status`, `google_status` (the `error.status` enum);
- `point_index`, `commute_mode`, `commute_duration_ms`;
- `commute_calls_reserved` (the 2N asked for) and `commute_usage_total` (the day's total after a reservation). `db_code` carries the reservation's Postgres code on `usage_unavailable`.

#### 6. Test stub and tests

**Files**: `tests/fixtures/google.ts`, `tests/lib/commute/{google,departure,origin,outcome}.test.ts`

**Intent**: A stub on the pattern of `tests/fixtures/apify.ts`, and tests for each pure rule with hand-written expectations.

**Contract**:

- Fixture exports:
  - `GOOGLE_TEST_SERVER_KEY` (a canary worth nothing), `GOOGLE_TEST_BROWSER_KEY`;
  - `isRoutesRequest`, `routesCalls(requests)`;
  - builders `routesOk(seconds, meters, polyline)`, `routesEmpty()`, `routesError(httpStatus, googleStatus, message)`;
  - `routesSilence()`, which never answers, for the timeout;
  - a canary address and a canary `error.message`.
- `google.test.ts`:
  - the request's URL, headers and field mask; `departureTime` present only for TRANSIT; no `routingPreference`;
  - every classification;
  - `error.message` never appears in the result.
- `departure.test.ts`: Mon 07:00, Mon 09:00, Fri 18:00, Sat, Sun, the October and March DST weekends.
- `outcome.test.ts`: every rule, each "kept" case beside a "failed" case, and the single-point precedence.
- `origin.test.ts`: coordinates as numbers and as strings; 0 is not treated as missing, because `map.ts` already turns 0 into `null`; label only; label + street; blank label; none.
- `usage.test.ts` (stubbed at the HTTP edge, `/rest/v1/rpc/reserve_commute_calls`): the request carries `{ n }`; a total → `reserved`; `VP003` → `limit`; `42501`, `22023`, a 500, a network error, `null`, a string and a negative number → `failed`, each beside the `reserved` case. It also reads the `create_commute_usage` migration as text and asserts its limit literal equals `COMMUTE_DAILY_CALL_LIMIT`.
- `tests/fixtures/http.ts` gains `isReserveCommuteCallsRequest`.

### Success Criteria:

#### Automated Verification:

- Lint passes, including the merged server-only block and the commute/notes rule: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Tests pass, including `tests/setup.test.ts` with both Google keys unset: `npm test`
- Build passes with no `.env`, and the banner lists both Google entries: `npm run build`
- No test reaches Google: `routesCalls` is asserted in every test that builds a client
- The reservation reader classifies every answer, and the limit constant matches the migration: `npm test` (`tests/lib/commute/usage.test.ts`)

#### Manual Verification:

- With no `.env`, `npm run dev` shows the banner naming „Google Maps — trasy” and „Google Maps — mapa”

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: The calculation route `POST /api/commute`

### Overview

The paid action: every free refusal, then the key, then the reservation on the day's counter, then 2N parallel calls, then one ending. It answers as a fetch-driven endpoint, and its one write is the reservation.

### Changes Required:

#### 1. Route

**File**: `src/pages/api/commute.ts`

**Intent**: The order of `src/pages/api/audits.ts` without the claim, the heartbeat or the save; the reservation stands where the audit claims its row.

**Contract**:

- A form `POST` with `offer_id`. No session → redirect `/auth/signin`, the only redirect.
- Every other answer is `200`, `application/x-ndjson`, with lines:
  - `{ type: "stage", stage: "routing" }`;
  - a final `{ type: "done", result }` or `{ type: "failed", reason, message }`.
- Order:
  1. `isUuid`, then the offer read with `COMMUTE_OFFER_COLUMNS` (`offer_not_found` for both);
  2. `offer_archived`, then `no_origin`;
  3. `loadCommutePoints` (`points_unreadable`), then `no_points` / `too_many_points` (>6);
  4. `createRoutesClient()` (`not_configured`);
  5. `reserveCommuteCalls(supabase, 2N)`: `limit` → `daily_limit` (`info`, a refusal the product expects); `failed` → `usage_unavailable` (`error`, with `db_code`). Either ends the action with no request to Google;
  6. `logEvent` `started` with `commute_points`, `commute_origin`, `commute_calls_reserved` and `commute_usage_total`;
  7. `nextWorkingDayAt8Warsaw(new Date())`, then `Promise.all` of N×2 `computeRoute` calls, each with `AbortSignal.timeout(COMMUTE_CALL_DEADLINE_MS)`;
  8. `decideCommuteOutcome`;
  9. one log entry, `completed` or `failed`. The reservation is not given back on any way out.
- Free refusals are logged `info`, failures `error`. The failure entry carries `point_index`, `commute_mode`, `google_http_status` and `google_status` of the first failing call. Never a name, address, coordinate, label or polyline.
- `result` = `{ departure: { date, time: "08:00" }, origin: "coordinates" | "address", rows }`. Rows hold `name`, not `address`, plus the cells. Polylines and pins live inside route cells. Nothing is persisted.
- `export type CommuteStreamLine` is the island's typing contract, imported only through `import type`.

#### 2. Route tests

**Files**: `tests/pages/api/commute.test.ts`, `tests/pages/api/commute.unconfigured.test.ts`

**Intent**: Every scenario states how many requests reached Google and how many reservations reached Supabase, and that nothing else was written.

**Contract**:

- Scenarios:
  - no session (redirect, Google 0, reservations 0);
  - non-uuid, missing offer, archived, no origin, points unreadable, no points, seven points (each Google 0, reservations 0);
  - a missing offer with and without a key: same line, Google 0, reservations 0;
  - the reservation answered `VP003`: `daily_limit` with its sentence, Google 0, reservations 1;
  - the reservation answered with another Postgres error, a 500, a network error and an off-shape body: each `usage_unavailable`, Google 0, reservations 1, and the log entry carries `db_code` and no address;
  - 3 points: the reservation asks for `n = 6`;
  - 2 points, all routes: Google 4;
  - one TRANSIT `no_route`: Google 4, and the row reads `no_route`;
  - one point `400` in both modes: Google 4, `address_rejected`, the other row shown;
  - one point `400` in one mode: `request_rejected`;
  - all TRANSIT `400`: `request_rejected`;
  - one 403: `denied`;
  - one 429: `quota`;
  - one 500;
  - a silence: `timeout`;
  - coordinates origin vs address origin, as the request body shows.
- Every scenario asserts that the only write to Supabase is the reservation: exactly one `reserve_commute_calls` request in each scenario that passes the key check (a successful calculation, every Google failure, `daily_limit`, `usage_unavailable`), none before it, and no other `POST`/`PATCH`/`DELETE` anywhere. Every scenario that reaches Google shows the reservation before the first Routes request.
- Privacy canaries:
  - the point address canary, the offer label canary and Google's `error.message` canary never appear in any log entry;
  - a note canary in the notes table stub never appears in any Google request (and the route never reads `offer_notes`: 0 requests to it);
  - the point address appears only in Google request bodies.
- The unconfigured file asserts `not_configured`, with Google 0 and reservations 0, after every free check passes.

#### 3. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Only requests the route ends before Google.

**Contract**:

- `requestCommuteOfMissingOffer` refuses a fixture offer's id outright, on the pattern of `requestAuditOfMissingOffer`.
- Steps:
  - no session → sign-in redirect;
  - forged session → sign-in redirect;
  - non-uuid → NDJSON `failed`/`offer_not_found`;
  - missing offer → the same.
- The `smoke` job holds no Google key, so no step can reach Google or the reservation; the counter's rules are judged in Phase 1's smoke steps and in `test:db`.

### Success Criteria:

#### Automated Verification:

- Route tests pass with a Google request count in every scenario: `npm test`
- Lint and types pass: `npm run lint && npx astro sync && npx astro check`
- Build passes: `npm run build`
- Smoke passes, including the four `/api/commute` steps: `npm run smoke`
- Route tests cover `daily_limit` and `usage_unavailable` with Google 0, and every scenario past the key check makes exactly one reservation before Google: `npm test`

**Implementation Note**: Pause for manual confirmation before Phase 4 (no manual rows — confirm only that the route's contract reads right).

---

## Phase 4: The commute section on the card

### Overview

The member sees and uses the feature. The map loads only after a result and never in `preview`.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: The map library approved by the user on 2026-10-26.

**Contract**: `npm i @vis.gl/react-google-maps@^1.10.1` (≥ 1.8 for `Polyline`) and `npm i -D @types/google.maps`. No other package.

#### 2. Route colour tokens

**File**: `src/styles/global.css`

**Intent**: Six role tokens for the routes, distinguishable from one another on Google's dark map, defined in `:root` and `.dark` and exposed in `@theme inline`. The table's colour swatches use them as classes.

**Contract**: `--route-1` … `--route-6`, plus `--color-route-1..6`. They are named by role and ordered by the points' order.

#### 3. Stream reading

**File**: `src/lib/commute/stream.ts`

**Intent**: Pure functions for the island: a reader of a commute line and a follower of the body.

**Contract**:

- `readCommuteStreamLine(text)` validates every field of `done.result` and returns `null` for anything off-shape. `followCommuteStream(body)` mirrors `followAuditStream`.
- The answer is classified by reusing `classifyAuditAnswer` from `@/lib/audit/stream`. The rule is identical: a redirect is a sign-out, `200` + NDJSON is a stream, anything else is unreadable. There is no second copy.
- A body without a final line is told as „nie wiadomo, jak skończyło się liczenie — odśwież stronę”, with no retry offered.

#### 4. Islands

**Files**: `src/components/offers/CommuteRunner.tsx`, `src/components/offers/CommuteMap.tsx`

**Intent**:

- **`CommuteRunner`**:
  - the button, disabled while a request runs and when `available` is false;
  - after `done`, the table with a Komunikacja / Samochód switch and a swatch per row;
  - the departure date „odjazd: <dzień tygodnia> <data>, 8:00”;
  - the origin sentence — „Start: współrzędne z ogłoszenia” or „Start: lokalizacja i ulica z ogłoszenia” — plus „to szacunek okolicy, nie budynku”;
  - Google attribution beside the table (text „Google Maps” with `translate="no"`);
  - the failure sentence on `failed`.
- **`CommuteMap`** (mounted only with a result and a browser key):
  - `APIProvider` + `Map colorScheme="DARK"`;
  - one `Polyline encodedPath` per route of the active mode, in its token colour converted to hex;
  - a `Marker` labelled with the row number at each polyline's last vertex, and one at the origin (the first vertex);
  - fit to bounds.
- **One map per mounted island.** `CommuteMap` is mounted only after a `done` line, never on `failed`, `running` or `preview`. `APIProvider` and `Map` carry no `key` tied to the mode or the result, and the mode switch and a later result reach the map only as props of its `Polyline`/`Marker` children, so switching modes or pressing again never creates a second `google.maps.Map`. Every map load therefore follows a successful calculation, which reserved at least 2 calls on the day's counter — the counter bounds map loads too.
- Without a browser key, a sentence says the map is unavailable, and the table still shows.

**Contract**:

- `CommuteRunner` props: `offerId`, `available`, `mapKey: string | null`, `preview?: CommutePreview`.
- `CommutePreview` covers `running`, `failed(reason)`, `result(fixture, mode)` and `unreadable`. With `preview` the island sends nothing and never mounts `CommuteMap`: a token-styled placeholder box takes its place.
- `rgbaToHex` lives in `src/lib/commute/colors.ts`, which is pure and tested.
- Names render as text. No `dangerouslySetInnerHTML`.
- No route description or steps are shown.

#### 5. Section and card wiring

**Files**:

- `src/components/offers/OfferCommute.astro`;
- `src/components/offers/OfferView.astro` (below `OfferNotes`);
- `src/pages/offers/[id].astro`;
- `src/lib/commute/browser-key.ts`.

**Intent**: A section `id="dojazdy"` „Dojazdy” with:

- `data-commute-available` (server key);
- `data-commute-map` (browser key);
- `data-commute-origin`;
- `data-commute-archived`;
- `data-commute-points-state`.

Its branches:

- **archived:** no runner, plus a sentence that the offer must be restored first;
- **no origin:** no runner, plus why;
- **points read error:** no runner;
- **no points:** no runner, plus a link to `/criteria#punkty`;
- **otherwise:** the runner, with `available={isCommuteAvailable()}` and the „brak klucza” explanation inside the island when false.

**Contract**:

- `[id].astro` adds `loadCommutePoints` to its `Promise.all`.
- `[id].astro` gets the origin from the row it already reads, via `commuteOrigin`.
- `browser-key.ts` exports `commuteMapKey(): string | null`. It is the one module that reads `GOOGLE_MAPS_BROWSER_KEY`, and only `[id].astro` imports it. The ESLint server-only block allows that import there and nowhere else under `src/components/**`.

#### 6. Kitchen sink and render tests

**Files**: `src/pages/dev/offer-card.astro`, `src/pages/dev/_offer-fixtures.ts`, `tests/components/offers/render.test.ts`, `tests/lib/commute/{stream,colors}.test.ts`

**Intent**:

- `/dev/offer-card` gets a commute block with each state in a column as wide as the team column, all with `preview`. The states are:
  - idle available, idle unavailable (no key), archived, no origin, no points, points read error;
  - running;
  - result transit, result drive;
  - a row `no_route`, a row `address_rejected`, a map without a browser key;
  - each failure reason's sentence, `daily_limit` and `usage_unavailable` among them;
  - unreadable.
- Render tests cover each `data-commute-*` value and the text-only rendering of a hostile point name.

**Contract**: The `/dev` page loads no Google script in any state. A render test asserts that the HTML of every state contains no `maps.googleapis.com`.

### Success Criteria:

#### Automated Verification:

- Lint passes, including tokens-only for the route swatches: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Tests pass, including stream, colors and the render states: `npm test`
- Build passes with no `.env`: `npm run build`
- Smoke passes, and the fixture offer's card carries `data-commute-available="false"` and a `data-commute-origin`: `npm run smoke`

#### Manual Verification:

- `/dev/offer-card` shows every commute state; the browser's network panel shows no request to `maps.googleapis.com` or `routes.googleapis.com`
- On a real card under `npm run dev` with no Google keys: the section renders, the button is unavailable with its explanation, and the banner names both keys
- Code reading of `CommuteRunner`/`CommuteMap`: the map mounts only after `done`, and no `key` on `APIProvider` or `Map` depends on the mode or the result

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Rules and documentation

### Overview

The next agent and the reviewer keep the feature safe and cheap. The docs say where both keys go and how they fail.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Rules and references for the new module, in the places research §1 lists.

**Contract**:

- **Zero-config:** the reference list for "four places" names `src/lib/commute/google.ts` and `isCommuteAvailable()`.
- **Secrets:** both Google keys have five places — schema, `.env`, `.dev.vars`, `.env.example`, Cloudflare secret — and never CI, `review.yml` or `packages/code-reviewer/`.
  - `src/lib/commute/google.ts` is the one module that reads the server key. `src/lib/commute/browser-key.ts` is the one module that reads the browser key.
  - **The narrow exception:** the browser key is handed to `CommuteMap` as a prop from `src/pages/offers/[id].astro` only. It is public by design and restricted in Cloud Console by referrer and to Maps JavaScript API. No other secret may follow it.
  - "The three keys never cross" becomes "the keys never cross", naming all of them.
- **Members' data:** a point's address goes only to Routes, never to the model provider, a log or the browser. `auditNoNotesConfig` holds the points module too, and `commuteNoNotesConfig` keeps notes away from Google.
- **A new bullet „Nothing reaches Google on its own”:**
  - every test meets Routes through `tests/fixtures/google.ts` with a key worth nothing, and every route test states the Google request count;
  - smoke sends only requests that end before Google (`requestCommuteOfMissingOffer`);
  - the map loads only after a member's calculation, never in `preview`, `/dev` or `scripts/ui-screenshots.mjs`;
  - a real calculation is the user's action, and a go-ahead never carries over to the next one;
  - the hard cap is the application's daily counter, not Google's quotas: `supabase/migrations/<ts>_create_commute_usage.sql` is the reference for a counter only a `security definer` function writes, the reservation comes after every free refusal and the key and before `started`, a counter that cannot be read or written never lets a call through, and `COMMUTE_DAILY_CALL_LIMIT` and the migration's literal change together.
- **Product invariant:** Google output is never stored (EEA SST §20.2 / ToS §3.3.2(b)), and no route description or steps are shown (§20.1).
- **Structure:** a bullet for `src/lib/commute/` (one concern per file, as listed in Phases 2–4), the table migration as the reference for a capped team table, and `OfferCommute.astro`'s data attributes.
- **UI:** the `/dev/offer-card` bullet names the commute states and `CommuteRunner`'s `preview`. The `/dev/forms` bullet names `CommutePointsEditor` and `DeletePointForm`. The `/dev/criteria` bullet names the points section.
- **Testing:** `tests/fixtures/google.ts` is the reference stub, and the commute smoke steps are described. The `test:db` paragraph names `scripts/commute-usage.sql` as its third script, with the same discipline.

#### 2. Reviewer criteria

**File**: `packages/code-reviewer/src/prompts/system.ts`

**Intent**: Keep the reviewer in step with CLAUDE.md (`CLAUDE.md` „The code reviewer sees none of this file”).

**Contract**:

- The lines anchored at `:29`, `:37`, `:62`, `:105`, `:112` and `:132` gain:
  - the browser-key exception (a hard error stays any other secret reachable from an island);
  - Google among the paid services no test or step may reach;
  - the two Google keys' places;
  - the commute module's single-reader rule;
  - "Google output is never stored";
  - the reservation on the daily counter before any Routes call, never skipped on an error.
- Checked with `cd packages/code-reviewer && npm run preflight`. The agent never runs `npm run eval`.

#### 3. README, `.env.example`, runbook, user manual

**Files**: `README.md`, `.env.example` (finished in Phase 2), `context/foundation/deployment-runbook.md`, `context/foundation/user-manual/set-up-google-maps.md`

**Intent**: Where the keys go and what their failures look like.

**Contract**:

- **README:**
  - a section „Commute times (Google Maps)” beside „Fallback ingestion (Apify)” (`:246-266`), with a table of the two keys, server-only plus the exception, five places, never CI;
  - the `### Secrets` list (`:286-290`) gains both `wrangler secret put` lines;
  - the zero-config paragraph names the commute section.
- **Runbook:**
  - a `### Google Maps keys (FR-016)` section after the extraction-service token (`:435-447`), linking `context/foundation/user-manual/set-up-google-maps.md` for setup, restrictions, quotas and rotation, without repeating it;
  - a symptom table: `RefererNotAllowedMapError`, `denied`, `quota`, a point row reading „Google odrzucił adres”, `daily_limit` (the team's 300 calls for the Warsaw day are spent — wait until midnight Warsaw time) and `usage_unavailable` (the counter could not be read or written — a Supabase problem, not Google's);
  - **the owner's levers**, in Supabase Studio as `postgres`: reset or lower today's count in **Table Editor** → `commute_usage` (the row for today's Warsaw date), which lets the team calculate again today; a permanent change of the limit is a migration replacing `reserve_commute_calls` together with `COMMUTE_DAILY_CALL_LIMIT`, and anything above ~320 a day can leave the free allowance;
  - the current-state secrets row (`:31`).
- **User manual:** the names, the API list and the restrictions are unchanged. Its „Gdy coś nie działa” table gains the rejected-address row and the whole-failure sentences, which only this plan defines. Step 5's closing paragraph (the application-side limit „zaplanowany jako osobna poprawka”) is replaced by the limit as built — 300 calls a Warsaw day, the member's sentence, a link to the runbook's owner levers — and the `429` row's cause „albo limit aplikacji” moves to its own `daily_limit` row, since the application's refusal is not a `429`.
- **README:** the commute section states the daily limit in one line and links the runbook.

### Success Criteria:

#### Automated Verification:

- Reviewer prompt and evals load: `cd packages/code-reviewer && npm run preflight`
- Lint, types, tests and build still pass: `npm run lint && npx astro check && npm test && npm run build`
- No Google key name appears in `.github/` or `packages/code-reviewer/`: `grep -rn "GOOGLE_MAPS" .github packages/code-reviewer` returns nothing

#### Manual Verification:

- The user runs the paid reviewer eval (`cd packages/code-reviewer && npm run eval`) on the code before this change and after it, and compares it with the baseline in `packages/code-reviewer/evals/README.md` (CLAUDE.md, "The eval set runs before the reviewer's prompt or model changes")
- The user reads the CLAUDE.md exception wording and approves it

**Implementation Note**: Pause for manual confirmation before Phase 6.

---

## Phase 6: Manual — Google Cloud and one real calculation

### Overview

The user's deliberate, paid step. The agent prepares nothing on Google's side and presses nothing.

### Changes Required:

#### 1. Google Cloud and keys

**File**: none (`context/foundation/user-manual/set-up-google-maps.md`, steps 1–7)

**Intent**: The user follows the manual: account, project, the two APIs, both restricted keys, budget alert, local `.env`/`.dev.vars`, and the Cloudflare secrets once deployed. Google's daily quotas are only read there (step 5), never set. The plan does not repeat those steps.

**Contract**: Before the Worker that needs the tables deploys, the agent runs `npx supabase db push --dry-run`, shows the list, and pushes `create_commute_points` and `create_commute_usage` only on the user's yes.

#### 2. One real calculation

**File**: none

**Intent**: The user runs one calculation, which proves the classification, the departure time, the map and the absence of storage against the real service. Paid step: 2N Routes requests (N = the team's points, at most 6) and one Dynamic Maps load.

**Contract**: The user picks one live offer with coordinates and sets 2–3 points, ideally one that has no transit route. Under `npm run dev` with both keys, the user presses „Policz dojazdy” once, then checks:

- both modes in the table;
- the departure day;
- the start sentence;
- the attribution;
- the map with coloured routes and numbered pins;
- after switching the mode a few times, still one map load;
- after a reload, the idle section, with Google Metrics showing no new requests;
- in Supabase Studio, today's `commute_usage` row grew by exactly 2N.

Optionally, the user checks one offer without coordinates (address start). That is a second paid press, run only if the user decides so. A fault found here is reproduced against the stub and fixed there before the step is repeated.

### Success Criteria:

#### Manual Verification:

- Google Cloud is set up per `context/foundation/user-manual/set-up-google-maps.md` steps 1–6
- Both keys are in `.env` and `.dev.vars` locally, and the banner no longer names Google Maps
- `create_commute_points` and `create_commute_usage` are pushed to the hosted project after a dry-run the user approved
- Both Cloudflare secrets are set (manual step 7) and production's banner no longer names Google Maps
- One real calculation, pressed by the user, shows both modes, the departure day, the start sentence, the attribution and the map with coloured routes and pins
- After a reload the result is gone, and Google Metrics shows exactly 2N Routes requests and one map load for that press, the mode switches included
- The log entries for that press (`npm run dev` console or `wrangler tail`) hold no address, name, coordinate or polyline

---

## Testing Strategy

### Unit Tests:

- `departure`: weekdays, weekends, both DST weekends.
- `origin`: numeric strings, blanks, label without a street.
- `outcome`: every rule and its precedence.
- `google`: request shape, every classification, `error.message` never read into a result.
- `colors`: `rgbaToHex`, including alpha ignored and zero-padding.
- `stream`: off-shape lines, a cut body.
- `points`: every failed read beside an empty ok.
- `usage`: every reservation answer, and the limit constant against the migration.

### Integration Tests:

- **Route tests stubbed at the HTTP edge** (`tests/fixtures/http.ts` + `tests/fixtures/google.ts`). Every scenario states its Google request count and that no write happened. Privacy canaries cover the log, Google's bodies and notes.
- **`commute.unconfigured.test.ts`.**
- **Render tests** of `OfferCommute` and the criteria section.
- **ESLint rule tests.**
- **Smoke:** the points table's RLS from both sides with `withSnapshot`, the cap at six, `data-commute-points-state`, the counter's snapshot steps and refused reservations, the card's `data-commute-available="false"`, and four `/api/commute` requests that end before Google.
- **`test:db`** (`scripts/commute-usage.sql`): the Warsaw day boundary in both seasons, the refusal at exactly the limit, yesterday not counting, and a member's direct writes denied.

### Manual Testing Steps:

1. `/criteria`: add three points, edit one, delete one through the dialog, try a seventh.
2. `/dev/offer-card` and `/dev/criteria`: every commute and points state, with no Google request in the network panel.
3. Phase 6's one real calculation.

## Performance Considerations

- **Subrequests:** at most 12 Routes calls plus about 4 Supabase calls (the reservation among them) per press, within the Free plan's 50.
- **Monthly allowance:** 300 Routes calls a day × 31 = 9 300 < 10 000 free Essentials requests; map loads follow successful presses only, at most 150 a day.
- **Duration:** the calls run in parallel, each with a 10 s deadline. Waiting on `fetch` costs no CPU time.
- **Bundle:** the map bundle (~22 KB gzip plus Google's script) loads only after a result.

## Migration Notes

Two additive migrations with no data backfill. Rollback = drop the function and both tables, since nothing references them. The migration reaches the hosted project with `npx supabase db push` before the Worker that reads it deploys, on the user's consent (Phase 6).

## References

- PRD: `context/foundation/prd.md`: FR-016, FR-014, Non-Functional Requirements, and the „Resolved during implementation” block (2026-10-26)
- Research: `context/changes/commute-times/research.md`
- Google setup: `context/foundation/user-manual/set-up-google-maps.md`
- Paid-route reference: `src/pages/api/audits.ts:28-34,296-378`; island `src/components/offers/AuditRunner.tsx`; stream `src/lib/audit/stream.ts:37-122`
- Team table reference: `supabase/migrations/20260922202756_create_offers.sql:84-113`
- Function-written table reference: `supabase/migrations/20260926185936_create_members.sql`; counter snapshot smoke reference: the step "member cannot change the ingestion mode" in `scripts/smoke.mjs`; time-dependent DB checks reference: `scripts/audit-state.sql`; paired constant reference: `AUDIT_STALE_ATTEMPT_MS` in `src/lib/audit/failure.ts`
- Google's quotas not adjustable: `context/foundation/user-manual/set-up-google-maps.md`, step 5
- Zero-config reference: `src/lib/otodom/apify.ts:54-56`, `src/lib/config-status.ts:11-56`
- Lint references: `eslint.config.js:112-140,208-224`
- Stub reference: `tests/fixtures/apify.ts`; unconfigured test reference: `tests/pages/api/audits.unconfigured.test.ts`
- Smoke references: `scripts/smoke.mjs:681,938-956,1886-1975`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Team data — points with CRUD on `/criteria`, and the daily call counter

#### Automated

- [x] 1.1 Both migrations apply on a fresh local database: `npx supabase db reset` — 9b29e25
- [x] 1.2 Lint passes, including the new audit/points rule: `npm run lint` — 9b29e25
- [x] 1.3 Types check: `npx astro sync && npx astro check` — 9b29e25
- [x] 1.4 Unit, route and render tests pass: `npm test` — 9b29e25
- [x] 1.5 Build passes with no `.env`: `npm run build` — 9b29e25
- [x] 1.6 Smoke passes against local Supabase, including the points RLS steps, the counter's snapshot steps and `data-commute-points-state="ok"`: `npm run smoke` — 9b29e25
- [x] 1.7 The counter's rules hold in the database — Warsaw day boundary, the refusal at the limit, a member cannot write the counter: `npm run test:db` — 9b29e25

#### Manual

- [x] 1.8 On `/criteria` under `npm run dev`: add, edit and delete a point (the dialog confirms); a seventh is refused with its sentence — 9b29e25
- [x] 1.9 `/dev/criteria` and `/dev/forms` render every new state, and `?open=delete-point` opens the dialog — 9b29e25

### Phase 2: Google integration, offline

#### Automated

- [x] 2.1 Lint passes, including the merged server-only block and the commute/notes rule: `npm run lint` — 3142227
- [x] 2.2 Types check: `npx astro sync && npx astro check` — 3142227
- [x] 2.3 Tests pass, including `tests/setup.test.ts` with both Google keys unset: `npm test` — 3142227
- [x] 2.4 Build passes with no `.env`, and the banner lists both Google entries: `npm run build` — 3142227
- [x] 2.5 No test reaches Google: `routesCalls` is asserted in every test that builds a client — 3142227
- [x] 2.6 The reservation reader classifies every answer, and the limit constant matches the migration: `npm test` (`tests/lib/commute/usage.test.ts`) — 3142227

#### Manual

- [x] 2.7 With no `.env`, `npm run dev` shows the banner naming „Google Maps — trasy” and „Google Maps — mapa” — 3142227

### Phase 3: The calculation route `POST /api/commute`

#### Automated

- [x] 3.1 Route tests pass with a Google request count in every scenario: `npm test` — 8da11a6
- [x] 3.2 Lint and types pass: `npm run lint && npx astro sync && npx astro check` — 8da11a6
- [x] 3.3 Build passes: `npm run build` — 8da11a6
- [x] 3.4 Smoke passes, including the four `/api/commute` steps: `npm run smoke` — 8da11a6
- [x] 3.5 Route tests cover `daily_limit` and `usage_unavailable` with Google 0, and every scenario past the key check makes exactly one reservation before Google: `npm test` — 8da11a6

### Phase 4: The commute section on the card

#### Automated

- [x] 4.1 Lint passes, including tokens-only for the route swatches: `npm run lint` — 51d0a3d
- [x] 4.2 Types check: `npx astro sync && npx astro check` — 51d0a3d
- [x] 4.3 Tests pass, including stream, colors and the render states: `npm test` — 51d0a3d
- [x] 4.4 Build passes with no `.env`: `npm run build` — 51d0a3d
- [x] 4.5 Smoke passes, and the fixture offer's card carries `data-commute-available="false"` and a `data-commute-origin`: `npm run smoke` — 51d0a3d

#### Manual

- [x] 4.6 `/dev/offer-card` shows every commute state; the browser's network panel shows no request to `maps.googleapis.com` or `routes.googleapis.com` — 51d0a3d
- [x] 4.7 On a real card under `npm run dev` with no Google keys: the section renders, the button is unavailable with its explanation, and the banner names both keys — 51d0a3d
- [x] 4.8 Code reading of `CommuteRunner`/`CommuteMap`: the map mounts only after `done`, and no `key` on `APIProvider` or `Map` depends on the mode or the result — 51d0a3d

### Phase 5: Rules and documentation

#### Automated

- [x] 5.1 Reviewer prompt and evals load: `cd packages/code-reviewer && npm run preflight` — 9d3f19a
- [x] 5.2 Lint, types, tests and build still pass: `npm run lint && npx astro check && npm test && npm run build` — 9d3f19a
- [x] 5.3 No Google key name appears in `.github/` or `packages/code-reviewer/`: `grep -rn "GOOGLE_MAPS" .github packages/code-reviewer` returns nothing — 9d3f19a

#### Manual

- [x] 5.4 The user runs the paid reviewer eval (`cd packages/code-reviewer && npm run eval`) on the code before this change and after it, and compares it with the baseline in `packages/code-reviewer/evals/README.md` (CLAUDE.md, "The eval set runs before the reviewer's prompt or model changes") — 9d3f19a
- [x] 5.5 The user reads the CLAUDE.md exception wording and approves it — 9d3f19a

### Phase 6: Manual — Google Cloud and one real calculation

#### Manual

- [x] 6.1 Google Cloud is set up per `context/foundation/user-manual/set-up-google-maps.md` steps 1–6 — 5681165
- [x] 6.2 Both keys are in `.env` and `.dev.vars` locally, and the banner no longer names Google Maps — 5681165
- [x] 6.3 `create_commute_points` and `create_commute_usage` are pushed to the hosted project after a dry-run the user approved — 5681165
- [x] 6.4 Both Cloudflare secrets are set (manual step 7) and production's banner no longer names Google Maps
- [x] 6.5 One real calculation, pressed by the user, shows both modes, the departure day, the start sentence, the attribution and the map with coloured routes and pins — 5681165
- [x] 6.6 After a reload the result is gone, and Google Metrics shows exactly 2N Routes requests and one map load for that press, the mode switches included — 5681165
- [x] 6.7 The log entries for that press (`npm run dev` console or `wrangler tail`) hold no address, name, coordinate or polyline — 5681165
