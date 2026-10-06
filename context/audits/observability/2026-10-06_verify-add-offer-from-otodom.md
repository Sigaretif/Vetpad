---
type: observability-audit
date: 2026-10-06 20:03
mode: verify
commit: 30838e0
branch: master
dirty_tree: true
areas: [add-offer-from-otodom]
area_source: arguments
runtime_proof: partial
error_tracker: none (Cloudflare Workers Logs only)
previous_report: context/audits/observability/2026-10-05_verify-add-offer-from-otodom.md
findings: { critical: 0, high: 6, medium: 7, low: 2 }
---

# Observability audit — verify: add an offer from otodom (2026-10-06)

Re-check of `context/audits/observability/2026-10-05_verify-add-offer-from-otodom.md`
(verified at `159e67d`) after two changes: `auth-outage-not-signed-out` (archived,
commits `efd0627` … `1eed626`) and `otodom-fetch-sub-reasons` (commits `830721a` …
`30838e0`, status `impl_reviewed`, not archived).

**What was read is the working tree, not the commit.** On top of `30838e0` the tree
carries uncommitted edits to `src/lib/otodom/fetch.ts`, `src/lib/otodom/index.ts`,
`src/lib/otodom/types.ts`, `src/pages/api/offers.ts` and three test files — the triage
after the change's implementation review. Two things in this report exist only in
those edits: slugs are replaced in `landed_path`, and a landing on another offer's
page is refused. Line numbers below are the working tree's.

`findings` in the frontmatter counts what is still open. Of the 20 findings open in
the previous report, 5 are fixed and 15 are as they were.

## 1. TL;DR

- **Both steps landed, and no critical finding is left.** An Auth outage is no longer
  a sign-in redirect: the middleware classifies the error, logs it at `error` and
  answers with a 503 page that keeps the session (P1). An uncaught exception leaves a
  structured entry beside Astro's stack, and the member sees a page instead of a blank
  screen (P4).
- **The runbook's question can be answered from one log entry.** A fetch failure now
  says what the answer was: a Cloudflare challenge (`challenged`), a refusal, a page
  that came without listing data (`data_missing`), or a page whose data changed shape
  (`shape_changed` with a `detail` per origin) — with the status, where the redirects
  ended, the content type, the body's length and whether the marker was there (A4,
  A6, A15, and the headers left over from A3).
- **One ambiguity is left on purpose and is now said out loud.** A block served with
  200, without Cloudflare's header and without the marker, is the same entry as a
  redesigned page: `data_missing`. The code says so, and so does the member's message.
  Telling them apart would mean reading the page's text, which the project rules out.
- **The reporter has two callers now** — the route and the middleware, and nothing else.
  The card, the board, the loaders in `src/lib/` and the other four routes are the
  files the first audit read.
- **Most important consequence now:** a read that fails behind the card is still a 404
  "not found", and behind the board a 200 — and the log holds nothing for either.

## 2. Capture model

Only what changed since the previous report.

- **A second capture boundary, in front of Astro's.** `src/middleware.ts:22-101` wraps
  the whole request in `try`: on a throw it writes `event: "request"`, `outcome:
"unhandled"` with the route pattern, the method, the member's id and the error's
  name, then rethrows the same value (`:90-101`), so Astro's own stack line and the
  500 still happen. The route pattern is used, never the path
  (`src/middleware.ts:17-18`).
- **Auth errors are read.** `getUser()`'s `error` is classified by
  `src/lib/auth-error.ts:18-26` into `missing` (no entry), `rejected` (`info`, a
  sign-out) and `unavailable` (`error`, the 503 page); whatever it cannot recognise is
  `unavailable` (`src/middleware.ts:45-64`). During an outage the client's cookie
  writes are thrown away, so the session survives it (`src/middleware.ts:32-42,70-71`).
- **Error pages.** `src/pages/500.astro` and `src/pages/503.astro`; neither reads
  `locals`, the error or the request body.
- **The whitelist grew** from fourteen keys to thirty (`src/lib/log.ts`): `route`,
  `method`, `error_name`, `auth_status`, `auth_code`, and eleven keys for the fetch
  stage. Two of them hold free text — `error_message` and `error_cause` — and both
  pass through a filter that replaces every quoted address
  (`src/lib/otodom/fetch.ts:25-31,53-78`).
- **Still outside every boundary:** components rendered after the first flush, and the
  browser.

**Assumptions (outside the repo, not findings):** unchanged from the previous report.
None of the three changes has been observed on the deployed Worker; how production
Workers Logs indexes the object, and whether an `error` entry reaches a person, are
still unconfirmed.

## 3. What reaches the logs — before and after

_observed_ — read from the running production preview (section 8); _test_ — a hermetic
test asserts the whole entry; _static_ — read from code.

| Failure shape                                                         | Before (`159e67d`)                                        | After (working tree)                                                                                                         | Evidence | Verdict          |
| --------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| Supabase Auth unreachable, paused, 5xx or rate-limited                | `302 → /auth/signin`; from the route, `info` `signed_out` | `error` `auth_check` / `unavailable` with `route`, `method`, `error_name`, `auth_status`, `auth_code`; 503 page, cookie kept | test     | good             |
| Session Auth refuses (bad or expired token)                           | `302`, no entry                                           | `info` `auth_check` / `rejected` with the same fields; sign-in redirect                                                      | observed | good             |
| No session                                                            | `302`, no entry                                           | no entry from the middleware — an anonymous visitor is not an event                                                          | observed | good             |
| Throw in middleware, handler or page frontmatter                      | 500 with an empty body; one stack string                  | the stack string, plus `error` `request` / `unhandled` with `route`, `method`, `user_id`, `error_name`; the 500 page         | test     | good             |
| Cloudflare challenge in front of otodom, with 403 or 200              | `http_denied`, or `shape_changed` for a 200               | `error` `failed` / `fetch` / `challenged` with `cf_mitigated`, `status`, `retry_after`                                       | test     | good             |
| otodom answers 200 without `__NEXT_DATA__`                            | `shape_changed`, nothing else                             | `error` `failed` / `fetch` / `data_missing` with `status`, `content_type`, `body_length`, `marker_present: false`, landing   | test     | fair — see TL;DR |
| `__NEXT_DATA__` present but unreadable, or without `pageProps` / `ad` | `shape_changed`, nothing else                             | `shape_changed` with `detail`: `next_data_unparseable`, `page_props_missing` or `ad_missing`                                 | test     | good             |
| Redirect off otodom                                                   | `http_denied`, no host                                    | `http_denied` with `landed_host`, `landed_path`                                                                              | test     | good             |
| Redirect to another page on otodom                                    | `not_found` at `info`                                     | results page: `not_found` at `info` with `landed_path`; anything else, or another offer's page: `error` `unexpected_landing` | test     | good             |
| Fetch times out or never connects                                     | `timeout` / `network`, error dropped                      | the same reasons with `error_name`, `error_message`, `error_cause` and `phase` (`headers` or `body`)                         | test     | good             |
| Card read fails after the redirect                                    | `GET /offers/<uuid> → 404`                                | unchanged                                                                                                                    | static   | missed (A8)      |
| Board read fails                                                      | `GET /dashboard → 200`                                    | unchanged                                                                                                                    | static   | missed (A9)      |
| Save fails in another route (criteria, notes, requirements, sign-in)  | `302`                                                     | unchanged                                                                                                                    | static   | missed (P3, P6)  |
| Throw in a child component after the first flush                      | 200, truncated HTML                                       | unchanged                                                                                                                    | static   | missed (P5)      |
| Island fails to hydrate                                               | browser console only                                      | unchanged                                                                                                                    | static   | missed (P10)     |

## 4. Systemic root causes — where each stands

1. **Result objects without a sink — closed for this flow** (previous report). The
   fetch boundary now hands the route its evidence as well
   (`src/lib/otodom/types.ts:27-48`, `src/pages/api/offers.ts:108-123,177-184`).
2. **Supabase `{ error }` is a boolean — closed in the route and the middleware.**
   Open in `src/pages/dashboard.astro`, `src/pages/offers/[id].astro`, the loaders in
   `src/lib/`, `src/pages/api/criteria.ts`, `src/pages/api/notes.ts`,
   `src/pages/api/requirements.ts`; `src/pages/api/auth/signout.ts:7` still does not
   check.
3. **"Never throws" is implemented as discard — closed at the fetch boundary.** Both
   `catch` blocks there bind the error (`src/lib/otodom/fetch.ts:139-145,192-194`);
   the third leaves it out on purpose and says why (`:204-208`). Everywhere else the
   blocks are as they were.
4. **Outage and absence share a representation — closed for Auth and for the fetch.**
   Open for the card (`null` → 404) and for the reads that render an error state at 200.
5. **Every route builds its own failure carrier — unchanged.** The reporter exists and
   the other routes do not call it.
6. **The one place every request passes captures nothing — closed.**
   `src/middleware.ts` is now the reference for it.

## 5. Findings still open

Ids are the first report's. No file cited here has changed since `26e8322`, except
where a row says so.

| #   | Location                                                                               | Category           | Severity | What is left                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------- | ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A8  | `src/pages/offers/[id].astro:21-30,35-37`                                              | flattened-response | high     | A query error, a throw and "no row" are all a 404.                                                                                                                      |
| A9  | `src/pages/dashboard.astro:20-33`                                                      | swallowed          | high     | A failed board read is `GET /dashboard → 200` with nothing logged.                                                                                                      |
| P2  | `src/lib/criteria.ts`, `src/lib/notes.ts`, `src/lib/members.ts`                        | swallowed          | high     | Failed reads render an error state, or drop author names, with no entry.                                                                                                |
| P3  | `src/pages/api/criteria.ts`, `src/pages/api/notes.ts`, `src/pages/api/requirements.ts` | flattened-response | high     | A save that fails for everyone and one that works are both a 302.                                                                                                       |
| P5  | streamed components under the board and the card                                       | coverage-gap       | high     | Not probed; the middleware's `catch` does not see a throw after the first flush.                                                                                        |
| P6  | `src/pages/api/auth/signin.ts:41-45`                                                   | flattened-response | high     | The route shares the outage rule with the middleware now and still logs nothing. During an outage this path stays reachable, so a failed sign-in there is not an event. |
| A13 | `src/lib/otodom/map.ts:221-231`                                                        | flattened-response | medium   | A renamed sale or flat token is still told to the member as their mistake, at `info`.                                                                                   |
| A14 | `src/lib/otodom/map.ts:251-303`                                                        | coverage-gap       | medium   | Renamed characteristic keys still save a card of unknowns, silently.                                                                                                    |
| P7  | `src/pages/api/auth/signout.ts:7`                                                      | swallowed          | medium   | The result is ignored.                                                                                                                                                  |
| P8  | `src/pages/api/requirements.ts:59-66`                                                  | missing-throw      | medium   | A delete RLS denies still reads as a success.                                                                                                                           |
| P9  | `src/lib/supabase.ts`; the route's three Supabase calls                                | missing-context    | medium   | No durations.                                                                                                                                                           |
| P10 | `src/layouts/Layout.astro`; the islands                                                | coverage-gap       | medium   | No client-side listener.                                                                                                                                                |
| P11 | `src/lib/criteria.ts:230-231`                                                          | missing-context    | medium   | An unreadable limits row is the same state as an outage.                                                                                                                |
| A12 | `src/pages/api/offers.ts:126`; `src/pages/api/notes.ts:29`                             | missing-context    | low      | `/dashboard?error=` is still shared by two forms.                                                                                                                       |
| A17 | `src/pages/api/offers.ts:140-147`                                                      | swallowed          | low      | The body exit binds no error and logs no content type — `content_type` is on the whitelist now, this exit does not use it.                                              |

## 6. Recommended fix order — what is left

Nothing here is critical. In a tool a few people use, each of these is a failure the
member sees on the screen; what is missing is the entry that says why.

1. **Read failed is not "not found" and not "empty"** — A8, A9, P2, P11. The one place
   left where the system tells the member something untrue.
2. **The other routes log through the reporter** — P3, P6, P7, P8, and A12's `&form=`.
3. **Mapper drift** — A13, A14.
4. **The rest** — P5 (after a runtime probe), P9, P10, A17.

Two things that are not findings and come before any of the above:

- **Commit the triage edits.** The slug filter on `landed_path` is a privacy fix and
  is not in any commit.
- **Read the log on the deployed Worker once.** Three changes rest on the assumption
  that Workers Logs indexes the entry's fields.

## 7. Changes since last audit

| Previous id    | Severity then | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1             | critical      | fixed      | `src/middleware.ts:45-64` reads `error` and classifies it (`src/lib/auth-error.ts:18-26`); an outage is logged at `error` and rewritten to `/503` (`:73-77`), with the cookie writes dropped (`:70-71`). The route's `signed_out` exit is never reached during an outage: the rewrite happens before `next()`. Tests: `tests/middleware.test.ts` #8–#15. The `rejected` branch was observed on the preview. |
| P4             | high          | fixed      | `try` around the whole middleware, `request` / `unhandled` with `route`, `method`, `user_id`, `error_name`, then `throw error` (`src/middleware.ts:90-101`); `src/pages/500.astro`. Tests #16–#19. Left out of the entry: the error's message and `cause` — the message is in Astro's stack line of the same invocation, the cause is nowhere.                                                              |
| A4             | high          | fixed      | `challenged`, `data_missing` and three `detail`s for `shape_changed` (`src/lib/otodom/fetch.ts:168,196-221`), each with `status` and the evidence listed in section 3. The header half of A3 is closed here too (`:150-154`).                                                                                                                                                                               |
| A6             | high          | fixed      | Two narrow `try` blocks with `phase` (`src/lib/otodom/fetch.ts:136-145,189-194`); the landing is read between them, outside both (`:147-187`); name, message and cause are kept (`:69-78`).                                                                                                                                                                                                                 |
| A15            | medium        | fixed      | `landed_host` and `landed_path` on every landing that is not the offer (`src/lib/otodom/fetch.ts:108-123`); a landing elsewhere on otodom is `unexpected_landing`, an `error` (`:182`, `src/pages/api/offers.ts:74`).                                                                                                                                                                                       |
| A8, A9         | high          | still open | Files unchanged since `26e8322`.                                                                                                                                                                                                                                                                                                                                                                            |
| P2, P3, P5, P6 | high          | still open | Unchanged, except that `signin.ts` imports the shared outage rule.                                                                                                                                                                                                                                                                                                                                          |
| A13, A14       | medium        | still open | `src/lib/otodom/map.ts` unchanged.                                                                                                                                                                                                                                                                                                                                                                          |
| P7–P11         | medium        | still open | `src/lib/supabase.ts` changed its parameter type only.                                                                                                                                                                                                                                                                                                                                                      |
| A12, A17       | low           | still open | See section 5.                                                                                                                                                                                                                                                                                                                                                                                              |

Counts: 5 fixed, 15 still open. Open, then → now: critical 1 → 0, high 9 → 6,
medium 8 → 7, low 2 → 2. Over the three reports: 29 findings, 14 fixed.

## 8. Method and limits

- **No agents.** One reader. Read in full: `src/middleware.ts`,
  `src/lib/auth-error.ts`, `src/lib/error-pages.ts`, `src/lib/supabase.ts`,
  `src/lib/otodom/fetch.ts`, `src/lib/otodom/index.ts`, `src/pages/api/offers.ts`,
  both error pages, `src/pages/api/auth/signin.ts`. For every file behind a
  still-open finding, `git diff 26e8322` is empty.
- **Runtime proof: partial.** No probe harness exists. `npm run build`,
  `npm run preview` and `npm run smoke` on the working tree, against the local
  Supabase; the preview's log held nine entries:
  - two `auth_check` / `rejected` at `info`, for `GET /dashboard` and
    `POST /api/offers`, with `error_name: AuthApiError`, `auth_status: 403`,
    `auth_code: bad_jwt` — smoke's forged-session steps;
  - seven `offer_add` refusals: `auth` / `signed_out` twice, `body` /
    `unreadable_body`, `url` / `empty`, `foreign_host`, `not_an_offer`.

  **Not observed at runtime:** an Auth outage, an uncaught exception, and every fetch
  failure. Smoke runs against a live Auth and never reaches otodom.pl. Those rows rest
  on `npm test` — 718 passing on the working tree — and on reading.

- **Not verifiable from here.** Production Workers Logs; whether Astro hands a throw
  from a page's frontmatter to the middleware's `catch` on workerd exactly as the
  tests' stand-in for `next()` does; what an errored body stream leaves behind (P5).
- **Noticed while verifying, not findings.**
  - `unexpected_landing` is an `error` in the log and "the listing does not exist or
    has expired" to the member (`src/pages/api/offers.ts:29-32`). For a landing nobody
    has seen, the message claims more than the system knows.
  - During an outage every request writes one `error` entry. That is the signal, and
    on the Free plan's daily log quota it is also the first thing to watch.
  - `error_message` and `error_cause` are the first free-text fields on the whitelist.
    The address filter is tested; anything else a runtime error message could quote is
    not filtered.
- **Sweep of `src/`** (without `src/pages/dev`): two modules import the reporter,
  `src/pages/api/offers.ts` and `src/middleware.ts`; `console` is still called in
  `src/lib/log.ts` alone.
- **Probe harness.** None; nothing was left behind. The preview was stopped.
