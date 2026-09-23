# Fetching data from otodom.pl

Reference notes for building a daily "new apartment listings" notifier.
Everything below was verified live against production otodom.pl on **2026-09-16**
from a Polish residential IP using plain `curl` (no browser, no proxy, no API key).

**Target use cases**

1. Fetch a list of offers matching a set of filters.
2. Fetch one specific offer in full detail.

**Deployment context assumed by this document:** a cloud VM, one cron run per day,
notifications delivered by email.

---

## 1. Legal and robots.txt boundaries

There is no public Otodom API. Scraping is the only option, so stay inside the
rules the site itself publishes.

`https://www.otodom.pl/robots.txt` (fetched 2026-09-16) contains
`User-agent: *` with `Allow: /` plus a disallow list. The relevant entries:

| Rule                                                                                                                                                                              | Consequence for this project                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Disallow: /api/query`                                                                                                                                                            | **Do not use the GraphQL endpoint.** It works and accepts arbitrary queries, but it is off-limits. |
| `Allow: /api/query?crawl=true`                                                                                                                                                    | The only permitted GraphQL entry point. Undocumented, no introspection, not needed.                |
| `Disallow: /*?*map=1`                                                                                                                                                             | Do not use map view / bounding-box searches. Use the normal list view.                             |
| `Disallow: /ajax/`, `/adminpanel/`, `/hpr/`, `/uk/*`, `/drukuj/`, `/platnosci/`, `/oferta/kontakt/`, `/m/oferta/abuse/`, `/pl/login`, `/changelang/`, `/nowe-ogloszenie/confirm*` | Never touch.                                                                                       |
| `Disallow: /*description={search_term_string}`                                                                                                                                    | This is a search-template placeholder. A real `?description=taras` query is not covered by it.     |

Explicitly **allowed** (not matched by any disallow rule) and therefore what this
document builds on:

- `/pl/wyniki/...` - the search results page (HTML)
- `/pl/oferta/...` - the offer detail page (HTML)
- `/_next/data/{buildId}/pl/wyniki/....json` - the JSON payload behind the search page
- `/_next/data/{buildId}/pl/oferta/....json` - the JSON payload behind the offer page
- `/sitemap.xml` and the sitemaps it indexes

Additional non-robots.txt considerations:

- Otodom's Terms of Service prohibit automated data collection. robots.txt
  compliance does not override that. For a personal, low-volume notifier
  (one cron run per day, a handful of requests) the practical risk is low, but it
  is a deliberate choice, not a blanket permission.
- Offer detail responses include the advertiser's **phone number and full name**
  (`ad.contactDetails.phones`, `ad.owner.contacts`). That is personal data under
  GDPR. Do not store or email it unless you actually need it; prefer keeping only
  the offer URL.
- Do not redistribute scraped content. Keep it for personal use.

---

## 2. Site architecture

Otodom is a **server-side-rendered Next.js** application (Pages Router). Every
page ships its full data as JSON inside the HTML:

```text
<script id="__NEXT_DATA__" type="application/json" crossorigin="anonymous">{...}</script>
```

This means:

- **No JavaScript execution is needed.** No Playwright, no Selenium, no headless
  Chrome. `requests` / `httpx` + `json` is enough.
- **No HTML/CSS-selector parsing is needed.** Selectors on this site are hashed
  CSS-module classes and change with every deploy. Parse the JSON instead - it is
  far more stable.
- The same JSON is also reachable directly, without the HTML wrapper, at
  `/_next/data/{buildId}/<page-path>.json`. That is the preferred route.

Anti-bot status as observed: **no challenge.** No DataDome, no Cloudflare
interstitial, no captcha on a plain request with a normal desktop User-Agent.
There _is_ a reCAPTCHA widget embedded in the page markup, but it guards
interactive forms (contact / login), not page delivery.

---

## 3. Method A (recommended): the `_next/data` JSON route

### 3.1 Getting `buildId`

The route requires the current Next.js build ID. It changes on every Otodom
deploy (observed value on 2026-09-16: `jGmeL_RAnlKZBDWFZwXZe`).

Fetch any normal page and read it out of `__NEXT_DATA__`:

```python
import re, json, httpx

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9"}

def next_data(html: str) -> dict:
    m = re.search(r'id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError("__NEXT_DATA__ not found - layout changed or request was blocked")
    return json.loads(m.group(1))

def get_build_id(client: httpx.Client) -> str:
    r = client.get("https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/cala-polska",
                   headers=HEADERS, follow_redirects=True, timeout=30)
    r.raise_for_status()
    return next_data(r.text)["buildId"]
```

Cache the `buildId` on disk. Refresh it when a `_next/data` request returns
**404 with body `{}`** - that is the exact signature of a stale build ID.
The retry loop should be: request -> 404 -> re-fetch buildId -> request once more -> fail.

### 3.2 Search request

```
GET https://www.otodom.pl/_next/data/{buildId}/pl/wyniki/{transaction}/{estate}/{location-path}.json?{filters}
```

Verified working example (Warsaw flats for sale, newest first):

```
https://www.otodom.pl/_next/data/jGmeL_RAnlKZBDWFZwXZe/pl/wyniki/sprzedaz/mieszkanie/mazowieckie/warszawa/warszawa/warszawa.json?limit=36&by=LATEST&direction=DESC
```

Notes proven by testing:

- The `x-nextjs-data: 1` header is **not** required.
- Repeating `searchingCriteria=` query params (which the browser sends) is **not**
  required; the path segments are enough.
- Response is pure JSON. Top level is `{"pageProps": {...}, "__N_SSP": true}` -
  i.e. one level shallower than in `__NEXT_DATA__`, where it sits under
  `props.pageProps`. Handle both shapes if you share parsing code.

### 3.3 Where the data is

| JSON path (in `pageProps`)        | Contents                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `data.searchAds.items[]`          | The offers on this page                                                                                |
| `data.searchAds.pagination`       | `{totalItems, totalPages, currentPage, itemsPerPage}`                                                  |
| `data.searchAds.stats`            | Aggregate price min/max/mean for the current filter set                                                |
| `data.searchAds.locationsObjects` | Resolved location objects                                                                              |
| `filteringQueryParams`            | Echo of the filters the server actually applied - **use this to confirm your filters were understood** |
| `pageHeading`, `locationName`     | Human-readable description of the search                                                               |

`filteringQueryParams` is the single best sanity check: if you send `priceMax` and
it does not come back in that object, the server ignored it.

---

## 4. Method B (fallback): SSR HTML

Identical data, just wrapped:

```
GET https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/mazowieckie/warszawa/warszawa/warszawa?limit=36&by=LATEST&direction=DESC
```

Then `next_data(html)["props"]["pageProps"]`. Payload is ~1.1 MB vs ~215-460 KB
for the JSON route, so use it only for `buildId` discovery and as a fallback if
the `_next/data` route ever changes shape.

**Always follow redirects.** Otodom canonicalises some filters into the URL path:
sending `?roomsNumber=[TWO]` triggers a 301 to
`/pl/wyniki/sprzedaz/mieszkanie,2-pokoje/...`. With `curl` use `-L`; with `httpx`
use `follow_redirects=True`. Without it you get a 184-byte body containing only
the redirect target.

---

## 5. Building the search URL

### 5.1 Path structure

```
/pl/wyniki/{transaction}/{estate}[,{modifiers}]/{voivodeship}/{county}/{commune}/{city}[/{district}]
```

| Segment       | Verified values                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `transaction` | `sprzedaz`, `wynajem`                                                                                                              |
| `estate`      | `mieszkanie`, `kawalerka`, `dom`, `dzialka`, `lokal`, `haleimagazyny`, `garaz`, `inwestycja`, `pokoj`                              |
| `modifiers`   | comma-appended: `mieszkanie,2-pokoje`, `mieszkanie,3-pokoje`, `mieszkanie,rynek-pierwotny`, `lokal,biuro`                          |
| location      | `cala-polska`, or a hierarchy such as `mazowieckie/warszawa/warszawa/warszawa`, optionally plus a district: `.../warszawa/mokotow` |

Do not hand-build location paths. **Get them from the browser** (section 5.3) or
from `sitemap_locations_0.xml` (indexed by `/sitemap.xml`).

### 5.2 Query parameters (all verified against `filteringQueryParams`)

| Param                                                        | Example                        | Meaning                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`                                                      | `24`, `36`, `48`, `72`         | Page size. Larger values work; `72` confirmed.                                                                                            |
| `page`                                                       | `2`                            | 1-based page index.                                                                                                                       |
| `by` + `direction`                                           | `by=LATEST&direction=DESC`     | Sort. `LATEST/DESC` = newest first, which is what a notifier wants. `by=DEFAULT` is the site's relevance ranking (promoted offers first). |
| `priceMin`, `priceMax`                                       | `500000`, `900000`             | PLN, integers.                                                                                                                            |
| `areaMin`, `areaMax`                                         | `40`, `80`                     | m².                                                                                                                                       |
| `roomsNumber`                                                | `%5BTWO%5D`, `%5BTWO,THREE%5D` | URL-encoded `[TWO,THREE]`. Enum: `ONE, TWO, THREE, FOUR, FIVE, SIX_OR_MORE`. Triggers a path redirect.                                    |
| `market`                                                     | `ALL`, `SECONDARY`, `PRIMARY`  | Secondary / primary market.                                                                                                               |
| `ownerTypeSingleSelect`                                      | `ALL`, `PRIVATE`, `BUSINESS`   | `PRIVATE` = no agencies.                                                                                                                  |
| `daysSinceCreated`                                           | `1`, `3`, `7`, `14`            | Only offers created in the last N days. **Very useful for a daily cron** - `daysSinceCreated=1` returned 234 results for Warsaw flats.    |
| `description`                                                | `taras`                        | Free-text match against the description.                                                                                                  |
| `floorsNumber`, `buildingType`, `extras`, `isExclusiveOffer` | -                              | Exist in the UI; capture the exact param names from the browser when needed.                                                              |

### 5.3 How to obtain an exact filter URL

The reliable procedure, for any filter not listed above:

1. Open otodom.pl, set the filters in the UI, click **Szukaj**.
2. Wait for the page to finish loading, then copy the URL from the address bar.
   It must be the post-redirect URL, because Otodom rewrites part of the filter
   state into the path.
3. That URL is directly usable for Method B, and its path + query map 1:1 onto
   Method A.
4. Confirm by checking that every filter appears in `pageProps.filteringQueryParams`.

Avoid the map view entirely (`?map=1` is disallowed by robots.txt).

---

## 6. Search result item fields

Each element of `data.searchAds.items[]`:

| Field                                                         | Notes                                                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                          | Numeric internal ID, e.g. `68423433`. Stable. **Use as the dedup key.**                                                                                                    |
| `slug`                                                        | `idealne-na-start-lub-inwestycje-ul-orzycka-ID4D63L` - ends with `ID<publicCode>`                                                                                          |
| `title`                                                       | Advertiser-written headline                                                                                                                                                |
| `estate`, `transaction`                                       | `FLAT`, `SELL`                                                                                                                                                             |
| `totalPrice`                                                  | `{value, currency}`; may be `null` when `hidePrice` is true                                                                                                                |
| `pricePerSquareMeter`, `priceFromPerSquareMeter`, `rentPrice` | Money objects                                                                                                                                                              |
| `areaInSquareMeters`, `terrainAreaInSquareMeters`             | Numbers                                                                                                                                                                    |
| `roomsNumber`                                                 | Enum string, e.g. `TWO`                                                                                                                                                    |
| `floorNumber`                                                 | e.g. `FLOOR_3`, `GROUND`                                                                                                                                                   |
| `dateCreated`                                                 | `"2026-09-15 18:35:19"` - naive local time, **note the non-ISO format**                                                                                                    |
| `createdAtFirst`                                              | `"2026-09-15T18:35:05Z"` - ISO/UTC, the original publication moment. Prefer it **when present**, but see the warning below: it is `null` on offers that were never bumped. |
| `pushedUpAt`                                                  | Non-null when the advertiser re-promoted an old offer. Guard against this so a bump is not reported as a new offer.                                                        |
| `isPrivateOwner`, `isPromoted`, `isExclusiveOffer`            | Booleans                                                                                                                                                                   |
| `agency`                                                      | `{id, name, slug, imageUrl, type}` or `null`                                                                                                                               |
| `location`                                                    | `address.street/city/province` + `reverseGeocoding.locations[]` with `locationLevel` of `voivodeship / city_or_village / district / residential`                           |
| `images[]`                                                    | `{small, medium, large}` CDN URLs on `ireland.apollo.olxcdn.com`                                                                                                           |
| `totalPossibleImages`                                         | Photo count                                                                                                                                                                |
| `shortDescription`                                            | Truncated description                                                                                                                                                      |
| `tags[]`                                                      | `[{value: "BALCONY", weight: 35}, ...]`                                                                                                                                    |
| `development*`                                                | Populated for new-build investment listings                                                                                                                                |

**`createdAtFirst` can be `null` - verified 2026-09-19.** On a freshly published
offer that has never been bumped, `createdAtFirst` is absent and only `createdAt`
(detail view) / `dateCreated` (list view) carries the timestamp. Treating it as
always present will crash or, worse, sort `None` values into the wrong bucket.
Always resolve through a fallback:

```python
def published_at(item: dict) -> str | None:
    """Best available publication timestamp, ISO form preferred."""
    return item.get('createdAtFirst') or item.get('createdAt') or item.get('dateCreated')
```

The semantic difference still matters and the priority order above is correct:
when an advertiser bumps an old offer, `dateCreated` is refreshed while
`createdAtFirst` stays at the original moment. So `createdAtFirst` is the right
field _when it exists_; the fallback only fills the never-bumped case, where
`createdAt` happens to be the original moment anyway.

Offer URL from an item:

```python
url = f"https://www.otodom.pl/pl/oferta/{item['slug']}"
```

Ignore `item['href']` - it is an internal route template (`[lang]/ad/<slug>`).

**Off-by-one warning:** the API returns `limit + 1` items (25 for `limit=24`,
49 for 48, 73 for 72). One extra promoted/premium tile is injected. Do not
compute pagination from `len(items)`; use `pagination.totalPages` /
`pagination.itemsPerPage`.

---

## 7. Fetching a single offer

### 7.1 URL in, data out (the simplest use case)

This is the cheapest thing to build against Otodom and a good first milestone:
one function, offer URL as the only argument, structured data as the return
value. No `buildId`, no filter translation, no pagination, no state.

Reuses `HEADERS` and `next_data()` from section 3.1:

```python
import httpx

def fetch_offer(client: httpx.Client, url: str) -> dict:
    """Any canonical Otodom offer URL -> the full ad object."""
    r = client.get(url, headers=HEADERS, follow_redirects=True, timeout=30)
    r.raise_for_status()
    props = next_data(r.text)["props"]["pageProps"]
    ad = props.get("ad")
    if ad is None:
        raise LookupError(f"no ad payload (expired or removed): {url}")
    return ad
```

Why the HTML route and not `_next/data` here: for a single ad the HTML route
needs no `buildId`, so it cannot break on a deploy (see 3.1). You pay ~519 KB
instead of ~78 KB for one request, which is irrelevant at this volume. Use the
JSON route from 7.2 only if you are already refreshing offers in bulk.

Accepts any canonical offer URL, with or without the `/pl/` prefix, with or
without query string, and follows the redirect if the slug changed.

Checks worth having in that function:

| Condition                                                   | Meaning                           | Suggested handling                             |
| ----------------------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `HTTPError 404` or `410`                                    | Offer removed or wrong URL        | Mark inactive locally, do not retry            |
| Any other `4xx` (`403`, `429` above all)                    | Portal refused to serve the page  | Report with the status; see section 9.1        |
| `5xx`                                                       | Portal failing, not refusing      | Report as unavailable; never read as a block   |
| Redirect lands off otodom                                   | Consent or anti-bot page          | Treat as refused; see section 9.1              |
| Redirect lands on otodom, but not on `/(pl/)oferta/<slug>`  | No listing at this address        | Treat as not found                             |
| `pageProps.ad` missing but `shouldShowExpiredAdPage` truthy | Offer expired, page still renders | Mark expired, keep last known snapshot         |
| `ad.shouldShowExpiredAdPage === true`                       | Same flag, carried on `ad` itself | Check it too — `ad` can be present and expired |
| `__NEXT_DATA__` regex miss                                  | Site shape changed                | Fail loudly; do not fall back to HTML scraping |

A minimal, useful projection of the return value - enough for a notification
email, no personal data stored:

```python
def summarise(ad: dict) -> dict:
    ch = {c['key']: c.get('value') for c in ad.get('characteristics', [])}
    floor = ch.get('floor_no')                      # e.g. 'floor_7', 'ground_floor'
    return {
        'id':          ad['id'],
        'title':       ad['title'],
        'url':         ad['url'],
        'price':       ch.get('price'),             # 800000
        'rent':        ch.get('rent'),              # 1200 - service charge, not in price
        'price_per_m': ch.get('price_per_m'),
        'area_m2':     ch.get('m'),                 # 61.5
        'rooms':       ch.get('rooms_num'),
        'floor':       floor,
        'floors_total': ch.get('building_floors_num'),
        'build_year':  ch.get('build_year'),
        'building':    ch.get('building_type'),     # 'block', 'tenement', ...
        'condition':   ch.get('construction_status'),
        'market':      ad.get('market'),            # SECONDARY / PRIMARY
        'seller':      ad.get('advertType'),        # PRIVATE / AGENCY / DEVELOPER
        'created_at':  ad.get('createdAt'),
        'lat':         ad['location']['coordinates']['latitude'],
        'lon':         ad['location']['coordinates']['longitude'],
        'photo':       (ad.get('images') or [{}])[0].get('medium'),
    }
```

**Second trap, verified on a live ad 2026-09-20 (`ID4CZQU`): a missing value arrives
as `"0"`, not as a missing key.** That offer returned `rent: "0"` — service charge
zero — for a 1975 block where a zero czynsz is not credible. Otodom's form appears to
default the field rather than omit it, so `characteristics` cannot be read as
"present means stated". Mapped straight through, the product prints "Czynsz: 0 zł",
which is a fabricated fact about a cost the buyer pays monthly.

This is the exact failure `@context/foundation/prd.md` guards against under Success
Criteria → Guardrails ("Missing data reads 'unknown', never 'no' and never zero"),
and the code that causes it looks perfectly correct. Treat `"0"` from `rent` as
unknown, and check every other numeric entry for the same behaviour before trusting
it. Distinguishing "stated as zero" from "not stated" is not possible from this
payload alone — which is itself the answer: report unknown.

**The trap is wider than `"0"` — verified 2026-09-22.** A house listing (`ID4wZN2`)
had **no `rent` key at all**, and a rental (`ID4DapL`) returned `rent: "1"`. The rule
Vetpad applies to every numeric characteristic, not only `rent`: key absent, value
empty, unparseable, or `≤ 0` → unknown; integer facts (`rooms_num`,
`building_floors_num`, `build_year`) additionally require an integer. In code this is
the single function `numericOrUnknown` in `src/lib/otodom/map.ts`.

**Trap in `characteristics`, verified on a live ad:** `localizedValue` is filled
in only for numeric and monetary entries (`price`, `rent`, `price_per_m`, `m`,
`rooms_num`, `build_year`, `building_floors_num`, `free_from`). For every enum
entry - `market`, `floor_no`, `building_type`, `construction_status`,
`building_material`, `heating`, `windows_type`, `building_ownership`,
`energy_certificate` - it is an **empty string**. Read `value` instead and map
the token yourself; `floor_no` arrives as `floor_7`, not `7`. Currency lives in
the `currency` field of the entry, not inside `value`.

Deliberately omitted: `owner`, `agency`, `contactDetails`. They carry names and
phone numbers, and section 1 explains why you do not want that in your database.
All three were present on a live offer on 2026-09-22 (`agency` as `null` on a
private listing, so never assume it is an object). `target` is a second leak:
it repeats the seller's account id as `seller_id` (and `user_type`), so Vetpad
copies only `target.OfferType` and `target.ProperType`, never `target` whole —
see section 7.4.

Verified end to end on 2026-09-17: newest Warsaw listing pulled from a search
page, then `fetch_offer` on its URL returned an `ad` object with **62 keys** and
every field above populated. A nonexistent slug raised `HTTPError 404`.

`httpx` is a hard dependency of the snippets in this document. If you prefer
`requests`, the only changes are `follow_redirects=` → `allow_redirects=` and
the client constructor; both were tested and behave identically here.

### 7.2 Both routes

Given the slug `mieszkanie-49-m-warszawa-ID4CZR6`, the public code is the part
after the trailing `ID`, i.e. `4CZR6`.

**JSON route (preferred for bulk):**

```
GET https://www.otodom.pl/_next/data/{buildId}/pl/oferta/mieszkanie-49-m-warszawa-ID4CZR6.json?id=4CZR6
```

Verified: 200, ~78 KB. The `id` query param is part of the route contract.

**HTML route:**

```
GET https://www.otodom.pl/pl/oferta/mieszkanie-49-m-warszawa-ID4CZR6
```

Verified: 200, ~519 KB, then parse `__NEXT_DATA__`.

### 7.3 Field map

Data lives at `pageProps.ad` (~60 fields). The useful ones:

| Field                                   | Notes                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                    | Same numeric ID as in the search item                                                                                                                                                                                                                                                 |
| `title`, `slug`, `url`                  | Canonical absolute URL included                                                                                                                                                                                                                                                       |
| `description`                           | Full description, **HTML markup** - strip or render it                                                                                                                                                                                                                                |
| `createdAt`, `modifiedAt`, `pushedUpAt` | ISO/UTC                                                                                                                                                                                                                                                                               |
| `status`                                | `active`; expired offers set `shouldShowExpiredAdPage`                                                                                                                                                                                                                                |
| `market`                                | `SECONDARY` / `PRIMARY` — and `ALL` on a rental (2026-09-22); it does **not** tell sale from rental                                                                                                                                                                                   |
| `advertType`                            | `PRIVATE` / `AGENCY` / `DEVELOPER` — top-level on `ad`, not a `characteristics` entry                                                                                                                                                                                                 |
| `advertiserType`                        | Related classification                                                                                                                                                                                                                                                                |
| `adCategory`                            | `{id, name, type}` — **the** transaction and property-type discriminator on an offer page. Values in section 7.4                                                                                                                                                                      |
| `category`                              | **A different field.** Its `name` is an empty array — comparing against it passes every listing. Do not use it                                                                                                                                                                        |
| `transaction`                           | **Absent** on the offer page. `transaction: SELL` (section 6) exists only on search-result items                                                                                                                                                                                      |
| `characteristics[]`                     | `[{key, value, localizedValue, currency}]` with keys `price`, `rent`, `price_per_m`, `m`, `market`, `building_type`, `floor_no`, `construction_status`, ... **The cleanest source of the numeric facts.**                                                                             |
| `target`                                | Flat ad-targeting dict: `Area`, `Build_year`, `Building_floors_num`, `Building_material`, `Building_ownership`, `Building_type`, `Construction_status`, `Extras_types`, `Floor_no`, `City`, `City_id`, `MarketType`, `OfferType`, `ProperType` — **also `seller_id` and `user_type`** |
| `features`, `featuresByCategory`        | Amenity lists. `features` can be `[]` on an offer whose description names a balcony and a lift — an empty list is not a statement of absence                                                                                                                                          |
| `location.address`                      | `city`, `district`, `province` observed as `null`; only `street.name` filled (2026-09-22). Not a source for a location label                                                                                                                                                          |
| `location.coordinates`                  | `{latitude, longitude}`                                                                                                                                                                                                                                                               |
| `location.reverseGeocoding.locations[]` | District / neighbourhood hierarchy. The location label is the entry with the longest `fullNameItems`, read from its `fullName` (e.g. `"Praga-Południe, Warszawa, mazowieckie"`)                                                                                                       |
| `images[]`, `floorPlans`, `videos`      | Media                                                                                                                                                                                                                                                                                 |
| `owner`, `agency`, `contactDetails`     | **Contains name and phone number - personal data, see section 1**                                                                                                                                                                                                                     |
| `links`, `breadcrumbs`, `seo`           | Navigation metadata                                                                                                                                                                                                                                                                   |

### 7.4 Telling a flat sale from everything else (verified 2026-09-22)

Vetpad accepts only a sale of a flat (`@context/foundation/prd.md`, FR-005), and
the offer page carries no `transaction` field. The discriminator is `ad.adCategory`,
cross-checked against `ad.target.OfferType`. Three live listings, one per case:

| Listing                   | `ad.adCategory`                          | `target`                                  | Vetpad gate    |
| ------------------------- | ---------------------------------------- | ----------------------------------------- | -------------- |
| Flat for sale `…ID4CIsC`  | `{id: 101, name: "FLAT", type: "SELL"}`  | `OfferType: "sprzedaz"`                   | pass           |
| Flat for rent `…ID4DapL`  | `{id: 102, name: "FLAT", type: "RENT"}`  | `OfferType: "wynajem"`; `market: "ALL"`   | `not_for_sale` |
| House for sale `…ID4wZN2` | `{id: 201, name: "HOUSE", type: "SELL"}` | `ProperType: "dom"`; no `rent` key at all | `not_a_flat`   |

Two ways to get this wrong, both silent: comparing against `ad.category` (its
`name` is an empty array, so the gate never fires), or reading `ad.market` as the
transaction (a rental reported `ALL`). The gate itself is `mapAdToOffer` in
`src/lib/otodom/map.ts`.

Other observations from the same probe:

- `description` is a sequence of `<p>…</p>`; `images[]` entries carry `thumbnail`,
  `small`, `medium`, `large` and `isExterior` (20 photos on the flat above).
- `localizedValue` behaved exactly as the trap in section 7.1 describes.
- `owner` and `contactDetails` were filled (`phones`, `name`, `contacts`), `agency`
  was `null`, and `target` repeated the seller's account id as `seller_id`. That is
  why `raw` in `public.offers` is built from a **whitelist** of `ad` keys — with
  `location` narrowed to `coordinates` and `reverseGeocoding`, and `target` narrowed
  to `OfferType` and `ProperType` — rather than by deleting known personal fields.

**Reproducing any of this:** `npm run otodom:inspect -- <offer URL>`
(`scripts/otodom-inspect.mjs`) fetches one live offer with the app's own
`src/lib/otodom/` code and prints the gate inputs (`adCategory`, `target.OfferType`,
`target.ProperType`), every `characteristics` entry raw, and the mapper's output with
the columns that came out unknown. It hits the live portal: a debugging tool, not a
test, never run in CI.

---

## 8. Detecting new offers on a daily schedule

Recommended algorithm, one cron run per day:

1. For each saved search, request page 1 with
   `by=LATEST&direction=DESC&daysSinceCreated=3&limit=72`.
   `daysSinceCreated=3` gives ~48 h of slack for a missed or failed run while
   keeping the payload small; `LATEST/DESC` guarantees the newest offers are on
   page 1 so a single request is usually enough.
2. Read `pagination.totalPages`. Page further only while the oldest
   `published_at(item)` on the current page is still newer than your watermark,
   and cap it (e.g. 5 pages) so a bad filter cannot trigger a crawl. Use the
   `published_at()` fallback from section 6, never bare `createdAtFirst`.
3. For each item, skip it if `id` already exists in your local store (SQLite is
   plenty). Store `id`, `published_at(item)`, `totalPrice.value`, `slug`,
   `first_seen_at`, `notified_at`.
4. Treat an item as new only when its `id` is unseen. Do **not** key on
   `dateCreated` or `pushedUpAt`: advertisers bump old offers, which refreshes
   `dateCreated` while `createdAtFirst` stays put.
5. Optional price-drop alerts: compare stored `totalPrice.value` against the
   current one for already-known IDs.
6. Only fetch the offer detail endpoint for items you are actually going to email
   about, and only if the list fields are insufficient. The list item alone
   already carries price, area, rooms, floor, district, first photo and a short
   description, which is enough for a useful notification.
7. Email the batch as one digest per run, with a link per offer. One email a day
   beats one email per offer.

Request budget for a typical setup: 1 request for `buildId` + 1-2 per saved
search. With 3 saved searches that is roughly 5-7 requests per day.

---

## 9. Running in the cloud

This is the one thing that could not be verified from a residential connection.
Datacenter IP ranges (Hetzner, OVH, AWS, GCP, DigitalOcean) are a common trigger
for bot defences even when the same request succeeds from a home network.

**Run this preflight on the target VM before writing any code:**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" \
  -H "Accept-Language: pl-PL,pl;q=0.9" \
  "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/mazowieckie/warszawa/warszawa/warszawa"
```

- `200` -> proceed as documented.
- `403` / `429` / a captcha body -> the plain HTTP approach will not hold. Options,
  in order of preference: host it on a residential connection (an always-on
  Raspberry Pi with a daily cron is a perfect fit for one run per day), or place a
  Polish residential proxy in front of the requests. A headless browser does not
  help against IP reputation.

Also prefer a **Polish or European egress**; the site serves `/uk/*` variants and
geo-differentiated content, and `/uk/*` is robots-disallowed.

### 9.1 Cloudflare Workers specifically

Platform limits, from the official docs (page last updated 2026-09-05), against
what a daily notifier actually consumes:

| Limit                         | Workers Free | Workers Paid                                | This workload      |
| ----------------------------- | ------------ | ------------------------------------------- | ------------------ |
| CPU per Cron Trigger          | 10 ms        | 30 s (interval < 1 h) / **15 min (>= 1 h)** | JSON parse, sub-ms |
| Wall time per Cron Trigger    | 15 min       | 15 min                                      | seconds            |
| Subrequests per invocation    | 50           | 10,000                                      | 2-7                |
| Simultaneous open connections | 6            | 6                                           | 1-2                |
| Requests per day              | 100,000      | no limit                                    | 1                  |

Two quotes that settle the timeout question:

> Waiting on network requests (such as `fetch()` calls, KV reads, or database
> queries) does **not** count toward CPU time.

> There is no set time limit on individual subrequests.

So a Worker may wait on a slow upstream without burning its CPU budget. A daily
cron has an interval >= 1 h, which puts a paid Worker in the 15-minute CPU tier.
The Free tier's 10 ms CPU is enough to parse one offer and build an email, but
there is no headroom; budget for Paid if the digest does any real work.

**Two hard constraints that change the architecture:**

**1. You cannot control the TLS fingerprint.** Workers' `fetch()` uses
Cloudflare's own TLS stack. There is no way to set cipher order or ALPN. This
does not affect Otodom, which applies no TLS-based filtering, but it makes the
`ChromeishAdapter` workaround in `olx_fetching.md` section 2 **impossible to
express in a Worker**. Direct OLX scraping is off the table on this platform;
OLX needs either a third-party scraping service or a runtime with a real socket
stack (Cloudflare Containers, a VM).

**2. Egress is a Cloudflare datacenter range. VERIFIED 2026-09-20: Otodom serves
it.** A throwaway Worker (`vetpad-egress-probe`, deployed, called once, deleted)
fetched the Warsaw search results page from Cloudflare's egress with the
`User-Agent` and `Accept-Language` headers from section 3.1. Result:

| Field                          | Value           |
| ------------------------------ | --------------- |
| HTTP status                    | **200**         |
| `__NEXT_DATA__` present        | **yes**         |
| Captcha / interstitial markers | none            |
| `cf-mitigated` header          | absent          |
| Body size                      | 1,235,304 bytes |
| Round trip                     | 1,021 ms        |

**The offer page was verified separately on 2026-09-20**, because the check above
uses a _search results_ page and FR-004 fetches `/pl/oferta/...` — a different route
that could in principle be protected differently. A second throwaway Worker
(`vetpad-offer-probe`) walked the whole of section 7.1 against one live offer from
Cloudflare's egress:

| Step                                     | Result                                       |
| ---------------------------------------- | -------------------------------------------- |
| HTTP status                              | **200**, no redirect                         |
| `__NEXT_DATA__` via the bounded `RegExp` | found                                        |
| `JSON.parse`                             | no error                                     |
| `props.pageProps.ad`                     | present, **62 keys** — matches section 7.1   |
| `shouldShowExpiredAdPage`                | false                                        |
| HTML / embedded JSON size                | 558,209 B / **102,338 B**                    |
| `RegExp` + `JSON.parse` wall time        | **below 1 ms**, on the Workers **Free** plan |

Three things that payload settled, each recorded where it belongs: the CPU cost of
parsing is negligible (the JSON is a fifth of the HTML, not the whole of it);
`localizedValue` behaves exactly as the trap above describes (empty for `floor_no`,
filled for `price`); and `contactDetails`, `owner` and `agency` were all present, so
the personal-data rule in `@CLAUDE.md` is live rather than theoretical.

So the direct path in section 7.1 is open to a Worker on this account today, end to
end and not merely at the HTTP layer. Two caveats before treating it as settled: one observation is not a guarantee of
sustained access — blocking of datacenter ranges tends to arrive gradually, so
log every non-200 fetch status distinctly from a parse failure, and re-run this
probe if ingestion starts failing intermittently. A 403 is still handled by the
fallback below rather than by abandoning ingestion.

If the preflight fails, the fallback is a third-party scraping service. That
path is fully verified and documented separately in `otodom_apify.md`, including
the exact request shape and the failure modes the provider hides from you.

Storage: a Worker has no filesystem, so the SQLite store in section 8 becomes
**D1** (SQL, closest to the documented schema) or **KV** (sufficient if you only
ever check "have I seen this id"). Do not keep the watermark in memory; isolates
are recycled without warning.

---

## 10. Request etiquette

- **User-Agent:** send a realistic desktop Chrome UA. Do not send a blank UA and
  do not impersonate `Googlebot`. If you want to be transparent, a custom UA with
  contact info is the most honest option, but it also makes blocking trivial.
- **Accept-Language:** `pl-PL,pl;q=0.9`.
- **Rate:** 8 back-to-back requests all returned 200 in 0.6-1.0 s with no
  throttling. Still, keep 1-2 s between requests, run sequentially, never in
  parallel. A daily job has no reason to hurry.
- **Cookies:** not required. A cookie jar reused across requests looks more
  natural but is unnecessary.
- **Retries:** exponential backoff on 5xx and on timeouts; a maximum of 3
  attempts. On 403/429 abort the whole run and alert yourself rather than
  retrying.
- **Compression:** let the client negotiate gzip; the payloads are large.
- **Conditional requests:** not usable, these pages are dynamic.

---

## 11. Failure modes and how to detect them

| Symptom                                    | Cause                                                                 | Action                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `404` with body `{}` on a `_next/data` URL | Stale `buildId` (Otodom deployed)                                     | Re-read `buildId` from HTML, retry once                                               |
| `__NEXT_DATA__` regex finds nothing        | Blocked / challenge page, or the app moved to the App Router          | Log the raw body, alert, do not retry in a loop                                       |
| `KeyError: 'searchAds'`                    | Payload shape changed, or the URL redirected to a different page type | Assert on `pageProps.filteringQueryParams` and `data.searchAds` early and fail loudly |
| Filters silently ignored                   | Wrong param name or a value that failed validation                    | Diff your intended filters against `filteringQueryParams` on every run                |
| 184-byte response                          | An unfollowed 301 (filter canonicalised into the path)                | Enable redirect following                                                             |
| `403` / `429`                              | IP reputation or rate limiting                                        | See section 9                                                                         |
| Item count is `limit + 1`                  | Injected promoted tile                                                | Expected, see section 6                                                               |

Build the scraper so that **any** unexpected shape raises rather than silently
producing an empty result set: a notifier that quietly reports "no new offers"
forever is worse than one that crashes.

---

## 12. Things not to do

- Do not use `POST /api/query` (the GraphQL endpoint). It is robots-disallowed.
  For the record: it responds 200 to arbitrary queries, introspection is disabled,
  and only `?crawl=true` is permitted - but the documented `_next/data` route
  covers both use cases, so there is no reason to go there.
- Do not use map/bounding-box searches (`?map=1`) - robots-disallowed.
- Do not use a headless browser. It buys nothing here and multiplies cost,
  fragility and detectability.
- Do not scrape by CSS selectors. The class names are per-build hashes.
- Do not crawl the whole site. Fetch only your saved searches.
- Do not expect per-offer sitemaps. `/sitemap.xml` only indexes
  `sitemap_agencies_0.xml`, `sitemap_categories_0.xml` and
  `sitemap_locations_0.xml`; it is useful for resolving location paths, not for
  offer discovery.
- Do not store or forward advertiser phone numbers without a reason.

---

## 13. Verification log

Performed 2026-09-16, plain `curl`, Polish residential IP, no proxy:

| Check                                                  | Result                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `GET /pl/wyniki/...` (HTML)                            | `200`, 1 174 672 B, `__NEXT_DATA__` present                                                       |
| `GET /pl/oferta/...-ID4CZR6` (HTML)                    | `200`, 519 107 B, `pageProps.ad` complete                                                         |
| `GET /_next/data/{buildId}/pl/wyniki/....json`         | `200`, 215-458 KB, pure JSON                                                                      |
| `GET /_next/data/{buildId}/pl/oferta/...json?id=4CZR6` | `200`, 78 315 B                                                                                   |
| Filters `priceMin/priceMax/areaMin/roomsNumber`        | Applied; echoed in `filteringQueryParams`; 3 283 items / 92 pages                                 |
| `daysSinceCreated=1`                                   | `200`, 234 items - newest `2026-09-16 18:55:51`                                                   |
| Sort `by=LATEST&direction=DESC`                        | Correct descending `createdAtFirst` order                                                         |
| `limit=24 / 48 / 72`                                   | `itemsPerPage` honoured; `len(items) == limit + 1`                                                |
| 8 consecutive requests                                 | 8x `200`, 0.57-1.02 s, no throttling                                                              |
| Anti-bot challenge                                     | None                                                                                              |
| Invalid `buildId`                                      | `404`, body `{}`                                                                                  |
| `x-nextjs-data` header omitted                         | Still `200`                                                                                       |
| `searchingCriteria` params omitted                     | Still `200`                                                                                       |
| GraphQL introspection                                  | Disabled (`"introspection disabled"`)                                                             |
| `buildId` at time of writing                           | `jGmeL_RAnlKZBDWFZwXZe` (expect it to have changed)                                               |
| `fetch_offer()` on a live offer URL (7.1)              | `200`, `ad` object with 62 keys, all summary fields populated                                     |
| Nonexistent offer slug                                 | `HTTPError 404`                                                                                   |
| `characteristics[].localizedValue`                     | Populated for numeric/monetary entries only; **empty string for every enum entry** - read `value` |
| `createdAtFirst` on a never-bumped offer               | **`null`** - use the `published_at()` fallback from section 6                                     |
| Cloudflare Workers limits (2026-09-19)                 | Fit with large margin; `fetch()` wait does not consume CPU time                                   |
| Cloudflare Workers TLS control                         | None - no cipher/ALPN control, so the OLX workaround cannot run there                             |
| Cloudflare egress IP against Otodom                    | **Not verified** - deliberately; a 403 is handled by the fallback, see section 9.1                |

Performed 2026-09-22 while building Vetpad's single-offer ingestion (FR-004), with
`npm run otodom:inspect -- <url>` (`scripts/otodom-inspect.mjs`) — rerun it to
reproduce any row:

| Check                                                   | Result                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ad.adCategory` on flat sale / flat rental / house sale | `{101, FLAT, SELL}` / `{102, FLAT, RENT}` / `{201, HOUSE, SELL}` — the gate's discriminator (7.4)         |
| `ad.category.name`                                      | Empty array — **not** a usable discriminator                                                              |
| `ad.transaction` on an offer page                       | Absent; exists only on search-result items (section 6)                                                    |
| `ad.market` on a rental                                 | `ALL` — does not identify the transaction                                                                 |
| `characteristics.rent`                                  | `"0"` (2026-09-20), key absent (house), `"1"` (rental) — absent or `≤ 0` reads as unknown (7.1)           |
| `features` on a flat whose text names balcony and lift  | `[]` — an empty list is not a statement of absence                                                        |
| `location.address`                                      | `city`, `district`, `province` `null`; only `street.name` set — label comes from `reverseGeocoding` (7.3) |
| `owner`, `contactDetails`, `agency`                     | First two filled with name and phones; `agency` `null`                                                    |
| `target`                                                | Carries `seller_id` and `user_type` besides the ad attributes — never stored whole (7.4)                  |
| `advertType`                                            | Top-level on `ad` (e.g. `PRIVATE`), not a `characteristics` entry                                         |
| `shouldShowExpiredAdPage`                               | Can sit on `ad` itself, not only on `pageProps` — check both (7.1)                                        |

Re-run the checks in these tables before trusting the document; Otodom is a moving
target and the payload shape is not a contract.
