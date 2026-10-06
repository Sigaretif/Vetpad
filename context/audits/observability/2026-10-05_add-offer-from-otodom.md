---
type: observability-audit
date: 2026-10-05 21:36
mode: audit
commit: 26e8322
branch: master
dirty_tree: true
areas: [add-offer-from-otodom]
area_source: arguments
runtime_proof: not-run
error_tracker: none (Cloudflare Workers Logs only)
previous_report: null
findings: { critical: 3, high: 12, medium: 11, low: 3 }
---

# Observability audit — add an offer from otodom (2026-10-05)

Audited at `26e8322` on `master`, with a dirty tree: `CLAUDE.md` and
`.claude/.10x-cli-manifest.json` modified, two untracked paths. Nothing under `src/`
differs from the commit. Every claim below was read from code, never observed on a
running Worker — see section 8.

## 1. TL;DR

- **The flow is careful about telling failures apart and then tells nobody.**
  `src/lib/otodom/` separates 13 failure reasons, carries the upstream HTTP status and
  a `detail` string — and all of it is spent on one Polish sentence in a redirect.
  There is not a single `console.*` call in `src/`.
- **Every outcome of `POST /api/offers` is a 302.** A save, a duplicate, a refused
  rental, otodom blocking Cloudflare's egress, a changed page format, an RLS rejection
  and a missing migration are the same line in Workers Logs:
  `POST /api/offers → 302, outcome ok`.
- **Database errors are tested for truthiness and dropped.** `postgrest-js` never
  rejects, so a Supabase failure never reaches Astro's catch-all — the only code in
  the system that logs anything. About ten distinct causes share "Nie udało się zapisać
  oferty".
- **An outage and an absence look the same.** A Supabase Auth outage reads as "signed
  out", a failed card read as "offer not found" (404), an anti-bot page served with 200
  as "otodom changed its format", a failed board read as a 200.
- **The runbook's own contingency depends on a log line that does not exist.**
  `context/foundation/deployment-runbook.md:140-143` says to "log every non-200 fetch
  status distinctly from a parse failure", because that is how gradual egress blocking
  is told from a broken parser — the trigger for the Apify fallback. The status is
  computed and never logged.
- **Most important consequence:** if otodom starts refusing Cloudflare's IPs, or a
  Worker deploys ahead of `supabase db push`, every add fails and the only evidence is
  what a member remembers reading on the screen.

## 2. Capture model

How a failure travels from code to a human in this system.

- **Runtime.** One Cloudflare Worker; `main` is the `@astrojs/cloudflare` server
  entrypoint (`wrangler.jsonc:4`), `output: "server"` (`astro.config.mjs:11`). No
  queues, no cron, no `waitUntil` in `src/` — there is no background work to lose.
- **Error tracker.** None. No tracker SDK in `package.json`, no reference in `src/`.
  This is the starting point of the audit, not a finding.
- **Logging.** Zero `console.*` calls in `src/`. The pipeline is Cloudflare Workers
  Logs (`"observability": { "enabled": true }`, `wrangler.jsonc:18-20`), read with
  `npx wrangler tail --format json` or the dashboard
  (`context/foundation/deployment-runbook.md:99-107`; 3-day retention on Free). Per
  invocation it holds the request, the response status, the outcome, console output
  and uncaught exceptions. Whatever the code neither logs nor throws is a bare
  `METHOD /path → status`.
- **The only capture boundary is Astro's.**
  `node_modules/astro/dist/core/routing/handler.js:101-108` wraps middleware, endpoint
  and page frontmatter in one `try`, calls
  `state.logger.error(null, err.stack || err.message || String(err))` and renders a 500. The console destination prints it as one string through `console.error`
  (`core/logger/impls/console.js:11-21`); the built manifest's level is `info`, so it
  does print. The adapter returns that response as is
  (`node_modules/@astrojs/cloudflare/dist/utils/handler.js:79-87`), so workerd records
  status 500 with outcome `ok`. Astro's own request log is a no-op in production
  (`core/app/app.js:7-8`).
- **What runs outside it.** Components rendered after the first flush: an error there
  goes to `controller.error(e)` and never touches the logger
  (`node_modules/astro/dist/runtime/server/render/astro/render.js:62-73`). And the
  browser: no `error` / `unhandledrejection` listener, no error boundary
  (`src/layouts/Layout.astro:14-39`).
- **What never reaches it.** `src/` contains zero `throw` statements and 22 `catch`
  blocks, 21 of them without binding the error (only `src/lib/otodom/fetch.ts:59`
  binds). `postgrest-js` 2.116.0 resolves a network failure to
  `{ error, status: 0 }` instead of rejecting
  (`node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:292-354`), and
  `auth.getUser()` returns every `AuthError` — a network failure and a 5xx included —
  as `{ data: { user: null }, error }`
  (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:3245-3286`,
  `src/lib/fetch.ts:79-100,228-236`). So the boundary above sees programming bugs in
  unwrapped code and nothing else.
- **Response conventions.** Form-backed routes answer every failure with
  `302 → <page>?error=<message>` (`src/pages/api/offers.ts:44`); pages turn a failed
  read into an error state at HTTP 200 (`src/components/offers/OfferBoard.astro:31`)
  or a 404 (`src/pages/offers/[id].astro:35-37`). No code path returns a 5xx on
  purpose.
- **Scrubbing and sampling.** None in code.
- **Deploy identity.** No version, commit or environment is emitted by code;
  `wrangler.jsonc` declares only the `ASSETS` binding.

**Assumptions (outside the repo, not findings):**

| Assumption                                                                                                          | Status                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Workers Logs is collected in production and someone can read it                                                     | in repo (`wrangler.jsonc:18-20`); not confirmed by the user |
| Invocation logs record the request URL with its query string and the response status, but not the `Location` header | unconfirmed                                                 |
| Alert rules, notifications, Logpush or a tail Worker exist                                                          | unknown                                                     |
| The platform attaches a Worker version id to each log event                                                         | unconfirmed                                                 |
| Supabase's own logs (Auth, PostgREST, Postgres) hold the error details the app discards                             | unknown — access and retention not checked                  |
| What workerd records when a response body stream errors mid-flight                                                  | unknown                                                     |

## 3. What reaches the tracker

**Static-only** — derived from reading the code and the installed library sources. No
probe was run; every row is inferred. There is no tracker, so that column is "none"
throughout and the verdict judges what Workers Logs would hold.

| Failure shape                                                             | Response                             | Platform logs                                                                                | Tracker | Verdict                |
| ------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- | ------- | ---------------------- |
| Throw in middleware, route handler or page frontmatter                    | 500, empty body                      | one `console.error` string with the stack; no route, user, cause or error code; outcome `ok` | none    | poor                   |
| otodom answers 403 / 429 / 5xx                                            | 302 → `/dashboard?error=…(HTTP 403)` | `POST → 302`; the status only as prose in the next GET's URL                                 | none    | missed as an event     |
| otodom answers 200 without `__NEXT_DATA__` (anti-bot page or new format)  | 302, "strona mogła zmienić format"   | `POST → 302`                                                                                 | none    | missed                 |
| Mapper refuses the payload (`shape_changed` with `detail`)                | 302                                  | `POST → 302`; `detail` is dropped                                                            | none    | missed                 |
| Fetch times out, the network fails, or code inside the fetch `try` throws | 302                                  | `POST → 302`                                                                                 | none    | missed                 |
| Insert rejected (RLS, check, not-null, missing column, network)           | 302, `SAVE_FAILED`                   | `POST → 302`                                                                                 | none    | missed                 |
| Duplicate pre-check read fails                                            | 302, `SAVE_FAILED`                   | `POST → 302`                                                                                 | none    | missed                 |
| Supabase Auth unreachable or paused                                       | 302 → `/auth/signin`                 | `POST → 302`                                                                                 | none    | missed                 |
| Card read fails after the redirect                                        | 404 "Nie znaleziono oferty"          | `GET /offers/<uuid> → 404`                                                                   | none    | missed, wrong category |
| Board read fails                                                          | 200 with the error alert             | `GET /dashboard → 200`                                                                       | none    | missed                 |
| Throw in a child component after the first flush                          | 200, truncated HTML                  | nothing from Astro's logger                                                                  | none    | missed                 |
| Platform ends the invocation (CPU limit 1102, client cancel)              | Cloudflare error page                | outcome `exceededCpu` / `canceled`, no application context                                   | none    | poor                   |
| Island fails to hydrate                                                   | form still posts natively            | browser console only                                                                         | none    | missed                 |

## 4. Systemic root causes

1. **Result objects without a sink.** The ingestion module models failure precisely —
   `reason`, `status`, `detail` (`src/lib/otodom/types.ts:5-14,86-87`,
   `src/lib/otodom/index.ts:12-14`) — and the route's only consumer is
   `failureMessage(result.reason, result.status)` (`src/pages/api/offers.ts:10-41,80`),
   which builds the user's sentence. It is a reasonable design for the UI; nothing was
   ever asked to be the second consumer. Explains A1, A3, A5, A11, A12, A13.

2. **Supabase `{ error }` is a boolean here.** Every result is tested with
   `if (x.error)` and the object — `code`, `message`, `hint`, HTTP `status` — is
   discarded: `src/pages/api/offers.ts:71,89,93`, `src/pages/dashboard.astro:29`,
   `src/pages/offers/[id].astro:26`, and 16 of the 16 checked result sites repo-wide.
   Two sites do not check at all (`src/middleware.ts:10-13`,
   `src/pages/api/auth/signout.ts:7`). Because the client never rejects, this is the
   only place a database failure could have been recorded. Explains A2, A7, A8, A9,
   A10, A16, P1, P2, P3.

3. **"Never throws" is implemented as discard.** 21 of 22 `catch` blocks have no
   binding and return a fallback (`src/pages/dashboard.astro:30`,
   `src/pages/offers/[id].astro:27`, `src/lib/otodom/fetch.ts:70`,
   `src/lib/criteria.ts:266`). The comments justify the degradation — a page must not
   500 — and that part is right. They do not justify the silence, and where the `try`
   also wraps mapping code a programming bug becomes a permanent error state with no
   stack. Explains A6, A17, P2.

4. **Outage and absence share a representation.** A failed lookup is folded into the
   value that means "nothing there": `user: null` (`src/middleware.ts:10-13`),
   `null` → 404 (`src/pages/offers/[id].astro:21-30`), `shape_changed` for any 200
   without the marker (`src/lib/otodom/fetch.ts:63-65`), `network` for anything the
   fetch `try` throws (`src/lib/otodom/fetch.ts:59-61`). Explains A4, A6, A8, A15, P1.

5. **Failure is carried as 302 / 200 / 404, and every route builds its own carrier.**
   `fail()` is a closure per route (`src/pages/api/offers.ts:44`,
   `src/pages/api/criteria.ts:34-35`, `src/pages/api/notes.ts:29,55`,
   `src/pages/api/requirements.ts:34-35`) and `src/lib/` has no logger module, so there
   is no single line where a signal could be added. The convention itself is the
   project's (`CLAUDE.md`, Conventions) and is right for the user; the gap is that it
   is the only record. Explains A1, A12, P3, P6.

6. **The one place every request passes captures nothing.** `src/middleware.ts:6-29`
   ignores the auth error and does not wrap `next()`, which leaves Astro's
   context-free stack string as the sole capture, and streamed components bypass even
   that. Explains P1, P4, P5.

`CLAUDE.md` now states the rule these break — "No empty `catch`, no ignored promise
rejections, no failures turned into redirects or `200`s, no dropped error causes. If
the fix needs a `catch`, it logs or reports the error with its cause." That section is
an uncommitted edit, newer than every line it describes.

## 5. Findings by area

### Add an offer from otodom

| #   | Location                                                                                              | Category           | Severity | What happens in production                                                                                                                                                                                                                                                                                                                                                                               | Fix direction                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `src/pages/api/offers.ts:44,47-49,75,80,94,97,100`                                                    | flattened-response | critical | The member sees the right page or a Polish message. A responder sees `POST /api/offers → 302, outcome ok` for a save, a duplicate, all 13 ingest refusals, every database failure and "not signed in". Success rate, failure reason and failing stage cannot be derived.                                                                                                                                 | One structured log per outcome in the handler: `event`, `stage` (precheck / fetch / map / insert / twin), `reason`, upstream `status`, `user.id`, otodom id. `error` level for `http_denied`, `upstream_error`, `shape_changed`, `timeout`, `network` and database failures; `info` for the rest. |
| A2  | `src/pages/api/offers.ts:89-98`                                                                       | identity-lost      | critical | `inserted.error.code`, `message`, `hint` and `inserted.status` are discarded. One sentence covers a missing column or table (Worker deployed before `supabase db push` — fails every add), an RLS rejection, an expired JWT, a check or not-null violation from a mapper bug, an out-of-range integer, a date Postgres refuses, and a network failure. The responder sees a 302.                         | Log `code`, `message`, `hint`, HTTP status, `user.id`, `otodom_id`. Never `error.details`: for a check or not-null violation Postgres puts the failing row there, listing description included.                                                                                                   |
| A3  | `src/lib/otodom/fetch.ts:39-50`; `src/pages/api/offers.ts:26-29,80`                                   | coverage-gap       | high     | Egress blocking that arrives gradually is a stream of 302s. The status reaches the member's message and, as percent-encoded prose, the URL of the next GET — never a log event; for 404 / 410 it is dropped even from the message (`offers.ts:23-25`). The log `deployment-runbook.md:140-143` requires does not exist.                                                                                  | Log `reason`, `status` and the `cf-mitigated` / `retry-after` headers at the fetch boundary. Never the body.                                                                                                                                                                                      |
| A4  | `src/lib/otodom/fetch.ts:63-65,70-72,76,85`; `src/lib/otodom/map.ts:213,219`                          | flattened-response | high     | A captcha, consent or anti-bot page served with 200 on otodom.pl has no `__NEXT_DATA__` and becomes `shape_changed`: "strona otodom.pl mogła zmienić format". That is the confusion the runbook warns about. Nine origins share the reason; none records status, final URL, content type, body length or whether the marker was there.                                                                   | A sub-reason per origin, logged with `status`, landing host and path, `content-type`, `html.length`, marker present yes/no. No HTML, no `ad` payload.                                                                                                                                             |
| A5  | `src/lib/otodom/map.ts:223,230,239,242` → `src/lib/otodom/index.ts:14` → `src/pages/api/offers.ts:80` | identity-lost      | high     | The mapper says which check failed ("id, title, url or description missing", "characteristics missing", the `ProperType` token). `failureMessage` never reads it; its only reader is the local `scripts/otodom-inspect.mjs:60`. A responder cannot tell which part of the payload moved.                                                                                                                 | Put `detail` in the A1 log line. The values are fixed strings or an enum token — safe to log.                                                                                                                                                                                                     |
| A6  | `src/lib/otodom/fetch.ts:59-61`                                                                       | identity-lost      | high     | `error.name`, `message` and `cause` are dropped for a two-way label. "network" also absorbs throws from inside the same `try` that are not network failures — `new URL(response.url)` (`:52`), a body-read failure (`:58`), the runtime's redirect-limit and subrequest-limit errors. The member reads "Nie udało się połączyć z otodom.pl". "timeout" does not say whether headers or the body stalled. | Log `error.name`, `error.message` and a phase marker (headers / body). Move the landing-URL check out of the `try`.                                                                                                                                                                               |
| A7  | `src/pages/api/offers.ts:70-73`                                                                       | missing-throw      | high     | A read that fails before anything was fetched answers "Nie udało się zapisać oferty", and `existing.error` is dropped. The quiet variant: with a session PostgREST treats as anonymous, the select answers `[]` with 200, the route spends a request on otodom and fails only at the insert — an auth problem that costs an otodom fetch and still reads as a save failure.                              | Its own message and stage; log `code`, `message`, `status`.                                                                                                                                                                                                                                       |
| A8  | `src/pages/offers/[id].astro:21-30,35-37`                                                             | flattened-response | high     | A query error, a thrown exception and "no row" all return `null` → 404. A transient PostgREST failure right after the redirect shows "Nie znaleziono oferty" for an offer saved a second earlier; the member may paste it again or believe it was deleted. In the logs it is `GET /offers/<uuid> → 404`, the same as a mistyped id.                                                                      | Three outcomes instead of two. On a read error: log the offer id, `code` and `status`, answer 503 with a "cannot load right now" state.                                                                                                                                                           |
| A9  | `src/pages/dashboard.astro:20-33`                                                                     | swallowed          | high     | The member sees "Nie udało się wczytać ofert". The responder sees `GET /dashboard → 200`. `data-board-state="error"` exists only in the HTML body, which only `scripts/smoke.mjs` reads. The zero-config state, a query error and a throw share `{ ok: false }`.                                                                                                                                         | Bind the error and log `code`, `message`, `status`, `user.id` — separately from the unconfigured case, which is not a failure.                                                                                                                                                                    |
| A10 | `src/pages/api/offers.ts:91-97`                                                                       | swallowed          | medium   | `twin.error` is never read. A unique violation followed by an empty lookup is an invariant violation (a select-policy regression, or a second unique constraint) and falls through to `SAVE_FAILED`, whose "Nic nie zostało zapisane" is false here — the listing is already saved.                                                                                                                      | Log both errors with `otodom_id`; a distinct message.                                                                                                                                                                                                                                             |
| A11 | `src/pages/api/offers.ts:78`                                                                          | missing-context    | medium   | Nothing ever ties an invocation to a member, a listing or a stage. When the platform ends it — the CPU limit, or the member closing the tab during the 45 s wait — the outcome is recorded with no clue which listing or step.                                                                                                                                                                           | One "ingest started" line before the fetch: `user.id` and the listing id taken from the slug.                                                                                                                                                                                                     |
| A12 | `src/pages/api/offers.ts:44`; `src/pages/dashboard.astro:10,48`; `src/pages/api/notes.ts:29`          | missing-context    | medium   | The reason survives only as a percent-encoded sentence in the URL of the next request. It exists only if the browser follows the redirect; reload, back or a shared link replays it; anyone can forge it; any copy edit breaks a query built on it; it joins to its POST by time alone. `/dashboard?error=` is also shared — a notes failure redirected there renders inside the add-offer form.         | A1 makes this channel unnecessary for diagnosis; keep it for the member only. Tell the two forms apart with `&form=`, as `src/pages/api/criteria.ts` does.                                                                                                                                        |
| A13 | `src/lib/otodom/map.ts:221-231`                                                                       | flattened-response | medium   | If otodom renames `SELL` and `sprzedaz` together, every sale is refused with "to ogłoszenie dotyczy wynajmu"; a renamed `FLAT` becomes "inny rodzaj nieruchomości". A parser regression is presented as the member's mistake, and with no count per reason the spike is invisible.                                                                                                                       | Log each refusal with the raw tokens (`adCategory.type`, `adCategory.name`, `OfferType`, `ProperType`) — enum values, not personal data.                                                                                                                                                          |
| A14 | `src/lib/otodom/map.ts:251-303`                                                                       | coverage-gap       | medium   | Renamed characteristic keys make every fact `null` and the save succeeds: a card of "nie podano". Correct under the unknown-not-zero guardrail, and silent as a regression.                                                                                                                                                                                                                              | Warn when a saved offer has neither `price` nor `area_m2`, or most characteristic keys are absent. Field names only, no values.                                                                                                                                                                   |
| A15 | `src/lib/otodom/fetch.ts:51-57`                                                                       | identity-lost      | medium   | A landing off otodom is `http_denied` with no status and no host; a landing on otodom outside an offer path is `not_found`, so a challenge page under an otodom.pl path reads "Ogłoszenie nie istnieje lub wygasło".                                                                                                                                                                                     | Log the landing host and path, without the query string.                                                                                                                                                                                                                                          |
| A16 | `src/pages/api/offers.ts:6,97`                                                                        | flattened-response | low      | When the insert fails with status 0 the commit state is unknown — the POST is not retried — yet the message asserts nothing was saved. The member's retry then lands on the duplicate notice.                                                                                                                                                                                                            | A distinct message and log line for `status === 0`.                                                                                                                                                                                                                                               |
| A17 | `src/pages/api/offers.ts:56-62`                                                                       | swallowed          | low      | A body that cannot be parsed shows "To nie wygląda na poprawny adres URL". The comment covers the hand-crafted request, not a truncated or oversized body.                                                                                                                                                                                                                                               | Log at `warn` with the content type.                                                                                                                                                                                                                                                              |
| A18 | `src/pages/api/offers.ts:10-41`                                                                       | noise              | low      | Not a gap today — a condition on the fix. Expected refusals (foreign host, rental, not a flat, expired, duplicate) leave through the same `fail()` as a blocked egress or a database failure. Logged at one level, they would bury the real signal.                                                                                                                                                      | Map each reason to a level in one place, next to `failureMessage`, under the same exhaustiveness check.                                                                                                                                                                                           |

### Platform / plumbing

P2, P3, P6–P8 and P11 come from the repo-wide sweep, not from a full-stack audit of
their flows; they are here because the mechanism is the one above.

| #   | Location                                                                                                                                             | Category           | Severity | What happens in production                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fix direction                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `src/middleware.ts:10-13`; `src/pages/api/offers.ts:46-49`                                                                                           | missing-throw      | critical | The middleware reads `data.user` and ignores `error`. An Auth outage, a paused project or any 5xx yields `user: null`, so every protected page — and `POST /api/offers`, which is not under `PROTECTED_ROUTES` and redirects by itself — answers 302 → `/auth/signin`. The member loses the pasted URL and sees a sign-in page with no message; the responder sees 302s identical to an expired session. This is the mechanism behind the runbook row "Login fails in production, and no banner appears". | Read `error`. A missing session is "signed out"; anything else is logged (`name`, `status`, `code`, no email) and rendered as "service unavailable" instead of a sign-in redirect. `src/pages/api/auth/signin.ts:6-11` already classifies these errors. |
| P2  | `src/lib/criteria.ts:219-268,277-284`; `src/lib/notes.ts:61-97`; `src/lib/members.ts:34-41,67-84`                                                    | swallowed          | high     | An outage, an RLS regression or an unpushed migration renders "nie udało się wczytać" at 200, and a failed `members` read drops author names with no marker at all — the duplicate notice on a just-added offer names nobody. Nothing is logged. The `try` also wraps the mapping code, so a programming bug is a permanent error state with no stack.                                                                                                                                                    | One reporter called from each failure branch with `{ op, table, code, status, userId }`; no `details`, no row values, never an email. Narrow each `try` to the I/O.                                                                                     |
| P3  | `src/pages/api/criteria.ts:91-98`; `src/pages/api/notes.ts:81-85`; `src/pages/api/requirements.ts:62-65,91-94`                                       | flattened-response | high     | A save that fails for everyone and a save that works are both a 302. One message stands for an unknown Postgres error, zero rows from RLS and a thrown exception.                                                                                                                                                                                                                                                                                                                                         | A shared fail-redirect helper that logs route, a stable reason key, the Postgres code and the user id before redirecting.                                                                                                                               |
| P4  | `node_modules/astro/dist/core/routing/handler.js:101-108`; `core/errors/default-handler.js:105-107`; no `src/pages/500.astro`                        | missing-context    | high     | An uncaught throw gives the member a blank white page. The log is a stack string: no route, method, user, `cause`, or the `status` / `code` an `AuthError` carries. The unwrapped call sites are `src/middleware.ts:12`, `src/pages/api/auth/signin.ts:42`, `src/pages/api/auth/signout.ts:7` and `src/pages/api/offers.ts:70,83,92`.                                                                                                                                                                     | Wrap `next()` in the middleware: log a structured object with the route and user id, then rethrow so the 500 stays a 500. Add `src/pages/500.astro`.                                                                                                    |
| P5  | `node_modules/astro/dist/runtime/server/render/astro/render.js:62-73`, reached from `src/pages/dashboard.astro:52`, `src/pages/offers/[id].astro:68` | coverage-gap       | high     | A throw in a child component after the first flush never calls Astro's logger: the status is already 200 and the HTML stops mid-page. What workerd records for the errored stream is not known — the least certain finding here.                                                                                                                                                                                                                                                                          | Keep throw-prone shaping in frontmatter or `src/lib/`, where a throw is a logged 500. Probe P10 of the runtime catalog settles the rest.                                                                                                                |
| P6  | `src/pages/api/auth/signin.ts:42-46`                                                                                                                 | flattened-response | high     | An outage, wrong credentials, a rate limit and an unknown error code are all a 302. The route classifies them for the member's message and logs none.                                                                                                                                                                                                                                                                                                                                                     | Log the error class, `status` and `code`. Never the email or the password.                                                                                                                                                                              |
| P7  | `src/pages/api/auth/signout.ts:7`                                                                                                                    | swallowed          | medium   | The result is ignored. When the session cannot be loaded, sign-out returns an error without removing it; the member is redirected to `/` as if signed out while the cookie survives — on a shared computer, a risk. No signal.                                                                                                                                                                                                                                                                            | Check the result; on error log it, and clear the cookies locally or say that it failed.                                                                                                                                                                 |
| P8  | `src/pages/api/requirements.ts:59-66`                                                                                                                | missing-throw      | medium   | The delete checks `error` only. A delete RLS denies answers like a successful one with zero rows, so the route redirects as a success and the requirements stay. `CLAUDE.md` (Testing) already says a denied write is recognised by its row count.                                                                                                                                                                                                                                                        | `.select("author_id")` on the delete; zero rows is a logged failure.                                                                                                                                                                                    |
| P9  | `src/lib/supabase.ts:9-20`; `src/pages/api/offers.ts:70,83,92`                                                                                       | missing-context    | medium   | The 45 s signal covers otodom only. `postgrest-js` retries a GET three times with 1 / 2 / 4 s backoff (`fetchWithRetry.ts:95-125`) and an auth refresh retries for up to 30 s. During an outage pages hang and then show an error state; only wall time hints at it.                                                                                                                                                                                                                                      | A wrapped `global.fetch` in `createClient` logging method, pathname, status and duration — never the query string, which holds filter values. Per-stage durations in the A1 line.                                                                       |
| P10 | `src/layouts/Layout.astro:14-39`; the islands                                                                                                        | coverage-gap       | medium   | A failed hydration or chunk load — stale HTML after a deploy — leaves a form that still posts natively, without validation, pending state, or the `window.confirm` on destructive actions (`src/components/criteria/TeamLimitsForm.tsx:83`, `RequirementsEditor.tsx:86`). `astro:hydration-error` fires and nothing listens.                                                                                                                                                                              | A listener in `Layout.astro` for `astro:hydration-error`, `error` and `unhandledrejection`, sending `{ message, component, path }` to a small endpoint. No form values. A new endpoint is an API-surface change: `scripts/smoke.mjs` covers it.         |
| P11 | `src/lib/criteria.ts:230-231`                                                                                                                        | missing-context    | medium   | A limits row that does not read as limits is reported as the same state as an outage, and stays that way until someone opens the database.                                                                                                                                                                                                                                                                                                                                                                | A distinct reason (`invalid_row`) in the P2 report.                                                                                                                                                                                                     |

## 6. Recommended fix order

Ordered by blindness removed per unit of effort.

1. **A reporter and the offers handler's outcomes** — closes A1, A2, A3, A5, A7, A10,
   A11, A16, A18, and most of A12. A small `src/lib/` module that writes one
   structured object through `console`, called at every exit of
   `src/pages/api/offers.ts`. Responses do not change. This is the whole audited flow
   in one change, and the runbook's missing log with it.
2. **The middleware** — closes P1 and P4. Read `getUser().error`; wrap `next()` with
   log-and-rethrow. The only code every request passes, so it is the widest fix after
   the first.
3. **The fetch boundary's sub-reasons** — closes A4, A6, A15. This is what lets the
   runbook's question — blocked, or broken parser? — be answered from a log instead
   of a throwaway Worker.
4. **Read failed is not "not found" and not "empty"** — closes A8, A9, P2, P11. The
   loaders log through the reporter; the card answers 503 for a failed read.
5. **Mapper drift** — closes A13, A14.
6. **A shared fail-redirect helper for the other routes** — closes P3, P6, P7, P8,
   and the `&form=` half of A12.
7. **The rest** — P5 (after a runtime probe), P9, P10, A17, and `src/pages/500.astro`.

Constraints a real implementation must respect:

- **Privacy.** Log ids, codes and enum tokens. Never `error.details` from Postgres
  (it quotes the failing row — the listing's description, a note's text), never the
  page HTML or the `ad` payload (the advertiser's phone and name), never a member's
  email, never a query string. A whitelist of logged fields, not a blacklist — the
  same shape as `raw` in `src/lib/otodom/map.ts`.
- **A test before each fix.** `tests/pages/api/offers.test.ts` covers refusals and the
  successful save; nothing exercises the pre-check error, the insert error or the twin
  lookup (`src/pages/api/offers.ts:71-73,89-98`). Those are the branches fix 1 touches.
- **No new dependency.** `console` is the sink; an error-tracker SDK is a decision
  for `/10x-infra-research`, not part of these fixes.
- **Log volume.** Workers Logs on Free allows 200k events a day
  (`deployment-runbook.md:105`); one line per add is nowhere near it, but P9's
  per-request line needs a level.
- **Levels from the start (A18)**, or the first week of logs is refused rentals.
- **Zero-config stays a state, not a failure.** An unconfigured Supabase is not logged
  as an error (`src/pages/dashboard.astro:21`).

## 8. Method and limits

- **Agents.** Two read-only auditors ran in parallel: one on the add-offer flow
  (22 findings), one on cross-cutting code (18 findings). Merged to 29 after
  deduplication — the middleware, the card's 404, the board read, the `?error=`
  channel, the silent retries and the client were each reported from both sides.
- **Verified by hand** against the code and the installed sources:
  `postgrest-js` resolving instead of rejecting (`PostgrestBuilder.ts:292-354`) and
  retrying GETs only (`fetchWithRetry.ts:95-125`); `getUser()` returning `AuthError`s
  (`GoTrueClient.ts:3245-3286`, `lib/fetch.ts:79-100,228-236`); Astro's catch-all,
  console destination, no-op request log and empty 500
  (`handler.js:101-108`, `console.js:7-21`, `app.js:7-8`, `default-handler.js:105-107`);
  the streaming error path (`render.js:62-73`); the adapter returning the response
  (`@astrojs/cloudflare/dist/utils/handler.js:79-87`); `/api/offers` being outside
  `PROTECTED_ROUTES`; `detail` having no reader in the route; the column types and
  check constraints behind A2; the missing failure-branch tests; the delete in P8.
  All held.
- **Changed in triage.** A3 went from critical to high: the status does reach the
  member's message and the next request's URL. A10 from high to medium (a rare
  invariant violation). P2 and P3 from critical to high, because their flows were
  swept, not audited. Dropped: a finding that no version id is emitted (moved to
  Assumptions — the platform may attach one), and a chain an auditor marked as
  inferred — a page's second Supabase client falling back to the publishable key
  (`SupabaseClient.ts:626-627`) and showing a signed-in member an empty board marked
  `ok`. The fallback is real; the path into it was not traced.
- **Runtime proof: not run.** `--runtime` was not passed. Section 3 is static-only.
  Not observable from the repo: how Workers Logs renders an `Error` passed to
  `console.error`, whether the query string and `Location` header are recorded, and
  what an errored body stream leaves behind (P5).
- **Sweep of `src/`** (without `src/pages/dev`): 22 `catch` blocks — 0 empty, 21
  without a binding; 0 `.catch()` to a default; 0 `console.*`; 0 `throw`; 18 Supabase
  result sites — 16 check `error` and discard its content, 2 do not check.
- **Versions read.** astro 7.3.2, @astrojs/cloudflare 14.3.1, auth-js and
  postgrest-js 2.116.0.
- **Probe harness.** None exists; no worktree or temporary file was created.
