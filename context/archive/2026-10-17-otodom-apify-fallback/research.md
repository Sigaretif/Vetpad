---
date: 2026-10-17T20:02:40+02:00
researcher: Claude (Opus 5.5) for Wiktor Ortel
git_commit: 98b925b
branch: master
repository: 10xDevs4 (Vetpad)
topic: "Apify (trev0n/otodom-scraper) as an ingestion fallback beside the direct otodom fetch, with a switchable mode"
tags: [research, ingestion, otodom, apify, supabase-rls, zero-config, workers, testing]
status: partial
last_updated: 2026-10-17
last_updated_by: Claude (Opus 5.5)
---

# Research: Apify ingestion fallback with a switchable ingestion mode

**Date**: 2026-10-17T20:02:40+02:00
**Researcher**: Claude (Opus 5.5) for Wiktor Ortel
**Git Commit**: 98b925b
**Branch**: master
**Repository**: 10xDevs4 (Vetpad)

Nothing in this research called Apify or otodom.pl. Evidence comes from the code at
`98b925b`, the foundation docs, and public web documentation (Apify, Supabase,
Cloudflare, Astro). Status is **partial** for one reason, stated in full under
"Blocking evidence gap": the Apify actor's complete output schema is undocumented,
and the only way to close that gap is a paid run.

## Research Question

The change is described in `context/changes/otodom-apify-fallback/change.md`. The ten
questions it raised:

1. Where the seam for a second source sits.
2. The failure taxonomy and which failures should trigger the fallback.
3. How Apify's output compares with our mapper, including the fingerprint.
4. A mode singleton that members can read but not write.
5. Zero-config handling for `APIFY_TOKEN`.
6. The Workers runtime.
7. Logging.
8. The testing surface.
9. Rules and docs that need changing.
10. The Apify Console click path.

## Summary

- **The seam is `ingestOffer`** (`src/lib/otodom/index.ts:35-46`). It sits between the
  URL normalisation and the `OfferInsert` that both routes consume. Everything after
  `OfferInsert` works on any source unchanged: the duplicate/twin handling, the
  `otodom_id` identity check, lost facts, the fingerprint and the write. Everything
  that carries a guardrail lives inside `mapAdToOffer` (`src/lib/otodom/map.ts:215-309`),
  which reads otodom's `ad` shape: the FR-005 gate, `numericOrUnknown`, the `raw`
  whitelist and the seller-data drop. An Apify item is a different, flat shape, so the
  Apify path needs **its own mapper** into `OfferInsert`. That mapper reuses
  `numericOrUnknown`, `htmlToPlainText` and the small helpers, and has its own `raw`
  whitelist. That whitelist doubles as the server-side `fields=` projection. An adapter
  that synthesises a fake `ad` would invent the gate's own inputs and would put
  fabricated keys into `raw`, so it is rejected.
- **The FR-005 gate has no verified input on the Apify side.** `otodom_apify.md` §6
  verifies 15 fields and names about 30 of the actor's 50 keys. None of the named fields
  distinguishes sale from rental or a flat from another property type. `market` cannot,
  because a rental reads `ALL` (`otodom_fetching.md:447`).
  - Until a paid run captures the full key list and verifies a discriminator against a
    flat-sale, a flat-rental and a house-sale listing, an Apify result **cannot be gated**.
  - CLAUDE.md requires that only a flat sale is saved, so an ungated result can only be
    refused (fail closed).
  - This is the blocking gap.
- **Fidelity: switching source changes the stored row.**
  - 13 offer columns are verified exact matches between the two sources.
  - 3 more are present in the Apify output but unverified: `title`, `advert_type` (whose
    case differs) and `images` (only the count matches).
  - About 13 columns have no documented Apify field, among them `location_label`,
    `street_name`, `heating`, `building_ownership`, `features`, the currencies and
    `energy_certificate`.
  - On re-fetch, a source switch would therefore:
    - raise the lost-facts prompt (`src/lib/offer-refetch.ts:23-25`) on almost every row;
    - flip `listingFingerprint` and mark the audit stale with nothing in the listing having
      changed, if the member accepts;
    - possibly wipe `images` silently, since `images` is outside the lost-facts columns.
  - On an Apify-saved row, three columns are null only because Apify lacks them: heating,
    ownership and location. All three are decision-critical (`src/lib/audit/input.ts:90-100`),
    so the audit could report them as "missing from the listing" when the listing actually
    states them. That is the fabricated-fact guardrail at work in the other direction.
- **Fallback triggers.**
  - Today's taxonomy (`src/lib/otodom/fetch.ts:165-221`) separates block and page-change
    reasons from facts about the listing.
  - Fallback candidates: `challenged`, `http_denied` (403/429, and an off-otodom landing),
    `data_missing`, `shape_changed` at the fetch stage, `timeout` and `network`.
  - Never a fallback: URL-stage refusals, `not_found`, `expired`, a redirect to another
    offer, `not_for_sale`/`not_a_flat`, and `upstream_error`. For `upstream_error` the code
    comment at `fetch.ts:173-174` says so explicitly.
- **The mode table** follows the `criteria_revision` precedent: one `select` policy and no
  write policy at all (`20260927144141_create_team_criteria.sql:340-351`), plus the
  boolean-PK singleton (`20261007073258_create_audit_settings.sql:18-26`). Supabase
  documents that Dashboard queries run as `postgres`, which has `bypassrls`, so the owner
  can edit the row in Studio. The audit settings trigger raises 42501 without `auth.uid()`
  and **must not be copied** here.
- **Zero-config.**
  - `APIFY_TOKEN` follows the four-place pattern; `ANTHROPIC_API_KEY` is the reference.
  - Keeping it out of CI is technically sound: `access:"secret"` is read at runtime. It
    does, however, contradict the "six places" wording in CLAUDE.md:25 and the runbook
    (:293, :358-363), and those texts change with the code.
- **Runtime.** An ~8.5 s `fetch` fits a Workers HTTP request on the Free plan: there is no
  wall-time cap, and waiting costs no CPU.
  - The single `AbortSignal.timeout(45_000)` shared by the whole ingest
    (`src/pages/api/offers.ts:91`, `src/pages/api/offer-refetch.ts:148`) leaves no budget
    for Apify after a direct timeout. Each leg needs its own deadline.
  - PRD NFR l.123 says "roughly one minute", which bounds the sum of the two legs.
  - `maxTotalChargeUsd` caps the cost per run. `maxItems` only caps what is charged on
    pay-per-result. Apify's sync endpoint returns **no run id**.

## Blocking evidence gap

**Missing evidence:** the actor's full output (all 50 keys), captured for three listings:

- a flat sale;
- a flat rental;
- a house sale;

plus one listing whose rent otodom sends as `"0"`.

**What it decides:**

1. Whether any field can serve as the FR-005 gate.
2. Which of the about 13 undocumented columns actually exist.
3. The structure of `images`.
4. Whether `title` equals `ad.title`.

**How to close it:** only by a paid Apify run, about $0.002 each (`otodom_apify.md` §7).
Per CLAUDE.md "Nothing reaches the model provider on its own", and by the same logic for
any paid vendor, that is a **Manual** step the user runs. The plan should make it the
first Manual row, before any mapper code is written.

Its output must be stored as a **synthetic** fixture. The repository is public, and a raw
capture carries a real seller's phone number and name (`otodom_apify.md` §6.1, test-plan
§6.1). If the capture shows no discriminator, the design choices are:

- (a) the Apify path refuses everything as unverifiable, which makes the fallback useless;
- (b) gate on the user's pasted URL plus a direct-path signal, which is not available when
  direct is blocked;
- (c) pick another actor.

## Detailed Findings

### 1. Ingestion path and the seam

**Add path.** `src/pages/api/offers.ts` runs these steps:

1. Session check (:44-48).
2. `createClient` (:50-54).
3. `FormData` (:56-63).
4. `normalizeOfferUrl`.
5. Duplicate precheck on `source_url` (:74-87).
6. Log `started` (:90).
7. `ingestOffer(url, AbortSignal.timeout(45_000))` (:91).
8. On failure, `report(INGEST_OUTCOME[reason])` and a redirect to `?error=` (:92-102).
9. Insert `{...offer, source_url, created_by}` (:105-109).
10. On `23505`, a twin lookup (:133-153).

**URL normalisation.** `normalizeOfferUrl` is at `src/lib/otodom/url.ts:12-37`. It
returns the canonical `/pl/oferta/<slug>` address, or one of the reasons
`empty|malformed|foreign_host|not_an_offer`.

**`ingestOffer`** (`src/lib/otodom/index.ts:35-46`) runs normalise, then
`fetchOfferAd`, then `mapAdToOffer`. It returns either `{ok, url, offer: OfferInsert}` or
`{ok:false, stage: url|fetch|map, reason, status?, detail?, evidence?}`.

**`fetchOfferAd`** (`src/lib/otodom/fetch.ts:133-222`) returns `props.pageProps.ad` as
`unknown`.

**`mapAdToOffer`** (`src/lib/otodom/map.ts:215-309`):

- The gate (:220-234): `adCategory.type==="SELL"` cross-checked with
  `target.OfferType==="sprzedaz"`, then `adCategory.name==="FLAT"`.
- `numericOrUnknown` (:74-86, exported) and `integerOrUnknown` (:89-92).
- `buildRaw` (:156-161) over `RAW_AD_KEYS` (:11-22), with `target` and `location` narrowed
  (:25, :32).
- The seller data is dropped only because `owner`, `contactDetails` and `agency` are never
  read and `raw` is a whitelist.

**Re-fetch path.** `src/pages/api/offer-refetch.ts` runs these steps:

1. Reads the stored row: `source_url`, `otodom_id` and `AUDIT_OFFER_COLUMNS` (:25, :116-132).
2. Re-normalises the stored URL (:137-142).
3. Calls `ingestOffer` with the same 45 s signal (:148-159).
4. Checks the identity `otodom_id` (:165-168).
5. Runs `lostFacts` and `isLossAccepted` (:173-180, defined at `src/lib/offer-refetch.ts:23-25`, :75-77).
6. Writes the update (:184-189) and judges it by its zero rows (:213-216).
7. Compares the fingerprint before and after (:221-229).

**The seam.** `ingestOffer` is where the second source plugs in. The source-neutral
contract is `OfferInsert` (`src/lib/otodom/types.ts:69-108`).

**Constraints at the seam:**

- `fetch.ts`, `map.ts` and `types.ts` allow `import type` only, because
  `scripts/otodom-inspect.mjs` loads them under Node (`fetch.ts:14-15`, `map.ts:47-48`).
  An Apify module that reads `astro:env/server` therefore stays out of them. The token, or
  a provider built by a null-returning factory, is injected into `ingestOffer` from the
  route.
- `IngestFailureReason` (`index.ts:10`) drives three exhaustive tables in
  `src/lib/otodom/failure.ts`:
  - `addFailureMessage` (:15-51);
  - `refetchFailureMessage` (:59-96);
  - `INGEST_OUTCOME` (:116-133).

  A new reason must be added to all three, or `npx astro check` fails.

**Mapper vs adapter: a separate mapper.** An adapter that builds a synthetic `ad` has two
problems. It would assert `adCategory` and `target` itself, which disables the gate. And
`buildRaw` would then copy those invented keys into `raw`, which contradicts CLAUDE.md:
"`raw` is built from a whitelist of `ad` keys".

### 2. Failure taxonomy

The order is first match wins (`src/lib/otodom/fetch.ts:165-221`). The outcomes are in
`INGEST_OUTCOME` (`failure.ts:116-133`).

| Reason (where)                                                                                  | Condition                                                                  | Fallback?                                                                                                   |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `empty`, `malformed`, `foreign_host`, `not_an_offer` (url.ts)                                   | input                                                                      | **no**: a fact about the input                                                                              |
| `challenged` (fetch.ts:168)                                                                     | `cf-mitigated` header, any status                                          | **yes**: the strongest block signal                                                                         |
| `http_denied`, off-otodom landing (:171)                                                        | consent or anti-bot host                                                   | **yes**                                                                                                     |
| `not_found` 404/410 (:172)                                                                      | gone                                                                       | **no**; Apify would answer 201 + `_warning` anyway (`otodom_apify.md` §5.2)                                 |
| `upstream_error` ≥500 (:175)                                                                    | portal outage                                                              | **no**: the code comment at :173-174 reserves the fallback for a block, and Apify would hit the same outage |
| `http_denied`, other non-2xx (:177)                                                             | 403/429 = egress block; 400/401/451 ambiguous                              | **yes for 403/429**, **decision** for the other 4xx                                                         |
| `not_found`, landed on `/wyniki` (:180)                                                         | expired → search results                                                   | **no** (a fact about the listing; runbook :225-228 notes the landing was never recorded)                    |
| `unexpected_landing`, elsewhere/unparseable (:182)                                              | unseen landing                                                             | **decision** (weak candidate)                                                                               |
| `unexpected_landing`, another offer's ID (:185-187)                                             | re-pointed listing                                                         | **no**                                                                                                      |
| `timeout` / `network` (:139-144, :191-193)                                                      | no answer                                                                  | **yes**, but needs its own deadline (§6)                                                                    |
| `data_missing` (:199)                                                                           | 2xx without `__NEXT_DATA__`, i.e. a block served with 200 or a page change | **yes**                                                                                                     |
| `shape_changed`: `next_data_unparseable`, `page_props_missing`, `ad_missing` (:207, :212, :221) | page change                                                                | **yes**                                                                                                     |
| `expired` (:217, :220)                                                                          | `shouldShowExpiredAdPage`                                                  | **no**                                                                                                      |
| map `not_for_sale`, `not_a_flat` (map.ts:228-234)                                               | FR-005                                                                     | **no**: re-trying only costs money                                                                          |
| map `shape_changed` (map.ts:222, :225-227, :241-246)                                            | `ad` read but malformed                                                    | **decision**: in principle a page change, but Apify cannot gate it (gap above)                              |

Outside ingest are precheck failures, duplicates, the insert and twin outcomes,
`other_listing`, `lost_facts` and `offer_gone`. None of them is about the source, so none
is a trigger.

### 3. Apify output vs `OfferInsert`

**Verified exact** (`otodom_apify.md` §6, l.264-283):

| Column                | Apify field    | Mapper line |
| --------------------- | -------------- | ----------- |
| `otodom_id`           | `id`           | map.ts:268  |
| `listed_at`           | `dateCreated`  | :269        |
| `listing_modified_at` | `dateModified` | :270        |
| `description`         | `description`  | :273        |
| `price`               | `price`        | :275        |
| `area_m2`             | `area`         | :280        |
| `rooms`               | `rooms`        | :281        |
| `build_year`          | `buildYear`    | :283        |
| `rent`                | `rentPrice`    | :284        |
| `floor`               | `floor`        | :287        |
| `building_type`       | `buildingType` | :289        |
| `construction_status` | `condition`    | :290        |
| `latitude`            | `latitude`     | :301        |

Notes on these:

- `description` is "701 chars, identical". That it is the same HTML, so that
  `htmlToPlainText` gives the same text, is an inference.
- `rent` was verified only for the value 470. Whatever Apify does with `"0"`,
  `numericOrUnknown` turns `0`, `"0"`, `null` and absent into null.
- Enum tokens pass through raw (§6 l.285-288).

**Close but not proven identical:** `market` (map.ts:288). It reads
`characteristics.market` directly, while Apify's `market` is `ad.market` lowercased.

**Present but unverified:**

- `title` (:272). On a 404 it holds the error page's `<title>` (§5.2).
- `advert_type` (:296). Apify's `sellerType` reads `private`, while `ad.advertType` reads
  `PRIVATE`, and `labels.ts:87-91` is keyed in upper case.
- `images` (:305). Only the count is known. `mapImages` needs `thumbnail` and `large`
  https URLs.

**Not documented:**

- `price_currency`, `price_per_m`, `rent_currency`;
- `floors_total`, `building_ownership`, `heating`, `windows_type`, `building_material`,
  `energy_certificate`, `free_from`;
- `location_label` (`district` and `subdistrict` were observed null);
- `street_name`, `longitude`, `features`.

"Not documented" is not the same as "proven absent".

**Gate:** there is no documented equivalent of `adCategory` or `target`. See the blocking gap.

**Personal data.** `sellerPhone`, `sellerPhones`, `agencyName`, `agencyUrl` and
`agencyLicenseNumber` are excluded with the `fields=` projection (§6.1 mitigation 1;
runbook :291-293), so they never enter the Worker. The same whitelist builds `raw` for this
source. The mapper also drops them on receipt, a second line of defence that the canary
test proves.

**Junk records** (§5):

- A real item is one whose `id` is truthy.
- An item with `noResults: true` or `_warning` is filtered out.
- An empty result after filtering is a fetch failure. A 201 that contains only filtered
  items must never become a saved offer; the PRD NFR at l.118 forbids that outright.
- Whether that case is reported as `not_found` or as a new reason is a decision. The actor
  uses the same response for "offer gone" and "page shape changed" (§9 l.391-393).

**`listingFingerprint`** (`src/lib/audit/input.ts:345-351`) is `v1:` followed by the
SHA-256 of the 25 `AUDIT_OFFER_COLUMNS` values in order (:45-71), read back from DB rows
through `readAuditOffer` (:220-233). For a direct fetch and an Apify fetch of the same
listing:

- Equal: price, area, rooms, build_year, non-zero rent, floor, building_type,
  construction_status, likely market, and probably description.
- At risk: title, advert_type.
- Null under Apify: the 13 undocumented columns.

**Consequences:**

- A switch from direct to Apify on re-fetch triggers `lost_facts` (`offer-refetch.ts:176-180`).
- If the member accepts, the fingerprint changes and the audit goes stale.
- A switch from Apify to direct changes the fingerprint without any prompt.
- `images`, `longitude` and `raw` are written outside the lost-facts check (:186).

Mitigations for the plan to weigh:

- a `source` marker on the row;
- a refetch rule that keeps the stored values of columns the Apify source cannot supply;
- an audit input that knows a column is "not fetched" rather than "not stated".

### 4. Mode singleton

**Precedents:**

- The boolean PK with `check (id)` and an insert in the creating migration
  (`20261007073258_create_audit_settings.sql:18-26`, :40-41;
  `20260927144141_create_team_criteria.sql:28-38`, :60).
- A closed list as a table `check` (`...073258...:32-35`).
- A read-only table for members: `criteria_revision`, which has one select policy and no
  write policies (`...144141...:340-351`).
- **Do not copy the audit settings signature trigger.** It raises 42501 when `auth.uid()`
  is null (`...073258...:86-88`), and a Studio edit has no `auth.uid()`.

**Shape** (the file is created with `supabase migration new create_ingestion_settings`):

```sql
create table public.ingestion_settings (
  id boolean primary key default true,
  mode text not null,
  updated_at timestamptz,          -- optional; no auth.uid() signature
  constraint ingestion_settings_singleton check (id),
  constraint ingestion_settings_mode_known
    check (mode in ('direct_with_fallback','apify_only','direct_only'))
);
insert into public.ingestion_settings (id, mode) values (true, '<default — decision>');
alter table public.ingestion_settings enable row level security;
create policy ingestion_settings_select_authenticated
  on public.ingestion_settings for select to authenticated
  using (auth.uid() is not null);
-- no insert/update/delete policy, no anon policy: the owner edits in Studio as postgres
```

**RLS as the only gate.** Under the hosted grants (CLAUDE.md, Secrets), RLS is the only
gate:

- a member's update or delete reaches 0 rows;
- a member's insert fails with 42501.

**Studio role.** This is verified:

- Supabase: "Queries you run in the Dashboard execute as `postgres`"
  (https://supabase.com/docs/guides/database/postgres/roles).
- "On Supabase the owner is `postgres`, which has `bypassrls`"
  (https://supabase.com/docs/guides/database/postgres/row-level-security).

The Table Editor is not named verbatim on that page, so that part is unverified. Studio's
role selector or impersonation, if set to a non-postgres role, would make the edit fail
(https://supabase.com/features/user-impersonation).

**Failed read.** `loadAuditSettings` refuses and never falls back to a default
(`src/lib/audit/settings.ts:33-38`, :115-147). Refusal is triggered by:

- no client;
- a query error;
- a missing row;
- an off-list value;
- a throw.

The route then refuses with `settings_read_failed` (`src/pages/api/audits.ts:170-173`).
Ingestion has no precedent of its own, so this is a **decision**. A missing row is
reachable, because the owner can delete it in Studio.

**UI.** The audit settings section on `/criteria` is the pattern:

- `src/pages/criteria.astro:14-17` loads them;
- `src/components/criteria/CriteriaView.astro:208-216` renders them, carrying
  `data-audit-settings-state`;
- `/dev/criteria` and smoke check them (`scripts/smoke.mjs:86,225`).

A read-only mode display would follow that pattern, without a form. Whether to show it at
all is a **decision**.

### 5. Zero-config for `APIFY_TOKEN`

**The four-place pattern, with `ANTHROPIC_API_KEY` as the reference:**

1. `astro.config.mjs:21`: `envField.string({context:"server", access:"secret", optional:true})`.
2. A factory that returns null: `src/lib/audit/provider.ts:46`, :111-112.
3. The call sites, null-checked: `offers.ts` and `offer-refetch.ts`.
4. The status: `src/lib/config-status.ts:19-24` (entry), :27 (`missingConfigs`), :35-37
   (`isAuditAvailable`).

The banner is `src/layouts/Layout.astro:23-36`.

**Other places the token lands:**

- `.env.example:3-4`.
- The README: install (:39-42), a feature section on the model of :173-186, secrets
  (:217), and CI (:264).
- The runbook: "Current state" (:30) and the six-places section (:358-370).
- `tests/setup.ts:10` and `tests/setup.test.ts:28-34`, which gain `APIFY_TOKEN: undefined`
  and a guard that the factory returns null.
- Human steps: `.env`, `.dev.vars`, and `npx wrangler secret put APIFY_TOKEN`.

`wrangler.jsonc` has no vars block, so it does not change.

**CI.** `.github/workflows/ci.yml:23-27` injects Supabase and Anthropic into the `ci`
job's build step only. `smoke` gets no secrets (:45-49).

- Leaving `APIFY_TOKEN` out of CI works, because Astro reads secrets at runtime
  (https://docs.astro.build/en/guides/environment-variables/).
- It departs from the "six places" wording at CLAUDE.md:25, README:185 and runbook
  :293/:358-363. Those texts change in the same change, to say "five places, never CI".

**No token, per mode.** All of this is a **decision**, recorded in the change note as
"no token means direct-only plus a banner entry":

- direct_with_fallback becomes direct-only.
- direct_only is unaffected.
- apify_only has no source at all. It either refuses with a "fetch unavailable, extraction
  service unconfigured" reason, or degrades to direct.

Degrading to direct is what the change note implies. Refusing would contradict "never
refuse because a secret is absent".

### 6. Workers runtime

**Limits:**

- The plan is Workers Free (`deployment-runbook.md:29`), with 10 ms of CPU and 1102 as its
  signature (:166).
- "No hard limit on duration for HTTP-triggered Workers". Waiting on `fetch` costs no CPU.
  There are 50 subrequests on Free
  (https://developers.cloudflare.com/workers/platform/limits/, updated 2026-10-12;
  `otodom_fetching.md` §9.1 :561-648).

**Subrequests for one add:**

| Step         | Subrequests                             |
| ------------ | --------------------------------------- |
| Auth         | 1–2                                     |
| Precheck     | 1                                       |
| Mode read    | 1                                       |
| Direct fetch | 1 + redirect hops (counting unverified) |
| Apify        | 1                                       |
| Insert       | 1                                       |
| Twin         | 1                                       |
| **Total**    | **~7–10**, well under 50                |

**CPU.** The Apify body is ~6.6 KB (`otodom_apify.md:153`), so parsing it costs a
negligible amount of CPU.

**Deadlines:**

- The 45 s signal today is inline at `offers.ts:91` and `offer-refetch.ts:148`, and the
  text "45 sekund" is hard-coded at `failure.ts:44`, :88.
- A fallback needs per-leg deadlines as named constants, following
  `src/lib/audit/failure.ts:12-26`. As an illustration: direct ≈ 15–20 s, then Apify
  ≈ 40 s, with Apify's `timeout=` query parameter below the client deadline.
- The sum should stay within PRD l.123: "an ingest that has not completed within roughly
  one minute … reported as failed".
- Apify returns 408 `run-timeout-exceeded` after 300 s
  (https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post).

**Cost cap, per run:**

- `maxTotalChargeUsd` caps the run's total charge across pricing models (verified, same
  page). `otodom_apify.md:159` uses `0.05`.
- `maxItems` caps only what is charged on pay-per-result. It does not cap what is returned
  (§4.2).
- At $2 per 1,000 results, one call costs $0.002 (§7).

**No module-scope state.** The Apify call is built per request, as `createAuditProvider`
is. There is no module-scope "direct failed recently" memo (CLAUDE.md :35).

**Endpoint path.** Current Apify docs give `/v2/actors/:actorId/...`. The verified
document uses `/v2/acts/trev0n~otodom-scraper/...`, which `otodom_apify.md:128` says also
works.

### 7. Logging

`logEvent` (`src/lib/log.ts:9-58`) keeps only keys on its `FIELDS` list. Values are
strings cut to 300 characters, finite numbers and booleans (:60-80).

Today `offer_add` (`offers.ts:16`, :24-26, :89-100) and `offer_refetch`
(`offer-refetch.ts:29`, :36-37, :147-153) log:

- `stage`, `reason`, `status`, `detail`;
- `fetchFields(evidence)` (`failure.ts:140-155`).

**Fields to add to the whitelist** (the names are suggestions):

- `source`: `direct` or `apify`.
- `fallback_reason`: the direct reason that triggered Apify. `reason` stays the final
  outcome.
- `apify_status`: kept separate from `status`, which is otodom's status. Both appear in
  one entry after a fallback.
- `apify_error_type`: the token from `error.type`. Never `error.message`, which can quote
  the input.
- `ingestion_mode`, and the mode read's state.
  - A failed read reuses `detail`, `db_code` and `db_status`, as `ReadFailure` does
    (`src/lib/criteria.ts:303-310`).

There is no **run id**: run-sync returns only dataset items and pagination headers (Apify
docs, above), so that field is dropped.

The token travels only in `Authorization: Bearer` (`otodom_apify.md` §3 :79-83) and is
never logged. Tests add the test token to the forbidden-strings list of the log-privacy
scenarios.

### 8. Testing surface

**Fixtures:**

- `tests/fixtures/otodom.ts` is shaped like `ad`:
  - canaries at :12-21 (`CANARY_PHONE`, `CANARY_NAME`, ids, street);
  - `flatSaleAd` at :77-135, with its variants at :158-195.
- `tests/fixtures/http.ts`:
  - `stubFetch` (:53-75) records `{method,url,body}`, rejects on an aborted signal, and
    fails the test on any unplanned request (:78-86);
  - routing is by predicates: `isOtodomRequest` (:465-468) and `isTableRequest` (:332-335).
- A new `tests/fixtures/apify.ts` mirrors `tests/fixtures/anthropic.ts:49-68`, :217-246. It
  needs:
  - `APIFY_TEST_TOKEN`, `isApifyRequest` and `apifyCalls`;
  - `apifyItems()`, the real item plus the `noResults` sentinel, with
    `sellerPhone: CANARY_PHONE` and `agencyName: CANARY_NAME` (test-plan :183-188);
  - `apifyMissingOffer()`, which returns `_warning` and no `id`;
  - `apifyError(status, type)` and `apifySilence`.
- The fixture is synthetic and hand-written, never a recorded payload.

**Route tests.** Both `tests/pages/api/offers.test.ts` and
`tests/pages/api/offer-refetch.test.ts` count `stub.requests.filter(isOtodomRequest)`
together with inserts and writes.

- Today their stubs plan only the otodom, offers and auth requests. A mode-table read
  turns every existing scenario red until the stubs plan it.
- The cross-file guard at `offer-refetch.test.ts:1020-1032` asserts that every request is
  otodom, a stored read or an offer write. It is widened deliberately, and still forbids
  `offer_notes` and `offer_audits`.
- **New scenarios.** Each one states how many requests reached otodom, how many reached
  Apify, and how many writes there were:

| Scenario                                                                                           | otodom               | Apify | writes               | Further assertions                                                                  |
| -------------------------------------------------------------------------------------------------- | -------------------- | ----- | -------------------- | ----------------------------------------------------------------------------------- |
| Direct 403, `challenged`, `data_missing`, `shape_changed`, network or timeout, then Apify succeeds | 1                    | 1     | 1                    | no canary in the row sent; the log names the source                                 |
| Direct 404/410, `expired`, another offer, rental or house                                          | 1                    | 0     | 0                    |                                                                                     |
| Apify-only                                                                                         | 0                    | 1     | as the case requires |                                                                                     |
| Direct-only                                                                                        | as the case requires | 0     | as the case requires |                                                                                     |
| Apify sentinel only, or `_warning`                                                                 |                      | 1     | 0                    |                                                                                     |
| Apify 401, 403 `insufficient-permissions`, 408, 429, network, timeout                              |                      | 1     | 0                    | no retry                                                                            |
| Apify returns the canaries despite the projection                                                  |                      |       |                      | nothing stored                                                                      |
| Request URL check                                                                                  |                      |       |                      | carries `fields=` and no token; the token is only in the header                     |
| No token                                                                                           |                      | 0     |                      | separate `*.unconfigured.test.ts`, or a hoisted toggle as at `audits.test.ts:54-66` |
| Mode read fails, row missing, or value off the list                                                | 0                    | 0     | 0                    | per the decision                                                                    |
| FR-005 gate on Apify data                                                                          |                      |       |                      | depends on the gap                                                                  |

- The log-privacy `SCENARIOS` (`offers.test.ts:1152`, `offer-refetch.test.ts:1002`) gain
  Apify rows.

**Smoke.** `scripts/smoke.mjs` never reaches otodom (:1-11, :103-107), and the same must
hold for Apify. Steps for the mode table, modelled on `criteria_revision` (:1153-1162,
:1766-1776) and `audit_settings` (:1179-1191, :2032-2050):

1. anon select returns 0 rows;
2. a member select returns 1 row;
3. a member PATCH reaches 0 rows inside `withSnapshot` and leaves the row `same`;
4. an anon PATCH reaches 0 rows and leaves the row `same`;
5. a member POST gets 403/42501;
6. a member DELETE reaches 0 rows;
7. a page attribute is checked, if the mode is shown.

The mode read has to sit **after** the session check and URL validation in both routes.
Otherwise the existing smoke requests, which are refused before the network, start
touching it.

`ci.yml`'s `smoke` job gets no `APIFY_TOKEN`.

### 9. Rules and docs to change

**CLAUDE.md:34**, the Workers bullet, quoted verbatim:

> "…the fallback is still not a parser inside the Worker: it is a third-party extraction
> service the Worker calls with one `fetch`, replacing the otodom scraper rather than
> sitting beside it. `@context/foundation/ingestion/otodom_apify.md` is the verified path
> for that, request shape and failure modes included; adopting it is a decision to raise
> with the user."

It changes to "beside, selected by `public.ingestion_settings`", and the decision it asks
for is recorded as taken (2026-10-17).

**Other CLAUDE.md lines:**

- **CLAUDE.md:27**, the seller bullet. Its `raw`-as-a-whitelist-of-`ad`-keys wording gains
  the Apify counterpart: the projection, plus the whitelist of Apify keys.
- **CLAUDE.md:25**, the "six places". Either it gains `APIFY_TOKEN`, or the token gets its
  own five-place statement with no CI. A paid-call rule for Apify, analogous to "Nothing
  reaches the model provider on its own", should be added for tests and smoke.
- **CLAUDE.md:31** mentions the trigger conditions for the Apify fallback in the runbook.
- New Structure and Testing bullets name the references: the mapper, the fixture, the mode
  table and the smoke steps.

**Roadmap:**

- `context/foundation/roadmap.md:264` is the Parked entry, quoted verbatim:

  > "**Extraction-service fallback for ingestion (Apify)** — Why parked: the direct path
  > was verified end to end from Cloudflare's egress on 2026-09-20, so a second vendor
  > and a second secret buy nothing today. Trigger to revisit: otodom.pl answering the
  > Worker's egress with 403/429…"

- Related: :107 (S-02 unknowns) and :246 (Open Question 4, resolved as "not adopted now").
  Both need a note recording the 2026-10-17 decision.

**PRD:**

- FR-004 (l.82), FR-005 (l.84) and FR-009 (l.92) need no change of wording.
- The NFRs:
  - l.118: explicit fetch failure, no blank offer.
  - l.123: roughly one minute.
  - l.124: the extraction service is already allowed as a third party.
  - l.125: the extraction service passes personal data through, and it is discarded at the
    fetch.
- **Access Control l.146**, "Roles: flat … no restricted destructive actions": a setting
  that no member can change is new ground. The PRD gains a line saying who sets the
  ingestion mode. The owner holds a database role, not a product role.
- Non-Goals l.155, "every fetch… is a deliberate manual action": a fallback inside the
  same member action stays within it, and the wording is worth a check.

**Runbook:** `context/foundation/deployment-runbook.md:183-301`, "Ingestion starts failing
(otodom)". :288-301 describes adopting Apify as a decision with three cautions, and says
"a second secret in six places". It gains:

- the mode switch as the operational lever (direct-only as the kill switch);
- Apify's own failure signatures;
- the token rotation.

**Ingestion docs:**

- `otodom_fetching.md:639-641` and `:733`. The verification-table row is stale: it says
  the Cloudflare egress check was "Not verified", but §9.1 says it was verified on
  2026-09-20.
- `ingestion/README.md:10-11`: "the MVP's only source".
- `infrastructure.md:241` and `test-plan.md:48,70,185-188,867` mention the fallback. The
  test plan already prescribes the canary test.

**Code reviewer:** `packages/code-reviewer/src/prompts/system.ts`.

- **Automatic fails:**
  - :32: seller data, and `raw` built from a whitelist;
  - :35: not a flat sale;
  - :37: a paid provider request, model provider only. It extends to Apify.
- **Correctness:** :45-46 has the gate "na `ad.adCategory`" and `numericOrUnknown`. It
  gains the Apify mapper's gate.
- **Idiomaticity:** :85 (one `RegExp`), and :89, "równoległy mechanizm obok istniejącego"
  ("a parallel mechanism beside an existing one"). A fallback beside the scraper would be
  marked down by :89 unless the criterion names it as sanctioned.
- **Zero-config:** :61.
- **Tests:** :96, :101, :109.
- The one eval fixture, `packages/code-reviewer/evals/fixtures/react19-migration.diff`, has
  no ingestion content. The baseline is at `evals/README.md:44-54`.
- **Changing `system.ts` requires the user to run the paid eval.** The agent runs only
  `npm run preflight`. That is a **Manual** row.

### 10. Apify Console: setup steps

The steps are marked VERIFIED or UNVERIFIED against public docs as of 2026-10-17. Nothing
was clicked or called.

**(a) Account:**

1. Open https://console.apify.com/sign-up. (VERIFIED, docs.apify.com/platform/console)
2. Sign up with email and password (8+ characters, not the email; click **Sign up**, then
   verify by mail; **Resend verification email** exists), or **Continue with Google**, or
   **Continue with GitHub**. (VERIFIED)
3. The Free plan needs no card and includes **$5 of usage per month**. It does not roll
   over. When it runs out, the platform is blocked until the next cycle. (VERIFIED,
   apify.com/pricing)

**(b) The actor:**

1. https://apify.com/trev0n/otodom-scraper is reachable, titled "Otodom.pl Scraper |
   2$/1k". (VERIFIED)
2. Pricing reads **pay per event, "$2.00 / 1,000 results"**. (VERIFIED)
3. The ID `ir34sMIv8mrbL0ojO` appears in the Store page's OpenAPI link, unlabelled.
   (VERIFIED that the string is present)
4. In Console, clicking the Actor title opens the name and ID dialog. (UNVERIFIED for a
   Store actor that is not your own)
5. As an alternative, a run's Output tab has an **API** button that shows endpoints
   containing the ID. (VERIFIED, but it requires a run, which is paid)
6. `otodom_apify.md:422` records the ID as verified on 2026-09-19.

**(c) Scoped token:**

1. Go to Console → **Settings** → **API & Integrations**. (The page name is VERIFIED; the
   URL `/settings/integrations` is UNVERIFIED.)
2. Click the create button. (The label "+ Create new token" is UNVERIFIED.)
3. Give the token a description. (VERIFIED)
4. Set an expiration date. (VERIFIED: the docs offer it; rotation keeps the old token
   valid for 24 h.)
5. Turn on **Limit token permissions**. (VERIFIED)
6. Under **Resource-specific permissions**, add the Actor `ir34sMIv8mrbL0ojO` and grant
   **Run**. (Run is VERIFIED; the add-by-ID control is UNVERIFIED; the form rejects
   `trev0n/otodom-scraper` per `otodom_apify.md` §3.1, which was verified live.)
7. Set **Actor execution: Full access**. Both options exist in the docs (VERIFIED).
   - The web worker suggested Restricted.
   - `otodom_apify.md` §3.1, **verified live on 2026-09-19**, says Restricted made the
     actor fail with `insufficient permissions`.
   - Keep **Full access**.
8. Turn the default run storages toggle **ON**. Its caption reads "Configure whether the
   trigger token gets write access to the run default storages" (VERIFIED). It is
   mandatory for `run-sync-get-dataset-items` (§3.1).
9. Save. (The label is UNVERIFIED.)

**(d) Spending limit:**

1. Go to Console → **Billing** → **Limits**. "You can adjust the platform usage limits".
   Over the limit, "Apify platform services will be suspended". (VERIFIED,
   docs.apify.com/platform/console/billing)
2. The labels "Edit limit" and "Custom usage limit" are UNVERIFIED. Whether the Free plan
   can set a custom limit is UNVERIFIED. Free is hard-capped at $5 anyway (VERIFIED).
3. The API equivalent is `PUT /v2/users/me/limits` `{maxMonthlyUsageUsd}`. (VERIFIED)
4. Per run, `maxTotalChargeUsd` goes in the request. (VERIFIED)

**(e) Where the token goes:**

1. `.env` and `.dev.vars`, local. If `.dev.vars` exists, Wrangler ignores `.env` for
   workerd.
2. `npx wrangler secret put APIFY_TOKEN` for the production Worker. It "creates a new
   version of the Worker and deploys it immediately". With gradual deployments use
   `wrangler versions secret put` instead
   (https://developers.cloudflare.com/workers/configuration/secrets/, VERIFIED).
3. Not GitHub secrets and not CI (§5).

## Code References

- `src/lib/otodom/index.ts:35-46`: `ingestOffer`, the seam.
- `src/lib/otodom/fetch.ts:133-222`: the direct fetch and its taxonomy. The comment at
  :173-174 names "the Apify fallback trigger".
- `src/lib/otodom/map.ts:215-309`: the mapper. The gate is at :220-234, `numericOrUnknown`
  at :74-86 and `buildRaw` at :156-161.
- `src/lib/otodom/failure.ts:15-155`: messages, outcomes and `fetchFields`.
- `src/lib/otodom/types.ts:69-108`: `OfferInsert`.
- `src/pages/api/offers.ts:91` and `src/pages/api/offer-refetch.ts:148`: the shared 45 s
  signal.
- `src/lib/offer-refetch.ts:23-25`: `lostFacts`.
- `src/lib/audit/input.ts:45-71`, :90-100, :345-351: the audit columns, `DECISION_CRITICAL`
  and the fingerprint.
- `src/lib/audit/settings.ts:33-38`, :115-147: refuse on a failed read.
- `src/lib/config-status.ts:19-37` and `astro.config.mjs:21`: zero-config.
- `src/lib/log.ts:9-80`: the log whitelist.
- `supabase/migrations/20260927144141_create_team_criteria.sql:340-351`: the read-only
  table precedent.
- `supabase/migrations/20261007073258_create_audit_settings.sql:18-41`, :86-88: the
  singleton, and the trigger not to copy.
- `tests/fixtures/http.ts:53-86`, `tests/fixtures/anthropic.ts:49-68`: stubs and the
  paid-provider fixture pattern.
- `tests/pages/api/offer-refetch.test.ts:1020-1032`: the cross-file request guard.
- `scripts/smoke.mjs:1146-1191`, :1766-1776, :2032-2050: singleton RLS steps.
- `packages/code-reviewer/src/prompts/system.ts:32-37`, :45-46, :61, :85-89, :96-109: the
  criteria.

## Architecture Insights

- The ingestion module was built with this fallback in mind:
  - the `challenged`/`http_denied` vs `upstream_error` split exists "so an outage is never
    read as a blocked egress (the Apify fallback trigger)" (`fetch.ts:173-174`);
  - the test plan pre-specified the Apify canary fixture (`test-plan.md:183-188`).
- `OfferInsert` is the right contract boundary, and source-neutrality ends there.
  Guardrails live in the per-source mapper, so each source must re-earn them. The gate
  cannot be "inherited".
- The project's rule for missing data is "unknown, never a fabricated fact". A second,
  lower-fidelity source creates a new kind of unknown, "not fetched", that the product has
  no way to express yet. The lost-facts rule and the audit's missing-information findings
  both treat it as "the listing does not state it".

## Historical Context (from prior changes)

- `context/archive/2026-10-06-otodom-fetch-sub-reasons/` split the fetch reasons so a block
  is recognisable apart from a page change and an outage. That split is the trigger set
  for this change.
- `context/archive/2026-10-09-refetch-and-stale-audit/` introduced lost facts and the
  fingerprint. These are the mechanisms a source switch interacts with.
- `context/foundation/roadmap.md:246`: the user decided on 2026-09-22 not to adopt the
  fallback, and parked it at :264. `change.md` records the user's decision of 2026-10-17
  to adopt it.
- `context/foundation/test-plan.md:867`: "The next writers of offer data (re-fetch FR-009,
  extraction-service fallback) get their canary tests when they are built, per §6.1."

## Related Research

- No prior `research.md` exists for these. The plans are the record:
  `context/archive/2026-10-06-otodom-fetch-sub-reasons/plan.md` (sub-reasons) and
  `context/archive/2026-10-09-refetch-and-stale-audit/plan.md` (re-fetch and freshness).

## Open Questions (decisions for the user)

1. **The paid schema capture first?** Should the plan open with a Manual row in which you
   run the actor on three or four listings (flat sale, flat rental, house sale, rent
   `"0"`)? That capture becomes the basis for a synthetic fixture and settles the FR-005
   discriminator. Without it the Apify mapper can only refuse.
2. **The default mode** seeded by the migration: `direct_with_fallback`, or `direct_only`
   until the token is in place?
3. **Fallback triggers.** The recommended set is `challenged`, `http_denied` (403/429 and
   off-otodom), `data_missing`, fetch-stage `shape_changed`, `timeout` and `network`.
   Undecided:
   - the other 4xx;
   - `unexpected_landing` elsewhere;
   - map-stage `shape_changed`.
4. **A failed mode read** (error, missing row, value off the list). Options:
   - refuse the fetch, as the audit does with its settings;
   - fall back to `direct_only`, which is free and safe, so the member can still add an
     offer.
5. **`apify_only` without a token.** Degrade to direct, or refuse?
6. **Source switch on re-fetch.** Keep the stored values for columns Apify cannot supply,
   add a `source` column, or accept the lost-facts prompt and the audit going stale?
   Related: should an Apify-saved row's undocumented columns be excluded from the audit's
   missing-information findings?
7. **Deadlines.** Split the ~60 s budget, for example direct 15–20 s and Apify ~40 s.
   This changes the "45 sekund" member text.
8. **How to report an empty Apify result** (sentinel or `_warning` only): as `not_found`,
   or as a new reason?
9. **Show the active mode in the UI?** For example, a read-only section on `/criteria` with
   `data-ingestion-settings-state`. Whether the visual gate runs is a separate question.
10. **`maxTotalChargeUsd` per run** (the doc uses $0.05), and the Apify monthly limit.
11. **The PRD line on who sets the mode,** given flat roles (Access Control l.146).
12. **APIFY_TOKEN out of CI.** Confirm, so the "six places" texts become "five, never CI".
