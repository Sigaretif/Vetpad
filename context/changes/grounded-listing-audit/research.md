---
date: 2026-10-06T20:51:48+02:00
researcher: Claude (Opus 5.5) for Wiktor Ortel
git_commit: 90f1dca2a8c23dc46d28af31bd6ae989d83b3f0b
branch: master
repository: 10xDevs4
topic: "Ground S-04 grounded-listing-audit: what the audit reads, where it plugs in, what was already decided, and what the provider and the platform allow"
tags: [research, audit, anthropic, cloudflare-workers, criteria, offers, rls, structured-outputs]
status: partial
last_updated: 2026-10-06
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Follow-up: user decided model, SDK and default effort (medium); open questions 4 and 5 closed"
---

# Research: Ground S-04 — the grounded AI audit of a saved listing

**Date**: 2026-10-06T20:51:48+02:00
**Researcher**: Claude (Opus 5.5) for Wiktor Ortel
**Git Commit**: 90f1dca (working tree clean apart from this change folder)
**Branch**: master
**Repository**: 10xDevs4

## Research Question

`change.md` carries no notes, so the question is taken from the roadmap's S-04 entry
(`context/foundation/roadmap.md:124-137`), FR-010 and FR-011 (`context/foundation/prd.md:97-100`)
and test-plan risks #2, #3, #4 and #6 (`context/foundation/test-plan.md:49-53`):

What does the audit read, where does it plug into the application, what has already been decided
about it, and what do the model provider and the hosting platform allow — so that `/10x-plan` can
settle the three roadmap unknowns (progress and the ~3-minute limit, validation of the model's
output, CPU on the Free plan) without rediscovery.

The provider question the user raised during this research — which provider, and how it bills — is
answered in the companion file `provider-selection.md` in this folder and only summarised here.

## Summary

Status is **partial**: two questions can only be closed by a real audit call, which this research
did not make (see Open Questions 1 and 2).

1. **The excerpt reference text is the plain-text column `offers.description`, and that is a
   settled decision.** The S-02 plan chose normalising to plain text at fetch so that an audit
   excerpt matches character for character what the member reads on the card
   (`context/archive/2026-09-22-paste-listing-to-card/plan-brief.md:24`). The column is the output
   of `htmlToPlainText` (`src/lib/otodom/map.ts:127-146`); the original HTML survives only in
   `raw.description`.
2. **The prompt has to be built from the columns, not from `raw`.** An unstated attribute is `null`
   in its column (`supabase/migrations/20260922202756_create_offers.sql:3-7`), while
   `raw.characteristics` is otodom's unfiltered array and still carries placeholders such as
   `rent: "0"` (`src/lib/otodom/map.ts:11-32`, `:156-161`).
3. **Nothing under `src/` reads `criteria_revision` yet, and `loadCriteria` is the wrong shape for
   a prompt as it stands.** It returns no revision, splits requirements into the viewer's own and
   the others', and attaches authors that carry members' email addresses
   (`src/lib/criteria.ts:163-172`, `:214-269`). The roadmap's instruction to read criteria "through
   `loadCriteria`" (`context/foundation/roadmap.md:232`) needs an addition, not just a call.
4. **Row-level security cannot keep notes out of the audit.** `offer_notes` is readable by every
   signed-in member (`supabase/migrations/20260926202537_create_offer_notes.sql:113-117`), so the
   rule that notes never reach the provider holds only through the structure of the code and a test
   on the prompt builder.
5. **There is no protection against a repeated or concurrent audit today** beyond a disabled submit
   button (`src/components/form/SubmitButton.tsx:14`), and `/api/*` is outside the middleware's
   protected routes (`src/middleware.ts:6`). The audit route must check `locals.user` itself before
   anything else, and in-flight state has to live in Postgres.
6. **The audit runs inside one HTTP request on Workers Free — a settled decision — and the platform
   documents no duration limit for it.** The documented limits that do bind are 10 ms of CPU per
   request and the client staying connected; waiting on `fetch` is not CPU time.
7. **Provider: Anthropic, called directly, on prepaid credits** — the user's decision of
   2026-10-06. The official TypeScript SDK lists Cloudflare Workers as a supported runtime and can
   request schema-constrained JSON from a raw JSON Schema, with no validation library.
8. **The API's citations feature cannot be combined with schema-constrained output**; the request
   is rejected. Grounding therefore rests on the application's own verbatim-substring check, which
   is what the test plan already asks for.

## Detailed Findings

### What the audit reads: `public.offers`

- **The listing's own words** are `title text not null` and `description text not null`
  (`supabase/migrations/20260922202756_create_offers.sql:12-61`). `description` is plain text:
  `<br>`, `</p>` and `</li>` become line breaks, other tags are removed, entities are decoded, each
  line is right-trimmed and runs of blank lines collapse (`src/lib/otodom/map.ts:127-146`). `title`
  is trimmed only (`map.ts:235`). A listing with an empty title or description is not saved
  (`map.ts:238-240`).
- **Stated parameters** are nullable columns: seven numeric facts guarded by `is null or > 0`
  checks (`supabase/migrations/20260926155042_offers_numeric_facts_positive.sql:32-39`), ten
  enumerated facts stored as otodom's raw tokens, location fields, and `features jsonb`. An empty
  `features` array means the listing names no amenities, not that the flat has none
  (`src/lib/otodom/types.ts:102`).
- **`numericOrUnknown`** returns a number only when the value is finite and greater than zero; an
  absent key, an empty string, `"0"`, a negative, `"1e3"`, `"12,5"` and `"1 200"` all read as
  `null` (`src/lib/otodom/map.ts:74-86`).
- **Seller data.** The portal's structured contact fields are never read by the mapper, and the
  canary test checks every column and `raw` except `description` and `raw.description`
  (`tests/lib/otodom/map.test.ts:235-242`). A phone number or a name the advertiser typed into the
  text is kept by design, because redacting it would break verbatim excerpts
  (`context/foundation/prd.md:126`). `street_name` is a stored column; no document says whether it
  may be sent to the provider beyond "the listing's text and the team's criteria"
  (`context/foundation/prd.md:124`).
- **A stored row is not guaranteed to be mapper output.** Every signed-in member can update any
  column of any offer through the Data API (`20260922202756_create_offers.sql:84-113`), and smoke
  fixtures store `raw: {}` with a one-line description (`scripts/smoke.mjs:277-294`).
- **No content hash or version column exists.** `fetched_at` and `listing_modified_at` are the only
  markers of a listing version. S-09's "the listing changed" has nothing else to compare against,
  which bears on what S-04 stores with an audit.
- **Numeric columns may arrive as strings.** PostgREST can return `numeric` as a JSON string;
  `src/lib/criteria.ts:178-183` handles that for limits, and no equivalent reader exists for
  offers, which are cast to `OfferRow` (`src/pages/offers/[id].astro:25-26`).

### What the audit reads: criteria

- **Tables** (`supabase/migrations/20260927144141_create_team_criteria.sql`): the singleton
  `team_criteria` with `city`, `price_min`, `price_max`, `area_min` (`:28-56`);
  `member_requirements` keyed by `author_id` with `on delete cascade` and a `body` of at most 2000
  characters (`:130-139`); the singleton `criteria_revision` with `revision bigint` (`:206-214`).
- **What bumps the revision**: a real change to one of the four limit columns (`:238-247`), and an
  insert, a body-changing update, or a delete of a member's requirements (`:249-263`). Re-saving
  identical values does not. An account deletion bumps it through the cascade (`:195-197`).
- **Access**: `criteria_revision` has a `select` policy for signed-in members and no write policy;
  its comment names the audit as the reader (`:340-351`).
- **`loadCriteria(supabase, viewerId)`** never throws and returns either `{ state: "ok", limits,
limitsChangedBy, limitsChangedAt, own, others }` or `{ state: "error" }`
  (`src/lib/criteria.ts:163-172`, `:214-269`). `error` covers a null client, either query failing,
  a missing singleton row and a limit value that does not read as a limit. Each limit is
  optional, and an unset limit is "no limit", never zero
  (`context/archive/2026-09-27-team-search-criteria/plan-brief.md:23`).
- **Gap: revision and criteria are two separate requests with no shared snapshot.** A member's edit
  between them leaves an audit stored with a revision that does not match the criteria it was sent.
- **Gap: `RequirementsView.author` is a `Saver`, whose `member` variant holds an email address**
  (`src/lib/criteria.ts:151-156`, `src/lib/members.ts:16`). Only `body` belongs in a prompt.
- **Handed to S-04 by S-03**: handle partially set criteria, and decide whether an audit with no
  criteria is allowed (`context/archive/2026-09-27-team-search-criteria/plan-brief.md:65`).

### Where the audit plugs in

- **Zero-config pattern, four places**: `envField` with `optional: true` (`astro.config.mjs:17-22`);
  a factory returning `null` (`src/lib/supabase.ts:8-11`); a null-check at the call site, with
  `src/pages/api/offers.ts:134-138` as the route that also logs it; and a `ConfigStatus` entry
  (`src/lib/config-status.ts:11-19`) rendered as a banner on every page
  (`src/layouts/Layout.astro:23-36`).
- **The six places a secret lands** are listed in `context/foundation/deployment-runbook.md:296-304`.
  In CI the `smoke` job writes only the two Supabase keys (`.github/workflows/ci.yml:44-48`), so an
  audit route runs there in its unconfigured branch.
- **Card**: the marked spot is `src/components/offers/OfferNotes.astro:46`, inside the notes
  section and before the branch on the notes' read state, so the audit renders even when notes
  failed to read. `OfferView.astro:13-21` is shared by the page and `/dev/offer-card`, so every new
  prop must be supplied by each kitchen-sink state (`src/pages/dev/offer-card.astro:38-94`).
- **`?error=` on the card belongs to the note editor alone today** (`src/pages/offers/[id].astro:53-55`).
  A second form needs `&form=<name>`, as `src/pages/api/criteria.ts:34-35` does.
- **Board status**: `AuditStatus` is the single literal `"not_audited"` and `auditStatus()` a
  constant (`src/lib/offer-board.ts:72-81`); its one caller is
  `src/components/offers/OfferBoardItem.astro:78`. `AuditStatusBadge.astro:13-15` holds a
  `Record<AuditStatus, string>`, so a new status fails to compile until it is labelled.
  `BOARD_COLUMNS` selects no audit data (`offer-board.ts:61-62`). No test covers `auditStatus`.
- **Route conventions**: `src/pages/api/offers.ts` is the reference — the user check first
  (`:128-132`), one message per failure reason through an exhaustive switch (`:16-53`), one log
  entry per exit, and a `started` entry before the slow call (`:173-174`).
- **A long action has one existing shape**: a native form POST that blocks until the route
  redirects, with a spinner from `usePendingSubmit` and a server-side `AbortSignal.timeout(45_000)`
  (`src/pages/api/offers.ts:175`). No timer, elapsed time or client-side timeout exists under
  `src/`, no island calls `fetch`, and no route returns JSON. `CLAUDE.md` permits a `fetch`-driven
  JSON endpoint and asks that the first one be named there as the reference.
- **Logging**: `event` is a free string, so a new event needs no change to `src/lib/log.ts`. The
  field whitelist (`log.ts:9-40`) has no field for a model id, a provider request id, token usage,
  a duration, a stop reason, a finding count or a criteria revision; each one used must be added to
  the list. `error_message` is free text, and the ingestion code scrubs before logging because an
  error can quote what it failed to parse (`src/lib/otodom/fetch.ts:53-55`, `:204-207`).
- **Tests**: `stubFetch` replaces `globalThis.fetch` and `restoreFetch` fails a test on any
  unplanned request (`tests/fixtures/http.ts:39-72`), so no test can reach a real provider.
  `recordBody` accepts string bodies only (`:32-36`). `tests/setup.ts:6-10` mocks
  `astro:env/server` with the two Supabase names; whether Vitest throws on a named export missing
  from that mock was not verified.
- **Design tokens**: three semantic colour roles exist — `destructive`, `warning`, `info`
  (`src/styles/global.css:122-158`). The audit has four finding categories. `Badge variant="link"`
  has roughly 2.5:1 contrast and is flagged as a trap for later slices
  (`context/archive/2026-09-23-ui-offer-card/reviews/impl-review.md:91`).

### Patterns a new audits table has to follow

- RLS enabled in the creating migration, one policy per operation for `authenticated`, none for
  `anon`, no `for all` (`supabase/migrations/20260922202756_create_offers.sql:70-113`).
- `offer_id … references public.offers (id) on delete cascade`
  (`supabase/migrations/20260926202537_create_offer_notes.sql:26`).
- Database-owned timestamps on insert and a freeze trigger on update, with the deleted-account
  branch and `revoke execute` (`supabase/migrations/20260927133501_offer_notes_server_timestamps.sql:16-60`).
- Every column referencing `auth.users` states its `on delete`, chosen from the PRD
  (`context/foundation/lessons.md:12-17`). **The PRD states no rule for who ran an audit**;
  `prd.md:128` covers offers, notes and requirements.
- A new column referencing `auth.users` gets a case in `scripts/account-deletion.sql`, whose
  snapshot check hard-codes `count(*) <> 7` (`:124`).
- An upsert checks the `select` policy on both rows
  (`supabase/migrations/20260926202537_create_offer_notes.sql:110-112`) — relevant if a re-run
  replaces an audit in place.
- The Supabase client is untyped; there are no generated database types
  (`src/lib/otodom/types.ts:110-111`).

### What the hosting platform allows

Read 2026-10-06 from Cloudflare's documentation through Context7
(<https://developers.cloudflare.com/workers/platform/limits>,
<https://developers.cloudflare.com/workers/runtime-apis/context>).

- **CPU**: 10 ms per HTTP request on Workers Free. Waiting on `fetch` does not count. The docs add
  that an isolate has "some built-in flexibility" for a Worker that infrequently runs over, and
  that heavier workloads "typically use 10-20 ms".
- **Duration**: "There is no hard limit on duration for HTTP-triggered Workers. As long as the
  client remains connected, the Worker can continue processing, making subrequests, and streaming a
  response body."
- **Client disconnect**: "When the client disconnects or the response is complete, tasks associated
  with that request may be canceled." `ctx.waitUntil()` extends execution by up to 30 seconds after
  the response is sent or the client disconnects.
- **Runtime updates**: the runtime is updated a few times per week and gives in-flight requests a
  30-second grace period; a request still running after that is terminated. The docs call a
  collision "very unlikely". A request lasting minutes is exposed to it for longer than a typical
  one.
- **Subrequests**: 50 external subrequests per invocation on Free.
- **An undocumented idle limit is reported, not confirmed.** A community report of 2025-03-24
  describes a deployed Worker's subrequest stream failing with "Network connection lost" when more
  than 100 seconds pass between bytes
  (<https://www.answeroverflow.com/m/1353616307580571710>). If it holds, a non-streamed model call
  that takes longer than 100 seconds to answer would be cut, while a streamed one would not. This
  research did not reproduce it.
- **Idle connections on the client side.** A Cloudflare pull request of 2026-02-12 added a
  30-second keep-alive ping to long POST responses because proxies and load balancers were dropping
  idle streams (<https://github.com/cloudflare/agents/pull/898>). That is evidence about idle
  connections in general, not a documented limit of this platform.

### What the provider's SDK and API allow

Read 2026-10-06 from the `anthropics/anthropic-sdk-typescript` repository through Context7, and
from the Anthropic API reference bundled with Claude Code (cached 2026-09-25).

- **Runtime**: the SDK's README lists Cloudflare Workers among supported runtimes. The requirement
  is stated without a `nodejs_compat` condition; a build and a deployed request were not run.
- **Schema-constrained output without a validation library**: `jsonSchemaOutputFormat` from
  `@anthropic-ai/sdk/helpers/json-schema` takes a raw JSON Schema and is passed as
  `output_config.format` to `client.messages.parse()`, which exposes `parsed_output`. The SDK also
  has a Zod helper and accepts any Standard Schema library; neither is required.
- **What the schema does not enforce**: string length limits, `pattern`, numeric bounds and
  `minItems` above 1 are not supported by the API; the SDK moves them into the field's description.
  Every object needs `additionalProperties: false`. The schema guarantees shape, not content — it
  cannot check that an excerpt occurs in the listing.
- **When the output may not match the schema**: on `stop_reason: "refusal"` and on
  `stop_reason: "max_tokens"`. Both have to be read before `parsed_output`.
- **Citations and schema-constrained output are mutually exclusive**: the API returns a 400 when
  both are requested.
- **Timeouts and retries**: a per-request `timeout` in milliseconds and an `AbortSignal` are
  accepted as request options; `maxRetries` defaults to 2 and covers timeouts and connection
  errors.
- **Billing meets retries.** The provider charges a request that was "on track to succeed" when
  the client disconnected or timed out (`provider-selection.md`). Read together with the default of
  two retries, a timed-out audit can be paid for more than once. This is an inference from two
  sources, not an observed charge.
- **Streaming**: the SDK's `messages.stream()` with `finalMessage()` returns the complete message
  while bytes flow during generation. Schema-constrained output works with streaming.
- **Model behaviour that affects the request shape** (API reference): on `claude-opus-5-5` thinking
  cannot be disabled and effort defaults to `medium`; on `claude-opus-5` thinking is on by default
  and effort defaults to `high`. Both reject a fixed thinking budget and both can end a response
  with `stop_reason: "refusal"`.

### Provider and model

- **Provider**: Anthropic, direct, prepaid credits; credits bought 2026-10-06. Reasons, billing
  guarantees, what they do not guarantee, the alternatives and the price table are in
  `provider-selection.md`.
- **Model**: `CLAUDE.md` names `claude-opus-5` and makes a change the user's decision. Anthropic's
  pricing page lists Claude Opus 5 at 5 USD input and 25 USD output per million tokens and Claude
  Opus 5.5 at 4 USD and 20 USD. Its models overview page, read the same day, recommends starting
  with Claude Opus 5 and does not list Opus 5.5 in its comparison table. No document read here
  compares models on Polish real-estate terminology.

## Code References

- `src/lib/otodom/map.ts:127-146` — `htmlToPlainText`, the function that produces the excerpt
  reference text
- `src/lib/otodom/map.ts:74-86` — `numericOrUnknown`
- `src/lib/otodom/map.ts:11-32` — the `raw` whitelist
- `src/lib/criteria.ts:214-269` — `loadCriteria`
- `src/lib/offer-board.ts:72-81` — `AuditStatus` and `auditStatus()`, the board's swap point
- `src/components/offers/AuditStatusBadge.astro:13-15` — the one place a status gets a label
- `src/components/offers/OfferNotes.astro:46` — where the audit is inserted on the card
- `src/pages/offers/[id].astro:45-55` — the card's parallel reads and its `?error=` handling
- `src/pages/api/offers.ts:16-53`, `:128-138`, `:173-175` — the reference form route
- `src/middleware.ts:6` — `PROTECTED_ROUTES`, which does not include `/api`
- `src/lib/log.ts:9-40` — the log field whitelist
- `src/lib/config-status.ts:11-19` — the banner's entries
- `supabase/migrations/20260927144141_create_team_criteria.sql:206-263` — `criteria_revision` and
  its triggers
- `supabase/migrations/20260927133501_offer_notes_server_timestamps.sql:16-60` — server timestamps
  and the freeze trigger
- `tests/fixtures/http.ts:39-72` — `stubFetch` and `restoreFetch`
- `wrangler.jsonc:12-14` — why there is no `limits` block

## Architecture Insights

- **The plain-text normalisation was done at fetch so that the audit would not have to do it.**
  Any second normalisation at audit time would reopen the question of which text an excerpt is
  verbatim against.
- **A failed read is its own state everywhere except the card's offer read**, which renders a
  failed read as 404 (`src/pages/offers/[id].astro:21-30`). The audit's read sits behind that page
  and should follow the convention of notes and criteria, not the page's.
- **Authorisation exists only in RLS.** A route's check on `locals.user` decides who may trigger a
  paid call; RLS decides who may read or write the stored result.
- **The codebase has no place for state between requests other than Postgres.** No mutable
  module-scope value exists under `src/`, and the rules forbid adding one.
- **Smoke never calls an external service by construction, not by a guard.** It reaches
  `/api/offers` only with inputs refused before the fetch (`scripts/smoke.mjs:679-681`,
  `:747-768`). A locally run smoke with a provider key in `.env` has nothing stopping an audit
  route from making a paid call; only the `SUPABASE_URL` host is checked (`:76-83`).

## Historical Context (from prior changes)

- `context/archive/2026-09-22-paste-listing-to-card/plan-brief.md:24`, `plan.md:69`, `:183` — the
  excerpt reference text is the plain-text column; the listing text is never redacted. **Supported**
  by the current mapper.
- `context/archive/2026-09-22-paste-listing-to-card/reviews/plan-review.md:90-93` — `raw` was
  whitelisted to the keys S-04 and S-09 were expected to need, confidence "MED". **Partial**: the
  whitelist exists; finding 2 above argues the audit should not read `raw` for facts at all.
- `context/archive/2026-09-27-team-search-criteria/plan.md:5`, `:23`, `:51`, `:78` — the revision
  counter exists for S-04 to store and S-09 to compare. **Supported** by the migration.
- `context/archive/2026-09-20-deployment/deployment-plan.md:94-99`, `:636-644` — Workers Free is
  deliberate; model choice and hosting plan are separate budgets. **Supported** by `wrangler.jsonc`.
- `context/archive/2026-09-20-deployment/deployment-plan.md:646` — about 29 USD for about 200
  audits on `claude-opus-5`. **Partial**: no token or price basis is given; the assumed-size
  estimate in `provider-selection.md` lands near it.
- `context/archive/2026-09-20-deployment/deployment-plan.md:700` — streaming or polling is the
  audit's architectural decision, taken at FR-010. **Still open.**
- `context/foundation/infrastructure.md:143-148`, `:211-212`, `:225-227` — Workers Paid mandatory
  from day one, the secret living in four places, hosted migrations human-only. **Contradicted** on
  all three by `context/foundation/deployment-runbook.md:282-311`, `wrangler.jsonc:12-14` and
  `CLAUDE.md`. Its statement that the audit waits inside one request (`:20-23`, `:109-111`) is
  **supported**.
- `context/foundation/test-plan.md:66-70` — what the S-04 plan must name for risks #2, #3, #4 and
  #6; `:100` — the provider is stubbed at the HTTP edge; `:103` — a golden set is manual and
  optional and is never used to judge grounding; `:534-535` — `raw.images` holds unfiltered URLs
  and the first phase that reads it filters and tests it.
- `context/foundation/ingestion/otodom_fetching.md:612-626` — the one CPU measurement in the repo:
  parsing a 558,209-byte offer page took under 1 ms of wall time on Workers Free, one offer,
  2026-09-20. It measures ingestion, not the audit.

## Related Research

- `context/changes/grounded-listing-audit/provider-selection.md` — provider, billing and prices.
- `context/archive/2026-09-30-testing-ingestion-guardrails/research.md` — the mapper's guardrails
  and the Vitest toolchain. Its line stating that `raw.location` holds only coordinates is stale:
  the whitelist is `coordinates` and `reverseGeocoding`.

## Open Questions

Needing a measurement:

1. **Does the audit fit 10 ms of CPU?** Parsing the model's answer and running a substring check
   per finding is small work, but reading a streamed response means handling many chunks, and
   nothing has been measured. The runbook's procedure stands: run one audit on the longest listing
   and read the per-request CPU in the Workers dashboard
   (`context/foundation/deployment-runbook.md:282-284`).
2. **Is a silent upstream call cut after 100 seconds?** Unverified community report. A streamed
   call sidesteps the question; a non-streamed one depends on the answer.
3. **How long are real listings, in characters and tokens?** Not measured anywhere. It sets
   `max_tokens`, the cost per audit and whether question 1 is a concern at all.

Needing a decision from the user:

4. ~~Which model.~~ Decided 2026-10-06: `claude-opus-5-5` is the default. See Follow-up below.
5. ~~SDK or plain `fetch`.~~ Decided 2026-10-06: the official SDK.
6. **Validation of the model's output**: the API's schema constraint plus hand-written checks, or a
   validation library. No library is needed to obtain schema-shaped JSON.
7. **Is an audit allowed with no criteria, or with only some set?**
8. **Does a re-run replace the previous audit or add a new one?** `prd.md:93` says a re-run
   "overwrites the old findings"; `prd.md:77` says audits are never deleted by a machine action. A
   member's deliberate re-run satisfies both readings, but the PRD does not say it outright.
9. **What happens to "who ran this audit" when that account is deleted?** The PRD has no rule.
10. **How is progress shown and the ~3-minute limit enforced**: a blocking form POST as ingestion
    does, or an island-driven request with a streamed response. The first reuses everything that
    exists and shows only a spinner; the second would be the repo's first `fetch` endpoint.
11. **What happens when the member closes the tab mid-audit?** The platform may cancel the work,
    `waitUntil` gives 30 seconds, and the provider still charges. This is test-plan risk #3 and the
    plan has to fix the order of the provider call and the write.

Smaller, for the plan to settle:

12. **Whitespace inside excerpts.** The mapper trims line ends only, so a non-breaking space
    decoded from an entity stays inside a line. If the model writes an ordinary space there, an
    exact substring check rejects a correct excerpt. `decodeEntity` turns a numeric entity into
    its code point whatever it is (`src/lib/otodom/map.ts:113-120`), so `&#160;` becomes U+00A0.
    This is an inference from the code; no stored listing was checked for such characters.
13. **May `street_name` be sent to the provider?**
14. **A fourth colour role**, or a non-colour way to tell four finding categories apart.
15. **Guarding a local smoke run** against a paid call when `.env` holds a provider key.

## Follow-up 2026-10-06 — decisions taken after this research

The user decided, in the same conversation: the official Anthropic SDK; `claude-opus-5-5` as the
default model; `medium` as the default reasoning effort (first `low`, then revised); neither hard-coded at the call site; and
auto-reload is off in the Claude Console. `change.md` holds the full record, the two questions the
user wants `/10x-plan` to ask (whether the model is selectable in the application, and what the
audit's instruction should concentrate on) and the points the agent raised that are not yet
answered.

These supersede two statements above: the Summary's item 7 and the "Provider and model" section
describe the model as undecided and `CLAUDE.md` as naming `claude-opus-5`; `CLAUDE.md` now names
`claude-opus-5-5`.

What the decisions change for the findings:

- **The chosen effort equals the model's own default.** On `claude-opus-5-5` an omitted effort
  means `medium` (API reference, cached 2026-09-25). Sending it explicitly keeps the audit's
  default where the user put it if the provider's default changes.
- **Thinking cannot be switched off on this model**; effort is the only control over how much it
  reasons, and so over that part of the output cost.
- **Open Question 1 (CPU) and 3 (listing length) are unchanged** and still need one real audit.
- **A new open question, not blocking**: how `medium` compares with `low` and `high` on real Polish
  listings. Nothing read here measures it.
- **The user asked for a deploy-and-verify phase in the plan**, with an update to
  `context/foundation/deployment-runbook.md`. One real audit in production on the longest listing
  is what closes Open Questions 1 and 3; `change.md` lists what the phase covers.
