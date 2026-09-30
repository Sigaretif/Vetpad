---
date: 2026-09-30T21:00:40+02:00
researcher: Claude (Opus 5.5) for Wiktor Ortel
git_commit: 81d9d9bd29871c80ed06785d0e73a309b2461e80
branch: master
repository: 10xDevs4
topic: "Ground rollout Phase 1 of test-plan.md — risks #1, #6 (storage), #7 and the Vitest + getViteConfig toolchain"
tags: [research, testing, ingestion, otodom, safe-url, vitest, astro-container]
status: complete
last_updated: 2026-09-30
last_updated_by: Claude (Opus 5.5)
---

# Research: Ground rollout Phase 1 — ingestion guardrails, seller data in storage, stored-URL rendering

**Date**: 2026-09-30T21:00:40+02:00
**Researcher**: Claude (Opus 5.5) for Wiktor Ortel
**Git Commit**: 81d9d9b (working tree has uncommitted changes to CLAUDE.md, skills and the new test-plan; none touch `src/`)
**Branch**: master
**Repository**: 10xDevs4

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` (risks #1, #6 storage half, #7): find the real failure path of each risk in code, verify or correct the Risk Response Guidance, locate existing tests, name the cheapest useful test layer, flag speculative risks or misleading hot-spot evidence, and check whether Vitest + `getViteConfig` runs cleanly alongside `@astrojs/cloudflare` and `astro:env`.

## Summary

1. **Toolchain: Vitest 5.0.3 + a plain `getViteConfig()` does NOT start in this project.** Both a worker and I re-ran this in a scratch copy of the repo. It fails with a startup error, `ReferenceError: module is not defined at runInRunnerObject (workers/runner-worker/index.js:107)`, because `@astrojs/cloudflare` 14.3.1 registers `@cloudflare/vite-plugin`. That plugin boots workerd inside Vitest's Vite server. It **does** run when the Astro config passed to `getViteConfig` has the adapter removed (config below). With that config, 4 files / 6 tests passed in 1.39 s: a pure unit test, an `astro:env/server` import, and Container API renders of `OfferGallery.astro` and `OfferBoardItem.astro` with the React renderer. Cloudflare's Workers pool packages peer on `vitest ^4.1`, so running tests *inside* workerd would mean Vitest 4, not 5. Nothing in `src/` needs that today.
2. **#1 is well defended in code, and none of it is tested.** Save and refuse are decided in exactly one place. `ingestOffer` (`src/lib/otodom/index.ts:21-32`) runs normalise → fetch → map, and the route performs its single `insert` only after `result.ok` (`src/pages/api/offers.ts:79-87`). No other `src/` path writes `offers`. The unknown-not-zero rule has two layers: `numericOrUnknown` (`map.ts:65-77`) and DB `CHECK (x is null or x > 0)` on 7 numeric columns (`supabase/migrations/20260926155042_offers_numeric_facts_positive.sql:32-39`). Today the only verification is a manual run of `scripts/otodom-inspect.mjs` against live listings, recorded in the archived plan. There are no automated tests.
3. **Fixture source: there are no recorded `__NEXT_DATA__` payloads anywhere in the repo, and `otodom-inspect.mjs` cannot dump one.** The oracle for fixtures is the documented shapes in `otodom_fetching.md` §7.1/§7.3/§7.4 and §13. Recommendation: hand-author minimal `ad` fixtures from those shapes, with **synthetic canary** seller data. Do not commit recorded third-party payloads: `.gitignore` covers only `*offer-real*` screenshots, and the repo already carries one real seller's phone and name in a doc (see Open Questions).
4. **#6 (storage): the whitelist is key-level and holds.** In a probe fixture I put a phone and name into `owner`, `contactDetails`, `agency` and `target.seller_id`. None of those values reached the mapped row. The canary *did* reach the row through `description` and `raw.description`, which the PRD explicitly requires to be stored verbatim (`prd.md:126`). The test must therefore assert **both** things: forbidden fields absent, and advertiser-typed text preserved. Otherwise the oracle will push toward redacting the description.
5. **#7: all 3 render sites of stored URLs are guarded by `safeHttpsUrl` and render nothing on `null`:** the card source link, the gallery, and the board thumbnail. S-08 does not exist yet. Two corrections to the guidance:
   - (a) `OfferGallery.astro:15-16` dereferences `image.thumbnail` without a null check. A `null` element in `offers.images` (PATCHable by any member) throws a TypeError while the card renders.
   - (b) `raw.images` keeps the **unfiltered** image URLs, including `javascript:` ones: the whitelist picks keys, not values. `raw` is rendered nowhere today (grep over `src/`). That makes this a latent risk for S-04 and later views, not a live one.
6. **Hot-spot evidence is partly misleading.** `map.ts` has 2 commits in the last 30 days: creation on 09-22 and impl review on 09-23. The later `src/lib/otodom/` commits touched `types.ts`/`labels.ts` for author naming. Most `src/lib/` churn is criteria, members and notes. Churn in the ingestion code measures creation, not instability. The real likelihood drivers for #1/#6 are upcoming second writers: re-fetch (FR-009), the Apify fallback, and the S-04 prompt reading `raw`.

## Detailed Findings

### Toolchain: Vitest + getViteConfig + Cloudflare adapter + astro:env

These results come from a scratch copy (`<scratchpad>/vitest-probe`). The real repo was not modified, and `git status` is unchanged.

- **Versions resolved:**
  - vitest 5.0.3 (peer `vite ^6.4 || ^7 || ^8`, no peer warnings);
  - vite 8.3.0 shared with astro 7.3.2;
  - @astrojs/cloudflare 14.3.1 / @cloudflare/vite-plugin 1.54.8;
  - @astrojs/react 6.0.5;
  - Node v22.23.2. CI uses `node-version: 22` (`.github/workflows/ci.yml:16`).
- **Default config fails.** `getViteConfig({ test: { include: [...] } })` fails at startup before any test runs. I reproduced it myself:
  ```
  ⎯⎯⎯ Startup Error ⎯⎯⎯
  ReferenceError: module is not defined
      at runInRunnerObject (workers/runner-worker/index.js:107:3)
  ```
  Fixes that did **not** work:
  - `{ adapter: undefined }` as the 2nd argument, because it is merged over the file config and the adapter stays;
  - `test.environment: "node"`;
  - `ssr.noExternal: []`.
- **Working config** (verified, 4 files / 6 tests pass):
  ```ts
  /// <reference types="vitest/config" />
  import { getViteConfig } from "astro/config";
  import astroConfig from "./astro.config.mjs";

  // The Cloudflare adapter boots workerd inside Vitest's Vite server and fails there;
  // tests run in Node, so they get the project's Astro config minus the adapter.
  const { adapter: _adapter, ...withoutAdapter } = astroConfig;

  export default getViteConfig({ test: { include: ["tests/**/*.test.ts"] } }, { ...withoutAdapter, configFile: false });
  ```
  It keeps the React integration, the Tailwind plugin and `env.schema` from the single source, `astro.config.mjs`. No workerd starts. Consequence: code that later imports `cloudflare:*` would not resolve under this config. No `src/` file does today (worker grep).
- **`astro:env/server` resolves under Vitest.** With no `.env`, `SUPABASE_URL`/`SUPABASE_KEY` are `undefined` and `createClient` (`src/lib/supabase.ts`) returns `null`. **Not isolated:** a root `.env` or shell variables leak into tests and turn `createClient` into a real client. The user's working tree has a real `.env`, and CI's `smoke` job writes one (`ci.yml:43-47`). A test that relies on zero-config must `vi.mock("astro:env/server", () => ({ SUPABASE_URL: undefined, SUPABASE_KEY: undefined, getSecret: () => undefined }))`. The worker verified this passes with `.env` present.
- **Container API needs the React renderer, even for `.astro` components.** `OfferGallery`/`OfferBoardItem` render React `Card`/`Badge` from `src/components/ui/` server-side. Without renderers the render fails with `NoMatchingRenderer: Unable to render CardHeader`. Passing `renderers: await loadRenderers([getContainerRenderer()])` from `astro:container` + `@astrojs/react/container-renderer` fixes it. Context7 `/withastro/docs` says the API is experimental and may break in minor/patch releases.
- **Lint and typecheck:**
  - `npx astro check`: 0 errors, and it does type-check test `.ts` files.
  - `npm run lint`: fails with `@typescript-eslint/no-unsafe-argument` where a `.ts` test passes an `.astro` import to `renderToString`, because nothing declares `*.astro` for typescript-eslint. A shim fixes it: `declare module "*.astro" { const component: import("astro/runtime/server/index.js").AstroComponentFactory; export default component; }`.
  - `npm run build` still passes with `vitest.config.ts` present.
- **Zero-dependency alternative for pure modules** (my own probe). `map.ts`, `fetch.ts`, `url.ts`, `types.ts` and `safe-url.ts` have no runtime imports (`map.ts:47-48`, `fetch.ts` comment at the `OTODOM_HOSTS` copy). They load under Node 22's type stripping, which I verified by importing `map.ts` and `safe-url.ts` from a plain `.mjs` script. So #1 and #6 could be covered with built-in `node:test` and no new dependency. Only #7's `.astro` render needs Vite/Vitest. This is a genuine cost choice for `/10x-plan`, next to the user's go-ahead for vitest.
- Coverage, watch mode, jsdom/happy-dom and Vitest 4.x were not tested.

### Risk #1 — ingestion saves a false or incomplete offer

**Oracle (not the mapper):**
- `prd.md:46` (Guardrail: missing data reads "unknown", never "no", never zero).
- `prd.md:64` (US-01 AC).
- `prd.md:84` (FR-005: only a sale of a flat, refused "with an explicit message naming which of the two it failed on, and nothing is saved … after the fetch").
- `prd.md:118` (NFR: fetch failure is explicit; "No blank, partial or silently empty offer is ever created or saved").
- `prd.md:120`.
- `otodom_fetching.md`:
  - §7.1 traps at :357-376 (`rent: "0"` on `ID4CZQU`; no `rent` key on the house `ID4wZN2`; `rent: "1"` on the rental `ID4DapL`; the rule "key absent, empty, unparseable, or ≤ 0 → unknown; integer facts additionally require an integer");
  - :378-385 (`localizedValue` is `""` for every enum, so read `value`);
  - §7.4 :451-484 (gate on `ad.adCategory` cross-checked with `target.OfferType`; `category.name` is `[]`, so a gate on it never fires);
  - failure table §7.1 :316-325.

**Failure path in code:**
- Fetch → `FetchFailureReason` (`fetch.ts`, `fetchOfferAd`). A regex miss on `__NEXT_DATA__`, a JSON parse error, a missing `props.pageProps`, or `ad` not a record → `shape_changed`. `shouldShowExpiredAdPage` on `ad` or on `pageProps` → `expired`. 404/410 → `not_found`; ≥500 → `upstream_error`; other non-ok → `http_denied`; off-host redirect → `http_denied`; a non-offer path after redirect → `not_found`; abort/timeout → `timeout`; other throw → `network`.
- Map → `mapAdToOffer` (`src/lib/otodom/map.ts:203-297`), in this order:
  1. `ad` not a record → `shape_changed` (:204);
  2. `adCategory`/`target` not records → `shape_changed` (:210);
  3. `adCategory.type === "SELL"` disagrees with `target.OfferType === "sprzedaz"` → `shape_changed` with detail (:212-215);
  4. not a sale → `not_for_sale` (:216);
  5. `adCategory.name !== "FLAT"` → `not_a_flat` (+ `ProperType` as detail) (:217-222);
  6. id/title/url/description missing → `shape_changed` (:225-231);
  7. `characteristics` not an array → `shape_changed` (:232-234).
- Numbers: every numeric column goes through `numericOrUnknown` (:65-77) or `integerOrUnknown` (:80-83). Enums are read from `.value` (:242-243). A currency is kept only when its amount is non-null (:244-247). Coordinate `0` or out of range → null (:173-179).
- Route (`src/pages/api/offers.ts`):
  - `failureMessage` (:10-41) maps each reason to its own Polish message. `not_for_sale` → "…dotyczy wynajmu" (:19-20); `not_a_flat` → "…innego rodzaju nieruchomości" (:21-22). An exhaustive `never` check is at :36-38.
  - The insert (:83-87) runs only after `if (!result.ok) return fail(...)` (:79-81).
  - An insert error → `SAVE_FAILED`, and a `23505` on `otodom_id` → twin card (:89-98).
- Persistence: the insert is a single statement, so it cannot leave a partial row.
  - Required non-nulls are `source_url`, `otodom_id`, `title`, `description`, `raw` (`20260922202756_create_offers.sql`).
  - There is no DB check that `title`/`description` are non-empty. The mapper (:229) is the only guard against a blank text row.
- **Other writers to `offers`:** none in `src/`. Beyond the route, only selects exist (`dashboard.astro`, `offers/[id].astro:25`). Re-fetch (FR-009) is not built. `scripts/smoke.mjs` writes via the Data API (POST :204, PATCH `price` :764, DELETE :823).

**Behaviour I observed in a probe** (`numericOrUnknown` on inputs, not an oracle):

| Input | Result |
|---|---|
| `"0"`, `" "`, `"abc"`, `0`, `-1`, `"Infinity"`, `null`, `undefined`, `true` | `null` |
| `"12,5"` (Polish decimal comma) | `null` |
| `"1 200"` | `null` |
| `"1e3"` | `1000` |
| `"0x10"` | `16` |

§7.1 does not define "unparseable" precisely enough to settle `"1e3"`/`"0x10"` (JavaScript `Number()` accepts both) or `"12,5"` (safe direction: a stated fact becomes unknown). See Open Questions.

The gate probe was a synthetic flat-sale `ad` with the gate fields varied:
- `{FLAT, RENT}` + `wynajem` → `not_for_sale`;
- `{HOUSE, SELL}` + `sprzedaz` + `ProperType "dom"` → `not_a_flat`, detail `dom`;
- `{FLAT, RENT}` + `sprzedaz` → `shape_changed` "disagree".

**Verdict on the guidance:**
- "absent / empty / unparseable / `"0"` → unknown": **correct**, and the numeric DB checks back it up for `≤ 0`. A test should cover every numeric column (price, price_per_m, m, rooms_num, building_floors_num, build_year, rent), not only rent. It should also cover the currency rule: rent `"0"` with `currency: "PLN"` must give `rent_currency: null` as well. Otherwise the card could render a dangling currency.
- "rental and non-flat refused naming which check failed": **correct for the single-failure cases.** Add three cases:
  - a *rental house* reports `not_for_sale` only, because sale is checked first (:216 before :217);
  - an `adCategory`/`OfferType` disagreement yields `shape_changed`, a "format changed" message, not a rental/flat message;
  - the `category.name: []` trap from §7.4. A fixture where `category` says FLAT but `adCategory` says HOUSE must be refused.
- "page without usable listing data is a fetch error, nothing persisted": **correct.** The cheapest layer is `fetchOfferAd` / `ingestOffer` with `globalThis.fetch` stubbed at the HTTP edge (HTML with/without `__NEXT_DATA__`, broken JSON, no `pageProps`, `shouldShowExpiredAdPage` on either level, 403/404/410/5xx, off-host `response.url`). "Nothing persisted" is structural: the one insert sits behind `result.ok` (`offers.ts:79-87`). A route-level assertion would need a recording fake for `@/lib/supabase` (`vi.mock`) and `context.locals.user`. That costs more, and the test plan lists mocking internal modules as an anti-pattern (for #3). It is a choice for `/10x-plan`, not a requirement.
- "the mapper passes for a typical listing, so edge cases pass too": this is a valid challenge. Concretely: the house fixture must also lack the `rent` key, the rental must carry `rent: "1"`, and enum entries must carry `localizedValue: ""` with the token in `value`. These are the three documented shapes a typical-listing fixture never exercises.

**Existing tests:** none.
- No `*.test.*`/`*.spec.*` outside `.claude/skills/**`.
- No runner in `package.json`.
- The archived plan records "Unit Tests: Brak" and manual `otodom-inspect` runs against three live listing types (`context/archive/2026-09-22-paste-listing-to-card/plan.md:437`, progress 2.7-2.10).
- `smoke.mjs` hits `/api/offers` only on paths refused before the fetch (anon :447, JSON body :498, empty :503, foreign host :508, non-offer path :513). It never exercises the gate, the mapper or the positive-number checks.

### Fixture source

- **No recorded payload exists.** `git ls-files` finds no `.json`/`.html` fixture, and a grep for `__NEXT_DATA__|adCategory|contactDetails` outside `node_modules`/`dist`/`.astro` hits only docs, plans, `map.ts` and `fetch.ts`.
- **`scripts/otodom-inspect.mjs` prints three sections to stdout and has no file write.** It never prints `owner`/`contactDetails` (:55-86; impl-review F8).
- **Seeds usable as the fixture oracle are prose and tables in `otodom_fetching.md`:**
  - gate triples §7.4 :459-461;
  - rent variants :357-376;
  - `localizedValue` :378-385;
  - `category.name: []` :439;
  - `location.address` with only `street.name` filled :444;
  - `images[]` entry keys `thumbnail, small, medium, large, isExterior` :470;
  - `shouldShowExpiredAdPage` :324;
  - seller keys `owner`/`agency`/`contactDetails` :387-393, :448;
  - `target.seller_id`/`user_type` :442.
- **Recommendation:** hand-author small fixtures from these documented shapes. Each fixture should carry the same synthetic canaries (e.g. phone `+48 600 000 001`, name `Kanarek Testowy`) in `owner`, `contactDetails`, `agency`, `target.seller_id`/`user_type` and `location.address`. This keeps third-party data and real PII out of a public repo. It also makes the oracle the doc rather than a live page. A recorded payload would need a new `.gitignore` rule or scrubbing, since `.gitignore:31` matches only `context/**/screenshots/*offer-real*`.
- **Gap:** the docs list key names, not the full nested content of `images[]`, `characteristics[]` and `reverseGeocoding`. "No seller data inside whitelisted keys" rests on the 62-key observation (`otodom_fetching.md` :606/:712), not on a stored payload.

### Risk #6 (storage half) — seller phone or name reaches the database

**Oracle:**
- `prd.md:125` says seller phone and name are "discarded at the point of fetch and no part of the product retains them".
- `prd.md:126` says the rule "covers the portal's contact fields, not the listing's own words". Title and description "are stored exactly as the advertiser wrote them, even when the advertiser typed a phone number or a name into them".
- `otodom_fetching.md:48-51` (§1) and :387-393 (§7.1): `owner`, `agency`, `contactDetails` carry name and phone; `target` repeats `seller_id` (and `user_type`).

**Code:**
- `RAW_AD_KEYS` (`map.ts:11-22`), `RAW_LOCATION_KEYS` (:25), `RAW_TARGET_KEYS` (:32);
- `buildRaw` via `pickKeys` (:139-152);
- structured columns read only named paths (:255-295);
- the persisted row is `{ ...result.offer, source_url: result.url, created_by: user.id }` (`offers.ts:83-87`). Nothing else is added.

**Probe (observed):** a flat-sale `ad` carrying `owner: {name, phones}`, `contactDetails: {phones, name}`, `agency: {name}`, `target.seller_id/user_id`, `location.address.street`, plus the same phone/name typed into `description`. The mapped result:
- dropped `owner`/`contactDetails`/`agency` and the `target` ids;
- `JSON.stringify(result)` contained the canary name only via `description`/`raw.description`, as the PRD requires;
- `raw.target` = `{OfferType, ProperType}` only;
- `raw.location` = `{coordinates}` only; the street went to the `street_name` column, which the PRD does not forbid (worker: no PRD rule on street name).

**Verdict on the guidance:**
- "assert absence of forbidden fields": **correct.** The practical form is a serialised-row search for canary strings (`JSON.stringify(row)` must not contain the phone digits, the canary name or the seller id) plus key-absence checks on `raw`. That catches a nested leak that per-field assertions miss.
- **Correction:** the test must also assert that a phone or name the advertiser **typed into the description is kept** (`prd.md:126`). Without that, the obvious "fix" for a canary hit is to redact the description, which breaks FR-011's verbatim excerpts.
- "the mapper whitelist is enough": for today's single writer the persisted row equals the mapper output plus two app-owned fields, so a mapper-level test is the cheapest layer with full signal. The challenge becomes real with future writers: re-fetch (FR-009) and the Apify fallback, whose `sellerPhone`/`agencyName` fields (`otodom_apify.md` §6.1 :297-310) bypass `mapAdToOffer`'s input shape. Each of those needs the same canary test when it lands. That belongs in the §6 cookbook entry, not in this phase.
- `raw` also stores the **original HTML** `description` (the `description` column is plain text via `htmlToPlainText`, :118-137). That matters for S-04 prompt assembly (Phase 4), not for storage privacy.

### Risk #7 — stored non-https URL renders into href/src

**Guard:** `safeHttpsUrl` (`src/lib/safe-url.ts:7-15`) returns `parsed.href` only for protocol `https:`, and `null` for non-strings and parse failures.

My probe observed:

| Input | Result |
|---|---|
| `javascript:alert(1)`, `http://x`, `//x.pl`, `data:text/html,1` | `null` |
| `HTTPS://x.pl/a` | `https://x.pl/a` |
| `https:x` | `https://x/` |
| `" https://x"` | `https://x/` |

Host is not checked, so any https host a member PATCHes into `source_url` is linked as "Otwórz oryginał na otodom.pl". That is out of #7's scheme scope; noted only.

**Every view rendering a stored URL.** The worker checked every file under `src/` with a grep for `href=|src=|srcset|action=|poster=`. There are exactly 3 scheme-controlled sites, all guarded:

1. Card source link. `src/components/offers/OfferCard.astro:34` has `const sourceUrl = safeHttpsUrl(offer.source_url);`. At :57-59 it renders `{sourceUrl && (<a href={sourceUrl} …>)}`, so `null` means no link.
2. Gallery. `src/components/offers/OfferGallery.astro:15-19` does `flatMap`, keeping only entries whose `thumbnail` **and** `large` both pass; it renders `href={image.large}` (:38) and `src={image.thumbnail}` (:44). Zero entries renders "Ogłoszenie nie zawiera zdjęć." (:29-32).
3. Board thumbnail. `src/components/offers/OfferBoardItem.astro:31-36` takes the first `safeHttpsUrl((image as Partial<OfferImage> | null)?.thumbnail)`, which is null-safe. `null` renders a placeholder div with no `<img>` (:48-52).

Internal links such as `/offers/${offer.id}` interpolate a `uuid` primary key, so their scheme is not controllable. There is no `set:html`, `dangerouslySetInnerHTML` or `innerHTML` anywhere in `src/` (worker grep). `raw`, `latitude` and `longitude` are not rendered anywhere.

**S-08 (map link) does not exist.** `roadmap.md:176-186` and FR-008 (`prd.md:90`) say it is built "from the scraped location text", which means `location_label` (maybe `street_name`) interpolated into a Google Maps URL. The risk there is query-string construction on a constant https base (`URL`/`encodeURIComponent`), not a stored scheme. Research cannot ground code that does not exist. The S-08 plan should carry the render test.

**Verdict on the guidance:**
- "a non-https URL never reaches href/src; null renders no link/image": **correct**, and Container API render tests on `OfferCard`, `OfferGallery` and `OfferBoardItem` are the cheapest layer that proves the *view* is safe, independent of the mapper. The worker's probe rendered `OfferGallery` with a `javascript:` image and `OfferBoardItem` with a leading `javascript:` thumbnail. Both outputs contained no `javascript:`.
- "the mapper filters URLs, so the view is safe": **confirmed as the wrong assumption.** Stored rows are PATCHable by any member (update policy on all columns, `create_offers.sql:101-107`). There is no DB check on `source_url`/`images` (impl-review F1 "Fix B" not adopted). `raw.images` keeps the unfiltered URLs.
- **Correction or addition 1:** `OfferGallery.astro:16` reads `image.thumbnail` on each element with no null guard. `OfferCard.astro:31` checks only `Array.isArray(offer.images)`. So `images: [null]` throws a TypeError while the card renders. My inference is that this makes an HTTP 500 on `/offers/<id>`. I did not run it, and `offers/[id].astro` has no render-time catch. The board handles the same case with `?.`. A render test with `[null]`, `[42]` and `[{}]` elements would catch it. The fix belongs to `/10x-plan` (the lesson says a null result renders nothing; it says nothing about crashing).
- **Correction or addition 2:** the invalid inputs the fixtures (`src/pages/dev/_offer-fixtures.ts:141-156`, `unknownOffer` :86) do not cover today:
  - `javascript:` in `source_url` (only `http:` is covered);
  - a valid thumbnail with a hostile `large`, which is the only case exercising the "both must pass" rule;
  - null or non-object elements;
  - `data:`, `//host`, `JAVASCRIPT:` and leading whitespace.
- The lesson in `lessons.md:7` names `src/pages/offers/[id].astro` as the source-link site. The guard now lives in `OfferCard.astro:34`, so the anchor is stale.

**Existing tests:** none automated.
- Hostile URLs were checked by eye via kitchen-sink screenshots (`context/archive/2026-09-23-ui-offer-card/plan.md:423`; `context/archive/2026-09-26-shared-offer-board/plan.md:225,253,430`).
- `smoke.mjs` has no hostile-URL assertion. Its fixture offer has no images and an `https://example.com/smoke/<id>` source.

## Code References

- `src/lib/otodom/index.ts:21-32` - `ingestOffer`: normalise → fetch → map, the single save/refuse decision
- `src/lib/otodom/fetch.ts` (`fetchOfferAd`) - `__NEXT_DATA__` regex, HTTP/redirect/expired/shape failure reasons
- `src/lib/otodom/map.ts:11-32` - `RAW_*_KEYS` whitelists
- `src/lib/otodom/map.ts:65-83` - `numericOrUnknown`, `integerOrUnknown`
- `src/lib/otodom/map.ts:203-234` - gate order and required-field checks
- `src/lib/otodom/map.ts:181-191` - `mapImages` https filter (columns only; `raw.images` unfiltered)
- `src/pages/api/offers.ts:10-41` - one message per failure reason
- `src/pages/api/offers.ts:79-98` - insert only after `result.ok`; `23505` twin path
- `supabase/migrations/20260926155042_offers_numeric_facts_positive.sql:32-39` - DB `> 0` checks on 7 numeric columns
- `src/lib/safe-url.ts:7-15` - `safeHttpsUrl`
- `src/components/offers/OfferCard.astro:31,34,57-59` - source link guard; `images` array check only
- `src/components/offers/OfferGallery.astro:15-19,29-32,38,44` - gallery guard; no null-element guard
- `src/components/offers/OfferBoardItem.astro:31-36,48-52` - board thumbnail guard (null-safe)
- `src/pages/dev/_offer-fixtures.ts:86,141-156` - existing hostile-URL fixtures
- `scripts/otodom-inspect.mjs:11-13,55-86` - Node type-stripping import; stdout only
- `.gitignore:31` - only `*offer-real*` screenshots ignored

## Architecture Insights

- The ingestion modules are deliberately runtime-import-free, so Node can load them. That makes them testable without Vite, and `node:test` is an option.
- Guardrails are layered: ingest filter (mapper) → DB checks (numeric only) → render guard (URLs). Only the render layer protects against a member's PATCH, so #7 tests belong on the views, not on the mapper.
- The Cloudflare adapter couples every Vite-based tool to workerd. Tests must receive the Astro config without the adapter, and the `vitest.config.ts` comment should say why.

## Historical Context (from prior changes)

- `context/archive/2026-09-22-paste-listing-to-card/plan.md:437` - "Unit Tests: Brak"; the mapper was verified manually against live listings (progress 2.4-2.11 at 19d2e68). 2.11 (no phone or name) was confirmed only indirectly, by whitelist and grep. **Supported:** consistent with the code today.
- `context/archive/2026-09-22-paste-listing-to-card/plan.md:477` (D2) - `target` narrowed from whole to `{OfferType, ProperType}`. **Supported:** `map.ts:32`.
- `context/archive/2026-09-22-paste-listing-to-card/reviews/impl-review.md:32-49` (F1) - `safeHttpsUrl` + gallery filter + https-only source link + `mapImages` filter; the DB check (Fix B) was not taken. **Supported**, except the source-link site moved from `[id].astro` to `OfferCard.astro:34`.
- `context/foundation/lessons.md:7` - rule on `safeHttpsUrl`. **Partial:** the rule holds; its file anchor is stale.

## Related Research

Not applicable. This is the first research artifact under `context/changes/testing-ingestion-guardrails/`.

## Open Questions

1. **Vitest vs `node:test` for #1/#6.** Vitest needs the user's go-ahead (CLAUDE.md `## Testing`). `node:test` needs no dependency but cannot render `.astro`. Is one runner (Vitest) for everything preferred, or a split? This is the user's decision in `/10x-plan`.
2. **"Unparseable" boundary** for `numericOrUnknown`: should `"1e3"` / `"0x10"` count as stated numbers? `otodom_fetching.md` §7.1 does not say. Otodom was never observed sending them, so this is low impact. The test oracle should pick one explicitly rather than copy `Number()`'s behaviour.
3. **Rental house message:** FR-005 wants the message to name "which of the two it failed on". When both fail, the code names only "rental". Is that acceptable, or should the PRD say which wins?
4. **Gallery null element → likely 500:** fix in this phase (the render test would expose it), or record it and fix separately? This is a planning choice.
5. **Real PII already in the repo:** `context/foundation/ingestion/otodom_apify.md:298-299` (tracked) contains what looks like a real private seller's phone number and name, in a public repository. It is outside this phase's code scope, but it is exactly the data class risk #6 protects. The user should decide on redaction (rewriting git history is forbidden by CLAUDE.md, so only a forward edit is possible).
6. **`raw.images` stores unfiltered URLs:** harmless while `raw` is unrendered. Should S-04/Phase 4 or the mapper filter values, not just keys? Defer to the phase that first reads `raw`.
