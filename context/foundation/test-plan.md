# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-30

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
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
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Ingestion saves a false or incomplete offer: an unstated attribute reads as "0 zł" or "no", a rental or a house is saved as a flat sale, or a failed/changed-shape fetch leaves a blank or partial record behind | High | Medium | PRD Guardrails, NFR, FR-005; interview Q4; roadmap: upcoming second writers of offer data (re-fetch FR-009, extraction-service fallback, S-04 reading the stored raw payload). Hot-spot dir `src/lib/otodom/` (5 commits/30d) reflects the module's creation, not instability (research, Phase 1) |
| 2 | **Denial of Wallet:** the paid AI audit can be triggered repeatedly — a loop, a double click, concurrent requests, or a request without a session — and every call is billed by the model provider | High | High | interview Q1; roadmap S-04 (next slice on Stream A); PRD NFR (correctness over cost — a slower, pricier model per call) |
| 3 | A paid audit result is lost: the model answered but the database write failed or the request timed out, the offer falls back to "Not Audited", and the same audit has to be paid for again | High | Medium | interview Q1; PRD NFR (~3-minute audit limit, reported as failed with a retry offered); roadmap S-04 Unknowns |
| 4 | The audit reports an ungrounded finding: a red flag, cost or mandatory condition with no excerpt, with an excerpt that is not verbatim listing text, or a missing-information finding outside the decision-critical attributes | High | High | PRD Guardrails, FR-011, NFR (every finding traceable to a verbatim quotation); roadmap S-04 |
| 5 | A write on X changes Y: a re-fetch overwrites notes, one member's action edits or deletes another member's note or requirements, a delete takes more (or less) than the PRD says it should | High | Medium | interview Q1; PRD FR-009, FR-012–FR-015, NFR (no system action modifies human-authored text); roadmap S-09, S-10, S-11; `lessons.md` (author FK blocked account deletion); hot-spot dir `supabase/migrations/` (9 commits/30d) |
| 6 | Personal data escapes: the seller's phone or name reaches the database or the audit prompt, or members' notes reach the model provider | High | Medium | PRD NFR (notes never leave the system; advertiser's personal data never stored); roadmap S-04 Risk |
| 7 | Stored content renders unsafely: a `javascript:` (or other non-https) URL read from the database lands in `href`/`src` and runs in another member's session | High | Low | `lessons.md` (impl review of `paste-listing-to-card`, F1); roadmap S-08 (map link built from stored data) |

Abuse lens: #2 is resource abuse, #6 is PII leakage, #5 and #7 are
authorization/access. RLS as such has no dedicated row — the user verifies
it by hand on every schema change (interview Q4); its write-side behaviour is
covered through #5.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | On a listing payload built from the documented shapes, an absent, empty, unparseable or `"0"` numeric attribute becomes unknown on every numeric fact (not only rent), and a currency never survives its unknown amount; a rental and a non-flat are refused naming which check failed — including a rental house, a sale/offer-type disagreement reported as a changed format, and a payload whose generic category says flat while the ad category says otherwise; a page without usable listing data is a fetch error and nothing is persisted | "The mapper passes for a typical listing, so the edge cases pass too" | Fixture source: no recorded payload exists — fixtures are hand-authored from the shapes documented in `ingestion/otodom_fetching.md` §7 (rental with `rent: "1"`, house without a rent key, `rent: "0"`, enums with empty localized values), carrying synthetic seller canaries, never third-party data; the persistence boundary that decides save vs refuse | unit on fixtures, network stubbed at the HTTP edge | Expected values copied from the mapper's current output; the oracle is the PRD and `ingestion/otodom_fetching.md` §7. Committing a recorded live payload (third-party data, possible PII in a public repo) |
| #2 | A second audit request for the same offer while one is in flight does not call the provider; an unauthenticated request never calls it; the stub's call count is asserted | "There are three of us behind a login, so there is no attacker" and "middleware protects `/api`" | Audit entry point, its auth check, where in-flight state lives (Postgres, never module scope), the provider boundary | integration on the audit endpoint with the provider stubbed at the HTTP edge | Asserting only a 200 status instead of the number of billed calls |
| #3 | When the provider answered and the write failed, the result is recoverable or the failure is explicit; "in progress" does not hang forever; a retry does not pay for a result that already exists | "A 200 from the provider means the audit is done" | Order of provider call vs persist, audit status states, the ~3-minute timeout path, the retry path | integration with a provider stub and a forced write failure | Mocking internal modules instead of the network and database edges |
| #4 | A positive finding without an excerpt, or whose excerpt is not a verbatim substring of the stored listing text, is rejected; a missing-data finding carries no excerpt | "The prompt tells the model to quote, so it quotes" | Structured-output shape, where validation happens, which stored text is the reference for matching (whitespace, quotes, diacritics) | unit on the output validator (deterministic substring match); optional manual golden set | Using an LLM to judge whether a quote is grounded when a deterministic comparison exists |
| #5 | After every write operation, other members' rows (notes, requirements, author columns) are identical to before; an RLS denial is recognised as such (HTTP 200 with `[]` on read) | "The UPDATE succeeded, so only the targeted row changed" | Which operations write which tables, RLS policies per operation, cascades and freeze triggers, the two denial signatures | integration in `scripts/smoke.mjs` against local Supabase | Asserting only "no error" — RLS denies with 200 and an empty array |
| #6 | The persisted row and the built prompt contain no seller phone or name from the portal's contact fields, and the prompt contains no notes — also when the fixture carries all of them; a phone or name the advertiser typed into the title or description is kept verbatim (PRD NFR: the rule covers contact fields, not the listing's own words) | "The mapper whitelist is enough, so the prompt is clean" — and, for every future writer (re-fetch, extraction-service fallback), "it goes through the same whitelist" | The `raw` whitelist, prompt assembly inputs, every path that reads notes near the audit, every writer of offer data | unit on the mapper and the prompt builder: a serialised-row search for canary strings plus key-absence checks | Asserting only that expected fields are present, never that forbidden ones are absent. "Fixing" a canary hit by redacting the description, which breaks FR-011's verbatim excerpts |
| #7 | A non-https URL from a database row never reaches `href` or `src`; a `null` result renders no link or image; a malformed stored image entry (`null`, a non-object, an object without URLs) renders nothing and never breaks the card | "The mapper filters URLs, so the view is safe" — confirmed wrong: any member can update stored rows, and the stored raw payload keeps unfiltered image URLs (latent until a view or the audit reads it) | Every view that renders stored URLs (card, gallery, board, S-08 map link), and the first phase that reads the raw payload | unit on the URL guard plus component render through the Astro Container API | Testing only a valid URL; testing only the scheme and never the shape of the stored entry |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Test runner and ingestion guardrails | Bootstrap Vitest and prove that ingestion never saves an invented fact, a non-flat-sale, seller data, or an unsafe URL; wire `npm test` into CI | #1, #6 (storage), #7 | unit (recorded fixtures) | planned | context/changes/testing-ingestion-guardrails/ |
| 2 | Write isolation | Prove that a write on X leaves every other member's data untouched, before S-09/S-10/S-11 add more writes | #5 | integration (smoke) | not started | — |
| 3 | Audit cost and durability | Prove that a paid model call cannot be multiplied and a paid result cannot be silently lost — starts only after S-04 ships | #2, #3 | integration (provider stub) | not started | — |
| 4 | Audit grounding and prompt privacy | Prove that no finding without a verbatim excerpt is shown and no note or seller data reaches the prompt — starts only after S-04 ships | #4, #6 (prompt) | unit, optional manual golden set | not started | — |

Phase 1 adds `vitest` to `package.json`; CLAUDE.md requires the user's
explicit go-ahead for that, which `/10x-plan` asks for. Phases 3 and 4 are
blocked on S-04 (`grounded-listing-audit`) — their protections should also be
named in the S-04 plan, so the code under test is built to be testable.

## 4. Stack

| Layer | Tool | Version | Notes |
|---|---|---|---|
| lint + typecheck | ESLint, `astro check` | eslint ^10.10, astro 7.3.2 | Wired in CI `ci` job |
| unit + integration (in-process) | none yet — see Phase 1 (Vitest via `getViteConfig`, checked: 2026-09-30) | vitest 5.0.3 (npm latest, 2026-09-30) | Requires explicit user go-ahead (CLAUDE.md) |
| component render | none yet — see Phase 1 (Astro Container API, `experimental_AstroContainer`) | astro 7.3.2 | For `.astro` output assertions without a browser |
| integration (live, local Supabase) | `scripts/smoke.mjs` | n/a | Existing; CI `smoke` job; never reaches otodom.pl or production |
| API/provider mocking | none yet — see Phase 3 | n/a | Stub at the HTTP edge only |
| e2e | none | n/a | Not planned; smoke against the production preview covers critical routes |
| visual gate | `scripts/ui-screenshots.mjs` | n/a | Manual, per plan; not a CI gate (§7) |
| (optional) AI-native | manual golden-set audit eval — checked: 2026-09-30 | n/a | When NOT to use: in CI, on every change, or to judge excerpt grounding (deterministic check does that) |

**Stack grounding tools (current session):**
- Docs: Context7 — checked Astro testing guide (`getViteConfig`, Container API `renderToString`, React container renderer); checked: 2026-09-30
- Search: Exa.ai — not available in current session; web search available but not needed; checked: 2026-09-30
- Runtime/browser: no Playwright MCP; claude-in-chrome skill available — not used; checked: 2026-09-30
- Provider/platform: no Supabase or Cloudflare MCP; `gh` CLI available — not used; checked: 2026-09-30

## 5. Quality Gates

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint (incl. `tokensOnlyConfig`) + `astro check` | local + CI `ci` job | required | syntactic, type and token drift |
| build | CI `ci` job | required | build-time breakage |
| smoke against production preview | CI `smoke` job | required | broken routes, closed registration, RLS on notes/criteria/members |
| unit (`npm test`) | local + CI `ci` job | required after §3 Phase 1 | ingestion guardrail regressions |
| write-isolation smoke steps | CI `smoke` job | required after §3 Phase 2 | cross-member writes, overwritten notes |
| audit integration (provider stub) | CI | required after §3 Phase 3 | multiplied billed calls, lost paid results |
| post-edit hook running related unit tests | local (agent loop) | recommended after §3 Phase 1 | regressions at edit time |
| visual screenshot gate | local, per plan | optional (user's call per change) | rendering regressions |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test for an ingestion rule (unknown-not-zero, flat-sale gate, seller-data whitelist)

- TBD — see §3 Phase 1.

### 6.2 Adding a render test for stored content (URL guard, unknown presentation)

- TBD — see §3 Phase 1.

### 6.3 Adding a write-isolation check for a new write path (cross-member, re-fetch, delete, archive)

- TBD — see §3 Phase 2.

### 6.4 Adding a test for a paid external call (billed-call count, lost result, timeout)

- TBD — see §3 Phase 3.

### 6.5 Adding a grounding or prompt-privacy test for the audit

- TBD — see §3 Phase 4.

### 6.6 Per-rollout-phase notes

(Appended by each phase as it ships.)

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

- Strategy (§1–§5) last reviewed: 2026-09-30
- Stack versions last verified: 2026-09-30
- AI-native tool references last verified: 2026-09-30

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
