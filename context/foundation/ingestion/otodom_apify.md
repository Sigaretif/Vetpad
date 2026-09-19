# Fetching Otodom offers through Apify

Companion to `otodom_fetching.md`. That document describes talking to Otodom
directly. This one describes the third-party route: paying Apify to run a
community scraper and calling it as an HTTP API.

Everything marked **verified** was executed live on **2026-09-19** against the
production Apify API with a real token, and the output was diffed field by field
against Otodom's own `__NEXT_DATA__` for the same offer. Everything marked
**unverified** is the actor author's documentation, which was wrong twice in this
very session - see section 4.

---

## 1. When this route is the right choice

Use Apify when **any** of these is true:

- You are deploying to a runtime that cannot control its TLS stack, which makes
  direct scraping impossible for the target. Cloudflare Workers is exactly this
  case for OLX. See `otodom_fetching.md` section 9.1.
- Your egress IP is a datacenter range and the target blocks it.
- You do not want to own the maintenance of a scraper: `buildId` rotation,
  markup changes, redirect handling.

Do **not** use it when:

- You can reach the site directly and are willing to maintain ~15 lines of code.
  `otodom_fetching.md` section 7.1 is verified, faster (~0.6 s against ~8.5 s),
  and returns Otodom's full 62-field object rather than a 50-field projection.
- You need a hard, unambiguous error when an offer is gone. Apify reports a
  missing offer with **HTTP 201 and a fake result** (section 5).

### 1.1 What Apify is and is not

Apify is **not** an Otodom API and has no relationship with Otodom. It is a
marketplace hosting scrapers written by third parties. Choosing it does not
improve your legal position: you are paying someone else to send the same
requests. Otodom's terms of service do not distinguish which process issued them.

It is arguably slightly worse in one respect: advertiser phone numbers pass
through Apify's infrastructure before reaching you (section 6), which puts a
processor in your data chain that self-hosting avoids.

---

## 2. Actor selection

Over twenty Otodom actors exist in Apify Store; most have 2-8 users and look like
mass-generated listings. The one verified here:

|                        |                                        |
| ---------------------- | -------------------------------------- |
| Actor                  | `trev0n/otodom-scraper`                |
| Actor ID               | `ir34sMIv8mrbL0ojO`                    |
| Title                  | Otodom.pl Scraper \| 2$/1k             |
| Pricing model          | `PAY_PER_EVENT`, $2.00 / 1,000 results |
| Users / monthly active | 127 / 39                               |
| Reviews                | **none (0.0)**                         |
| Versions               | one (`1.0`)                            |

Selection criteria worth re-applying before trusting any replacement: it accepts
detail-page URLs, it was modified recently, it has a non-trivial monthly active
user count, and its pricing model is pay-per-event rather than rental. Rental
actors require a paid Apify plan after the trial; pay-per-event ones draw on the
free monthly credit.

**Abandonment is the expected failure mode.** One maintainer, one version, no
reviews. Keep the field mapping in section 6 so you can migrate to another actor
or to direct fetching without re-deriving it.

---

## 3. Authentication and token scope

Token page: `https://console.apify.com/settings/integrations`
(**Settings -> API & Integrations** in Apify Console).

Pass it in the header, not the query string; query parameters end up in logs:

```
Authorization: Bearer apify_api_...
```

### 3.1 Scoping, and the trap in it

Apify supports _scoped_ tokens via the **Limit token permissions** toggle. For
running a third-party Store actor the useful configuration is:

- **Resource-specific permissions -> Actor**, ID `ir34sMIv8mrbL0ojO`,
  permission **Run**. The form wants the technical ID; `trev0n/otodom-scraper`
  is not accepted there.
- **Actor execution: Full access.** Counter-intuitive but correct. This governs
  the short-lived token Apify injects _into_ the run, not yours. Under
  _Restricted access_ the actor may fail with `insufficient permissions` because
  it cannot reach its own default storages.
- **Default run storages access: ON.** Mandatory.
  `run-sync-get-dataset-items` reads the dataset the run produced; with this
  off, the call fails.

**Verified diagnostics for a token that does not work.** The error messages are
ambiguous, so distinguish them by `error.type`:

| Situation                       | HTTP    | `error.type`                   |
| ------------------------------- | ------- | ------------------------------ |
| Malformed / nonexistent token   | 401     | `user-or-token-not-found`      |
| No token supplied               | 401     | `token-not-provided`           |
| Valid token, insufficient scope | **403** | **`insufficient-permissions`** |

A 403 with `insufficient-permissions` means the token authenticates correctly and
the scope is wrong. Do not go looking for a typo in the token.

Note that a scoped token with only **Run** cannot read `GET /v2/users/me`; that
is a separate permission and its 403 is **not** a sign of a broken token. Test
scope by attempting the actual run, not by reading the profile.

If scoping fights you, disable **Limit token permissions**, run once, delete the
token. For the production token, scope it properly.

---

## 4. The request

```
POST https://api.apify.com/v2/acts/trev0n~otodom-scraper/run-sync-get-dataset-items
```

Note `acts` in the path (`actors` also works). Tilde separates owner and name.

### 4.1 `startUrls` takes objects, not strings - verified

The actor's README shows plain strings. **That is wrong.** Strings produce:

```json
{
  "error": {
    "type": "invalid-input",
    "message": "Input is not valid: Items in input.startUrls at positions [0] do not contain valid URLs"
  }
}
```

Correct body:

```json
{
  "startUrls": [{ "url": "https://www.otodom.pl/pl/oferta/kawalerka-przy-metrze-szwedzka-ID4Da0W" }],
  "extractDetails": true,
  "maxItems": 1
}
```

Verified: **HTTP 201**, 8.3 s, 6,648 bytes.

### 4.2 Useful query parameters

| Parameter                     | Why                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `maxTotalChargeUsd=0.05`      | Hard cost ceiling per run. Always set it.                                                |
| `timeout=<s>`                 | Caps the run itself.                                                                     |
| `fields=a,b,c`                | Server-side projection - a clean way to drop personal-data fields before they reach you. |
| `omit=sellerPhone,agencyName` | The inverse. See section 6.                                                              |

`maxItems` does **not** limit how many items come back. Per Apify's docs it
limits only what you are **charged** for on pay-per-result actors. Verified: with
`maxItems: 1` the response still contained 2 items (section 5).

### 4.3 Reference implementation

```python
import os
import requests

APIFY_TOKEN = os.environ['APIFY_TOKEN']
ACTOR = 'trev0n~otodom-scraper'
ENDPOINT = f'https://api.apify.com/v2/acts/{ACTOR}/run-sync-get-dataset-items'


def real_offers(items: list[dict]) -> list[dict]:
    """Drop the actor's junk records. See section 5 - this is not optional."""
    return [i for i in items
            if i.get('id') and not i.get('noResults') and not i.get('_warning')]


def fetch_offer_via_apify(url: str, timeout: int = 120) -> dict:
    r = requests.post(
        ENDPOINT,
        params={'maxTotalChargeUsd': '0.05'},
        headers={'Authorization': f'Bearer {APIFY_TOKEN}',
                 'Content-Type': 'application/json'},
        json={'startUrls': [{'url': url}],
              'extractDetails': True,
              'maxItems': 1},
        timeout=timeout,
    )
    r.raise_for_status()
    offers = real_offers(r.json())
    if not offers:
        raise LookupError(f'offer gone or unscrapable: {url}')
    return offers[0]
```

Set the client timeout well above the observed 8.5 s. Apify itself returns
**408** if the run exceeds **300 s**, so anything above that is pointless.

---

## 5. Two actor bugs you must handle - verified

### 5.1 A junk sentinel record accompanies every success

Requesting one detail URL returns **two** dataset items. The second:

```json
{
  "noResults": true,
  "source": "https://www.otodom.pl/pl/oferta/...-ID4Da0W",
  "url": "https://www.otodom.pl/pl/oferta/...-ID4Da0W",
  "reason": "No properties found - the requested URL/filters returned zero matches.",
  "error": null,
  "scrapedAt": "2026-09-19T19:52:41.581Z"
}
```

The actor scrapes the detail page correctly, then also applies its
"did the search yield results" check to the same URL. A detail page yields zero
_search_ results, so it appends this record. It has 6 keys against the real
record's 50.

Consequence: `data[0]` works only by accident of ordering, and iterating the
array feeds garbage into your pipeline. Always filter.

### 5.2 A missing offer is reported as success

A nonexistent offer URL returns **HTTP 201**, not an error:

```json
[
  {
    "title": "Strona błędu 404 | Otodom.pl",
    "propertyUrl": "https://www.otodom.pl/pl/oferta/nie-ma-takiej-oferty-ID0X0X0",
    "scrapedAt": "2026-09-19T19:54:01.457Z",
    "_warning": "Could not extract structured data - only basic info available"
  },
  { "noResults": true, "...": "as in 5.1" }
]
```

The actor swallows Otodom's 404 and hands you the error page's `<title>` as the
offer title. There is no `id`, no `price`.

This is a **regression against fetching Otodom directly**, where the same URL
raises a clean `HTTPError 404`. A hard failure becomes a soft one, which is the
classic way a cron job silently stops working.

Detection: an item is a real offer only if `id` is truthy. `_warning` present or
`noResults` true means failure. If `real_offers()` returns empty, treat it as
404: mark the offer inactive locally, do not retry in a loop.

---

## 6. Output schema and fidelity - verified

50 keys in detail mode. Field-by-field diff against Otodom's own payload for the
same offer, all **exact matches**:

| Apify field    | Otodom source                         | Value                  |
| -------------- | ------------------------------------- | ---------------------- |
| `id`           | `ad.id`                               | `68438633`             |
| `price`        | `characteristics.price`               | `450000`               |
| `rentPrice`    | `characteristics.rent`                | `470`                  |
| `area`         | `characteristics.m`                   | `25.3`                 |
| `rooms`        | `characteristics.rooms_num`           | `1`                    |
| `floor`        | `characteristics.floor_no`            | `floor_5`              |
| `buildYear`    | `characteristics.build_year`          | `1975`                 |
| `buildingType` | `characteristics.building_type`       | `block`                |
| `condition`    | `characteristics.construction_status` | `ready_to_use`         |
| `market`       | `ad.market` (lowercased)              | `secondary`            |
| `latitude`     | `location.coordinates.latitude`       | `52.265083`            |
| `dateCreated`  | `ad.createdAt`                        | `2026-09-19T18:25:16Z` |
| `dateModified` | `ad.modifiedAt`                       | `2026-09-19T18:30:19Z` |
| `description`  | `ad.description`                      | 701 chars, identical   |
| `images`       | `ad.images`                           | 12, identical count    |

**The actor passes Otodom's raw enum tokens through unchanged** (`floor_5`,
`block`, `ready_to_use`, `secondary`). It does not invent its own vocabulary.
This was the main risk with using a third-party scraper and it did not
materialise: no silent mapping layer to audit.

Fields observed `null` on this offer: `district`, `subdistrict`, `parkingType`,
`elevator`. Do not assume presence.

### 6.1 Personal data - act on this

For a listing whose `sellerType` is `private`, the response contained:

```
sellerPhone : '+48512228855'
agencyName  : 'Robert Krupa'
```

A private individual's phone number and full name, the latter in a field called
`agencyName`. There is no input flag to suppress them, and they traverse Apify's
servers before reaching you.

Mitigations, best first:

1. Server-side projection so they never reach your runtime:
   `?fields=id,title,price,area,rooms,floor,market,dateCreated,propertyUrl,mainImage`
2. Or `?omit=sellerPhone,sellerPhones,agencyName,agencyUrl,agencyLicenseNumber`
3. Strip them on receipt and never persist them.

In Vetpad mitigation 1 is the one to use, and none of this is optional: `@CLAUDE.md`
makes "the advertiser's phone number and name never reach the database" a rule, and
`@context/foundation/prd.md` states it as a product property under Non-Functional
Requirements. The projection keeps the data out of the Worker entirely, so there is
nothing to strip and nothing to leak.

See `otodom_fetching.md` section 1 for why. Note OLX is easier here: its
`contact.phone` is a boolean.

### 6.2 Fields to ignore

`isPromoted`, `isPremium`, `isExclusiveOffer` are presentation flags. `scrapedAt`
is the actor's clock, not Otodom's - never use it for freshness.

---

## 7. Cost and latency - verified

|                             |                                                   |
| --------------------------- | ------------------------------------------------- |
| Latency per run             | **8.3 s and 8.5 s** across two runs               |
| Charge                      | 1 result per run under `maxItems: 1`, i.e. $0.002 |
| Two-run test total          | ~$0.004                                           |
| Apify sync-endpoint ceiling | 300 s, then HTTP 408                              |

Container startup dominates the 8.5 s; the scrape itself is a fraction of it. Do
not expect the ~0.6 s of a direct request.

At one offer per day the monthly cost is ~$0.06, comfortably inside the free
plan's monthly credit. Pay-per-event actors, unlike rental ones, do not require a
paid plan.

---

## 8. Calling this from Cloudflare Workers

The call is an ordinary HTTPS POST to `api.apify.com`: no TLS tuning, no IP
reputation concern, nothing a Worker cannot do. Platform limits and the two hard
Workers constraints are tabulated in `otodom_fetching.md` section 9.1.

At 8.5 s per run, the synchronous endpoint fits a Cron Trigger with a very large
margin (15 min wall time, and `fetch()` waiting does not consume CPU time). The
asynchronous pattern below is therefore optional - worth adopting if you batch
many URLs per run, unnecessary for a handful.

Store the token as a secret, never as a plain var:

```bash
npx wrangler secret put APIFY_TOKEN
```

### 8.1 Optional: async plus webhook

Removes any timeout question entirely.

1. Cron Worker `POST`s to `/v2/acts/{actor}/runs` with the `webhooks` parameter
   (Base64-encoded JSON array) pointing at a second Worker route. Returns in
   ~200 ms.
2. Apify calls that route when the run finishes.
3. The receiving Worker reads the dataset and sends the digest.

Caveat from Apify's docs: a webhook created with a **scoped** token is dispatched
with a token carrying the same limited permissions, so the scope must cover the
follow-up operation as well, not just creating the webhook.

---

## 9. Failure modes

| Symptom                                | Cause                               | Action                                                                                                   |
| -------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `401` `user-or-token-not-found`        | Token wrong or deleted              | Re-issue                                                                                                 |
| `401` `token-not-provided`             | Header missing                      | Fix the request                                                                                          |
| `403` `insufficient-permissions`       | Token valid, scope too narrow       | Section 3.1. Not a typo.                                                                                 |
| `400` `invalid-input` on `startUrls`   | Strings instead of objects          | Section 4.1                                                                                              |
| `408`                                  | Run exceeded 300 s                  | Switch to the async pattern in 8.1                                                                       |
| `201` with `_warning` and no `id`      | Offer gone, or page shape changed   | Treat as 404 (5.2)                                                                                       |
| `201`, items present, all filtered out | Same as above                       | Same                                                                                                     |
| Two items for one URL                  | Actor's junk sentinel               | Filter (5.1)                                                                                             |
| Run charges more than expected         | `maxItems` caps billing, not output | Set `maxTotalChargeUsd`                                                                                  |
| Actor stops working entirely           | Single maintainer abandoned it      | Fall back to direct fetching per `otodom_fetching.md` 7.1, or migrate actors using the section 6 mapping |

Design so anything unexpected raises. A notifier that reports "nothing new"
forever is worse than one that crashes.

---

## 10. Verification log

Executed 2026-09-19 against the production Apify API.

| Check                                     | Result                                                 |
| ----------------------------------------- | ------------------------------------------------------ |
| Malformed token -> `/users/me`            | `401` `user-or-token-not-found`                        |
| No token -> `/users/me`                   | `401` `token-not-provided`                             |
| Under-scoped token -> run actor           | `403` `insufficient-permissions`                       |
| Under-scoped token -> `apify/hello-world` | `403` (so it was not actor-specific)                   |
| Working token -> `/users/me`              | `403` - profile read is a separate permission          |
| `startUrls` as strings                    | `400` `invalid-input`                                  |
| `startUrls` as objects                    | **`201`, 8.3 s, 6,648 B**                              |
| Items returned for one URL                | **2** (1 real + 1 `noResults` sentinel)                |
| Field diff against Otodom, 11 fields      | **all exact**, enums passed through raw                |
| `description` / `images`                  | 701 chars / 12 - identical to source                   |
| `dateCreated` vs `ad.createdAt`           | identical                                              |
| `createdAtFirst` on that offer            | `null` at source - see `otodom_fetching.md` 6          |
| Nonexistent offer URL                     | **`201`** with 404-page title and `_warning`           |
| Second run latency                        | 8.5 s                                                  |
| Actor ID lookup                           | `trev0n~otodom-scraper` -> `ir34sMIv8mrbL0ojO`, public |

Not verified: behaviour on a bumped offer (needed to observe
`createdAtFirst` diverging from `dateCreated`), search-URL input mode,
`extractDetails: false` mode, and the async webhook pattern in 8.1.

Re-run this table before trusting the document. The actor has one maintainer and
one version; its output is not a contract.
