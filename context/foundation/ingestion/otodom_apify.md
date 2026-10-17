# Fetching Otodom offers through Apify

Companion to `otodom_fetching.md`. That document describes talking to Otodom
directly. This one describes the route Vetpad uses beside it: one run of Apify's
generic `apify/cheerio-scraper`, with our own `pageFunction`, called as an HTTP API
from the Worker. It is the fallback the user adopted on 2026-10-17 (change
`otodom-apify-fallback`), and it is code in the repository, not a recipe:

- `src/lib/otodom/apify-request.ts` — the actor, the run's parameters, the whitelists,
  the `pageFunction`, the request (`buildApifyRequest`) and the reading of the answer
  (`readApifyAnswer`);
- `src/lib/otodom/apify.ts` — the token and the one request (`createApifyLeg`);
- `src/lib/otodom/index.ts` — when a run follows a direct fetch (`FALLBACK_TRIGGERS`)
  and which reason the member reads (`chooseOutcome`);
- `src/lib/ingestion-settings.ts` and `public.ingestion_settings` — the mode.

Everything marked **verified** was executed live: the actor comparison in the paid
spike of 2026-10-17 (`context/changes/otodom-apify-fallback/spike-apify.md`), and the
committed request module in that change's Phase 3
(`context/changes/otodom-apify-fallback/live-verification.md`). Section 10 is the log.
Everything marked **unverified** is Apify's documentation or a plausible name nobody
has seen yet.

---

## 1. When this route runs

The ingestion mode — the one row of `public.ingestion_settings`, changed only by the
owner in Supabase Studio — decides:

| `mode`                          | What runs                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direct_with_fallback` (seeded) | The direct fetch (`otodom_fetching.md` 7.1) with a 20 s deadline; after `challenged`, `http_denied`, `timeout`, `network` or `data_missing`, one Apify run |
| `apify_only`                    | One Apify run and no request of our own to otodom                                                                                                          |
| `direct_only`                   | The direct fetch alone, with the whole 60 s — the kill switch                                                                                              |

Without `APIFY_TOKEN`, or when the row cannot be read, every mode runs as
`direct_only`. The deadlines and their order are in `src/lib/otodom/deadlines.ts`.

No run follows a listing that is gone (`not_found`, `expired`), an outage of the
portal (`upstream_error`), a landing nobody has seen (`unexpected_landing`) or a
changed page (`shape_changed`): Apify reads the same page and would only pay to learn
the same. A refused address, or a listing the FR-005 gate refuses, never reaches the
fetch at all.

### 1.1 What Apify is and is not

Apify is **not** an Otodom API and has no relationship with Otodom. It is a platform
that runs crawlers, ours included. Choosing it does not improve the legal position:
the same offer page is requested, from a residential IP instead of Cloudflare's.
Vetpad still requests only `/pl/oferta/…` pages, which `robots.txt` allows
(`otodom_fetching.md` section 1), one page per run.

---

## 2. Actor selection — verified 2026-10-17

|               |                                                                        |
| ------------- | ---------------------------------------------------------------------- |
| Actor         | `apify/cheerio-scraper` (maintained by Apify)                          |
| Actor ID      | `YrQuEkowkNCLdk4j2` (`APIFY_ACTOR_ID`)                                 |
| What it does  | fetches each start URL and runs our `pageFunction` on it, with Cheerio |
| Pricing model | platform usage (compute units plus proxy traffic), not per result      |

The `pageFunction` returns otodom's own `props.pageProps.ad`, narrowed inside Apify,
together with the HTTP status and the landed URL. The Worker therefore receives the
same `ad` the direct path gets, and runs the same classifier
(`classifyAnswer`/`classifyPayload` in `src/lib/otodom/fetch.ts`) and the same
`mapAdToOffer` on it. There is no second mapper.

### 2.1 Rejected: `trev0n/otodom-scraper`

Verified on 2026-09-19 and again in the 2026-10-17 spike, and rejected:

- **No key carries the transaction or the property type** (otodom's `adCategory` is
  not passed on), so the FR-005 flat-sale gate has no input.
- **An expired listing comes back as a success**: HTTP 201, one item with a truthy
  `id`, a price and an area, and `"***"` in the description and the street — otodom
  masks an expired listing that way. A filter on a truthy `id` does not catch it, so
  the fallback would save a gutted offer, which the PRD forbids.
- A missing offer also came back as HTTP 201 with the 404 page's title (2026-09-19),
  and the output changed between the two verifications (a sentinel record gone, the
  advertiser's account id added). One maintainer, one version, no reviews.
- It returns `sellerPhone` and `agencyName` — a private seller's phone and name — with
  no input flag to suppress them.

`abotapi/otodom-pl-scraper` and `dadhalfdev/otodom-scraper` were read (README only):
both take search-result URLs, not a single offer page.

---

## 3. Authentication, token scope and the one-time approval — verified

Token page: Apify Console → **Settings → API & Integrations**. The token travels in
the header only, never in the query string, which ends up in logs:

```
Authorization: Bearer apify_api_...
```

The production token is scoped (**Limit token permissions** on):

- **Resource-specific permissions → Actor** `YrQuEkowkNCLdk4j2`, permission **Run**.
  The form wants the technical ID, not `apify/cheerio-scraper`.
- **Actor execution: Full access.** It governs the short-lived token Apify injects
  _into_ the run, not ours. Under _Restricted access_ the actor fails with
  `insufficient permissions`.
- **Default run storages access: ON.** `run-sync-get-dataset-items` reads the dataset
  the run produced.

A scoped token cannot list runs or read `GET /v2/users/me` (`insufficient-permissions`);
that is not a broken token. Run logs and per-run cost are read in Console → **Runs**.

**The one-time full-permission approval.** cheerio-scraper runs user-supplied code,
so Apify classes it as a full-permission actor. Before its first run the account
owner approves it once at
`https://console.apify.com/actors/YrQuEkowkNCLdk4j2?approvePermissions=true`; until
then every run answers 403 `full-permission-actor-not-approved`. The approval gives
the run's injected token full account access while our `pageFunction` runs — which is
why the `pageFunction` is a fixed string in the repository, reviewed like code and
never built from input. Done by the user on 2026-10-17.

Diagnostics for a token that does not work, by `error.type` (the message is never
read, see section 9):

| Situation                           | HTTP    | `error.type`                         |
| ----------------------------------- | ------- | ------------------------------------ |
| Malformed, unknown or revoked token | 401     | `user-or-token-not-found`            |
| No token supplied                   | 401     | `token-not-provided`                 |
| Valid token, insufficient scope     | **403** | **`insufficient-permissions`**       |
| Actor never approved                | 403     | `full-permission-actor-not-approved` |

---

## 4. The request — verified

`buildApifyRequest(normalizedUrl)` in `src/lib/otodom/apify-request.ts` is the one
definition; this is what it builds.

```
POST https://api.apify.com/v2/acts/YrQuEkowkNCLdk4j2/run-sync-get-dataset-items
     ?maxTotalChargeUsd=0.05&timeout=30&memory=1024
Authorization: Bearer <APIFY_TOKEN>
{ "startUrls": [{ "url": "<normalised offer URL>" }],
  "pageFunction": "<APIFY_PAGE_FUNCTION>",
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "apifyProxyCountry": "PL" },
  "maxRequestsPerCrawl": 1, "maxRequestRetries": 1, "maxConcurrency": 1 }
```

- The start URL is the only part that varies, and it is always the output of
  `normalizeOfferUrl`.
- `maxTotalChargeUsd=0.05` caps one run's cost — a 25× margin over the observed
  cost (section 7).
- `timeout=30` (`APIFY_RUN_TIMEOUT_S`) makes Apify end the run, and answer, before the
  Worker stops waiting after 40 s (`APIFY_CLIENT_DEADLINE_MS`).
- `run-sync-get-dataset-items` returns no run id, so none is logged.
- The Worker makes exactly one request per run and never retries it; a member's retry
  is a new deliberate action.

### 4.1 The `pageFunction`

`APIFY_PAGE_FUNCTION` is assembled once, at module load, from the exported lists
`APIFY_AD_KEYS`, `APIFY_LOCATION_KEYS` and `APIFY_TARGET_KEYS` — one whitelist, not a
list in code plus a copy in a string. It:

- reads `script#__NEXT_DATA__`, parses it and takes `props.pageProps.ad`;
- copies only the whitelisted keys of `ad`, of `ad.location` and of `ad.target`;
- returns `{requestedUrl, loadedUrl, status, markerPresent, parseError,
pagePropsPresent, pagePropsExpired, ad}`. The status is `response.status` — the
  crawler's `response` has `status` and `headers`, not `statusCode` (verified).
  `pagePropsPresent` keeps a missing `pageProps` apart from a missing ad.

The spike's first version turned a missing `pageProps` into "no ad" and accepted an
array as an object; the committed version fixes both, and the Worker checks every
field anyway (section 5).

---

## 5. Reading the answer — verified

`readApifyAnswer(httpStatus, json, requestedUrl)` is pure and reads the answer only
through `isRecord` and type checks. Then the item goes through the same
`classifyAnswer` and `classifyPayload` as a direct fetch.

| Answer                                                                                 | Reading                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| non-2xx                                                                                | `apifyFailure: "http"`, `apifyStatus`, and `error.type` when it is a token; `error.message` never read |
| 201 with `[]`                                                                          | `empty_dataset`                                                                                        |
| 201 with an item `{"#error": true, "#debug": {…}}`                                     | `run_error`: Apify reached otodom and could not read the page — read as `http_denied`, no status       |
| 201 with more than one item, a field of the wrong type, or an item for another address | `malformed_item`                                                                                       |
| 201 with one well-formed item                                                          | the item's `status`, `loadedUrl`, marker and `ad` classified exactly like a direct fetch               |

- **Errors arrive as HTTP 201.** An `#error` item carries no `ad`, and its
  `#debug.errorMessages` hold stack traces: it is a fetch failure, never data, and
  `#debug` is never read into a result or a log.
- **Datacenter proxies get 403 from otodom** (2 of 2 attempts in the spike, as
  `#error` items after one retry). The fallback's trigger is exactly otodom refusing
  a datacenter egress, so the run uses `RESIDENTIAL` in `PL`, through which an expired
  listing's 410 reaches the `pageFunction` intact.
- **A run that exceeds its `timeout=`** answers 400 `run-failed`, not 408 and not an
  empty dataset (observed 2026-10-17). It is an Apify failure that did not reach
  otodom.
- An Apify leg that did not reach otodom leaves the direct reason to the member; in
  `apify_only`, with no direct reason, the member reads `extraction_failed`
  (`chooseOutcome` in `src/lib/otodom/index.ts`). A page without `__NEXT_DATA__` on
  both legs keeps `data_missing` with `detail: "both_sources"`.

---

## 6. Output and fidelity — verified

For two live listings (spike) and one more (Phase 3), every whitelisted key of the
returned `ad` — `id, url, title, description, characteristics, features, adCategory,
images, createdAt, modifiedAt, advertType, shouldShowExpiredAdPage`,
`location.{coordinates, reverseGeocoding, address}`, `target.{OfferType, ProperType}`
— is JSON-equal to a direct fetch of the same page, and the two `OfferInsert`s
`mapAdToOffer` makes from them are deep-equal. Consequences:

- `listingFingerprint` does not move when the source changes, so an audit is not
  flagged stale by a switch of the leg;
- the lost-facts prompt of a re-fetch (FR-009) does not fire on a source switch;
- no "not fetched" kind of unknown appears.

The item is 20–30 KB of JSON, against 530–560 KB of HTML on a direct fetch, so the
Worker's CPU stays far below the direct path's.

### 6.1 Personal data

The `pageFunction` never copies `owner`, `contactDetails` or `agency`, and narrows
`target` to `OfferType`/`ProperType`, so the advertiser's phone, name and account id
do not leave Apify; none appeared in any item, live or in the spike. `mapAdToOffer`'s
own whitelist stays the second line of defence. `tests/fixtures/apify.ts` builds its
items with the seller's data still in them, so the canary tests prove that second
line on its own (`@CLAUDE.md`, Secrets and data access).

---

## 7. Cost and latency — verified

|                           |                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------- |
| Latency per run           | 2–9 s (`RESIDENTIAL`/`PL`: 5.4–6.9 s in the spike)                                |
| Cost per run              | `RESIDENTIAL`/`PL` $0.001–0.002; datacenter $0.000–0.001 (Console → Runs → Usage) |
| A failed run              | billed too (a 403-blocked datacenter run billed $0.001)                           |
| A run past its `timeout=` | 400 `run-failed`; the 1 s run in Phase 3 was TIMED-OUT, $0.000                    |
| Per 1,000 fallbacks       | roughly $1–2                                                                      |
| Free plan                 | $5 of usage per month, no rollover; the platform is suspended once it is spent    |

Container startup dominates the latency. Do not expect the ~0.6 s of a direct
request: a fallback adds 5–9 s to the member's wait. Set a monthly usage limit in
Console → Billing → Limits.

---

## 8. Calling this from Cloudflare Workers

The call is an ordinary HTTPS POST to `api.apify.com`. Waiting on `fetch()` costs no
CPU time and HTTP-triggered Workers have no wall-time cap, so the synchronous endpoint
fits one member's request; no async run, webhook or run id is used.

The token is a secret and follows the zero-config pattern (`@CLAUDE.md`): five places
— the `astro.config.mjs` schema, `.env`, `.dev.vars`, `.env.example` and Workers
Secrets — and never CI.

```bash
npx wrangler secret put APIFY_TOKEN
```

---

## 9. Failure modes

| Symptom                                      | Cause                                                    | Action                                                                                                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` `user-or-token-not-found`              | Token wrong, expired or deleted                          | Re-issue (rotation: `deployment-runbook.md`, "Ingestion starts failing")                                                                                                                                        |
| `401` `token-not-provided`                   | Header missing                                           | Fix the request                                                                                                                                                                                                 |
| `403` `insufficient-permissions`             | Token valid, scope too narrow                            | Section 3. Not a typo.                                                                                                                                                                                          |
| `403` `full-permission-actor-not-approved`   | The one-time approval was never given                    | Section 3, the approval URL                                                                                                                                                                                     |
| `402`                                        | Usage spent or the account's limit reached               | Raise the limit or wait for the next cycle; `direct_only` meanwhile                                                                                                                                             |
| `400` `run-failed`                           | Run exceeded its `timeout=`                              | Observed 2026-10-17 on `apify/cheerio-scraper` with `timeout=1`: Console status TIMED-OUT, 0 results, $0.000 (`otodom-apify-fallback/live-verification.md`). Read as an Apify failure that did not reach otodom |
| `400` `run-failed`, Console status FAILED    | The actor or the `pageFunction` broke                    | Read the run's Log tab in Console. Billed                                                                                                                                                                       |
| `201` with an `#error` item                  | The crawler could not read the page (e.g. otodom's 403)  | `run_error`, read as `http_denied`. Check the proxy group is `RESIDENTIAL`                                                                                                                                      |
| `201` with `[]`                              | The run ended with no item                               | `empty_dataset`; the member reads the direct reason                                                                                                                                                             |
| `408`, `429` (unverified names)              | Apify-side timeout or rate limit                         | `apifyFailure: "http"` with the status; covered by fixtures only                                                                                                                                                |
| `data_missing` with `detail: "both_sources"` | The page has no `__NEXT_DATA__` on both legs: it changed | `direct_only` until the parser is fixed                                                                                                                                                                         |

Design so anything unexpected is a fetch failure, never data: an offer saved from a
half-read item is worse than a member told to try later.

---

## 10. Verification log

### 10.1 The spike, 2026-10-17

16 requests to `api.apify.com` with the user's go-ahead: 12 paid runs (6 of each
actor), 2 runs refused before starting, 2 metadata reads. Raw outputs stayed outside
the repository.

| Check                                                  | Result                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| trev0n, 4 expired + 2 live listings                    | no transaction/property type; an expired listing returned as a success |
| cheerio-scraper, live flat sale, datacenter            | 201, 9.0 s, full `ad`                                                  |
| cheerio-scraper, live flat rental, datacenter          | 201, 3.6 s, `adCategory {FLAT, RENT}` → refused as `not_for_sale`      |
| cheerio-scraper, expired listing, datacenter           | 201 with an `#error` item (403 from otodom, after 1 retry)             |
| cheerio-scraper, expired listing, `RESIDENTIAL`/`PL`   | 201, 5.8 s, `status: 410` → `not_found`                                |
| cheerio-scraper, live flat sale ×2, `RESIDENTIAL`/`PL` | 201, 6.9 s and 5.4 s, full `ad`                                        |
| Whitelisted keys against a direct fetch                | JSON-equal on both live listings                                       |
| `owner`/`contactDetails`/`agency` in any item          | none                                                                   |
| First run before the approval                          | 403 `full-permission-actor-not-approved`                               |

### 10.2 The committed request module, 2026-10-17 (Phase 3)

Run through `scripts/apify-verify.mjs`, which enforced the budget, the 30 s pacing
between requests that may reach otodom and the record in
`context/changes/otodom-apify-fallback/live-calls.md` (Apify 6/15, otodom 1/15, no
block). Listings are named by their ID token only.

| Case            | Result                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid-token` | 401 `user-or-token-not-found` before a run started → `apifyFailure: "http"`                                                                                         |
| `sale`          | direct `ad` (62 keys) and Apify `ad` (14 keys) JSON-equal on every whitelisted key; no key outside the lists; `OfferInsert`s deep-equal                             |
| `rental`        | refused by the FR-005 gate as `not_for_sale`                                                                                                                        |
| `expired`       | 410 through Apify, same listing token → `not_found`                                                                                                                 |
| `redirect`      | an altered slug with the same ID token landed on the same listing → accepted                                                                                        |
| `run-timeout`   | `timeout=1`: 400 `run-failed` → `apifyFailure: "http"`, not reached otodom; Console: TIMED-OUT, $0.000 — pinned as `apifyRunTimeout()` in `tests/fixtures/apify.ts` |

**Not verified:** a Cloudflare challenge (`cf-mitigated`) seen through the proxy, a
redirect to another offer or to `/wyniki` seen as `loadedUrl`, a run that times out
_after_ otodom answered (covered by fixtures only), and the error type names of 402,
408 and 429.

### 10.3 History: `trev0n/otodom-scraper`, 2026-09-19

The first version of this document verified that actor end to end: `startUrls` must
be objects (strings give 400 `invalid-input`), one URL returned 2 items (a
`noResults` sentinel beside the real one), a nonexistent offer came back as 201 with
the 404 page's title, and `sellerPhone`/`agencyName` carried a private seller's phone
and name. Section 2.1 says why it was rejected.

A change to `src/lib/otodom/apify-request.ts` makes section 10.2 stale until it is
verified live again. Every such run is paid and is the user's deliberate action: the
authorisation of 2026-10-17 covered `otodom-apify-fallback` alone, so a new
verification needs a new go-ahead and a budget of its own (`@CLAUDE.md`, Paid model
calls and CI review).
