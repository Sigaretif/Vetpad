---
project: vetpad
context_type: runbook
platform: Cloudflare Workers
worker_name: vetpad
production_url: https://vetpad.vetpad.workers.dev
plan: Workers Free
first_deployed: 2026-09-20
---

# Deployment Runbook

Operational knowledge for shipping and debugging Vetpad in production. Written for
an agent starting a fresh session with no memory of how this was set up.

`@context/foundation/infrastructure.md` is _why_ this platform was chosen.
This file is _how it actually behaves_, written after deploy zero — every entry
below was observed, not predicted. The step-by-step account of that first deploy
lives in `context/archive/2026-09-20-deployment/deployment-plan.md`; this file is
the part that outlives it.

## Current state

|                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker                | `vetpad`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Production URL        | <https://vetpad.vetpad.workers.dev>                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Cloudflare account    | `917c8d5693d671be4227202d2ceb42ed`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Plan                  | **Workers Free** — deliberate, see "When to buy Workers Paid"                                                                                                                                                                                                                                                                                                                                                                                                   |
| Auto-deploy           | Workers Builds, production branch **`master`**                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Secrets in production | `SUPABASE_URL`, `SUPABASE_KEY` (hosted Supabase, publishable key), `ANTHROPIC_API_KEY` (since 2026-10-09); `APIFY_TOKEN` is the user's step after `otodom-apify-fallback` deploys — until it is set, every ingestion mode runs as `direct_only` and the banner says so; `GOOGLE_MAPS_SERVER_KEY` and `GOOGLE_MAPS_BROWSER_KEY` are the user's step after `commute-times` deploys — until they are set, commute times are switched off and the banner names both |
| KV binding            | `SESSION` → namespace `vetpad-session` (auto-provisioned, adapter-injected)                                                                                                                                                                                                                                                                                                                                                                                     |
| Preview URLs          | **disabled** (`preview_urls: false`)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Observability         | enabled; `wrangler tail` and Workers Logs both work on Free                                                                                                                                                                                                                                                                                                                                                                                                     |

## How a change reaches production

**The routine path is a push to `master`.** Workers Builds runs `npm run build`
then `npx wrangler deploy`. Nothing else is needed and nobody has to run a deploy
command. GitHub Actions is a quality gate only and carries no deploy step.

Changes leave the working tree through `/git-ship` or `/git-land` — user-invoked
skills, and `CLAUDE.md` requires asking which one every time. An agent cannot run
either; ask the user.

**The emergency path** is a manual deploy from a local tree:

```bash
npm run build && npx wrangler deploy
```

Use it when Workers Builds is broken or unavailable, not as a habit — two deploy
sources racing is how a tree and a production Worker drift apart. Never
`wrangler pages deploy`: `@astrojs/cloudflare` v14 dropped Pages support, so that
command is wrong for this repository no matter what a tutorial says.

## Verifying a deploy

Routes, banner, Supabase reachability and the CPU ceiling in one pass:

```bash
B=https://vetpad.vetpad.workers.dev
for p in "/" "/auth/signin" "/auth/signup"; do printf '%-14s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$B$p")"; done
curl -s -o /dev/null -w "/dashboard %{http_code} -> %{redirect_url}\n" "$B/dashboard"
curl -s -o /tmp/p.html "$B/"
grep -q "Supabase nie jest skonfigurowany" /tmp/p.html && echo "banner: VISIBLE — secrets missing" || echo "banner: gone"
grep -q "ANTHROPIC_API_KEY" /tmp/p.html && echo "provider banner: VISIBLE — key missing" || echo "provider banner: gone"
grep -q "GOOGLE_MAPS_" /tmp/p.html && echo "maps banner: VISIBLE — a Google key missing" || echo "maps banner: gone"
grep -qiE "1102|exceeded resource limits" /tmp/p.html && echo "!!! 1102" || echo "1102: none"
curl -s -o /dev/null -w "wrong-password -> %{redirect_url}\n" -X POST "$B/api/auth/signin" \
  -H "Origin: $B" --data-urlencode "email=x@y.z" --data-urlencode "password=wrong"
curl -s -o /dev/null -w "audit without a session %{http_code} -> %{redirect_url}\n" -X POST "$B/api/audits" \
  -H "Origin: $B" --data-urlencode "offer_id=00000000-0000-4000-8000-000000000000"
curl -s -o /dev/null -w "commute without a session %{http_code} -> %{redirect_url}\n" -X POST "$B/api/commute" \
  -H "Origin: $B" --data-urlencode "offer_id=00000000-0000-4000-8000-000000000000"
# SUPABASE_URL / SUPABASE_KEY: the hosted project URL and its publishable key
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $SUPABASE_KEY" | grep -o '"disable_signup":[a-z]*'
```

Expected: `200`, `200`, `404`, `302 -> /auth/signin`, every banner gone, no 1102, the
wrong password redirect carrying `?error=Nieprawid%C5%82owy%20e-mail%20lub%20has%C5%82o.`
(the application's own sentence for credentials Auth refused), the audit and commute routes
each answering `302 -> /auth/signin`, and `"disable_signup":true`.

The audit and commute requests carry no session, so each route ends them before it looks
for an offer or a key: they cost nothing and never reach the model provider or Google. Nothing in this pass
runs an audit — a real one is a deliberate, paid, manual action (`CLAUDE.md`, Testing).

Registration is checked by **reading** the Auth settings, never by a trial
`POST /auth/v1/signup`: if sign-up were open, that probe would create an account in
production. The trial sign-up belongs to `npm run smoke`, on a throwaway local database.

**The wrong-password check is the useful one.** That sentence proves
the Worker reached the hosted Supabase — an unreachable one fails differently. It
verifies the whole path without anybody holding a production password. Signing in
for real stays a human action in a browser.

## Rollback

```bash
npx wrangler versions list          # candidates
npx wrangler rollback [version-id]  # seconds
```

**Rollback reverts code, never data.** Once `supabase/migrations/` exists, a rolled
back Worker may not understand the current schema — that is a manual recovery, not
a rollback. A `wrangler secret put` is itself a new version, so rolling back code
can roll back a secret with it; check `wrangler secret list` afterwards.

## Logs

```bash
npx wrangler tail --format json
```

Workers Logs is included on Free (200k events/day, 3-day retention) and
`observability.enabled` is already true, so the dashboard's log view works with no
extra setup.

Every attempt to add an offer leaves entries with `event: "offer_add"`: filter on that
field, then on `outcome`, `stage` and `reason`.

The middleware (`src/middleware.ts`) writes two more. `event: "auth_check"` is a session
Supabase Auth did not confirm: `outcome: "rejected"` at `info` is a session Auth refused,
and the member is signed out; `outcome: "unavailable"` at `error` is an Auth that could
not answer, and the member got the 503 page — read `auth_status`, `auth_code` and
`error_name` to tell a paused project from a rate limit or a network failure. A visitor
without a session cookie leaves no entry. `event: "request"` with `outcome: "unhandled"`
is an exception that ended in the 500 page: `route` is the route's pattern, never the
path, and the stack is in Astro's own line beside it.

Every audit leaves entries with `event: "offer_audit"` (`src/pages/api/audits.ts`). An
audit that reached the model provider leaves two: `outcome: "started"` with
`stage: "provider"` before the paid call, and one more on the way out — `completed`
(`info`), `refused` (`info`, a refusal the product expects, such as an attempt already
running) or `failed` (`error`), with `stage` and `reason`. The entries carry `user_id`,
`offer_id`, `model`, `effort`, `criteria_revision` and `listing_chars`; the closing one
adds `provider_request_id`, `stop_reason`, `input_tokens`, `output_tokens`,
`duration_ms` (the provider call), `stream_events`, `findings_count`, `rejected_count`
and `dropped_count`. A provider failure is told by `reason`, `status`,
`provider_error_type` and `provider_request_id`; `provider_error_message` appears only
on a request the provider rejected as invalid, cut short. A failed read of the criteria
or of the settings says which step failed in `detail`, `db_code`, `db_status` and
`error_name`. No entry holds the prompt, the listing's text, an excerpt, a requirement
or the model's answer. A request that never got as far as the claim leaves one entry
and no `started`.

`event: "audit_settings"` (`src/pages/api/audit-settings.ts`) is a change of the team's
model or effort on `/criteria`: `refused` at `info`, `failed` at `error` with `stage`,
`reason` and, from the database, `db_code` and `db_status`.

`wrangler tail --format json` also gives each request's `cpuTime` and `wallTime` in
milliseconds, next to its log entries — the per-request CPU reading "The CPU ceiling is
reached" asks for, without the dashboard.

Known limitation: when Auth refuses a refresh token (a stale cookie), `auth-js` itself
calls `console.warn` with the `AuthApiError` — Auth's message and a stack — once per
auth-state listener, outside `logEvent`; it predates the `auth_check` entries, and
silencing it belongs with the `createClient` fetch wrapper (observability audit finding
P9), not with the middleware.

## Symptoms that lie

Every row here was hit or verified during deploy zero. All of them look like
something other than what they are, which is the only reason this table exists.

| Symptom                                                                                                       | Actual cause                                                                                                                                                                                     | Action                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1102 Worker exceeded resource limits`                                                                        | Free plan's 10 ms CPU ceiling                                                                                                                                                                    | **Check the plan before debugging code.** The message names no limit and reads like an application bug                                                                                                                                        |
| Deploy rejected, API error **100328**                                                                         | a `limits` block in `wrangler.jsonc` while on Free                                                                                                                                               | Remove it. `limits.cpu_ms` is Paid-only and blocks the deploy outright                                                                                                                                                                        |
| `curl` exit 35 / `sslv3 alert handshake failure` on a fresh `*.workers.dev` name                              | certificate not issued yet — the wildcard covers one label, this host has two                                                                                                                    | Wait ~2 minutes and retry. The Worker is already live                                                                                                                                                                                         |
| Push to `master` triggers no build, silently                                                                  | Workers Builds production branch left at the default `main`                                                                                                                                      | Set it to `master`. Failure mode is silence, not an error                                                                                                                                                                                     |
| Build fails during install                                                                                    | `.nvmrc` pins a version the build image lacks                                                                                                                                                    | Image preinstalls **22.23.2** and **24.18.0** only; an exact version outside those forces a source build                                                                                                                                      |
| New version shows source `version_upload`, looks unpromoted                                                   | `wrangler deploy` is upload **then** promotion, and the API labels them separately                                                                                                               | Check `wrangler deployments list` — 100% traffic on the new version means it deployed                                                                                                                                                         |
| Signed-in members get the 503 page and login fails, **no banner appears**                                     | hosted Supabase project paused after ~7 days idle (Free tier)                                                                                                                                    | Resume it in the Supabase dashboard. The log names it: `event: "auth_check"`, `outcome: "unavailable"`, with `auth_status` when Auth sent one. `src/lib/config-status.ts` detects _unset_ variables, never an _unreachable_ service           |
| A member reads „otodom.pl przysłał stronę bez danych ogłoszenia”                                              | may be a block served with HTTP 200, not a changed page — the fetch cannot tell                                                                                                                  | Read `body_length` and `content_type` of the `reason: "data_missing"` entry. It never has `cf_mitigated` — with that header the reason is `challenged` — so a missing header is not a missing block. Then "Ingestion starts failing (otodom)" |
| A table returns `[]` with HTTP 200                                                                            | RLS is on with no `select` policy — looks like missing data                                                                                                                                      | Add the policy. **Never** reach for the `secret` / `service_role` key                                                                                                                                                                         |
| A member reads „Konto u dostawcy modelu nie ma środków albo osiągnęło limit wydatków…”, **no banner appears** | the prepaid balance in the Claude Console is used up, or the workspace's spend limit is reached — the key is set, so `src/lib/config-status.ts` has nothing to report                            | Filter `event: "offer_audit"`, `reason: "provider_credit"`. Top up or raise the limit in the Console (a human's step); auto-reload is off on purpose. Nothing in the application is broken                                                    |
| An audit fails with `reason: "provider_auth"` on a key that was just created                                  | the key belongs to no workspace: the provider answers `400 invalid_request_error`, not 401, and the provider module reads it as a refused key                                                    | Create the key inside the workspace and set it again. Seen locally 2026-10-09                                                                                                                                                                 |
| `npm run preview` keeps failing with `provider_auth` after `.dev.vars` was fixed                              | `npm run build` copies `.dev.vars` into `dist/server/`, and the preview reads the copy                                                                                                           | Rebuild, then restart the preview. Local only — production reads Workers Secrets                                                                                                                                                              |
| `cpuTime` far above 10 ms on Free, and no `1102`                                                              | the limit tolerates a Worker that runs over it infrequently; the documentation gives no number for that tolerance                                                                                | Not a fault and not proof of headroom — see "The CPU ceiling is reached"                                                                                                                                                                      |
| Secrets appear to vanish after an auto-deploy                                                                 | they do not — secrets are per-Worker, not per-version                                                                                                                                            | Verified: they survived the first Workers Builds deploy                                                                                                                                                                                       |
| `wrangler secret put` answered „Success”, and the banner still names the key                                  | the value was empty: run as `! npx wrangler secret put …` inside a Claude Code session, the command gets no interactive input and uploads an empty string, which the application reads as no key | Seen 2026-10-27 with both Google Maps keys. Set it from a real terminal, or pipe the value in without echoing it — `printf '%s' "$VALUE" \| npx wrangler secret put NAME` — then reload `/` and check the banner                              |

## Contingencies

### Ingestion starts failing (otodom)

**Verified 2026-09-20 on both routes: otodom serves Cloudflare's egress.** The
search page returned HTTP 200 with `__NEXT_DATA__` present, no captcha and no
`cf-mitigated` header; a second probe then walked the full § 7.1 path against a live
**offer** page — `RegExp`, `JSON.parse`, and `props.pageProps.ad` with its documented
62 keys, all from Cloudflare's egress
(`@context/foundation/ingestion/otodom_fetching.md` § 9.1). Verifying the offer route
separately mattered: the preflight in § 9 uses a search URL, and that is not the route
FR-004 fetches. So the direct path is the one in use: one `fetch`, one bounded
`RegExp`, `JSON.parse`.

One observation is not permanent access. Blocking of datacenter ranges arrives
gradually, and intermittent blocking is indistinguishable from a broken parser unless
the log tells a refused fetch from a page that arrived without its data, and that
from a page whose data changed shape — exactly the failure the pre-mortem describes.
`POST /api/offers` logs each of them (`src/pages/api/offers.ts`), together with what
the answer said about itself, so read the entry before concluding anything.

Filter on `event: "offer_add"` and `stage: "fetch"`. The fetch
(`src/lib/otodom/fetch.ts`) runs its checks in the order below and the first one that
matches names the `reason`; `status` is in the entry whenever the response's headers
arrived. An entry at `error` has `outcome: "failed"`, one at `info` has
`outcome: "refused"`.

- `reason: "challenged"` (`error`) — the response carried a `cf-mitigated` header,
  whatever its status: Cloudflare answered instead of the portal. Read `cf_mitigated`
  (the header's value), `status`, `content_type` and `retry_after`. This check comes
  before the status, so a 403 or a 429 with the header is `challenged` and **not**
  `http_denied` — a query that counts blocks counts both reasons;
- `reason: "http_denied"` with a `landed_host` that is not `otodom.pl` or
  `www.otodom.pl` (`error`) — the redirects ended off otodom, on a consent or
  anti-bot page; a subdomain counts as off. Read `landed_host` and `landed_path`.
  The `status` is that other host's, whatever it is — its 404 is not a listing that
  is gone — and the member's sentence shows it from 400 up;
- `reason: "not_found"` with `status` 404 or 410 (`info`) — no such listing. Not a
  block;
- `reason: "upstream_error"` (`error`) — `status` 500 or above: the portal failing,
  not refusing;
- `reason: "http_denied"` with any other `status` outside 2xx (`error`) — the portal
  refused the fetch and sent no `cf-mitigated`. Read `status`, `retry_after` and
  `content_type`; 403 and 429 are the signatures of blocked egress;
- `reason: "not_found"` with a 2xx `status` and a `landed_path` under `/wyniki` or
  `/pl/wyniki` (`info`) — the redirects ended on the portal's results page, which
  the fetch reads as a listing the portal no longer has. Nobody has recorded where
  otodom really sends one, so `unexpected_landing` below is where a wrong guess shows;
- `reason: "unexpected_landing"` (`error`) — the redirects ended on otodom, on a page
  that is neither the offer that was asked for nor the results page. Read
  `landed_host` and `landed_path`; an entry with neither had a landing address that
  could not be read. An entry with `landed_listing` and no `landed_path` landed on
  **another offer's** page — its token differs from `listing` — and that page is
  never read or saved. The member is told the listing does not exist, so the entry is
  the only place the difference shows;
- `reason: "timeout"` or `reason: "network"` (`error`) — a call threw. `phase` says
  which one: `headers` is `fetch()` before any answer, ahead of every check above,
  and the entry has no `status`; `body` is the read of the page, at this point in the
  order, and the entry has a 2xx `status` and `content_type`. Read `error_name`,
  `error_message` and `error_cause` — an address quoted in them reads `<url>`, and
  the cause reads `name code: message` with the parts it had;
- `reason: "data_missing"` (`error`) — a 2xx page without the `__NEXT_DATA__` script:
  `marker_present` is `false`. A changed page and a block served with 200 look the
  same to the fetch, so read `body_length` and `content_type`: the two live offer
  pages measured so far were over 500,000 bytes (`otodom_fetching.md` § 9.1, § 13).
  `body_length` counts characters, which is somewhat fewer than bytes on a Polish
  page and the same order of magnitude; a body many times shorter, or a content type
  that is not HTML, points at a block;
- `reason: "shape_changed"` with `detail: "next_data_unparseable"` or
  `detail: "page_props_missing"` (`error`) — the script was there
  (`marker_present: true`) and could not be used: its JSON does not parse, or parses
  without `props.pageProps`. Read `body_length`;
- `reason: "expired"` (`info`) — the page set `shouldShowExpiredAdPage`. Not a block;
- `reason: "shape_changed"` with `detail: "ad_missing"` (`error`) — `pageProps` came
  without `ad` and without the expiry flag. Read `body_length`.

Whenever the response reported an address, the entry says where the redirects ended —
above the body read as well as below it. `landed_host` is the host. An offer page on
otodom is named by `landed_listing` alone: the `ID…` token ending its slug, to
compare with `listing`, the one the member pasted, and absent when the slug has no
token. Any other landing has `landed_path`, and no slug is ever logged: a path
segment that follows `oferta`, ends in a token or holds `oferta` inside itself reads
`<slug>`, because a slug repeats the listing's title, and `landed_listing` is the
token that segment ended in. Every entry from `phase: "body"` down came from an
offer page on otodom.

- `reason: "shape_changed"` with `stage: "map"` (`error`) — the data arrived and its
  shape has changed; `detail`, when the mapper gave one, names what it could not read.
  The entry has no field about the response.

A query written against the earlier log, looking for `shape_changed` with
`stage: "fetch"` and no `detail`, finds nothing any more: that entry is `data_missing`
now.

`challenged` rests on the header alone — the page's text is never searched — and
nobody has seen otodom send that header or a challenge page yet
(`@context/foundation/ingestion/otodom_fetching.md` § 2, § 9.1). A block by another
provider, or one Cloudflare serves without the header, arrives as `http_denied` when
it comes with 403 or 429 and as `data_missing` when it comes with 200. So one
`data_missing` proves nothing, and neither reason replaces the probe.

Re-run the probe before deciding anything — a `challenged` entry, or `data_missing`
that keeps coming back, is the signal to run it: deploy a throwaway Worker **outside
this repository** that fetches one otodom URL and returns the status code plus
whether `__NEXT_DATA__` is present, call it once, then
`npx wrangler delete --force`. It takes ten minutes and turns a guess into a fact.

If it returns 403/429 or a captcha, the fallback is already there: the extraction
service in `@context/foundation/ingestion/otodom_apify.md`, **adopted by the user on
2026-10-17** (change `otodom-apify-fallback`). It sits beside the direct fetch, not in
its place: `apify/cheerio-scraper` (actor `YrQuEkowkNCLdk4j2`) runs our fixed
`pageFunction` (`src/lib/otodom/apify-request.ts`) on the same offer page through
Apify's `RESIDENTIAL` proxy in `PL`, and hands back otodom's own `ad`, which the same
checks and the same `mapAdToOffer` read. The seller's data is dropped inside Apify by
the `pageFunction`'s whitelist, and `mapAdToOffer`'s own whitelist stays the second
line of defence.

#### The mode switch — the operational lever

The one row of `public.ingestion_settings` selects how a listing is fetched, for
adding (FR-004) and re-fetching (FR-009) alike. Only the owner changes it: Supabase
Studio → **Table Editor** → `ingestion_settings` → `mode`. Members only read it, on
`/criteria`; no member and no route can write it.

| `mode`                              | What runs                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direct_with_fallback` (seeded)     | The direct fetch with a 20 s deadline; after `challenged`, `http_denied`, `timeout`, `network` or `data_missing` (`FALLBACK_TRIGGERS` in `src/lib/otodom/index.ts`), exactly one Apify run with a 40 s deadline |
| `apify_only`                        | One Apify run, no request of our own to otodom — for while otodom blocks Cloudflare's egress outright                                                                                                           |
| `direct_only` — **the kill switch** | The direct fetch with the whole 60 s, never an Apify request — for a cost surprise, a broken `pageFunction`, or anything else Apify does wrong                                                                  |

The change takes effect on the next request; nothing is cached. Without
`APIFY_TOKEN` every mode runs as `direct_only` (`ingestion_mode_reason:
"apify_unconfigured"`), and so does a failed read of the row (`"mode_read_failed"`,
with `ingestion_mode_read` saying how it failed) — the direct fetch is free, so a
failed read never starts a paid run. `/criteria` shows the configured mode beside the
one that runs (`data-ingestion-mode`, `data-ingestion-mode-effective`), so after a
change, open it to confirm. If the migration
`supabase/migrations/20261017193318_create_ingestion_settings.sql` is not on the
hosted project yet, the read fails and ingestion runs `direct_only` — push it before
the Worker that reads it (`CLAUDE.md`, Structure).

#### Reading a fallback in the log

Filter on `event: "offer_add"` or `event: "offer_refetch"`. From `started` on, every
entry carries `ingestion_mode`, `ingestion_mode_effective`, `ingestion_mode_reason` and
`ingestion_mode_read` (a failed read adds `db_code` and `db_status` to `started`). An
outcome entry also carries `source` (`direct` or `apify`: which leg the member's
sentence came from), `fallback_reason` (the direct reason that started the Apify run),
`apify_status`, `apify_error_type` (Apify's own token, never its message),
`apify_failure` (our own token: `http`, `empty_dataset`, `malformed_item`,
`run_error`, `timeout`, `network`), `direct_duration_ms` and `apify_duration_ms`. An
Apify leg that reached otodom is read through the same reasons as the list above; one
that did not leaves the direct reason to the member, or — in `apify_only` —
`reason: "extraction_failed"`. An Apify answer that needs somebody's attention is
logged at `error` even when the member's sentence came from the direct leg
(`apifyNeedsAttention` in `src/lib/otodom/failure.ts`).

| Symptom in the entry                                           | Cause                                                                                                                      | Fix                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apify_error_type: "user-or-token-not-found"` (401)            | the token is unknown, expired or revoked                                                                                   | Re-issue the token (rotation order below)                                                                                                                                                                                                                                                                                               |
| `apify_error_type: "insufficient-permissions"` (403)           | the token lacks **Run** on actor `YrQuEkowkNCLdk4j2`, or **Actor execution** is not Full access                            | In Console → Settings → API & Integrations, edit the token: add the actor with Run, Actor execution Full access, Default run storages access on                                                                                                                                                                                         |
| `apify_error_type: "full-permission-actor-not-approved"` (403) | the account never approved cheerio-scraper, which runs user-supplied code                                                  | Approve once at <https://console.apify.com/actors/YrQuEkowkNCLdk4j2?approvePermissions=true>                                                                                                                                                                                                                                            |
| `apify_status: 402`                                            | the month's usage is spent or the account's usage limit is reached; the platform is suspended until the next cycle         | Raise the limit in Console → Billing → Limits, or wait for the cycle; set `direct_only` meanwhile if the fallback is not needed                                                                                                                                                                                                         |
| `apify_error_type: "run-failed"` (400)                         | the run ended without a dataset — not a configuration fault                                                                | Open that run in Console → **Runs**. Status **TIMED-OUT** means `timeout=30` (`APIFY_RUN_TIMEOUT_S` in `src/lib/otodom/deadlines.ts`) was too short — compare `apify_duration_ms`; a normal run takes 2–9 s. Status **FAILED** means the actor or the `pageFunction` broke — read the run's **Log** tab. A run of either kind is billed |
| `reason: "data_missing"` with `detail: "both_sources"`         | the page came without `__NEXT_DATA__` on both legs: a changed page, not a block                                            | Set `direct_only` until the parser is fixed — every further fallback pays to learn the same                                                                                                                                                                                                                                             |
| `apify_failure: "run_error"`, member reads `http_denied`       | Apify reached otodom and its crawler could not read the page (its `#error` item); a block of the residential proxy as well | Repeated: compare with a direct fetch; `#debug` is never logged, so read the run's Log tab in Console                                                                                                                                                                                                                                   |
| `apify_failure: "timeout"`                                     | no answer within the Worker's 40 s (`APIFY_CLIENT_DEADLINE_MS`)                                                            | Look for the run in Console → Runs; one longer than `timeout=` should have answered `run-failed` first                                                                                                                                                                                                                                  |

Each Apify run costs about $0.001–0.002 (`RESIDENTIAL`/`PL`, read in Console → Runs →
Usage); a failed run is billed too, and the Worker never retries one. Set a monthly
usage limit in Console → Billing → Limits.

#### Rotating the Apify token

In this order, so no request runs without a valid token: issue the new token with the
same scope (Console → Settings → API & Integrations: Limit token permissions, Run on
actor `YrQuEkowkNCLdk4j2`, Actor execution Full access, Default run storages access
on); `npx wrangler secret put APIFY_TOKEN` and paste it (a new Worker version, see
"Rollback"); update `.env` and `.dev.vars` (rebuild before `npm run preview`); then
delete the old token. The token never goes into GitHub secrets or CI.

### The CPU ceiling is reached

**Measured 2026-10-09, after S-04 deployed: this application runs over the Free plan's
10 ms on most requests, and nothing has failed.** An earlier version of this section
said the plan carried deploy zero "with room to spare"; that rested on the absence of
1102, not on a per-request reading, and the reading says otherwise. From one
`wrangler tail` session on production, every request with `outcome: "ok"`:

| Request                               | `cpuTime`     |
| ------------------------------------- | ------------- |
| `GET /`                               | 4 ms          |
| `GET /auth/signin`                    | 48 ms         |
| `POST /api/auth/signin`               | 7 ms, 25 ms   |
| `GET /dashboard`                      | 17, 33, 46 ms |
| `GET /criteria`                       | 32 ms         |
| `GET /offers/<id>`                    | 19, 21, 40 ms |
| `POST /api/offers` (FR-004 ingestion) | 19 ms         |
| `POST /api/audits` (FR-010 audit)     | 27 ms         |

The plan allows this because the limit has "built-in flexibility" for a Worker that
"infrequently runs over" it, and terminates one that hits it "consistently"
(<https://developers.cloudflare.com/workers/platform/limits/>, read 2026-10-09). The page
gives no number for either word. So the application lives on that tolerance at the
traffic of a few members, and nobody knows where it ends.

**The audit is not the expensive request.** One real audit on production
(`claude-opus-5-5`, effort `medium`, a listing of 1472 characters, the team's criteria
at revision 2): 27 ms of CPU, 8.5 s of wall time of which the provider call took 8.2 s,
5923 input and 749 output tokens, 21 stream events, one finding, none rejected or
dropped, `stop_reason: "end_turn"`. An ordinary page render costs as much or more, and
waiting on the provider is not metered — so the stream is not where the CPU goes, and a
longer listing is not expected to move the audit's number much. Not measured: where the
17–48 ms of a page render is spent, a listing much longer than 1472 characters (nobody
confirmed that one was the longest saved), and an audit with many findings.

**The user's decision, 2026-10-09: stay on Workers Free.** The trigger to revisit it is
the first `1102` a member sees, or the first request in the log with
`outcome: "exceededCpu"` — not a `cpuTime` above 10 ms, which is every day's reading.
Finding where a page render's CPU goes would be a change of its own; nothing has been
started.

The FR-004 parse itself stays cheap: a probe ran the section 7.1 path against a live
offer page on Free and `RegExp` plus `JSON.parse` completed in under a millisecond — the
page is ~558 KB of HTML, but the embedded `__NEXT_DATA__` JSON is only ~102 KB.

When the ceiling is reached, enable Workers Paid and **in the same change** add:

```jsonc
"limits": { "cpu_ms": 300000 },
```

Without it the Paid default is 30 s, not the headline 5 minutes — the pre-mortem's
exact failure: the audit dies on the longest listings, the ones that most needed
auditing, and it looks like a model-provider problem for weeks.

### The model provider key (FR-010)

`ANTHROPIC_API_KEY` is in all **six** places since 2026-10-09: the `astro.config.mjs`
schema, `.env`, `.dev.vars`, `.env.example`, Workers Secrets, and the GitHub repository
secrets, which `.github/workflows/ci.yml` hands to the `ci` job's build step only. The
factory in `src/lib/audit/provider.ts` returns `null` when it is unset and
`src/lib/config-status.ts` raises the banner, so a deploy without the key degrades the
audit instead of crashing a route. A second provider key, or a renamed one, repeats all
six.

Production runs on the same key as local development, in a Claude Console workspace:
prepaid credits, auto-reload off and a monthly spend limit (confirmed by the user in phase 4 of S-04).
Rotating it is a human's step in both places, and a `wrangler secret put` is a new
Worker version (see "Rollback").

Never call a model provider from a React island — islands ship to the browser and the
key would ship with them.

### The extraction-service token (FR-004, FR-009)

`APIFY_TOKEN` has **five** places, and CI is never one of them: the `astro.config.mjs`
schema, `.env`, `.dev.vars`, `.env.example` and Workers Secrets
(`npx wrangler secret put APIFY_TOKEN`). Astro reads an `access: "secret"` field at
runtime, so the build needs no value, and a token CI never holds is a paid run no CI
step can start; putting it into CI is the user's decision. `createApifyLeg` in
`src/lib/otodom/apify.ts` returns `null` when it is unset and `src/lib/config-status.ts`
raises the banner, so a deploy without it runs every mode as `direct_only`. The banner
says only whether the token is set, never that it works — a revoked token shows up as
`apify_error_type` in the log (see "Ingestion starts failing"). The token is scoped to
Run on one actor; rotation is described there too.

### Google Maps keys (FR-016)

Commute times take two keys, `GOOGLE_MAPS_SERVER_KEY` (Routes API, read by the Worker
only, in `src/lib/commute/google.ts`) and `GOOGLE_MAPS_BROWSER_KEY` (Maps JavaScript API,
read in `src/lib/commute/browser-key.ts` and handed to the map on the card — public by
design, protected by its restrictions). Each has **five** places and CI is never one of
them: the `astro.config.mjs` schema, `.env`, `.dev.vars`, `.env.example` and Workers
Secrets (`npx wrangler secret put GOOGLE_MAPS_SERVER_KEY`, then `…_BROWSER_KEY`). Without
the server key the commute button is disabled and the banner names it; without the browser
key the table shows without a map. The banner says only whether a key is set, never that it
works. Creating the project and the keys, their restrictions, Google's quotas (which this
account cannot lower), the budget alert and the rotation of a key are in
[`context/foundation/user-manual/set-up-google-maps.md`](./user-manual/set-up-google-maps.md);
this section does not repeat them.

Before the Worker that needs them deploys, `create_commute_points` and
`create_commute_usage` reach the hosted project with `npx supabase db push`, under the
consent rule in "What only a human does".

Every way a calculation ends is one `offer_commute` log entry, with `reason`,
`google_http_status`, `google_status`, `point_index` and `commute_mode` of the first call that
failed, and never an address, a name, a coordinate or a route line. A point saved or deleted
on `/criteria` leaves a `commute_point` entry.

| Symptom                                                                                                                                  | Cause                                                                                                                                                                   | What to do                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| The map is grey with Google's message; the browser console says `RefererNotAllowedMapError`                                              | The page's address is not in the browser key's referrer restrictions                                                                                                    | Add it (manual, step 4) and wait a few minutes                      |
| „Google odrzucił klucz aplikacji…”, log `reason: "denied"`, `google_http_status` 401/403                                                 | Routes API disabled, the server key restricted to another API, or billing inactive (the Free Trial ended without **Activate full account**)                             | Manual, steps 1–3 and **Billing**                                   |
| „Google ogranicza teraz liczbę zapytań o trasy…”, log `reason: "quota"`, 429 / `RESOURCE_EXHAUSTED`                                      | Google's own daily quota (Pacific time) — not the app's limit, which is never a 429                                                                                     | Wait for Google's day to turn; read **Metrics** in the console      |
| A point's row reads „Google odrzucił adres tego punktu — sprawdź go w kryteriach” while the other rows show                              | Google rejected that point's address in both modes; no address is checked on save                                                                                       | Correct the address on `/criteria` — street with number and city    |
| „Dzienny limit liczenia dojazdów zespołu został wyczerpany — spróbuj jutro.”, log `reason: "daily_limit"` (info)                         | The team's 300 Routes calls for the Warsaw day are spent; nothing was sent to Google                                                                                    | Wait until midnight Warsaw time, or use the owner's lever below     |
| „Nie udało się sprawdzić, czy liczenie mieści się w dziennym limicie zespołu…”, log `reason: "usage_unavailable"` (error) with `db_code` | The counter could not be read or written — a Supabase problem, not Google's: a paused project, `create_commute_usage` not pushed to the hosted project, a network fault | Check the hosted project and its migrations; nothing reached Google |

#### The owner's levers on the daily limit

The limit lives in the database, so only the owner moves it, in Supabase Studio as
`postgres`, which bypasses row-level security — no member can, through the app or the
Data API.

- **Let the team calculate again today:** **Table Editor** → `commute_usage` → the row
  whose `day` is today's Warsaw date → lower `calls` (or delete the row, which reads as 0).
  Every call spent after that still counts toward Google's monthly bill.
- **Change the limit for good:** a new migration that replaces
  `public.reserve_commute_calls` with the new literal, together with
  `COMMUTE_DAILY_CALL_LIMIT` in `src/lib/commute/failure.ts` —
  `tests/lib/commute/usage.test.ts` fails while the two differ. At 31 days a month, anything
  above about 320 calls a day can leave Google's free allowance of 10 000 Routes requests.

## What only a human does

An agent may run `astro build`, `wrangler deploy`, `wrangler versions upload`,
`wrangler tail` and `wrangler rollback` unattended. It may apply migrations to the
hosted project with `npx supabase db push`, but only with the user's consent, asked
each time after showing the `--dry-run` list (`CLAUDE.md`, Structure).

A human does, by hand: creating accounts and API tokens, `wrangler login`, `supabase login` and `supabase link`,
setting or rotating any production secret, deleting the Worker, changing the billing plan, dashboard configuration, and
invoking `/git-ship` or `/git-land`.

## Team accounts

Registration is closed (FR-001); every account is created by a human in the hosted
project's dashboard. None of this is an agent's job (see "What only a human does").

- **Close registration.** Authentication → Sign In / Providers → turn off **Allow new
  users to sign up**. Leave the **Email** provider enabled — disabling it also disables
  password sign-in for existing accounts. Confirm with the `disable_signup` check in
  "Verifying a deploy".
- **Create an account.** Authentication → Users → Add user → Create new user, with
  **Auto Confirm User** ticked. Hand the password to the member directly.
- **Reissue a password.** There is no password reset in the product (FR-001). In the SQL
  Editor:

  ```sql
  update auth.users
  set encrypted_password = crypt('<new password>', gen_salt('bf')), updated_at = now()
  where email = '<address>';
  ```

  Step-by-step version for the administrator (in Polish):
  [`context/foundation/user-manual/change-user-password.md`](./user-manual/change-user-password.md).

- **Remove a stray account** someone registered before sign-up was closed:
  Authentication → Users → the account → Delete user.

Hosted accounts never go into `supabase/seed.sql`: the repository is public, and the
seed is for local fixtures only.

## Two databases, never one

| Where                                                   | Which Supabase                   |
| ------------------------------------------------------- | -------------------------------- |
| `.env`, `.dev.vars` — `npm run dev`, `preview`, `smoke` | **local** (`npx supabase start`) |
| CI `smoke` job                                          | its own local container          |
| Workers Secrets                                         | **hosted**                       |

Local development uses the local database. `npm run smoke` signs in with an account
from `supabase/seed.sql` and attempts a sign-up, so it needs the local database: only
there does that account exist, and only there is the sign-up attempt harmless.
Migration work runs through `supabase db reset`, which wipes whatever it points at.

**`supabase db reset --linked` wipes the hosted database and runs `supabase/seed.sql`
against it.** Seeds are not inherently local. Migrations reach the hosted project
with `supabase db push`, which does not run seeds.
