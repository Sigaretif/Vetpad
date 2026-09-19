# Fetching data from olx.pl

Reference notes for building a daily "new apartment listings" notifier.
Everything below was verified live against production olx.pl on **2026-09-16**
from a Polish residential IP using Python `requests` (no browser, no proxy,
no API key, no cookies).

**Target use cases**

1. Fetch a list of flats for sale matching a set of filters.
2. Fetch one specific offer in full detail.

**Deployment context assumed by this document:** a cloud VM, one cron run per day,
notifications delivered by email.

**Companion document:** `otodom_fetching.md`. Read section 12 of this file before
combining both sources - roughly 40% of OLX real-estate results are Otodom
cross-posts.

---

## 1. Legal and robots.txt boundaries

Unlike Otodom, OLX **explicitly whitelists a JSON API** in its own robots.txt.

`https://www.olx.pl/robots.txt` (fetched 2026-09-16), `User-agent: *`:

| Rule                                                                                                                                                                                                                                                                                                      | Consequence for this project                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `Disallow: /api/`                                                                                                                                                                                                                                                                                         | The API namespace is closed by default...                                  |
| `Allow: /api/v1/offers/`                                                                                                                                                                                                                                                                                  | **...except this one, which covers both use cases.** Explicitly permitted. |
| `Allow: /api/v1/targeting/`                                                                                                                                                                                                                                                                               | Permitted, not needed here.                                                |
| `Allow: /api/v1/friendly-links/`                                                                                                                                                                                                                                                                          | Permitted. Probed, but no working request shape found (see 4.4).           |
| `Disallow: */ajax/`, `/adminpanel/`, `*/facebook/`, `*/rss/`, `*/konto/`, `*/mojolx/`, `/drukuj/`, `/oferta/ulotka/`, `/oferta/kontakt/`, `/platnosci/`, `/searchform/`, `/nowe-ogloszenie/confirm*`, `/i2/oferta/abuse/`, `/m/oferta/abuse/`, `/i2/oferta/kontakt/*`, `/api/open/oauth/token/`, `*/i2/*` | Never touch.                                                               |
| `Allow: /`                                                                                                                                                                                                                                                                                                | Regular search pages and offer pages are fine.                             |

This is a materially better legal position than Otodom: the primary data source
here is an endpoint the site owner has explicitly opened to automated clients.

Remaining considerations:

- OLX's Terms of Service still restrict automated data collection. robots.txt
  compliance does not override the ToS. For a personal, low-volume notifier the
  practical risk is low, but it is a deliberate choice.
- **GDPR is easier here than on Otodom.** The API never returns a phone number.
  `contact.phone` is a boolean flag (`true`/`false`) meaning "this seller has a
  phone number", and `contact.name` / `user.name` are first names only. There is no
  sensitive payload to accidentally persist.
- Do not redistribute scraped content.

---

## 2. The blocker: TLS-fingerprint filtering

**This is the single most important thing in this document.** OLX sits behind AWS
CloudFront with a WAF that rejects requests based on the TLS handshake
fingerprint (JA3), not on HTTP headers. A default OpenSSL client is blocked
outright, including on the homepage.

Verified behaviour:

| Client                                                               | Result    |
| -------------------------------------------------------------------- | --------- |
| `curl` 7.81 / OpenSSL 3.0.2, full Chrome header set, HTTP/2          | `403`     |
| `curl --http1.1`, same headers                                       | `403`     |
| Python `requests` with the default SSL context                       | `403`     |
| `wget` (different handshake shape)                                   | `200`     |
| Python `requests` with reordered ciphers + ALPN forced to `http/1.1` | **`200`** |

The block response is a CloudFront error page, 919 bytes:

```text
<TITLE>ERROR: The request could not be satisfied</TITLE>
<H1>403 ERROR</H1> ... Request blocked.
```

Sending more browser-like headers changes nothing. Only the TLS layer matters.

### 2.1 Working client (no extra dependencies)

```python
import ssl
import requests
from requests.adapters import HTTPAdapter

CIPHERS = ('ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:'
           'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:'
           'ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:'
           'ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:'
           'AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA')

UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')


class ChromeishAdapter(HTTPAdapter):
    """Shifts the OpenSSL JA3 fingerprint off the WAF blocklist."""

    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.set_ciphers(CIPHERS)
        ctx.set_alpn_protocols(['http/1.1'])
        kwargs['ssl_context'] = ctx
        return super().init_poolmanager(*args, **kwargs)


def olx_session() -> requests.Session:
    s = requests.Session()
    s.mount('https://', ChromeishAdapter())
    s.headers.update({
        'User-Agent': UA,
        'Accept': 'application/json',
        'Accept-Language': 'pl-PL,pl;q=0.9',
    })
    return s
```

### 2.2 If that stops working

The workaround above depends on the WAF's current blocklist, which can change.
Escalation path, in order of preference:

1. Re-tune the cipher list / ALPN (cheapest, no dependencies).
2. `pip install curl_cffi` and use `curl_cffi.requests` with
   `impersonate="chrome"`. This replays a real Chrome handshake and is the
   purpose-built solution. Add it only if step 1 fails.
3. A residential egress (see section 10).

A headless browser is a poor answer here: it is heavy, and it does not help if the
problem is IP reputation rather than fingerprint.

**Detection rule:** treat any `403` with a ~919-byte `text/html` body as
"fingerprint or IP blocked", never as "no results". Alert, do not retry in a loop.

---

## 3. Site architecture

Two independent routes exist. Prefer the API.

**A. `GET /api/v1/offers/`** - a versioned JSON API, robots-allowed, no auth, no
cookies. This is the documented path for both use cases.

**B. Server-rendered HTML** - the search page embeds its full state in
`window.__PRERENDERED_STATE__` as a **double-encoded JSON string** (a JSON string
containing JSON):

```python
import re, json
m = re.search(r'window\.__PRERENDERED_STATE__\s*=\s*(".*?");\s*\n', html, re.S)
state = json.loads(json.loads(m.group(1)))   # note: two passes
```

Useful parts of that state:

- `state['listing']['listing']['links']['self']` - **the exact API URL the site
  itself called.** The fastest way to translate any UI search into API params.
- `state['listing']['listing']['params']` - the same thing as a dict, e.g.
  `{"offset":0,"limit":40,"category_id":14,"region_id":2,"city_id":17871}`
- `state['listing']['filters']['data']` - the global filter catalogue (334 keys),
  see section 5.2
- `state['listing']['breadcrumbs']` - resolves category IDs

Route B is a discovery tool, not a production data source: the search HTML is
~4.2 MB versus ~375 KB for the equivalent API call.

No JavaScript execution is required for either route.

---

## 4. Use case 1: list of offers with filters

### 4.1 Request

```
GET https://www.olx.pl/api/v1/offers/
```

Verified working example (Warsaw, flats for sale, private sellers, 500-900k PLN,
40 m² and up, 2-3 rooms, secondary market):

```
https://www.olx.pl/api/v1/offers/
  ?category_id=14
  &region_id=2
  &city_id=17871
  &filter_float_price:from=500000
  &filter_float_price:to=900000
  &filter_float_m:from=40
  &filter_enum_rooms[0]=two
  &filter_enum_rooms[1]=three
  &filter_enum_market[0]=secondary
  &owner_type=private
  &sort_by=created_at:desc
  &offset=0
  &limit=50
```

Result: `200`, 375 KB, `metadata.total_elements = 373`.

```python
r = session.get('https://www.olx.pl/api/v1/offers/', params={
    'category_id': 14, 'region_id': 2, 'city_id': 17871,
    'filter_float_price:from': 500000, 'filter_float_price:to': 900000,
    'filter_float_m:from': 40,
    'filter_enum_rooms[0]': 'two', 'filter_enum_rooms[1]': 'three',
    'filter_enum_market[0]': 'secondary',
    'owner_type': 'private',
    'sort_by': 'created_at:desc',
    'offset': 0, 'limit': 50,
}, timeout=40)
```

### 4.2 Response envelope

```
{ "data": [ ...offers... ],
  "metadata": { "total_elements": 373,
                "visible_total_count": 373,
                "promoted": [0,1,2,12,13,14,25,26,27,38,39,40],
                "search_id": "...",
                "adverts": { ...ad-targeting noise, ignore... } },
  "links": { "self": {"href": ...}, "next": {"href": ...} } }
```

`links.next.href` is a ready-made absolute URL for the following page - use it
instead of computing offsets yourself.

### 4.3 Category and location IDs

From `state['listing']['breadcrumbs']`:

| Level | Label                     | `category_id` |
| ----- | ------------------------- | ------------- |
| L0    | Nieruchomości             | `3`           |
| L1    | Mieszkania                | `1307`        |
| L2    | **Mieszkania › Sprzedaż** | **`14`**      |

Location params, all verified:

| Param         | Example            | Notes                                                                                  |
| ------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `region_id`   | `2` = Mazowieckie  | Voivodeship                                                                            |
| `city_id`     | `17871` = Warszawa | City                                                                                   |
| `district_id` | `353` = Mokotów    | District. Verified: returns 497 items, all with `location.district.name == "Mokotów"`. |

Omitting all three searches nationwide (`200`, capped at 1000 - see 4.5).

Warsaw district IDs are exposed as plain links in the search page footer, e.g.
`?search[district_id]=365` for Białołęka. Known values: Śródmieście 351,
Mokotów 353, Ochota 355, Włochy 357, Wola 359, Rembertów 361, Żoliborz 363,
Białołęka 365, Bemowo 367, Bielany 369, Ursus 371, Ursynów 373, Wilanów 375,
Targówek 377, Praga-Północ 379, Praga-Południe 381, Wawer 383, Wesoła 533.

For any other location, read the ID out of `listing.params` on the corresponding
UI search page rather than guessing.

### 4.4 How to translate a UI search into API params

The reliable procedure:

1. Set the filters in the OLX UI, run the search, copy the resulting URL.
2. Fetch that URL as HTML with the session from section 2.1.
3. Parse `__PRERENDERED_STATE__` and read
   `state['listing']['listing']['links']['self']`.
4. That is the exact, fully-parameterised API URL. Copy its query string.

`/api/v1/friendly-links/` is robots-allowed and looks like it exists precisely for
this translation, but three probed request shapes all returned `404`
(`{"error":{"status":404,"detail":"Parameters can not be resolved."}}`). The
`__PRERENDERED_STATE__` route above works and needs no guessing.

### 4.5 Hard limits

| Limit              | Value                     | Evidence                                                                                        |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------- |
| Max `limit`        | **50**                    | `limit=100` → `400`                                                                             |
| Result window      | **~1000**                 | `total_elements` saturates at 1000; `offset=1000` still returns 40 items, `offset=2000` → `400` |
| Items per response | `limit` + promoted extras | `limit=40` → 51 items, `limit=50` → 64 items                                                    |

The 1000-result cap means broad searches are not fully enumerable. Keep filters
narrow enough that `total_elements` stays well under 1000, otherwise you are
silently blind to part of the market.

---

## 5. Filters

### 5.1 Syntax

- **Range filters:** `filter_float_<name>:from` and `filter_float_<name>:to`
  (the colon is part of the parameter name; URL-encode it as `%3A` if your client
  does not do it for you).
- **Enum filters:** indexed array syntax, `filter_enum_<name>[0]`,
  `filter_enum_<name>[1]`, ...
- **Scalars:** plain `key=value`.

### 5.2 Verified catalogue for `category_id=14`

Extracted from `state['listing']['filters']['data']`, keeping only entries whose
`options[].categories` contain `14`:

| Param                                   | Type   | Label             | Values                                                                                                            |
| --------------------------------------- | ------ | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `filter_float_price:from` / `:to`       | float  | Cena              | PLN                                                                                                               |
| `filter_float_m:from` / `:to`           | float  | Powierzchnia      | m²                                                                                                                |
| `filter_float_price_per_m:from` / `:to` | float  | Cena za m²        | zł/m²                                                                                                             |
| `filter_enum_rooms[n]`                  | enum   | Liczba pokoi      | `one`, `two`, `three`, `four` (`four` = 4 and more)                                                               |
| `filter_enum_market[n]`                 | enum   | Rynek             | `primary`, `secondary`                                                                                            |
| `filter_enum_builttype[n]`              | enum   | Rodzaj zabudowy   | `blok`, `kamienica`, `apartamentowiec`, `loft`, `pozostale`                                                       |
| `filter_enum_floor_select[n]`           | enum   | Poziom            | `floor_-1` (suterena), `floor_0` (parter), `floor_1` … `floor_10`, `floor_11` (powyżej 10), `floor_17` (poddasze) |
| `filter_enum_furniture[n]`              | enum   | Umeblowane        | `yes`, `no`                                                                                                       |
| `owner_type`                            | scalar | Prywatnie / firma | `private`, `business`                                                                                             |
| `sort_by`                               | scalar | Sortuj            | `relevance:desc`, `created_at:desc`, `filter_float_price:asc`, `filter_float_price:desc`                          |
| `query`                                 | scalar | Free text         | e.g. `balkon`. Verified `200`.                                                                                    |

To discover filters for another category, dump the same catalogue and match on
that category's ID.

### 5.3 `sort_by=created_at:desc` does not sort by creation time

**Verified, and it matters.** With `sort_by=created_at:desc`, after removing the
promoted positions, the remaining items are sorted **descending by
`last_refresh_time`**, not by `created_time`:

```
sorted by last_refresh desc? True
sorted by created desc?      False
```

This mirrors the UI: "Najnowsze" on OLX means "most recently refreshed". A seller
bumping a three-month-old listing puts it back at position 1. There is **no
equivalent of Otodom's `daysSinceCreated`** filter.

Consequences for a notifier:

- Never treat "appears near the top" as "is new".
- Deduplicate on `id`, and judge genuine novelty from `created_time`.
- Omitting `sort_by` gives an unsorted, relevance-flavoured order - always send it
  explicitly.

---

## 6. Offer fields (identical in list and detail responses)

| Field                                                                                       | Notes                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                        | Numeric, e.g. `1098715920`. Stable. **Dedup key.**                                                                                                                                                                                                                   |
| `url`                                                                                       | Canonical OLX URL. For cross-posts this still points at olx.pl.                                                                                                                                                                                                      |
| `external_url`                                                                              | Present for partner cross-posts, points at otodom.pl. See section 12.                                                                                                                                                                                                |
| `partner`                                                                                   | `{"code": "otodom_pl"}` for cross-posts, otherwise absent/empty                                                                                                                                                                                                      |
| `title`                                                                                     | Seller-written headline                                                                                                                                                                                                                                              |
| `description`                                                                               | **Full description, HTML markup.** Included in the list response, so a detail call is usually unnecessary.                                                                                                                                                           |
| `created_time`                                                                              | ISO 8601 with offset, e.g. `2026-09-16T19:15:13+02:00`. **The real publication moment.**                                                                                                                                                                             |
| `last_refresh_time`                                                                         | Bump / refresh moment. Drives `sort_by`.                                                                                                                                                                                                                             |
| `pushup_time`, `omnibus_pushup_time`                                                        | Promotion timestamps                                                                                                                                                                                                                                                 |
| `valid_to_time`                                                                             | Expiry, typically +30 days                                                                                                                                                                                                                                           |
| `status`                                                                                    | `active`                                                                                                                                                                                                                                                             |
| `business`                                                                                  | `false` = private seller                                                                                                                                                                                                                                             |
| `offer_type`                                                                                | `offer`                                                                                                                                                                                                                                                              |
| `params[]`                                                                                  | `[{key, name, type, value:{key,label}}]`. Keys for flats: `price`, `price_per_m`, `m`, `rooms`, `floor_select`, `market`, `builttype`, `furniture`. **The cleanest source of numeric facts.** `price.value` also carries `negotiable`, `currency`, `previous_value`. |
| `key_params`                                                                                | Short list of highlighted param keys                                                                                                                                                                                                                                 |
| `location`                                                                                  | `{city:{id,name}, district:{id,name}, region:{id,name}}`                                                                                                                                                                                                             |
| `map`                                                                                       | `{lat, lon, zoom, radius, show_detailed}`                                                                                                                                                                                                                            |
| `photos[]`                                                                                  | CDN URLs on `ireland.apollo.olxcdn.com`                                                                                                                                                                                                                              |
| `contact`                                                                                   | `{name, phone: bool, chat, negotiation, courier}` - **`phone` is a flag, not a number**                                                                                                                                                                              |
| `user`                                                                                      | `{id, name, created, company_name, ...}` - first name only for private sellers                                                                                                                                                                                       |
| `shop`, `safedeal`, `delivery`, `promotion`, `category`, `isGpsrAvailable`, `protect_phone` | Metadata, mostly irrelevant here                                                                                                                                                                                                                                     |

Because the list response is complete, a one-request-per-search design is viable.

---

## 7. Use case 2: single offer

### 7.1 By numeric ID

```
GET https://www.olx.pl/api/v1/offers/{id}/
```

Verified: `200`, 9.2 KB (11.5 KB for a cross-post). Payload is
`{"data": {...}}` with the same field set as section 6.

```python
r = session.get(f'https://www.olx.pl/api/v1/offers/{offer_id}/', timeout=40)
offer = r.json()['data']
```

- Cross-posted Otodom offers are retrievable through this endpoint too.
- A nonexistent ID returns `404` with
  `{"error":{"status":404,"title":"Not Found","detail":"Ad not found."}}`.
- A withdrawn ID returns `410` with body `[]`. Treat 404 and 410 identically:
  the offer is gone. Note the body shape differs, so do not assume `.json()`
  yields a dict on error paths.
- At 9 KB this is far lighter than Otodom's 78 KB equivalent, so fetching details
  for a handful of offers per run is cheap.

### 7.2 URL in, data out (the simplest use case)

Offer URLs look like this, with the ID as the last path segment before `.html`:

```
https://www.olx.pl/d/oferta/klimatyczne-mieszkanie-w-kamienicy-CID3-ID1bKRJe.html
                                                                   ^^^^^^
```

That suffix is **not** the numeric API ID and not plain base36. It is the
numeric ID encoded in **base62 with the alphabet
`0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ`** - digits,
then lowercase, then uppercase. The alphabet is case-sensitive and the ordering
matters; the three other plausible orderings all fail.

Verified by encoding the API `id` of 13 live offers and comparing to the suffix
in their own `url` field: 12/13 exact. Then verified in the other direction by
decoding four suffixes and calling the API: all `200` with matching titles.

```python
import re

_A = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

def id_from_url(url: str) -> int:
    m = re.search(r'-ID([0-9A-Za-z]+)\.html', url)
    if not m:
        raise ValueError(f'not an OLX offer URL: {url}')
    n = 0
    for ch in m.group(1):
        n = n * 62 + _A.index(ch)
    return n

def fetch_offer_by_url(session, url: str) -> dict:
    """Any OLX offer URL -> the full offer object."""
    r = session.get(f'https://www.olx.pl/api/v1/offers/{id_from_url(url)}/', timeout=40)
    if r.status_code in (404, 410):
        raise LookupError(f'offer gone: {url}')
    r.raise_for_status()
    return r.json()['data']
```

**The 1-in-13 caveat, and why you need a fallback.** One offer in the sample had
API `id=1073600464` while its own `url` field carried suffix `1aEIvv`, which
decodes to `1073600401`. That ID returns `410`. So OLX's stored slug can be
stale relative to the current ID - observed on an Otodom cross-post. The decode
is therefore correct but the _input URL_ can be wrong, and you cannot tell the
two cases apart from the status code alone.

Fallback when the decoded ID gives 404 or 410: fetch the URL as HTML with the
same session and read the ID out of the embedded state rather than the slug.

```python
import json, re

def id_from_html(session, url: str) -> int:
    r = session.get(url, timeout=40, allow_redirects=True)
    r.raise_for_status()
    m = re.search(r'__PRERENDERED_STATE__\s*=\s*(".*?");', r.text, re.S)
    state = json.loads(json.loads(m.group(1)))     # double-encoded, see section 3
    return state['ad']['ad']['id']
```

Confirm the shape of that last path against a live page before relying on it;
section 3 explains the double decode and how to explore the state safely. Note
the HTML page is ~4.2 MB against 9 KB for the API call, so keep this strictly as
a fallback.

**Cross-post check first.** Before building your own detail fetch, test
`offer['partner']['code'] == 'otodom_pl'`. If true, `offer['external_url']`
points at the Otodom listing, which carries richer data (see section 12). For
those, resolving the URL through Otodom instead is the better call.

---

## 8. Detecting new offers on a daily schedule

Because sorting is refresh-based and there is no "created in the last N days"
filter, the local store does the work.

1. For each saved search, request `offset=0&limit=50&sort_by=created_at:desc`.
2. Drop the indices listed in `metadata.promoted` - they are injected ads, not
   part of the ordered result set.
3. Page via `links.next.href` while any item on the page is unknown to your store,
   capped at a few pages (e.g. 5) so a bad filter cannot start a crawl. Because
   ordering is by `last_refresh_time`, a genuinely new offer can sit below bumped
   older ones, so do not stop at the first already-seen item.
4. Keep a SQLite table: `id`, `created_time`, `price`, `url`, `external_url`,
   `first_seen_at`, `notified_at`.
5. Report an offer as new only when its `id` is unseen **and** `created_time` is
   within the lookback window (e.g. 3 days). The second condition suppresses
   long-dormant listings surfacing after a bump.
6. Optional price-drop alerts: compare the stored price against
   `params[key=price].value.value` for known IDs.
7. Email one digest per run.

Request budget: 1-2 requests per saved search per day. With 3 searches that is
3-6 requests daily.

---

## 9. Request etiquette

- **TLS:** mandatory, see section 2.
- **User-Agent:** realistic desktop Chrome UA.
- **Accept:** `application/json` for API calls.
- **Rate:** 10 back-to-back API calls all returned `200` in 0.24-0.50 s with no
  throttling. Still keep 1-2 s between requests and run sequentially. The API is
  noticeably faster than Otodom's routes.
- **Cookies:** not required.
- **Retries:** exponential backoff on 5xx and timeouts, max 3 attempts. On `403`
  abort the run and alert - retrying a fingerprint block is pointless.

---

## 10. Running in the cloud

Higher risk here than with Otodom. OLX already fingerprints clients at the TLS
layer, so a datacenter IP is more likely to attract an additional reputation-based
block. Hetzner, OVH, AWS, GCP and DigitalOcean ranges are the usual suspects.

**Run this preflight on the target VM before writing any code:**

```python
# olx_preflight.py - needs only `requests`
import ssl, requests
from requests.adapters import HTTPAdapter

CIPHERS = ('ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:'
           'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:'
           'ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:'
           'ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:'
           'AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA')

class A(HTTPAdapter):
    def init_poolmanager(self, *a, **k):
        c = ssl.create_default_context()
        c.set_ciphers(CIPHERS); c.set_alpn_protocols(['http/1.1'])
        k['ssl_context'] = c
        return super().init_poolmanager(*a, **k)

s = requests.Session(); s.mount('https://', A())
s.headers['User-Agent'] = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                           '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')
r = s.get('https://www.olx.pl/api/v1/offers/',
          params={'category_id': 14, 'city_id': 17871, 'limit': 5},
          timeout=40)
print(r.status_code, len(r.content))
print(r.json()['metadata']['total_elements'] if r.ok else r.text[:200])
```

- `200` plus a result count -> proceed as documented.
- `403` -> try `curl_cffi` with `impersonate="chrome"`; if that also fails the IP
  is the problem. A residential host (an always-on Raspberry Pi with a daily cron
  fits a once-a-day job perfectly) or a Polish residential proxy are the remaining
  options.

Prefer a Polish or European egress.

---

## 11. Failure modes

| Symptom                               | Cause                                                                                                                             | Action                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `403`, ~919-byte HTML CloudFront page | TLS fingerprint or IP blocked                                                                                                     | Section 2.2 / section 10. Alert, do not loop.                                                                            |
| `400` on a list request               | `limit > 50`, or `offset` beyond the ~1000 window                                                                                 | Clamp both                                                                                                               |
| `404` `"Ad not found."`               | Offer removed or expired                                                                                                          | Mark as gone locally                                                                                                     |
| `410` with body `[]`                  | Offer withdrawn, or the URL slug is stale (section 7.2)                                                                           | Retry once via the HTML fallback in 7.2; if that also fails, mark as gone                                                |
| `200` with `total_elements: 0`        | **Invalid filter value silently ignored.** Verified: `filter_enum_rooms[0]=siedem` returns `200` and an empty list, not an error. | Validate values against the section 5.2 catalogue before sending; treat a sudden drop to 0 as a bug, not as "no results" |
| Top results are old                   | Expected - `sort_by` is refresh-based                                                                                             | Section 5.3                                                                                                              |
| Item count exceeds `limit`            | Injected promoted ads                                                                                                             | Section 4.5                                                                                                              |
| `__PRERENDERED_STATE__` regex misses  | Search-page markup changed                                                                                                        | Only affects discovery, not the API path                                                                                 |
| Results plateau at 1000               | Result-window cap                                                                                                                 | Narrow the filters                                                                                                       |

Design so that any unexpected shape raises. A notifier that quietly reports
"nothing new" forever is worse than one that crashes.

---

## 12. Deduplicating against Otodom

**In a sampled Warsaw result set, 20 of 51 offers (~40%) were Otodom
cross-posts.** They are marked unambiguously:

```text
{ "partner": {"code": "otodom_pl"},
  "external_url": "https://www.otodom.pl/pl/oferta/...-ID4D6NX",
  "url": "https://www.olx.pl/d/oferta/...-CID3-ID1clXFL.html" }
```

If you run both scrapers, the same flat will arrive twice under two different IDs.

Recommended approach:

1. **Classify at ingest.** An OLX offer with `partner.code == "otodom_pl"` (or a
   non-empty `external_url` pointing at otodom.pl) is a cross-post.
2. **Join on the Otodom slug.** Extract the trailing `ID<code>` from
   `external_url` and use it as the canonical key. It matches the `slug` suffix in
   the Otodom data, so the two sources join exactly, with no fuzzy matching.
3. **Pick one winner per canonical key.** Prefer the Otodom record: it carries
   more structured detail (`characteristics`, `features`, `target`, build year).
   Keep the OLX ID as a secondary reference.
4. **Deduplicate native OLX offers by `id` only.** Fuzzy matching on
   title/price/area across sources is not needed once step 2 is in place, and it
   produces false positives in large new-build developments where many units share
   a title and area.
5. **Consider scope.** If you scrape Otodom anyway, filtering OLX to
   `partner`-free offers (`owner_type=private` helps, though it is not the same
   thing) gives you the genuine OLX-only supply and cuts the notification noise.
   OLX's private-seller segment is its real added value over Otodom.

---

## 13. OLX versus Otodom

|                              | Otodom                                   | OLX                                 |
| ---------------------------- | ---------------------------------------- | ----------------------------------- |
| robots.txt position          | allowed page routes                      | **explicitly allowed JSON API**     |
| Anti-bot                     | none observed                            | CloudFront WAF, TLS fingerprint     |
| Workaround needed            | no                                       | cipher reorder, no extra dependency |
| Contract stability           | `buildId` rotates per deploy             | versioned `/api/v1/`                |
| Offer payload size           | 78 KB                                    | 9 KB                                |
| Sort by creation date        | yes (`createdAtFirst`)                   | **no**, refresh-based only          |
| "last N days" filter         | `daysSinceCreated`                       | none                                |
| Result window                | 3283 items / 92 pages observed           | capped at ~1000                     |
| Max page size                | 72+                                      | 50                                  |
| Description in list response | truncated                                | **full**                            |
| Phone number exposed         | yes (GDPR concern)                       | no                                  |
| Structured attributes        | richer (build year, materials, features) | adequate (8 params)                 |

For a daily notifier OLX is technically sturdier and legally cleaner, but the
refresh-based sorting and the 1000-result cap push more responsibility onto your
local state. Running both sources with the section 12 join gives the best
coverage: Otodom for depth, OLX for private-seller supply.

---

## 14. Verification log

Performed 2026-09-16, Python `requests` with the section 2.1 adapter, Polish
residential IP, no proxy:

| Check                                                    | Result                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `curl` (default OpenSSL), any headers                    | `403`, 919 B CloudFront block                                      |
| Python `requests`, default SSL context                   | `403`, 919 B                                                       |
| `wget`                                                   | `200`                                                              |
| Python `requests` + reordered ciphers + ALPN `http/1.1`  | **`200`**, 2 029 474 B                                             |
| `GET /api/v1/offers/` with 8 filters                     | `200`, 375 688 B, `total_elements: 373`                            |
| Filters echoed in `links.self`                           | All 8 present and applied                                          |
| `GET /api/v1/offers/{id}/`                               | `200`, 9 237 B                                                     |
| `GET /api/v1/offers/{id}/` for an `otodom_pl` cross-post | `200`, 11 464 B                                                    |
| `GET /api/v1/offers/1/`                                  | `404`, `"Ad not found."`                                           |
| `district_id=353`                                        | `200`, 497 items, all `district.name == "Mokotów"`                 |
| `query=balkon`                                           | `200`                                                              |
| Nationwide (no region/city)                              | `200`, capped at 1000                                              |
| `limit=40 / 50 / 100`                                    | 51 / 64 items / `400`                                              |
| `offset=40 / 80 / 960 / 1000 / 2000`                     | 52 / 52 / 40 / 40 items / `400`                                    |
| `sort_by=created_at:desc` ordering                       | descending by `last_refresh_time`, **not** `created_time`          |
| No `sort_by`                                             | unsorted by either timestamp                                       |
| Invalid enum value (`rooms=siedem`)                      | `200` with `total_elements: 0` (silent)                            |
| 10 consecutive API requests                              | 10x `200`, 0.24-0.50 s, no throttling                              |
| Otodom cross-posts in sample                             | 20 of 51 (~39%)                                                    |
| Category IDs                                             | `3` Nieruchomości / `1307` Mieszkania / `14` Mieszkania › Sprzedaż |
| URL suffix encoding                                      | base62, alphabet `0-9a-zA-Z`; 12/13 live offers encoded exactly    |
| Decode suffix then `GET /offers/{id}/`                   | 4/4 `200` with matching titles                                     |
| Stale slug case                                          | `id=1073600464` vs suffix `1aEIvv` → `1073600401` → `410`          |
| Withdrawn offer ID                                       | `410`, body `[]` (distinct from `404` + error dict)                |

Re-run this table before trusting the document. The WAF blocklist in particular is
a moving target, and the API response shape is not a contract.
