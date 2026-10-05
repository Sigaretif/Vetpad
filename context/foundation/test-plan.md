# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-02

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

The oracle for every assertion is the PRD, the ingestion notes in
`context/foundation/ingestion/`, or the interview — never the current output
of the code under test.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`,
`scripts/` (last 30 days, 37 commits in scope; docs, `context/`, `dist/`,
`node_modules/` excluded).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                        | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ingestion saves a false or incomplete offer: an unstated attribute reads as "0 zł" or "no", a rental or a house is saved as a flat sale, or a failed/changed-shape fetch leaves a blank or partial record behind               | High   | Medium     | PRD Guardrails, NFR, FR-005; interview Q4; roadmap: upcoming second writers of offer data (re-fetch FR-009, extraction-service fallback, S-04 reading the stored raw payload). Hot-spot dir `src/lib/otodom/` (5 commits/30d) reflects the module's creation, not instability (research, Phase 1)                                                                                                                                                                                                               |
| 2   | **Denial of Wallet:** the paid AI audit can be triggered repeatedly — a loop, a double click, concurrent requests, or a request without a session — and every call is billed by the model provider                             | High   | High       | interview Q1; roadmap S-04 (next slice on Stream A); PRD NFR (correctness over cost — a slower, pricier model per call)                                                                                                                                                                                                                                                                                                                                                                                         |
| 3   | A paid audit result is lost: the model answered but the database write failed or the request timed out, the offer falls back to "Not Audited", and the same audit has to be paid for again                                     | High   | Medium     | interview Q1; PRD NFR (~3-minute audit limit, reported as failed with a retry offered); roadmap S-04 Unknowns                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | The audit reports an ungrounded finding: a red flag, cost or mandatory condition with no excerpt, with an excerpt that is not verbatim listing text, or a missing-information finding outside the decision-critical attributes | High   | High       | PRD Guardrails, FR-011, NFR (every finding traceable to a verbatim quotation); roadmap S-04                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | A write on X changes Y: a re-fetch overwrites notes, one member's action edits or deletes another member's note or requirements, a delete takes more (or less) than the PRD says it should                                     | High   | Medium     | interview Q1; PRD FR-009, FR-012–FR-015, NFR (no system action modifies human-authored text); roadmap S-09, S-10, S-11; `lessons.md` (author FK blocked account deletion); hot-spot dir `supabase/migrations/` (9 commits/30d) — the valid signal: triggers and checks there have needed correcting after review. Churn in `src/` and `scripts/` does not raise this risk: the write routes bind every row to the session's member, and the smoke churn is coverage growing with each slice (research, Phase 2) |
| 6   | Personal data escapes: the seller's phone or name reaches the database or the audit prompt, or members' notes reach the model provider                                                                                         | High   | Medium     | PRD NFR (notes never leave the system; advertiser's personal data never stored); roadmap S-04 Risk                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7   | Stored content renders unsafely: a `javascript:` (or other non-https) URL read from the database lands in `href`/`src` and runs in another member's session                                                                    | High   | Low        | `lessons.md` (impl review of `paste-listing-to-card`, F1); roadmap S-08 (map link built from stored data)                                                                                                                                                                                                                                                                                                                                                                                                       |

Abuse lens: #2 is resource abuse, #6 is PII leakage, #5 and #7 are
authorization/access. RLS as such has no dedicated row — the user verifies
it by hand on every schema change (interview Q4); its write-side behaviour is
covered through #5.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Must challenge                                                                                                                                                                                                                                            | Context `/10x-research` must ground                                                                                                                                                                                                                                                                                                                                                                                | Likely cheapest layer                                                                                                                                                                                                                                                                                                          | Anti-pattern to avoid                                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | On a listing payload built from the documented shapes, an absent, empty, unparseable or `"0"` numeric attribute becomes unknown on every numeric fact (not only rent), and a currency never survives its unknown amount; a rental and a non-flat are refused naming which check failed — including a rental house, a sale/offer-type disagreement reported as a changed format, and a payload whose generic category says flat while the ad category says otherwise; a page without usable listing data is a fetch error and nothing is persisted    | "The mapper passes for a typical listing, so the edge cases pass too"                                                                                                                                                                                     | Fixture source: no recorded payload exists — fixtures are hand-authored from the shapes documented in `ingestion/otodom_fetching.md` §7 (rental with `rent: "1"`, house without a rent key, `rent: "0"`, enums with empty localized values), carrying synthetic seller canaries, never third-party data; the persistence boundary that decides save vs refuse                                                      | unit on fixtures, network stubbed at the HTTP edge                                                                                                                                                                                                                                                                             | Expected values copied from the mapper's current output; the oracle is the PRD and `ingestion/otodom_fetching.md` §7. Committing a recorded live payload (third-party data, possible PII in a public repo) |
| #2   | A second audit request for the same offer while one is in flight does not call the provider; an unauthenticated request never calls it; the stub's call count is asserted                                                                                                                                                                                                                                                                                                                                                                            | "There are three of us behind a login, so there is no attacker" and "middleware protects `/api`"                                                                                                                                                          | Audit entry point, its auth check, where in-flight state lives (Postgres, never module scope), the provider boundary                                                                                                                                                                                                                                                                                               | integration on the audit endpoint with the provider stubbed at the HTTP edge                                                                                                                                                                                                                                                   | Asserting only a 200 status instead of the number of billed calls                                                                                                                                          |
| #3   | When the provider answered and the write failed, the result is recoverable or the failure is explicit; "in progress" does not hang forever; a retry does not pay for a result that already exists                                                                                                                                                                                                                                                                                                                                                    | "A 200 from the provider means the audit is done"                                                                                                                                                                                                         | Order of provider call vs persist, audit status states, the ~3-minute timeout path, the retry path                                                                                                                                                                                                                                                                                                                 | integration with a provider stub and a forced write failure                                                                                                                                                                                                                                                                    | Mocking internal modules instead of the network and database edges                                                                                                                                         |
| #4   | A positive finding without an excerpt, or whose excerpt is not a verbatim substring of the stored listing text, is rejected; a missing-data finding carries no excerpt                                                                                                                                                                                                                                                                                                                                                                               | "The prompt tells the model to quote, so it quotes"                                                                                                                                                                                                       | Structured-output shape, where validation happens, which stored text is the reference for matching (whitespace, quotes, diacritics)                                                                                                                                                                                                                                                                                | unit on the output validator (deterministic substring match); optional manual golden set                                                                                                                                                                                                                                       | Using an LLM to judge whether a quote is grounded when a deterministic comparison exists                                                                                                                   |
| #5   | After every write operation — a denied one and a successful one made next to another member's row — the other members' rows (notes, requirements, author columns) are identical to before, compared as whole rows with their dates, not one field; a delete of an offer takes every member's notes on that offer and nothing from another offer (FR-015); an RLS denial is recognised by its row count: a denied read, update or delete affects zero rows and raises no error, a forged insert or upsert is refused with `42501` (research, Phase 2) | "The UPDATE succeeded, so only the targeted row changed" — and "a denied cross-member update or delete surfaces as an error": it does not, and without `Prefer: return=representation` it answers 204 with an empty body, exactly like a successful write | Which operations write which tables, RLS policies per operation, cascades and freeze triggers, the denial signatures per operation and per `Prefer` header. Re-fetch, note delete and offer delete have no route yet (S-09, S-11) and archive has no schema (S-10): today only their database half is testable, through the Data API standing in for them, and each of those slices adds its own route-level check | integration in `scripts/smoke.mjs` against local Supabase — a stub cannot answer for a policy, a trigger or a cascade. One exception: a route's handling of a save that RLS filtered down to zero rows cannot be produced by the real policies for a signed-in member, so it is a hermetic route test stubbed at the HTTP edge | Asserting only "no error" or only a status — a denied write and a successful one can share it; assert the number of rows affected. Calling a row "unchanged" after comparing a single field                |
| #6   | The persisted row and the built prompt contain no seller phone or name from the portal's contact fields, and the prompt contains no notes — also when the fixture carries all of them; a phone or name the advertiser typed into the title or description is kept verbatim (PRD NFR: the rule covers contact fields, not the listing's own words)                                                                                                                                                                                                    | "The mapper whitelist is enough, so the prompt is clean" — and, for every future writer (re-fetch, extraction-service fallback), "it goes through the same whitelist"                                                                                     | The `raw` whitelist, prompt assembly inputs, every path that reads notes near the audit, every writer of offer data                                                                                                                                                                                                                                                                                                | unit on the mapper and the prompt builder: a serialised-row search for canary strings plus key-absence checks                                                                                                                                                                                                                  | Asserting only that expected fields are present, never that forbidden ones are absent. "Fixing" a canary hit by redacting the description, which breaks FR-011's verbatim excerpts                         |
| #7   | A non-https URL from a database row never reaches `href` or `src`; a `null` result renders no link or image; a malformed stored image entry (`null`, a non-object, an object without URLs) renders nothing and never breaks the card                                                                                                                                                                                                                                                                                                                 | "The mapper filters URLs, so the view is safe" — confirmed wrong: any member can update stored rows, and the stored raw payload keeps unfiltered image URLs (latent until a view or the audit reads it)                                                   | Every view that renders stored URLs (card, gallery, board, S-08 map link), and the first phase that reads the raw payload                                                                                                                                                                                                                                                                                          | unit on the URL guard plus component render through the Astro Container API                                                                                                                                                                                                                                                    | Testing only a valid URL; testing only the scheme and never the shape of the stored entry                                                                                                                  |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                           | Goal (one line)                                                                                                                                 | Risks covered        | Test types                                                                   | Status      | Change folder                                 |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------- | ----------- | --------------------------------------------- |
| 1   | Test runner and ingestion guardrails | Bootstrap Vitest and prove that ingestion never saves an invented fact, a non-flat-sale, seller data, or an unsafe URL; wire `npm test` into CI | #1, #6 (storage), #7 | unit (recorded fixtures)                                                     | complete    | context/changes/testing-ingestion-guardrails/ |
| 2   | Write isolation                      | Prove that a write on X leaves every other member's data untouched, before S-09/S-10/S-11 add more writes                                       | #5                   | integration (smoke), SQL against the local database, one hermetic route test | complete    | context/changes/testing-write-isolation/      |
| 3   | Audit cost and durability            | Prove that a paid model call cannot be multiplied and a paid result cannot be silently lost — starts only after S-04 ships                      | #2, #3               | integration (provider stub)                                                  | not started | —                                             |
| 4   | Audit grounding and prompt privacy   | Prove that no finding without a verbatim excerpt is shown and no note or seller data reaches the prompt — starts only after S-04 ships          | #4, #6 (prompt)      | unit, optional manual golden set                                             | not started | —                                             |

Phase 1 adds `vitest` to `package.json`; CLAUDE.md requires the user's
explicit go-ahead for that, which `/10x-plan` asks for. Phases 3 and 4 are
blocked on S-04 (`grounded-listing-audit`) — their protections should also be
named in the S-04 plan, so the code under test is built to be testable.

## 4. Stack

| Layer                              | Tool                                                                                                                           | Version                           | Notes                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lint + typecheck                   | ESLint, `astro check`                                                                                                          | eslint ^10.10, astro 7.3.2        | Wired in CI `ci` job                                                                                                                                                                                                                        |
| unit + integration (in-process)    | Vitest via `getViteConfig` from `astro/config` with the Cloudflare adapter stripped (`vitest.config.ts`) — checked: 2026-09-30 | vitest 5.0.3                      | `npm test`; wired in CI `ci` job since Phase 1. User go-ahead 2026-09-30 (CLAUDE.md). Runs in Node, not workerd                                                                                                                             |
| component render                   | Astro Container API (`experimental_AstroContainer`) with the React container renderer — experimental, checked: 2026-09-30      | astro 7.3.2, @astrojs/react 6.0.5 | For `.astro` output assertions without a browser; runs under `npm test`                                                                                                                                                                     |
| integration (live, local Supabase) | `scripts/smoke.mjs`                                                                                                            | n/a                               | Existing; CI `smoke` job; never reaches otodom.pl or production                                                                                                                                                                             |
| SQL against the local database     | `scripts/account-deletion.sql` through `psql` (`npm run test:db`) — checked: 2026-10-01                                        | n/a                               | Since Phase 2: account deletion, which the publishable key cannot reach. One transaction ending in `ROLLBACK`; local database only; not part of `npm test`; a step of the CI `smoke` job, run with the `psql` the runner image ships (§6.6) |
| API/provider mocking               | `globalThis.fetch` stub at the HTTP edge (`tests/fixtures/http.ts`, `stubFetch`) — checked: 2026-09-30                         | vitest 5.0.3 (`vi.stubGlobal`)    | Since Phase 1 (otodom + Supabase REST); Phase 3 reuses it for the model provider. Never `vi.mock` of internal modules                                                                                                                       |
| e2e                                | none                                                                                                                           | n/a                               | Not planned; smoke against the production preview covers critical routes                                                                                                                                                                    |
| visual gate                        | `scripts/ui-screenshots.mjs`                                                                                                   | n/a                               | Manual, per plan; not a CI gate (§7)                                                                                                                                                                                                        |
| (optional) AI-native               | manual golden-set audit eval — checked: 2026-09-30                                                                             | n/a                               | When NOT to use: in CI, on every change, or to judge excerpt grounding (deterministic check does that)                                                                                                                                      |

**Stack grounding tools (current session):**

- Docs: Context7 — checked Astro testing guide (`getViteConfig`, Container API `renderToString`, React container renderer); checked: 2026-09-30
- Search: Exa.ai — not available in current session; web search available but not needed; checked: 2026-09-30
- Runtime/browser: no Playwright MCP; claude-in-chrome skill available — not used; checked: 2026-09-30
- Provider/platform: no Supabase or Cloudflare MCP; `gh` CLI available — not used; checked: 2026-09-30

## 5. Quality Gates

| Gate                                              | Where               | Required?                                                                                                                                                                                                | Catches                                                                                                                                                       |
| ------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lint (incl. `tokensOnlyConfig`) + `astro check`   | local + CI `ci` job | required                                                                                                                                                                                                 | syntactic, type and token drift                                                                                                                               |
| build                                             | CI `ci` job         | required                                                                                                                                                                                                 | build-time breakage                                                                                                                                           |
| smoke against production preview                  | CI `smoke` job      | required                                                                                                                                                                                                 | broken routes, closed registration, RLS on notes/criteria/members                                                                                             |
| unit (`npm test`)                                 | local + CI `ci` job | required — wired in the CI `ci` job by §3 Phase 1                                                                                                                                                        | ingestion guardrail regressions, unsafe stored URLs in views                                                                                                  |
| write-isolation smoke steps and `npm run test:db` | CI `smoke` job      | required after §3 Phase 2                                                                                                                                                                                | cross-member writes, overwritten notes, a delete that takes more or less than FR-015 says, an account deletion that is blocked or takes another member's data |
| audit integration (provider stub)                 | CI                  | required after §3 Phase 3                                                                                                                                                                                | multiplied billed calls, lost paid results                                                                                                                    |
| post-edit hook running related unit tests         | local (agent loop)  | wired: `.claude/hooks/related-tests.sh`, with lint per edit and an end-of-turn sweep beside it (`.claude/settings.json`); skipped while the user's red-phase marker `.git/claude-hooks/red-phase` exists | regressions at edit time                                                                                                                                      |
| visual screenshot gate                            | local, per plan     | optional (user's call per change)                                                                                                                                                                        | rendering regressions                                                                                                                                         |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

Tag each `describe` with the §2 risk it protects, as the reference tests do:
`(#1)` for an invented or incomplete fact (unknown-not-zero, the flat-sale
gate, no blank row, an unknown shown as a value in a view, a failed read
shown as an empty state, and a team limit broken by a fact the listing does
not state), `(#5)` for a write that must leave other rows alone, `(#6)` for
seller data, `(#7)` for a stored URL in `href`/`src`.

### 6.1 Adding a unit test for an ingestion rule (unknown-not-zero on every mapped fact, flat-sale gate, seller-data whitelist)

- **Where:** `tests/lib/otodom/`, mirroring `src/lib/otodom/`, one
  `<module>.test.ts` per module (`map.test.ts`, `fetch.test.ts`). A route that
  writes offer data gets its test at the route's path under `tests/pages/api/`.
- **Reference test:** `tests/lib/otodom/map.test.ts`. Its four `describe`
  blocks are the four rules: unknown-not-zero on every numeric column and its
  currency, the flat-sale gate with its edge variants, no blank row, and the
  seller-data whitelist. A new rule gets its own `describe`; a new input to a
  rule already covered joins that rule's block. Unknown-not-zero is not only
  the `characteristics` numbers: every mapped fact that can be unstated
  (coordinates, dates, enum tokens, text) follows it.
- **Fixtures:** build the `ad` with `tests/fixtures/otodom.ts` —
  `flatSaleAd(overrides)` for a sale of a flat,
  `withCharacteristic(ad, key, patch)` to change one `characteristics` entry
  (`null` drops it), `omitKeys(ad, ...keys)` to make a key absent rather than
  `undefined`, and the
  §7.4 variants `rentalFlat`, `saleHouse`, `rentalHouse`, `typeDisagreement`,
  `categoryTrap`. They are synthetic, hand-written from
  `ingestion/otodom_fetching.md` §7, and every variant carries the same seller
  canaries (`CANARY_PHONE` and its spellings, `CANARY_NAME`, the seller and
  user ids — together `SELLER_CANARIES`). A new shape is added there from the
  document; a payload recorded from the live portal is never committed.
  Import fixtures by relative path (`../../fixtures/otodom`): `@/*` maps to
  `src/` only. For a nested key (`location.coordinates`, `adCategory`), pass
  the whole parent to `flatSaleAd({ location: { ...base.location, … } })`,
  spread from `flatSaleAd()`'s own value; once a second test needs the same
  override, move it into `tests/fixtures/otodom.ts` as a helper.
- **Oracle:** the PRD and `ingestion/otodom_fetching.md` §7. Write each
  expected value by hand from the fixture input and the rule, never from the
  mapper's output. When the rule exists in the code but neither document
  states it (the coordinate rule — `0` or out of range is unknown — is one,
  as of 2026-09-30), do not promote the code to oracle: raise it with the
  user, write the agreed rule into `ingestion/otodom_fetching.md` §7 (or the
  PRD, for a product rule) in the same change, and test against that text.
- **Seller-data pattern (#6), always both halves:** take the row, drop
  `description` and `raw.description` from a copy, `JSON.stringify` it and
  assert that no entry of `SELLER_CANARIES` occurs in it; and assert that
  `description` still contains `CANARY_PHONE` and `CANARY_NAME` verbatim. A
  canary hit is fixed in the whitelist, never by redacting the description
  (FR-011 excerpts must stay verbatim). Allowed `raw` keys are written out in
  the test as a list, not imported from the code under test.
- **Every new writer of offer data** — the re-fetch (FR-009), the
  extraction-service fallback, whose `sellerPhone`/`agencyName` carry the
  seller (`ingestion/otodom_apify.md` §6.1) — gets the same canary test, run on
  the row it actually sends to the database, not on an intermediate object.
  For the fallback, its fixture carries `sellerPhone: CANARY_PHONE` and
  `agencyName: CANARY_NAME`.
- **Fetch and route boundary:** stub the network at the HTTP edge with
  `stubFetch` from `tests/fixtures/http.ts` and `afterEach(restoreFetch)`;
  pages come from `otodomPage`, `otodomPageProps`, `pageWithNextData` and
  `PAGE_WITHOUT_NEXT_DATA`, and `responseAt(body, { status, url })` sets a
  status or the address a redirect landed on. `tests/lib/otodom/fetch.test.ts`
  is the reference for a fetch failure reason. `tests/pages/api/offers.test.ts`
  is the reference for a route: it overrides the zero-config mock with its own
  `vi.mock("astro:env/server", …)` holding `SUPABASE_TEST_URL` /
  `SUPABASE_TEST_KEY`, calls the handler with a hand-built context, and asserts
  on the recorded requests — no `POST /rest/v1/offers` on a refusal, exactly
  one on success, no canary in its body. Never `vi.mock` `@/lib/supabase` or
  `@/lib/otodom`.
- **Run:** `npm test -- tests/lib/otodom` (one file:
  `npm test -- tests/lib/otodom/map.test.ts`; the route:
  `npm test -- tests/pages/api`).
- **Pitfalls:**
  - A new numeric `characteristics` column goes through `numericOrUnknown`
    and gets the same list of unstated values the reference test uses
    (absent, `""`, `"0"`, `"-5"`, `"1e3"`, `"0x10"`, `"12,5"`, `"1 200"`,
    `null`, …), plus `"2.5"` for an integer column. A fact read by its own
    function (coordinates take numbers only, and a negative value is a real
    place) needs its own list, built from that fact's rule, not this one.
  - `new Response()` has `url === ""`, which the fetch reads as "no
    redirect"; a redirect test sets `url` through `responseAt`.
  - A request the stub did not plan fails the test in `restoreFetch`.
    postgrest-js retries a rejected GET up to three times with back-off, so an
    unplanned Supabase GET fails slowly — the documented request shapes are in
    the header comment of `tests/fixtures/http.ts`.
  - The gate reads `adCategory`, never `category`; `categoryTrap` exists to
    catch a gate moved onto the wrong field.

### 6.2 Adding a render test for stored content (URL guard, unknown presentation)

- **Where:** `tests/components/<folder>/`, mirroring `src/components/`. A
  component gets `<kebab-name>.test.ts` (`offer-board-item.test.ts`);
  `render.test.ts` holds the #7 stored-URL checks for the three offer views
  and is where a new URL check on those views goes.
- **Reference test:** `tests/components/offers/render.test.ts` (`OfferCard`,
  `OfferGallery`, `OfferBoardItem`) for stored URLs;
  `tests/components/offers/offer-board-item.test.ts` for an unknown fact.
- **Container:** create it once in `beforeAll` with
  `experimental_AstroContainer.create({ renderers })`, where `renderers` is
  `await loadRenderers([getContainerRenderer()])` — `loadRenderers` from
  `astro:container`, `getContainerRenderer` from
  `@astrojs/react/container-renderer` — and render with
  `container.renderToString(Component, { props })`. The React renderer is
  needed even for an `.astro` view, because the views render React components
  from `src/components/ui` (`Card`, `Badge`) on the server.
  `tests/astro-modules.d.ts` types the `.astro` import for lint.
- **Props:** from `src/pages/dev/_offer-fixtures.ts` (`fullOffer`,
  `unknownOffer`, `memberSaver`, `noLimits`, `malformedImagesOffer`), with one
  fact overridden by the hostile, broken or unknown value — a fact and its
  pair together where it has one (`price` with `price_currency`). A new broken state gets a
  fixture there and a section on `/dev/offer-card` (CLAUDE.md `### UI`).
- **Stored-URL assertion (#7) — a whitelist, never a blacklist:** extract every `href` and
  `src` value and assert each matches `^(?:https:\/\/|\/(?![/\\]))` — an
  absolute https URL, or an internal path that is not protocol-relative. The
  helper also compares the number of attribute names with the number of
  extracted quoted values, so a single-quoted or unquoted attribute fails the
  test instead of slipping past it. "Does not contain `javascript:`" would pass
  `data:` and `http:`. Assert the absence too (no source link text, zero
  `<img>`) and the exact URL where one must render.
- **Broken inputs:** the stored row is the attack surface — any member can
  PATCH it — so feed the view directly, with no mapper in between: schemes
  (`javascript:`, upper-case, a leading space, `data:`, `http:`, `//host`),
  `null` and non-string values, and for image lists an element that is `null`,
  a number, `{}` or a bare string, and a valid `thumbnail` with a hostile
  `large`. Each must render without throwing.
- **Unknown-fact assertion (#1):** the oracle is the PRD — Guardrails
  (missing data reads "unknown", never "no" and never zero) and the resolved
  Open Questions block for the wording „nie podano w ogłoszeniu”, rendered
  through `src/components/offers/Unstated.astro`. Assert on the visible text:
  strip the tags and collapse every run of whitespace, NBSP included (the
  `Intl` formatting in `@/lib/otodom/labels` uses it), into one space. Then
  assert both halves: the unstated phrase is there (with its label, and the
  number of times you expect it), and no zero or empty value is — a pattern
  for a bare `0` before `zł`/`PLN`/`m²` that does not match inside
  `890 000 zł`, plus `NaN`, `null` and `undefined`. A blacklist is right here,
  unlike for URLs: the failure is one known value, and the positive half
  keeps the test from passing on an empty render.
- **Run:** `npm test -- tests/components`.
- **Pitfalls:**
  - Run `npx astro sync` before `npm run lint` on a render test: the types of
    `astro:container` come from the git-ignored `.astro/` it generates, and
    without them lint reports `no-unsafe-call` on `loadRenderers`.
  - The Container API is experimental (`experimental_` prefix) and may break
    on an Astro minor or patch upgrade. After upgrading `astro` or
    `@astrojs/react`, run `npm test -- tests/components` first; a failure
    there is the API moving, not necessarily a view regressing.

### 6.3 Adding a write-isolation check for a new write path (cross-member, re-fetch, delete, archive)

- **Where — pick the layer by what can lie:**
  - A policy, a freeze trigger or the `offer_notes.offer_id` cascade:
    a step in `scripts/smoke.mjs`, against the local Supabase through the Data
    API. A stub cannot answer for any of the three. The routes are not the
    boundary — the publishable key reaches PostgREST directly — so the attack
    is sent to the Data API, and through the route as well once a route exists.
  - An `on delete` action hanging off `auth.users` (account deletion): a case
    in `scripts/account-deletion.sql`. The publishable key cannot delete an
    account, so smoke cannot reach it; the script talks to the local Postgres
    with `psql`, inside one transaction that ends in `ROLLBACK`.
  - A route branch the real policies cannot produce for a signed-in member (a
    write that RLS filtered down to zero rows): a hermetic route test under
    `tests/pages/api/`, stubbed at the HTTP edge.
- **Reference:** in `scripts/smoke.mjs`, `withSnapshot(observed, run)` and its
  two expectations, `snapshot: "same"` and `snapshot: "changed"`. It reads the
  observed rows with `select=*` in a fixed order before and after `run`, and
  reports whether they are the same, column for column, dates included. An
  observed read is `{ path, as, order }`; `observedNote(author, offerId)`,
  `observedNotes(path)` and `observedRequirements(owner)` build one. It
  composes with `withRevision` in either order.
  `tests/pages/api/criteria.test.ts` is the reference for the zero-rows
  branch of a route; `scripts/account-deletion.sql` for account deletion.
- **Oracle:** the PRD — FR-002 and FR-003 (shared limits, own requirements),
  FR-009 (notes survive a re-fetch), FR-012–FR-015 (own note only, everyone
  reads, archive, delete with its cascade), and the Non-Functional
  Requirements: "No system action modifies or destroys human-authored text",
  and the paragraph on a deleted member's account (offers and notes stay,
  unsigned, and nobody edits them; requirements go with the account). The
  table below says how PostgREST _signals_ an outcome, never what the outcome
  should be. When a new step is red with nothing broken on purpose, that is a
  defect in a migration or a route: stop and report it, never fit the
  expectation to the behaviour.
- **Count rows, never a status alone.** A denied cross-member write raises no
  error, and without `Prefer: return=representation` it answers exactly like
  a successful one. Signatures, probed on the local Supabase on 2026-10-01:

  | Attempt                                                             | `Prefer`                      | Answer                                         |
  | ------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
  | Denied read (RLS)                                                   | —                             | `200`, `[]`                                    |
  | Denied `UPDATE` or `DELETE` of another member's row                 | `return=representation`       | `200`, `[]`                                    |
  | Denied `UPDATE` or `DELETE` of another member's row                 | none                          | `204`, empty body                              |
  | Successful `UPDATE` or `DELETE`                                     | `return=representation`       | `200`, the rows it touched                     |
  | Successful `UPDATE` or `DELETE`                                     | none                          | `204`, empty body — the same as the denied one |
  | `UPDATE` or `DELETE` whose filter reaches several members' rows     | `return=representation`       | `200`, the writer's own rows only              |
  | `UPDATE` with the publishable key alone                             | `return=representation`       | `200`, `[]`                                    |
  | Forged `INSERT` by a member (a row signed with another member's id) | none                          | `403`, `42501`                                 |
  | Forged upsert onto another member's existing row                    | `resolution=merge-duplicates` | `403`, `42501`                                 |
  | `INSERT` with the publishable key alone                             | none                          | `401`, `42501`                                 |
  | `DELETE` with no filter at all                                      | —                             | `400`, `21000`                                 |

  So every update and delete step sends `prefer: "return=representation"`
  and asserts `rows`; a forged insert or upsert is judged by its `42501` and
  by the observed row. `42501` proves a refusal only for an insert or an upsert; for an
  update or a delete the proof is `rows: 0` plus `snapshot: "same"`. The one
  step that deliberately omits `Prefer` („… without Prefer answers 204 and
  leaves the note”) shows the trap: there the unchanged row is the only
  evidence. Both routes that write authored rows save with an upsert, so a
  forgery is tried both ways — `forgeNote({ upsert })` and
  `forgeRequirements({ upsert })`.

- **The neighbour's row first, then the check.** A comparison means something
  only once the row it could wrongly touch exists. Smoke therefore creates
  two fixture offers (`FIXTURE_OFFER_ID`, `FIXTURE_OFFER_ID_2`) and puts a
  note of each seeded member on both, and both members hold requirements,
  before any isolation step runs. `withSnapshot` treats an empty read before
  the step as a failed step („nothing to observe before the step”), never as
  "same". A new write path asks three questions, each with its own observed
  row:
  1. _Denied:_ the other member's attempt on my row — `rows: 0` (or `42501`),
     my row `"same"`.
  2. _Successful, next to a neighbour:_ a write whose filter names no author
     (`offer_id=eq.…`, or `author_id=in.(A,B)`) — `rows: 1`, the neighbour's
     row `"same"`. This is the case "the UPDATE succeeded, so only the
     targeted row changed" hides.
  3. _Another table or another offer:_ an offer write observes
     `observedNotes(ALL_FIXTURE_NOTES)`; a delete of one offer observes the
     other offer's notes, with a row-count read before (both members' notes
     are there) and after (`rows: 0`).
- **The control steps keep the comparison honest.** „control: an edited note
  is reported as changed” and „control: a note saved again with the same text
  is reported as changed” run on every smoke run with
  `snapshot: "changed"`: the second moves only `updated_at`, so it proves the
  comparison covers dates. A wrapper that reads the wrong row, an empty list
  or one field turns them red. When a new table gets its own observed read,
  give it a control step of its own: „control: requirements save edits them,
  bumps the revision and is reported as changed” is the one for
  `observedRequirements`, and it has to change the text, because saving the
  same requirements again moves no date.
- **Adding a step.** A step is `[name, run, expected]` in `steps`; `expected`
  takes `status`, `rows`, `errorCode`, `snapshot`, `revisionDelta` (and the
  redirect keys for a route). For a write through a route, wrap the
  `request(…)` call the same way:

  ```js
  [
    "archiving the fixture offer leaves every note as it was",
    () =>
      withSnapshot([observedNotes(ALL_FIXTURE_NOTES)], () =>
        request("/api/<route>", { method: "POST", form: { offer_id: FIXTURE_OFFER_ID } }),
      ),
    { status: 302, location: "<where the route redirects>", snapshot: "same" },
  ],
  ```

  Steps are ordered and stateful: put a new one after the fixtures and both
  members' rows exist, and before the cascade steps that delete the fixture
  offers. Describe it in the file's header comment, and in `README.md`.

- **Each slice that adds a write adds its own route-level check.** What this
  phase tests for re-fetch, note delete, offer delete and archive is their
  database half, with a Data API write standing in for a route that does not
  exist yet. The slice that builds the route owns the rest:
  - **S-09 (re-fetch, FR-009).** Prove two things. The re-fetch is an
    `UPDATE` of the offer's row, never delete-and-reinsert: the
    `offer_notes.offer_id` cascade would take every member's notes with the
    deleted row. And after a re-fetch through the route every note is the
    same whole row, `updated_at` included. Smoke must never reach otodom.pl
    and the fixture offers' `source_url` is not an otodom address, so the
    successful re-fetch is a route test on the pattern of
    `tests/pages/api/offers.test.ts`: stub the otodom page and the Supabase
    answers, then assert on the recorded requests — one `PATCH` to
    `/rest/v1/offers` filtered by the offer's `id`, no `DELETE` and no `POST`
    to `offers`, no write to `offer_notes`, and a body without `id` and
    `created_by`. The database half stays in smoke: keep the step „another
    member's rewrite of the listing data leaves every note as it was”
    (`rewriteListingAsOther`) and make its body the columns the route really
    writes. Add a smoke step for what the route does reach without otodom —
    a refused or failed re-fetch — wrapped in `withSnapshot` over the offer
    and `ALL_FIXTURE_NOTES`, both `"same"` (a failed fetch saves nothing).
  - **S-10 (archive, FR-014).** A smoke step through the archive route and
    one through restore, each observing `ALL_FIXTURE_NOTES` with
    `snapshot: "same"`, plus the two Data API attacks above if the archive
    writes a column a member must not forge. The column naming who archived
    references `auth.users`, so its creating migration declares `on delete`
    (`context/foundation/lessons.md`, "Declare `on delete` on every author
    column"), chosen from the PRD — and `scripts/account-deletion.sql` gets a
    case: the leaving member archives a fixture offer, and after the deletion
    the offer and its archived state are there, with the column in the state
    that `on delete` action leaves.
  - **S-11 (delete a note, delete an offer, FR-015).** Each route decides in
    its own code what zero deleted rows means, and its doc comment says so:
    `src/pages/api/requirements.ts` deletes without `.select()` and treats
    zero rows as success by a stated choice, which is not to be inherited by
    accident. If zero rows is a failure, the branch gets a route test like
    `tests/pages/api/criteria.test.ts` (the real policies will not produce it
    for the author). In smoke: the note-delete route removes the member's own
    note (`rows: 0` on a read afterwards) while the other member's note on
    the same offer is `"same"`; and the cascade steps („another member
    deletes the fixture offer and the second offer's notes stay as they
    were” and its neighbours) send the delete through the offer-delete route
    instead of the Data API, keeping the reads around it.
- **Account deletion (`scripts/account-deletion.sql`).** One transaction:
  fixtures, a snapshot table (`to_jsonb` of each row), `delete from
auth.users` for `sigaretif3@vetpad.local`, then one `DO` block per check
  that raises `account-deletion: [<check name>] …`, and `rollback`. A new
  author column adds a fixture row signed by the leaving member, a snapshot
  entry, and a check after the deletion. The staying member's rows are
  compared whole; the leaving member's without the author column and without
  a note's `updated_at`, because `on delete set null` runs as an `UPDATE` and
  the PRD says nothing about an orphaned note's date. A check that acts as a
  member sets `request.jwt.claims` and `set local role authenticated`, and
  counts rows with `get diagnostics`.
- **Route test for a zero-rows write.** `tests/pages/api/criteria.test.ts`:
  stub the one planned write with `isTableRequest(request, "<table>",
"PATCH")` from `tests/fixtures/http.ts`, answer `jsonResponse([], 200)`, and
  assert the redirect carries `?error=`, the right `&form=` and fragment —
  never the `302` alone, which success shares. The success case asserts the
  body's keys from a hand-written list, and that no signature, date or id is
  sent.
- **Tag:** `(#5)` on the `describe` of a route test. Smoke steps and SQL
  checks have no `describe`; name the requirement (FR-009, FR-015) in the
  comment above the step or the check.
- **Run:** smoke against the production preview with the local Supabase up —
  `npm run build && npm run preview`, then
  `BASE_URL=http://localhost:4321 npm run smoke`. The SQL script:
  `npm run test:db` (needs `psql` and the local Supabase; `DB_URL` overrides
  the Supabase CLI's default local address). The route test:
  `npm test -- tests/pages/api/criteria.test.ts`.
- **Pitfalls:**
  - `supabaseRest` reports `rows` only for an array body. A step that expects
    `rows` and sends no `Prefer` fails — it does not pass silently — but a
    step that expects only `204` passes whether or not a row existed.
  - Give every denial a row of its own to lose. The denied delete, the delete
    without `Prefer` and the delete by offer each target a different note, so
    a loosened policy turns each of them red by itself instead of the first
    one consuming the row the others observe.
  - Any update of a note moves its `updated_at`, text changed or not;
    requirements move theirs only when `body` changes. Observe the
    neighbour's row, never the row the step is meant to write.
  - The stored value is read back with a filter, not from the write's own
    answer: „fixture offer keeps its author after another member claims it”
    (`offerStillByMember`) is the pattern.
  - Cleanup counts rows too, and every step runs even after an earlier one
    failed. The last steps delete both fixture offers by id and expect
    `rows: 0`, so a failed cascade step leaves nothing behind and is reported
    twice.
  - Confirm a new family of steps once by breaking the thing it guards on the
    local database (a policy loosened to `true`, a trigger disabled) and
    watching it go red; restore with `npx supabase db reset` — the local one,
    never `--linked`. The reset wipes data typed by hand into the local
    database, so ask the user first, and restart `npm run dev` afterwards.
  - `scripts/account-deletion.sql` is run only against the local database.
    Its first check refuses a database without the seeded accounts — a check
    for the seed, not for the host, so a `DB_URL` exported for something else
    is followed; what keeps a database unchanged is the `ROLLBACK`.
    `scripts/smoke.mjs` does check the host: it refuses a `SUPABASE_URL` that
    is not on this machine.
  - `RecordedRequest` in `tests/fixtures/http.ts` records no headers. A route
    test proves the write asked for its rows back through the `select` URL
    parameter, not through the `Prefer` header.
  - The route test's distinguishing message fragments („zapisać”,
    „wyczyścić”, „sesji”) are written by hand from the current Polish copy,
    which the PRD does not fix. A copy rewrite turns them red; update the
    fragments, do not import the messages from the route.

### 6.4 Adding a test for a paid external call (billed-call count, lost result, timeout)

- TBD — see §3 Phase 3.

### 6.5 Adding a grounding or prompt-privacy test for the audit

- TBD — see §3 Phase 4.

### 6.6 Per-rollout-phase notes

(Appended by each phase as it ships.)

**Phase 1 — Test runner and ingestion guardrails**
(`testing-ingestion-guardrails`, 2026-09-30)

- Fixtures are hand-written, not "recorded" as the §3 row says: no recording
  exists, and none may be committed — third-party data, the advertiser's phone
  and name, in a public repository. The same synthetic canaries replaced the
  real seller's phone and name once quoted in `ingestion/otodom_apify.md`
  §6.1.
- Vitest gets the project's Vite config through `getViteConfig` with the
  Cloudflare adapter stripped: the adapter boots workerd inside Vitest's Vite
  server and fails at startup. Tests run in Node, so a `cloudflare:*` import
  in `src/` would not resolve under `vitest.config.ts` and would need its own
  configuration (`@cloudflare/vitest-pool-workers` required Vitest 4 when
  checked, 2026-09-30).
- `astro:env/server` resolves under Vitest but reads the real `.env`.
  `tests/setup.ts` mocks it with unset secrets so every test starts
  zero-config; a test file's own `vi.mock` of the module overrides it
  (verified), and `tests/setup.test.ts` fails if the default goes.
- "Unparseable" for a numeric string means anything but plain decimal
  notation (`/^\d+(?:\.\d+)?$/` after trimming): `"1e3"`, `"0x10"`, `"+5"`,
  `"12,5"`, `"1 200"` and `"Infinity"` are unknown. Checked live with
  `npm run otodom:inspect` on a flat sale on 2026-09-30: otodom sends plain
  decimal strings, and every stated number came through.
- The tests found two production gaps, fixed in the same change: the decimal
  rule above, and `OfferGallery` throwing on an `images` element that is not
  an object (fixture `malformedImagesOffer`). FR-005 now says a rental house
  gets the transaction message, which is checked first.
- Every guard's test was confirmed by a deliberate break that turned it red.
  The suite runs with no network (checked under `unshare -rn`).
- Deferred:
  - `raw.images` keeps unfiltered URLs. Nothing renders `raw` today; the first
    phase that reads it (S-04, §3 Phase 4) filters and tests it.
  - The host of `source_url` is not checked: any https host gets the „Otwórz
    oryginał na otodom.pl” link. Outside #7's scheme rule — noted, not fixed.
  - S-08's map link does not exist yet; its render test comes with the S-08
    plan, per §6.2.
  - The next writers of offer data (re-fetch FR-009, extraction-service
    fallback) get their canary tests when they are built, per §6.1.

**Phase 2 — Write isolation**
(`testing-write-isolation`, 2026-10-01)

- No defect was found: the research probe and every new check passed against
  the migrations as they stood. The phase is regression protection for S-09,
  S-10 and S-11; nothing under `src/` or `supabase/migrations/` changed.
- Delivered, in three layers (§6.3):
  - `scripts/smoke.mjs` — `withSnapshot` with the expectations
    `snapshot: "same"` / `"changed"`, a second fixture offer, a note of each
    seeded member on both offers, and the control steps (two for notes, one
    for requirements, added by the implementation review). Around them:
    denied edit, delete, forged insert and forged upsert on notes and on
    requirements; the denied delete without `Prefer` (204); writes whose
    filter reaches both members' rows; an offer rewrite standing in for a
    re-fetch, against every note; the offer's author surviving a reassignment
    and a clearing; the cascade checked on both members' notes and against
    the other offer; the second member's requirements observed around
    everything the first member writes and around the limits clear and
    restore; cleanup deletes that count their rows. Two denials run the other
    way round than the plan wrote them — the delete without `Prefer` and the
    denied delete of requirements are the first member's attempts on the
    second member's row — so that every denial has a row of its own to lose;
    the second member's attempts on the first member's rows are covered by
    the denied delete of the note and by the delete naming both authors.
  - `tests/pages/api/criteria.test.ts` — the route branch for a limits write
    that changed no row, which the real policies never produce for a
    signed-in member; `tests/fixtures/http.ts` gained `isTableRequest` and the
    documented request shape of the limits write.
  - `scripts/account-deletion.sql` with `npm run test:db`, and a step in the
    CI `smoke` job that runs it before the build.
- §3's "integration (smoke)" grew by two layers, both the user's decisions:
  account deletion by SQL with a rollback (research's open question 1), and
  the hermetic route test for the branch smoke cannot reach.
- Each family of checks went red once on a deliberately broken system and
  green again after the restore:
  - Harness: `withSnapshot` narrowed to compare `pros` only — the control
    step for a date-only change went red.
  - Notes and offers, on the local database, each break on its own, restored
    with `npx supabase db reset`: the `update` policy on `offer_notes`
    loosened to `true` — the denied `PATCH` and the successful `PATCH` beside
    another member's note; the `delete` policy loosened to `true` — the denied
    `DELETE`, the `DELETE` without `Prefer` and the successful `DELETE`
    beside; `offers_freeze_created_by` disabled — the offer-author step; a
    temporary trigger on `offers` moving the notes' `updated_at` — the
    offer-write step.
  - Requirements: the `update` policy on `member_requirements` loosened to
    `true` — the denied `PATCH` and the `PATCH` naming both authors; the
    `delete` policy loosened — the denied `DELETE` and the `DELETE` naming
    both authors.
  - Route test (2026-10-01): the `updated.data.length === 0` branch in
    `src/pages/api/criteria.ts` disabled — exactly the two `200 []` cases
    (save and clear) went red, the other five stayed green.
  - SQL script (2026-10-01): `public.offer_notes_before_update` replaced so
    that it always restores the author — `npm run test:db` exited non-zero
    with `account-deletion: [account deletion succeeds] … violates foreign
key constraint "offer_notes_author_id_fkey" (23503)`; restored with a
    local `npx supabase db reset`.
- CI: the `smoke` job ran green with the new step on 2026-10-01 (commit
  `fb20ba9`). The runner image ships `psql`, so the plan's fallback —
  `docker exec -i supabase_db_vetpad psql -U postgres` with the file on
  standard input — was not needed and is not wired in.
- Open:
  - `scripts/account-deletion.sql` does not assert the `updated_at` of an
    orphaned note. `offer_notes_before_update` keeps it on an account
    deletion, but the PRD says nothing about that date, so the script leaves
    it out of the comparison.
  - `RecordedRequest` in `tests/fixtures/http.ts` records no headers, so the
    route test proves `.select("id")` through the `select` URL parameter, not
    through the `Prefer` header.
  - The route test's distinguishing message fragments are hand-written from
    the current Polish copy; the PRD does not fix the wording, so a copy
    rewrite turns them red.
  - `scripts/account-deletion.sql` does not compare `team_criteria.updated_at`
    and does not assert the `criteria_revision` bump that the deleted
    member's requirements going away causes.
- Deferred:
  - Changing an offer's `id` through the Data API: a member can, unless a
    note references the offer (409, `23503`). Observed during research, not
    assessed, outside #5.
  - `enable_anonymous_sign_ins` on the hosted project. The policies admit any
    session with a uid, so they hold only while it is `false`; smoke sees the
    local `supabase/config.toml`, never the hosted setting.
  - Route-level checks for the re-fetch (S-09), the archive (S-10) and the
    note and offer deletes (S-11): each slice adds its own, per §6.3.

**Outside the rollout — `testing-read-failure-states`**
(2026-10-02)

- Not a §3 phase: phases 3 and 4 wait for S-04. The change covers logic that
  only `scripts/smoke.mjs` exercised, and smoke checks the `ok` markers alone.
  Two failure scenarios, both tagged `(#1)`: a failed read shown as an empty
  state („brak notatek”, „osoba z usuniętym kontem”, „brak limitów”), and a
  team limit broken by a fact the listing does not state. No defect was
  found and nothing under `src/` or `supabase/migrations/` changed — it is
  regression protection.
- Delivered:
  - Pure rules (§6.8): `tests/lib/team-limits.test.ts` (`limitBreaches`,
    `normalizePlace`) and `tests/lib/offer-board.test.ts` (`parseBoardSort`,
    `boardSortHref`).
  - Read functions (§6.7): `tests/lib/members.test.ts` (`resolveSaver`,
    `resolveAuthors`, `saverName`, `authorName`), `tests/lib/notes.test.ts`
    (`loadNotes`) and `tests/lib/criteria.test.ts` (`loadCriteria`,
    `loadTeamLimits`). The header comment of `tests/fixtures/http.ts` gained
    the request shape of every read these modules send, and how postgrest-js
    turns an answer into a result.
  - `scripts/smoke.mjs`: the write „second fixture offer gets an area” and
    the steps „board puts the offer without a price last…” and „board puts
    the offer without an area last…”, each in both directions, through
    `fixtureBoardOrder`. Unknown values last is a property of the query in
    `src/pages/dashboard.astro`, so only a real database proves it. Confirmed
    once by a deliberate break: with `nullsFirst: false` removed and the
    preview rebuilt, both descending steps went red.
  - Rules the sources had not stated, decided by the user and written down
    in the same change. In the PRD (FR-002): a location given as empty text,
    or as spaces and commas only, states no place. In CLAUDE.md
    (`## Structure`): the order of the breaches and how `limitBreaches`
    answers for limits the form does not allow; a `null` author column is a
    deleted account with or without a client; a value in the limits row that
    does not read as a limit is a failed read, a number sent as text reads
    as that number, and members' requirements are read most recently edited
    first.
- Stryker, narrowed to each module, before (2026-10-01) and after
  (2026-10-02). Every survivor and every uncovered mutant in scope has a
  decision in `context/archive/2026-10-01-testing-read-failure-states/mutation.md`; the
  score was never the target.

  | Module (scope)                           | Before | After  | Killed / survived / no coverage / total after |
  | ---------------------------------------- | ------ | ------ | --------------------------------------------- |
  | `src/lib/team-limits.ts`                 | 6.0%   | 97.59% | 81 / 2 / 0 / 83                               |
  | `src/lib/offer-board.ts`                 | 0%     | 85.42% | 41 / 7 / 0 / 48                               |
  | `src/lib/members.ts`                     | 0%     | 89.92% | 116 / 6 / 7 / 129                             |
  | `src/lib/notes.ts:1-99` (the read)       | 0%     | 82.50% | 33 / 7 / 0 / 40                               |
  | `src/lib/criteria.ts:151-285` (the read) | 0%     | 86.23% | 119 / 16 / 3 / 138                            |

  The whole-file baselines were 0% for `src/lib/notes.ts` (60 mutants) and
  22.35% for `src/lib/criteria.ts` (264 mutants, every killed one in the form
  validators). The whole files were not measured again: lines `100-113` of
  `notes.ts` and `1-150` of `criteria.ts` are outside this change.

- Mutants left without an assertion, by kind:
  - _Equivalent:_ an early-exit check (`if (!supabase)`, `if (result.error)`,
    a `typeof` guard) whose removal makes the code throw into the `catch` of
    the same function, which answers the same failed state; a `null` check
    whose removal compares with `null` and gives the same answer, given the
    table's checks (`price` and `area_m2` are never `≤ 0`).
  - _Consciously left out — data, not a rule:_ column lists and `select`
    strings (`BOARD_COLUMNS`, `BOARD_SORT_COLUMN`, `LIMIT_COLUMNS`), which a
    stub answers regardless of and smoke guards on the real database, and the
    field labels in `NOTE_FIELD_LABELS`. An assertion on the literal would
    mirror the code.
  - _Consciously left out — unreachable from the HTTP edge:_ the `catch` in
    `resolveSaver` and in `loadTeamLimits`. No response shape makes them
    throw, and `vi.mock` of an internal module is not used.
  - _Consciously left out — type guards:_ the `default` branch of
    `saverName` and `authorName` (`never`, guarded by `astro check`), and the
    `typeof` guards on `updated_at` / `updated_by`, which differ only for a
    value a `timestamptz` or `uuid` column never returns.
  - _Consciously left out — a swap point:_ `auditStatus` in
    `src/lib/offer-board.ts`, one constant today; S-04 gives it a rule and
    its assertions.
- Deferred:
  - The form validators — `parseLimitsForm`, `parseNumber`,
    `requirementsError` in `src/lib/criteria.ts` and `noteError` in
    `src/lib/notes.ts`. They are outside both scenarios; `parseLimitsForm` is
    reached only through `tests/pages/api/criteria.test.ts`.
  - A hermetic test of the board query (the `order` parameter). It would
    prove what the query asks for, not how Postgres sorts; smoke proves the
    order.
  - Repeated sort parameters (`?sort=price&sort=area`). The sources are
    silent and the interface never builds such a link, so no test binds the
    behaviour either way.
  - Render assertions for the error states (`data-notes-state="error"`,
    `data-criteria-state="error"`, `data-limits-state="error"`) — a property
    of the views, not of `src/lib`. Smoke still has no step that looks for an
    error marker.
  - The retry branches of postgrest-js (`503`, `520`, a rejected `fetch`).

### 6.7 Adding a unit test for a read function (a failed read is its own state)

A read function takes the Supabase client as an argument and answers a union
with a failed state; it never throws. What the test protects is the
difference between "the read failed" and "there is nothing to show" — a
failed read rendered as „brak notatek” or „brak limitów” invents a fact, and
a form prefilled from it overwrites the real row on save.

- **Where:** `tests/lib/<module>.test.ts`, mirroring `src/lib/<module>.ts`.
- **Reference test:** `tests/lib/criteria.test.ts` (two reads sent in
  parallel and a dependent third). `tests/lib/notes.test.ts` is the smaller
  one (a read and a dependent read); `tests/lib/members.test.ts` covers a
  `maybeSingle()` read and the `deleted` / `unknown` distinction.
- **Client:** built in the test, the way a request builds it —
  `createClient(new Headers(), { set: vi.fn() } as unknown as AstroCookies)`
  from `@/lib/supabase`, wrapped in a `client()` helper that throws when it
  gets `null`. The file overrides the zero-config mock of `tests/setup.ts`
  with its own `vi.mock("astro:env/server", …)` returning `SUPABASE_TEST_URL`
  / `SUPABASE_TEST_KEY`, imported inside the factory with
  `await import("../fixtures/http")` because `vi.mock` is hoisted. Importing
  `@/lib/supabase` is not mocking it: only the network is stubbed, and every
  module under `src/lib` runs as in production.
- **Network:** `stubFetch` from `tests/fixtures/http.ts` with
  `afterEach(restoreFetch)`. The handler tells the tables apart with
  `isTableRequest(request, "<table>", "GET")`, never by the order of the
  requests — parallel reads arrive in either order. A table the case did not
  plan returns `undefined`, so a read that should not have gone out fails
  the test.
- **The failures, each through the HTTP edge:**

  | State                                         | Answer                                                                                                                          |
  | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
  | No client                                     | pass `null` as the client; `stubFetch(() => undefined)` and `stub.requests` has length 0                                        |
  | Query error                                   | `jsonResponse({ code: "XX000", message: "internal error", details: null, hint: null }, 500)` — `error` is set at once, no retry |
  | Missing row, for a `maybeSingle()` read       | `jsonResponse([], 200)` — `data: null`, no error                                                                                |
  | More than one row, for a `maybeSingle()` read | two rows in the array — an error, `PGRST116`                                                                                    |
  | Exception inside the function                 | a `200` whose body is not the shape the code walks: `{}`, `null`, or a list holding `null`                                      |
  | Unreadable value in a row                     | a `200` row with the value, one column at a time through `it.each`, the other columns readable                                  |

  With `maybeSingle()` an object body is handed over as the row itself, so
  there "not the row" means a row without its columns, `null`, or text.

- **Do not use:** `503`, `520` or a rejected `fetch` — postgrest-js retries a
  GET up to three times with back-off (about 7 s) and they end as a result
  with `error`, never as an exception; and a `404` whose body is an array,
  which becomes `data: []` with no error and so stands in for nothing.
- **The control case is mandatory — "empty but successful".** Every
  `describe` of failures opens with the read that succeeds and finds nothing
  (`200 []` for a list; for the limits, the singleton row with four `null`),
  asserted as a whole value written out by hand: `null`, never `0` and never
  `""`. Each failure then asserts its failed state **and** `not.toEqual` the
  empty one. Without the control the suite passes on a function that always
  answers the failed state.
- **Count the requests.** A failure case asserts that the read did go out
  (the outcome came from the database's answer, not from an early exit) and
  that the dependent read did not (`members` is not asked after a failed
  notes read). A success case asserts how many requests named the authors —
  one, for the distinct ids, read back from `id=in.(…)`.
- **A failed dependent read is not a failed read.** When the main read
  succeeds and `members` answers `500`, the state stays `ok`, the rows are
  shown, and each author is `unknown` — never `deleted`, which is a fact
  from the row (a `null` author column) and needs no read.
- **What the request asks for.** Assert a filter or an order the function
  owns through `new URL(request.url).searchParams` (`offer_id=eq.<id>`,
  `order=updated_at.desc`, `id=eq.true`), and only where a source names it.
  That the database really sorts that way is not this layer's claim (§6.8).
- **Oracle:** CLAUDE.md `## Structure` (a failed read is its own state; a
  `null` author is a deleted account; `unknown` names nobody), the PRD
  (Guardrails; Non-Functional Requirements for the deleted account's
  wording), the function's contract in the archived plan of the change that
  built it (`context/archive/`), and the creating migration's header for
  what a column means. Name the sources in a comment at the top of the test.
  Never the function's current output.
- **Run:** `npm test -- tests/lib/criteria.test.ts`. Then Stryker narrowed
  to the read — `npx stryker run --mutate "src/lib/criteria.ts:151-285"` (a
  line range when the file also holds code outside the risk; read the range
  from the file again if it has changed) — and a decision for every survivor
  and every uncovered mutant (CLAUDE.md, `### Mutation testing (Stryker)`).
- **Pitfalls:**
  - A `catch` that no response shape can reach gets the decision
    „świadomie pominięty — nieosiągalne z krawędzi HTTP” in the change's
    mutant log, not a `vi.mock` of an internal module. Try the shapes first:
    the `catch` in `loadNotes` and `loadCriteria` is reached by a body that
    is not a list of rows; the one in `resolveSaver` and `loadTeamLimits` is
    reached by nothing, because the code only reads fields of a value it has
    already checked.
  - An early-exit check whose removal lands in the same `catch`
    (`if (!supabase)`, `if (result.error)`, `!result.data`) is an equivalent
    mutant: the answer is the same failed state. Do not write a test that
    pins which line produced it. That unreachable `catch` is the net those
    equivalents rest on — a reason to keep it, not to delete it.
  - A new read documents its request shape in the header comment of
    `tests/fixtures/http.ts`, read from
    `node_modules/@supabase/postgrest-js/dist/index.mjs`, not from memory:
    `select` loses its whitespace, an `in` list is percent-encoded in the
    URL, `maybeSingle()` is a client-side flag.
  - `RecordedRequest` records no headers; assert on the URL.
  - A value the table's checks do not admit (a zero limit, an empty city)
    can only come from a stub. Whether it is a failed read or "nothing set"
    is a rule, so it needs a source; when none states it, §6.8's rule for a
    silent source applies.
  - Interface copy that no source fixes („Ty”, „Ciebie”) is written by hand
    with a comment saying so; a copy rewrite turns it red, and that is the
    assertion's whole job. The deleted account's wording is the PRD's.
  - Run `npx astro sync` before `npm run lint`, as in §6.2.

### 6.8 Adding a unit test for a pure rule (team limits, board sort)

A pure rule has no executable imports: no stub, no `vi.mock`, no client.

- **Where:** `tests/lib/<module>.test.ts`.
- **Reference test:** `tests/lib/team-limits.test.ts` (a rule over facts and
  limits). `tests/lib/offer-board.test.ts` is the reference for parsing
  input that must always give a valid value and never throw.
- **Inputs:** literals built in the test, through small helpers that take
  overrides (`offer({ price })`, `limits({ city })`) so that a case states
  only the fact it is about. A fixture from `src/pages/dev/_offer-fixtures.ts`
  may be an input, never an expectation.
- **Every "does not break" stands beside a "breaks".** An unstated price
  gives no mark — and the same limit, with the price stated, gives one. An
  unset limit breaks nothing — and the same offer under the set limit is
  marked. Alone, the first half passes on a function that always answers
  `[]`. For parsing it is the same pair: an unknown direction falls back to
  the key's own, and each key is also asked with the direction opposite to
  its default, so a function that ignored `dir` cannot pass both.
- **Expected values are written by hand,** as whole values: the exact array
  with its order (`["city", "price_above", "area_below"]`), the exact link
  (`/dashboard?sort=price&dir=desc`). Never computed in the test with the
  rule's own logic, and never from a constant imported from the module
  under test.
- **Bounds:** the value on the bound and the one just past it, side by side
  (`850000` fits, `850001` does not).
- **One `it.each` per property,** not copies of one test: unstated facts,
  unset limits, spellings of one town, hostile sort names (`toString`,
  `__proto__`, `constructor`) are each a table.
- **Oracle:** the PRD (FR-002, Guardrails), CLAUDE.md `## Structure`, and
  the contract in the archived plan of the change that built the rule.
- **When the sources are silent about an input, ask the user.** Do not
  promote the code's current answer to oracle. The agreed rule is written
  into the PRD (a product rule) or CLAUDE.md (how the function answers) in
  the same change, before the test, and the test cites that text. An empty
  location label went into FR-002 this way; the order of the breaches and
  the limits the form does not allow went into CLAUDE.md. When the user
  leaves an input unbound, write no assertion for it in either direction —
  repeated sort parameters, and the known false alarm for a location that
  names only a county.
- **When smoke proves the rule instead.** A rule that is a property of the
  SQL query cannot be proved by a unit test: a stub would answer whatever
  order the test gave it. "Unknown values last" lives in the query in
  `src/pages/dashboard.astro` (`nullsFirst: false`), so the unit test covers
  only the parsing, and `scripts/smoke.mjs` proves the order on the local
  Supabase — `fixtureBoardOrder(sort, dir)` reports which of the two fixture
  offers stands higher, and the steps „board puts the offer without a price
  last…” and „board puts the offer without an area last…” run it in both
  directions. Their pattern: compare only the fixture rows, so other offers
  in the local database do not matter; swap the roles between the two sorts
  (one fixture states a price, the other an area), so a fixed order cannot
  pass; a missing row fails the step; and name the direction that decides —
  Postgres puts nulls first for `desc`, so that is where the query's option
  shows. Confirm a new step of this kind once by breaking the query and
  rebuilding the preview. Stryker sees `npm test` alone, so such a step
  kills no mutant.
- **Run:** `npm test -- tests/lib/team-limits.test.ts`, then
  `npx stryker run --mutate "src/lib/team-limits.ts"`. The smoke steps: as
  in §6.3.
- **Pitfalls:**
  - A `null` check on a limit can survive as an equivalent mutant: `x < null`
    compares with `0`, and the table's checks keep a stored price and area
    above zero. Record it as equivalent; do not invent a negative price to
    kill it.
  - A column map or a column list is data for the query, not a rule. An
    assertion on its literal mirrors the code; smoke guards it on the real
    database. Record its mutants as „świadomie pominięty”.
  - A swap point with one constant (`auditStatus`) has no rule to prove
    until the slice that fills it.
  - "Never throws" includes the names every object inherits — a lookup in a
    map must not accept `toString`.

## 7. What We Deliberately Don't Test

- **`/dev/*` kitchen-sink pages** — developer tools that answer 404 outside
  `astro dev`; the existing smoke 404 check is enough. Re-evaluate if one
  starts rendering in production. (Source: Phase 2 interview Q5.)
- **Visual snapshots / visual tests in CI** — the manual screenshot gate is
  run per plan when the user chooses it. Re-evaluate if a visual regression
  reaches production unnoticed. (Source: Phase 2 interview Q5.)
- **Live otodom.pl or live model-provider calls in CI** — paid, flaky and
  dependent on a third-party site; fixtures and stubs stand in. (Source:
  CLAUDE.md `## Testing`; consistent with interview Q1 cost concern.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-30; §2 (#5), §3 row 2, §4 and §5 amended for the write-isolation phase: 2026-10-01
- Cookbook (§6) last changed: 2026-10-02 — the tags paragraph, §6.7, §6.8 and a §6.6 entry, outside the rollout (`testing-read-failure-states`)
- Stack versions last verified: 2026-09-30
- AI-native tool references last verified: 2026-09-30

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
