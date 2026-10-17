---
date: 2026-10-17
topic: "Paid Apify spike: trev0n/otodom-scraper vs apify/cheerio-scraper with our own pageFunction"
status: done
supersedes: "research.md — Blocking evidence gap, §3 (Apify output vs OfferInsert), Open Questions 1, 6, 8"
---

# Spike: which Apify route can feed the fallback

Run by the agent on 2026-10-17 with the user's explicit go-ahead (budget: 30 requests, under the
Free plan's $5/month). 16 requests to `api.apify.com` were made: 12 paid actor runs (6 of each
actor), 2 runs refused by Apify before starting (not billed), 1 refused metadata read, 1 public
metadata read.
otodom.pl was also fetched directly (free) to compare. Raw outputs stayed in the agent's scratchpad
and are not in the repository: they are third-party listings. No offer URL is recorded here.

## Verdict

**Use `apify/cheerio-scraper` (actor ID `YrQuEkowkNCLdk4j2`) with our own `pageFunction`, through
the `RESIDENTIAL` proxy group in `PL`. Do not use `trev0n/otodom-scraper`.**

The `pageFunction` returns otodom's own `props.pageProps.ad`, narrowed to a whitelist inside Apify,
plus the HTTP status and the landed URL. The Worker therefore receives the same `ad` the direct path
gets and runs it through the existing `mapAdToOffer` and the existing failure taxonomy unchanged.

## Findings

### `trev0n/otodom-scraper` — rejected

- 6 runs (4 expired listings, 2 live). 45 keys, the same set on a flat sale, a flat rental and a
  house sale. **No key carries the transaction or the property type**, so the FR-005 gate has no
  input (otodom's `adCategory` is not passed on).
- **An expired listing comes back as a success**: HTTP 201, one item with a truthy `id`, price and
  area, and `description: "***"`, `street: "***"`, one image, null coordinates. otodom itself masks
  an expired listing this way (direct fetch: HTTP 410, same `***`). The September filter "a real
  item has a truthy `id`" does not catch it, so the fallback would save an expired, gutted offer —
  the PRD's "never a blank or partial offer" broken.
- On live listings the data is complete (description length, image count, coordinates equal to the
  direct fetch), enum tokens are otodom's raw tokens, an absent rent is `null`.
- The actor changed since the 2026-09-19 verification: the `noResults` sentinel record is gone, and
  `agencyId` (the advertiser's account id) was added.
- `abotapi/otodom-pl-scraper` and `dadhalfdev/otodom-scraper` were read (README only, no run): both
  take search-result URLs, not a single offer page, and have single-digit monthly users.

### `apify/cheerio-scraper` + our `pageFunction` — adopted

| Case              | Proxy                | Result                                                                                                                                                                   |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live flat sale    | datacenter (default) | 201, 9.0 s; `ad` with `adCategory {FLAT, SELL}`, `target {sprzedaz, mieszkanie}`, 14 images with `thumbnail/small/medium/large`, 12 characteristics, street, coordinates |
| Live flat rental  | datacenter           | 201, 3.6 s; `adCategory {FLAT, RENT}` — the existing gate refuses it as `not_for_sale`                                                                                   |
| Expired listing   | datacenter           | 201 with one `#error` item: "Request blocked - received 403 status code", after 1 retry. No `ad`                                                                         |
| Expired listing   | `RESIDENTIAL`, `PL`  | 201, 5.8 s; `status: 410` reaches the `pageFunction` — the existing taxonomy reads it as `not_found`                                                                     |
| Live flat sale ×2 | `RESIDENTIAL`, `PL`  | 201, 6.9 s and 5.4 s; `status: 200`, full `ad`                                                                                                                           |

- **Fidelity: identical.** For both live listings every whitelisted key of the returned `ad`
  (`id, url, title, description, characteristics, features, adCategory, images, createdAt,
modifiedAt, advertType, shouldShowExpiredAdPage`, `location.{coordinates, reverseGeocoding,
address}`, `target.{OfferType, ProperType}`) is JSON-equal to a direct fetch of the same page.
  Consequences: `listingFingerprint` does not move when the source changes, the lost-facts prompt
  does not fire on a source switch, and no "not fetched" kind of unknown appears. research.md's
  Open Question 6 and the separate-mapper design in its §3 fall away.
- **Personal data:** `owner`, `contactDetails` and `agency` are never copied by the `pageFunction`,
  so they do not leave Apify; none appeared in any item. `target` is narrowed to
  `OfferType`/`ProperType` inside Apify as well. The Worker still applies `mapAdToOffer`'s own
  whitelist — the second line of defence, and the one the canary test proves.
- **Datacenter proxies get 403 from otodom** (2 of 2 attempts on one listing), so the fallback —
  whose trigger is exactly otodom refusing a datacenter egress — must use `RESIDENTIAL` / `PL`.
- **Response size:** 20–30 KB of JSON per item, against 530–560 KB of HTML on a direct fetch.
- **The `pageFunction`'s `response`** exposes `status` and `headers`, not `statusCode`.
- **Errors arrive as HTTP 201** with an item `{"#error": true, "#debug": {errorMessages, retryCount}}`
  and no `ad`. That item must be read as a fetch failure (a block: `http_denied`), never as data.
  `#debug.errorMessages` contain stack traces and must not be logged.
- **Account approval:** cheerio-scraper runs user-supplied code, so Apify classes it as a
  full-permission actor. Before its first run the account owner must approve it once at
  `https://console.apify.com/actors/YrQuEkowkNCLdk4j2?approvePermissions=true`; until then every
  run answers 403 `full-permission-actor-not-approved`. Done by the user on 2026-10-17. The approval
  gives the run's injected token full account access while our `pageFunction` runs — which is why
  the `pageFunction` is a fixed string in the repository, reviewed like code, never built from input.
- **Token scope** used: Actor `ir34sMIv8mrbL0ojO` → Run (now unneeded) and Actor
  `YrQuEkowkNCLdk4j2` → Run. A scoped token cannot list runs (`insufficient-permissions`), so run
  logs and per-run cost are read in Console, not through the API.
- **Pricing model:** pay per platform usage (compute units + residential proxy traffic), not per
  result. Cost per run, read by the user in Console → Runs (the Usage column), 2026-10-17:
  datacenter $0.000–0.001 (the 403-blocked run also billed $0.001), `RESIDENTIAL`/`PL`
  $0.001–0.002, durations 2–8 s. Roughly $1–2 per 1,000 fallbacks, comparable to
  `trev0n/otodom-scraper`'s $2/1,000; `maxTotalChargeUsd=0.05` leaves a 25× margin. A failed
  run is billed too.
- **Not verified:** a Cloudflare challenge (`cf-mitigated`) seen through the proxy, a redirect to
  another offer or to `/wyniki` seen as `loadedUrl`, and the run-sync `timeout` behaviour.

## The `pageFunction` that was run

The starting point for the implementation (status read fixed as below):

```js
async function pageFunction(context) {
  const { $, request, response } = context;
  const KEEP = [
    "id",
    "url",
    "title",
    "description",
    "characteristics",
    "features",
    "adCategory",
    "images",
    "createdAt",
    "modifiedAt",
    "advertType",
    "shouldShowExpiredAdPage",
  ];
  const text = $("script#__NEXT_DATA__").first().text();
  let ad = null,
    pagePropsExpired = null,
    parseError = false;
  if (text) {
    try {
      const pp = JSON.parse(text)?.props?.pageProps ?? {};
      pagePropsExpired = pp.shouldShowExpiredAdPage ?? null;
      const src = pp.ad;
      if (src && typeof src === "object") {
        ad = {};
        for (const k of KEEP) if (k in src) ad[k] = src[k];
        if (src.location)
          ad.location = {
            coordinates: src.location.coordinates,
            reverseGeocoding: src.location.reverseGeocoding,
            address: src.location.address,
          };
        if (src.target) ad.target = { OfferType: src.target.OfferType, ProperType: src.target.ProperType };
      }
    } catch {
      parseError = true;
    }
  }
  return {
    requestedUrl: request.url,
    loadedUrl: request.loadedUrl,
    status: response?.status ?? null,
    markerPresent: Boolean(text),
    parseError,
    pagePropsExpired,
    ad,
  };
}
```

Request:

```
POST https://api.apify.com/v2/acts/apify~cheerio-scraper/run-sync-get-dataset-items
     ?maxTotalChargeUsd=0.05&timeout=120&memory=1024
Authorization: Bearer <APIFY_TOKEN>
{ "startUrls": [{ "url": "<normalised offer URL>" }], "pageFunction": "<the string above>",
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "apifyProxyCountry": "PL" },
  "maxRequestsPerCrawl": 1, "maxRequestRetries": 1, "maxConcurrency": 1 }
```

## What this changes for the plan

1. The Apify leg returns `{status, loadedUrl, markerPresent, parseError, pagePropsExpired, ad}`;
   a small adapter turns it into the same result `fetchOfferAd` returns, reusing the direct path's
   taxonomy (410/404 → `not_found`, `shouldShowExpiredAdPage` → `expired`, missing marker →
   `data_missing`, …), and `mapAdToOffer` runs unchanged on the `ad`.
2. New Apify-side failures to classify: the `#error` item (block), HTTP 401/403 with
   `error.type` (`user-or-token-not-found`, `insufficient-permissions`,
   `full-permission-actor-not-approved`), 402/429 (credit or rate), 408 (run timeout), an empty
   array, a network error or the client deadline.
3. The fallback triggers stay as research §2 proposes, minus nothing: since the Apify leg now reads
   the same page, a `data_missing` / `shape_changed` direct result would most likely repeat through
   Apify — still worth weighing against the cost of one run.
4. CLAUDE.md, `otodom_apify.md` (§2 actor, §4 request, §5 bugs, §6 schema, §7 cost, §10 log) and
   the runbook move from `trev0n/otodom-scraper` to this route.
5. The token's manual prerequisites gain two steps: Run on `YrQuEkowkNCLdk4j2`, and the one-time
   full-permission approval.
