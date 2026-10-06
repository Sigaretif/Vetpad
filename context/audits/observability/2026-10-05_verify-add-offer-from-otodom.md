---
type: observability-audit
date: 2026-10-05 22:38
mode: verify
commit: 159e67d
branch: master
dirty_tree: true
areas: [add-offer-from-otodom]
area_source: arguments
runtime_proof: partial
error_tracker: none (Cloudflare Workers Logs only)
previous_report: context/audits/observability/2026-10-05_add-offer-from-otodom.md
findings: { critical: 1, high: 9, medium: 8, low: 2 }
---

# Observability audit — verify: add an offer from otodom (2026-10-05)

Re-check of `context/audits/observability/2026-10-05_add-offer-from-otodom.md`
(audited at `26e8322`) after the change `offers-outcome-logging` — commits `53273ea`,
`cc282c1`, `4f559bf`, `57c5ebf`, `159e67d`. Verified at `159e67d` on `master`, with a
dirty tree: `CLAUDE.md` and `.claude/.10x-cli-manifest.json` modified, three untracked
paths, this directory among them. Nothing under `src/` differs from the commit.

`findings` in the frontmatter counts what is still open. Of the 29 findings in the
previous report, 9 are fixed, 4 changed and 16 are as they were.

## 1. TL;DR

- **Step 1 of the previous fix order landed, and it closes what it set out to close.**
  Every one of the thirteen ways out of `POST /api/offers` writes one structured entry
  through `src/lib/log.ts` before it returns, and a fourteenth entry marks the start of
  the fetch. A1, A2, A3, A5, A7, A10, A11, A16 and A18 are fixed.
- **The two critical findings of the flow are gone; the critical finding of the
  plumbing is not.** A database failure now carries its code, message, hint and HTTP
  status. An Auth outage still reads as "signed out" (P1) — the route now logs it, as
  `refused` / `auth` / `signed_out` at `info`, which makes it countable and mislabels it.
- **The runbook's log exists.** `reason: "http_denied"` with a `status` is a log event,
  and `stage` tells a page that lost its data from a payload the mapper refuses.
  Inside the fetch stage the question is still open: an anti-bot page served with 200
  and a changed page format are the same entry (A4).
- **The reporter has one caller.** `logEvent` is imported by
  `src/pages/api/offers.ts` and nothing else. The other routes, the loaders, the
  middleware, the card and the board are byte-for-byte what the previous report read.
- **Most important consequence now:** when Supabase Auth is unreachable, or a read
  behind the card or the board fails, the system still says "signed out", "not found"
  or renders an error state at 200 — and nothing in the logs says otherwise.

## 2. Capture model

Only what changed. Everything else in section 2 of the previous report still holds.

- **Logging.** `src/` now has two `console` calls, both in `src/lib/log.ts:47-48`:
  `console.error` for level `error`, `console.info` for `info`, each with one flat
  object as its only argument. `no-console` is an error everywhere else under `src/`
  (`eslint.config.js:107-110`), so this module is the only way out to the console.
- **Scrubbing.** There is one now, and it is a whitelist. The entry is built by walking
  a fixed list of fourteen keys (`src/lib/log.ts:9-24,39-46`), never the caller's keys;
  a value gets in only as a non-empty text cut to 300 characters, a finite number or a
  boolean. A field that is not on the list cannot reach the log whatever a call site
  passes — proved by leaking Postgres' `details` from the route on purpose: the
  console output did not change until the key was also added to the list.
- **Levels.** `failed` is `error`, every other outcome is `info`
  (`src/pages/api/offers.ts:78-80`). Which ingest reason is a refusal and which a
  failure is one table beside `failureMessage`, exhaustive by type
  (`src/pages/api/offers.ts:56-70`).
- **Capture boundary, deploy identity, the browser.** Unchanged. Astro's catch-all is
  still the only boundary; no version or environment is emitted by code.

**Assumptions (outside the repo, not findings):**

| Assumption                                                                                             | Status                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Workers Logs is collected in production and someone can read it                                        | in repo (`wrangler.jsonc`); not confirmed by the user                                                                     |
| Workers Logs indexes the fields of a single logged object as separate keys                             | from Cloudflare's documentation, read 2026-10-05; not observed on the deployed Worker — this change has not been deployed |
| Alert rules, notifications, Logpush or a tail Worker exist, so an `error`-level entry reaches a person | unknown                                                                                                                   |
| The platform attaches a Worker version id to each log event                                            | unconfirmed                                                                                                               |
| Supabase's own logs hold the details the app still discards outside this route                         | unknown                                                                                                                   |

## 3. What reaches the logs — before and after

There is no tracker, so the table judges what Workers Logs would hold. **Evidence**
says how the "after" column is known: _observed_ — the entry was read from a running
server (section 8); _test_ — a hermetic route test asserts the whole entry with
`toStrictEqual`, the network stubbed at the HTTP edge; _static_ — read from code.

| Failure shape                                                   | Before (`26e8322`)                                 | After (`159e67d`)                                                                                               | Evidence                                           | Verdict                  |
| --------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------ |
| otodom answers 403 / 429                                        | `POST → 302`                                       | `started`, then `error` `failed` / `fetch` / `http_denied` with `status`                                        | test                                               | good                     |
| otodom answers 5xx                                              | `POST → 302`                                       | `started`, then `error` `failed` / `fetch` / `upstream_error` with `status`                                     | test                                               | good                     |
| otodom answers 404 / 410                                        | `POST → 302`, status dropped even from the message | `started`, then `info` `refused` / `fetch` / `not_found` with `status`                                          | test                                               | good                     |
| otodom answers 200 without `__NEXT_DATA__`                      | `POST → 302`                                       | `error` `failed` / `fetch` / `shape_changed` — an event, but anti-bot page and new format are still one entry   | test                                               | poor (A4)                |
| Mapper refuses the payload                                      | `POST → 302`, `detail` dropped                     | `error` `failed` / `map` / `shape_changed` with `detail`                                                        | test                                               | good                     |
| Fetch times out or the network fails                            | `POST → 302`                                       | `error` `failed` / `fetch` / `timeout` or `network`; the error's name, message and cause are still dropped      | test                                               | fair (A6)                |
| Rental, or not a flat                                           | `POST → 302`                                       | `info` `refused` / `map` / `not_for_sale` or `not_a_flat` (with the `ProperType` token)                         | test                                               | good                     |
| Insert rejected by the database                                 | `POST → 302`, `SAVE_FAILED`                        | `error` `failed` / `insert` / `insert_failed` with `db_code`, `db_message`, `db_hint`, `db_status`, `otodom_id` | test                                               | good                     |
| Insert gets no answer                                           | `POST → 302`, "nothing was saved"                  | `error` `failed` / `insert` / `insert_unconfirmed` with `db_status: 0`; the member is told to check the board   | test                                               | good                     |
| Duplicate pre-check read fails                                  | `POST → 302`, `SAVE_FAILED`                        | `error` `failed` / `precheck` / `precheck_failed` with `db_*`; nothing is fetched                               | test                                               | good                     |
| Unique violation, twin not found or its lookup fails            | `POST → 302`, "nothing was saved" (false)          | `error` `failed` / `twin` / `twin_missing` or `twin_lookup_failed`; the member is told the listing is saved     | test                                               | good                     |
| Save, duplicate                                                 | `POST → 302`                                       | `started` + `saved`; or `duplicate` at `precheck` / `twin`, each with `offer_id`                                | observed (save, duplicate by address), test (twin) | good                     |
| Address refused before the network, unreadable body, signed out | `POST → 302`                                       | one `info` `refused` entry: `url` / reason, `body` / `unreadable_body`, `auth` / `signed_out`                   | observed                                           | good                     |
| Supabase Auth unreachable or paused                             | `POST → 302 → /auth/signin`                        | the same `refused` / `auth` / `signed_out` at `info`                                                            | static                                             | missed as an outage (P1) |
| Platform ends the invocation during the fetch                   | outcome with no application context                | the `started` entry precedes it, with `user_id` and `listing`                                                   | static                                             | fair                     |
| Throw in middleware, handler or frontmatter                     | 500, one stack string, no context                  | unchanged                                                                                                       | static                                             | poor (P4)                |
| Card read fails after the redirect                              | `GET /offers/<uuid> → 404`                         | unchanged                                                                                                       | static                                             | missed (A8)              |
| Board read fails                                                | `GET /dashboard → 200`                             | unchanged                                                                                                       | static                                             | missed (A9)              |
| Throw in a child component after the first flush                | 200, truncated HTML                                | unchanged                                                                                                       | static                                             | missed (P5)              |
| Island fails to hydrate                                         | browser console only                               | unchanged                                                                                                       | static                                             | missed (P10)             |

## 4. Systemic root causes — where each stands

1. **Result objects without a sink — closed for this flow.** The route is now the
   second consumer: `stage`, `reason`, `status` and `detail` go into the entry
   (`src/pages/api/offers.ts:147-153`), and `ingestOffer` says which stage refused
   (`src/lib/otodom/index.ts:16-20,29-35`).
2. **Supabase `{ error }` is a boolean — closed at three sites, open at the rest.**
   `src/pages/api/offers.ts:130-135,167-182,193-198` read `code`, `message`, `hint` and
   the result's `status`. `src/pages/dashboard.astro:29`,
   `src/pages/offers/[id].astro:26`, the loaders in `src/lib/` and the three other
   routes still test for truthiness; `src/middleware.ts:10-13` and
   `src/pages/api/auth/signout.ts:7` still do not check.
3. **"Never throws" is implemented as discard — unchanged.** 22 `catch` blocks, 21
   without a binding, the same numbers as before. The one in the route
   (`src/pages/api/offers.ts:113`) still binds nothing; it now reports that it ran.
4. **Outage and absence share a representation — unchanged.** `user: null`
   (`src/middleware.ts:10-13`), `null` → 404 (`src/pages/offers/[id].astro:21-30`),
   `shape_changed` for any 200 without the marker (`src/lib/otodom/fetch.ts:63-65`),
   `network` for anything the fetch `try` throws (`src/lib/otodom/fetch.ts:59-61`).
5. **Every route builds its own failure carrier — half closed.** The missing module
   exists (`src/lib/log.ts`). `fail()` is still a closure per route
   (`src/pages/api/criteria.ts`, `src/pages/api/notes.ts:29`,
   `src/pages/api/requirements.ts`), and none of them calls the reporter.
6. **The one place every request passes captures nothing — unchanged.**
   `src/middleware.ts:6-29` is the file the previous report read.

## 5. Findings still open

Ids are the previous report's. Locations are current; rows marked _changed_ say what
is left. Fixed findings are in section 7 only.

### Add an offer from otodom

| #   | Location                                                                               | Category           | Severity | What happens in production                                                                                                                                                                                                                                                                                                                                                            | Fix direction                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A4  | `src/lib/otodom/fetch.ts:63-65,70-72,76,85`                                            | flattened-response | high     | _Changed._ The fetch stage and the mapper are now told apart, and the mapper's refusals carry `detail`. Inside the fetch stage four origins still share `failed` / `fetch` / `shape_changed` with no status, landing URL, content type, body length or marker flag — so a captcha or anti-bot page served with 200 is still logged, and told to the member, as a changed page format. | A sub-reason per origin, with `status`, landing host and path, `content-type`, `html.length`, marker present yes/no. This is also where the `cf-mitigated` / `retry-after` headers left over from A3 belong. New keys go onto the reporter's list. |
| A6  | `src/lib/otodom/fetch.ts:59-61`                                                        | identity-lost      | high     | `timeout` and `network` are now `error`-level events, but `error.name`, `message` and `cause` are still dropped, and `network` still absorbs every non-network throw inside the same `try`.                                                                                                                                                                                           | Log `error.name`, `error.message` and a phase marker; move the landing-URL check out of the `try`.                                                                                                                                                 |
| A8  | `src/pages/offers/[id].astro:21-30,35-37`                                              | flattened-response | high     | Unchanged: a query error, a throw and "no row" are all a 404. The route now logs `saved` with the `offer_id` a second earlier, so a 404 on that id can be recognised as a failed read — by someone who already suspects it.                                                                                                                                                           | Three outcomes; log the read error; answer 503.                                                                                                                                                                                                    |
| A9  | `src/pages/dashboard.astro:20-33`                                                      | swallowed          | high     | Unchanged: `GET /dashboard → 200` for a failed board read.                                                                                                                                                                                                                                                                                                                            | Bind the error; log `code`, `message`, `status`, `user_id` through the reporter.                                                                                                                                                                   |
| A13 | `src/lib/otodom/map.ts:221-231`                                                        | flattened-response | medium   | _Changed._ Each refusal is now an entry, so a spike of `not_for_sale` or `not_a_flat` can be counted. A renamed `SELL` / `sprzedaz` is still presented to the member as their mistake, at `info`, and only `not_a_flat` carries a raw token (`ProperType`).                                                                                                                           | Log the four raw tokens on every refusal of the gate.                                                                                                                                                                                              |
| A14 | `src/lib/otodom/map.ts:251-303`                                                        | coverage-gap       | medium   | Unchanged: renamed characteristic keys save a card of unknowns, and the `saved` entry looks like any other.                                                                                                                                                                                                                                                                           | Warn when a saved offer has neither price nor area. Field names only.                                                                                                                                                                              |
| A15 | `src/lib/otodom/fetch.ts:51-57`                                                        | identity-lost      | medium   | Unchanged in the module. A landing off otodom is now an `error` entry (`http_denied`, no status, no host); a challenge page under an otodom path is `not_found` and therefore logged at `info` as an expected refusal.                                                                                                                                                                | Log the landing host and path, without the query string.                                                                                                                                                                                           |
| A12 | `src/pages/api/offers.ts:96`; `src/pages/api/notes.ts:29`; `src/pages/dashboard.astro` | missing-context    | low      | _Changed, was medium._ Diagnosis no longer depends on the `?error=` sentence. What is left is the member's side: `/dashboard?error=` is shared, so a notes failure redirected there renders inside the add-offer form.                                                                                                                                                                | `&form=`, as `src/pages/api/criteria.ts` does.                                                                                                                                                                                                     |
| A17 | `src/pages/api/offers.ts:110-117`                                                      | swallowed          | low      | _Changed._ The exit is a distinct entry (`refused` / `body` / `unreadable_body`). The error is still not bound and the content type is not logged, so a truncated or oversized body is the same entry as a hand-crafted request.                                                                                                                                                      | Add the content type to the entry.                                                                                                                                                                                                                 |

### Platform / plumbing

None of these files changed. Each row was re-read at `159e67d`.

| #   | Location                                                                                                       | Category           | Severity | Status     | Note                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------ | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `src/middleware.ts:10-13`; `src/pages/api/offers.ts:98-102`                                                    | missing-throw      | critical | still open | The route's exit now logs `signed_out`; the cause is decided in the middleware, which still ignores `error`.                                   |
| P2  | `src/lib/criteria.ts`, `src/lib/notes.ts`, `src/lib/members.ts`                                                | swallowed          | high     | still open | No caller of the reporter.                                                                                                                     |
| P3  | `src/pages/api/criteria.ts:88-98`; `src/pages/api/notes.ts:78-86`; `src/pages/api/requirements.ts:59-66,88-95` | flattened-response | high     | still open | `src/pages/api/offers.ts` is now the reference for what these should do.                                                                       |
| P4  | Astro's catch-all; no `src/pages/500.astro`                                                                    | missing-context    | high     | still open | The route's Supabase calls are at `src/pages/api/offers.ts:128,158-162,187-191`, still unwrapped — a thrown bug there is a context-free stack. |
| P5  | streamed components under `src/pages/dashboard.astro`, `src/pages/offers/[id].astro`                           | coverage-gap       | high     | still open | Still the least certain finding; no probe was run.                                                                                             |
| P6  | `src/pages/api/auth/signin.ts:42-46`                                                                           | flattened-response | high     | still open |                                                                                                                                                |
| P7  | `src/pages/api/auth/signout.ts:7`                                                                              | swallowed          | medium   | still open |                                                                                                                                                |
| P8  | `src/pages/api/requirements.ts:59-66`                                                                          | missing-throw      | medium   | still open | The delete still checks `error` only.                                                                                                          |
| P9  | `src/lib/supabase.ts:9-20`; `src/pages/api/offers.ts:128,158,187`                                              | missing-context    | medium   | still open | The entries carry no duration.                                                                                                                 |
| P10 | `src/layouts/Layout.astro`; the islands                                                                        | coverage-gap       | medium   | still open | No listener for `astro:hydration-error`, `error` or `unhandledrejection`.                                                                      |
| P11 | `src/lib/criteria.ts:230-231`                                                                                  | missing-context    | medium   | still open |                                                                                                                                                |

## 6. Recommended fix order — what is left

Step 1 of the previous list is done. The rest keeps its order; each step is cheaper
than it was, because the reporter and its test pattern exist.

1. **The middleware** — closes P1 and P4. Read `getUser().error` and log anything that
   is not a missing session; wrap `next()` with log-and-rethrow. It also corrects what
   the route now logs as `signed_out`.
2. **The fetch boundary's sub-reasons** — closes A4, A6, A15 and the header half of A3.
   The runbook's question is answered between stages today, not inside the fetch.
3. **Read failed is not "not found" and not "empty"** — closes A8, A9, P2, P11.
4. **Mapper drift** — closes A13, A14.
5. **The other routes log through the reporter** — closes P3, P6, P7, P8 and the
   `&form=` half of A12.
6. **The rest** — P5 (after a runtime probe), P9, P10, A17, `src/pages/500.astro`.

Constraints, beside those in section 6 of the previous report:

- **A new field is added to the reporter's list, never passed around it**
  (`CLAUDE.md`, Conventions). Steps 2, 3 and 5 each need keys the list does not have
  (a landing host, a content type, an operation and table name), and each addition
  takes a case in `tests/lib/log.test.ts`.
- **A new logging route copies the test, not only the code.**
  `context/foundation/test-plan.md` § 6.9: the whole entry written by hand, and a
  search of the console for what must not be there, one scenario per stage.
- **`db_message` is Postgres' own sentence.** It names a constraint or, for a typed
  column, quotes the rejected number or date. The plan accepted that; it becomes a
  question again the day a route logs a failed write of free text (a note, a
  requirement), where a length or encoding error could quote the member's words.

## 7. Changes since last audit

| Previous id | Severity then | Status        | Evidence                                                                                                                                                                                                                                                                                                     |
| ----------- | ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1          | critical      | fixed         | Thirteen `return`s in the handler, each preceded by one `report(...)` (`src/pages/api/offers.ts:100-210`), plus `started` at `:144`. Each exit has a test asserting the whole entry; five were observed on the running preview, three more on the dev server (section 8).                                    |
| A2          | critical      | fixed         | `dbFields` logs `code`, `message`, `hint` and the result's `status` (`src/pages/api/offers.ts:90-93`) with `user_id` and `otodom_id`; `details` is never read. Tests: an RLS refusal (`42501`, 403) and a check violation whose `details` quotes the row — `details` is absent from the console.             |
| A3          | high          | fixed         | `status` is in the entry for every fetch failure that has one, 404 and 410 included (`src/pages/api/offers.ts:147-153`); `context/foundation/deployment-runbook.md` now describes the log instead of asking for it. Left over: the `cf-mitigated` / `retry-after` headers are not logged — carried under A4. |
| A4          | high          | changed       | `stage` separates the fetch from the mapper (`src/lib/otodom/index.ts:29-35`). The four fetch-side origins are still one entry.                                                                                                                                                                              |
| A5          | high          | fixed         | `detail: result.detail` (`src/pages/api/offers.ts:152`); tests for the missing title and for `ProperType`.                                                                                                                                                                                                   |
| A6          | high          | still open    | `src/lib/otodom/fetch.ts:59-61` is unchanged. The outcome is now an `error` entry; the error itself is still dropped.                                                                                                                                                                                        |
| A7          | high          | fixed         | Its own stage, reason and message (`src/pages/api/offers.ts:129-137`); the test asserts no otodom request and no insert. The quiet variant — a session PostgREST treats as anonymous — still costs a fetch, and is now readable at the insert as `42501` with `db_status: 403`.                              |
| A8          | high          | still open    | `src/pages/offers/[id].astro` unchanged.                                                                                                                                                                                                                                                                     |
| A9          | high          | still open    | `src/pages/dashboard.astro` unchanged.                                                                                                                                                                                                                                                                       |
| A10         | medium        | fixed         | `twin.error` is read and logged; an empty lookup is `twin_missing`; both tell the member the listing is saved (`src/pages/api/offers.ts:187-206`). Three tests.                                                                                                                                              |
| A11         | medium        | fixed         | `started` with `user_id` and `listing`, written before the fetch (`src/pages/api/offers.ts:143-144`); a duplicate by address never writes it.                                                                                                                                                                |
| A12         | medium        | changed → low | The log carries the reason; the shared `/dashboard?error=` remains.                                                                                                                                                                                                                                          |
| A13         | medium        | changed       | Refusals are countable per reason; raw tokens only for `not_a_flat`.                                                                                                                                                                                                                                         |
| A14         | medium        | still open    | `src/lib/otodom/map.ts` unchanged.                                                                                                                                                                                                                                                                           |
| A15         | medium        | still open    | `src/lib/otodom/fetch.ts` unchanged; see the note on levels in section 5.                                                                                                                                                                                                                                    |
| A16         | low           | fixed         | `inserted.status === 0` has its own reason and a message that does not claim nothing was saved (`src/pages/api/offers.ts:165-175`). Test: a rejected `fetch` on the insert.                                                                                                                                  |
| A17         | low           | changed       | A distinct entry; no content type, error not bound.                                                                                                                                                                                                                                                          |
| A18         | low           | fixed         | `INGEST_OUTCOME` beside `failureMessage`, `Record<IngestFailureReason, …>` (`src/pages/api/offers.ts:56-70`); removing one reason fails `npx astro check` with `ts(2741)`.                                                                                                                                   |
| P1          | critical      | still open    | `src/middleware.ts` unchanged.                                                                                                                                                                                                                                                                               |
| P2          | high          | still open    | Loaders unchanged.                                                                                                                                                                                                                                                                                           |
| P3          | high          | still open    | Routes unchanged.                                                                                                                                                                                                                                                                                            |
| P4          | high          | still open    | No wrapper, no `src/pages/500.astro`.                                                                                                                                                                                                                                                                        |
| P5          | high          | still open    | Not probed.                                                                                                                                                                                                                                                                                                  |
| P6          | high          | still open    | `src/pages/api/auth/signin.ts` unchanged.                                                                                                                                                                                                                                                                    |
| P7          | medium        | still open    | `src/pages/api/auth/signout.ts` unchanged.                                                                                                                                                                                                                                                                   |
| P8          | medium        | still open    | `src/pages/api/requirements.ts` unchanged.                                                                                                                                                                                                                                                                   |
| P9          | medium        | still open    | No durations, no wrapped `fetch`.                                                                                                                                                                                                                                                                            |
| P10         | medium        | still open    | No listeners.                                                                                                                                                                                                                                                                                                |
| P11         | medium        | still open    | `src/lib/criteria.ts` unchanged.                                                                                                                                                                                                                                                                             |

Counts: 9 fixed, 4 changed, 16 still open. Fixed by severity: critical 2 (A1, A2),
high 3 (A3, A5, A7), medium 2 (A10, A11), low 2 (A16, A18). Open, then → now:
critical 3 → 1, high 12 → 9, medium 11 → 8, low 3 → 2 — A12 moved from medium to low.

## 8. Method and limits

- **No agents.** One reader re-read every cited location at `159e67d`. Files changed
  since `26e8322` under `src/`: `src/lib/log.ts` (new), `src/lib/otodom/index.ts`,
  `src/pages/api/offers.ts`. For every other cited file `git diff 26e8322..HEAD` is
  empty, and the cited lines were read again rather than assumed.
- **Runtime proof: partial.** The previous report had no probe harness, so there is no
  identical before/after suite. What was observed instead:
  - _Production preview on workerd, at `159e67d`._ `npm run build`, `npm run preview`,
    then `npm run smoke` against the local Supabase. The server log held five
    `POST /api/offers` lines and five `offer_add` entries, one before each: `auth` /
    `signed_out`, `body` / `unreadable_body`, `url` / `empty`, `url` / `foreign_host`,
    `url` / `not_an_offer` — each printed as an object with separate fields. Before the
    change the same five requests left five bare `302` lines.
  - _Dev server, earlier the same day, at the tree that became `4f559bf`._
    `src/` has not changed since (`git diff 4f559bf..HEAD -- src` is empty). One real
    sale listing gave `started` then `saved`; the same address again gave `duplicate`
    at `precheck` with the same `offer_id`. The entries were searched for the
    listing's title, the words of its slug, the full address, the pasted query and the
    member's email: none was there. The offer was deleted from the local database
    afterwards.
  - _Not observed at runtime:_ every database-failure branch, every otodom failure
    (403, 5xx, timeout, anti-bot page), the twin path. They rest on hermetic tests —
    `npm test`, 547 passing at `57c5ebf`; the later commit touched no code — and on
    reading. Nothing was run against otodom.pl for this report.
- **Mutation evidence.** `context/archive/2026-10-05-offers-outcome-logging/mutation.md`: Stryker
  on the three changed files, 95.53% (235 killed of 246), each of the 11 left with a
  recorded decision. Four of them are entries of `INGEST_OUTCOME` that nothing reads —
  the address reasons, which the route refuses with a literal `refused` before
  `ingestOffer` runs.
- **Still not verifiable from here.** How production Workers Logs renders and indexes
  the object; whether an `error`-level entry reaches anyone; what an errored body
  stream leaves behind (P5).
- **Noticed while verifying, not findings.** The `listing` token is whatever `ID…`
  word ends the slug: a slug ending in a title word that starts with "ID" would be
  logged as that word. Real slugs end with the portal's token.
- **Sweep of `src/`** (without `src/pages/dev`): 22 `catch` blocks, 21 without a
  binding — as before; 2 `console.*` calls, both in `src/lib/log.ts` — was 0; 0
  `throw`; one module imports the reporter.
- **Probe harness.** None exists; no worktree or temporary file was left behind. The
  preview and the dev server were stopped.
