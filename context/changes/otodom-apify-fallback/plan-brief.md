# Apify ingestion fallback with a switchable mode — Plan Brief

> Full plan: `context/changes/otodom-apify-fallback/plan.md`
> Research: `context/changes/otodom-apify-fallback/research.md` (superseded by `spike-apify.md` where they disagree)

## What & Why

When otodom.pl refuses the Worker's direct request, a member's add (FR-004) or re-fetch (FR-009) falls back to one Apify run. The run uses `apify/cheerio-scraper` with our own fixed `pageFunction` through a residential PL proxy, and it returns otodom's own `ad`, so every existing guardrail applies unchanged. The owner switches the mode in Supabase Studio: fallback, Apify only, or direct only as the cost kill switch. The user took the fallback off Parked on 2026-10-17.

## Starting Point

Ingestion is direct only: `ingestOffer` runs a 45 s fetch, then `mapAdToOffer`. CLAUDE.md still says a fallback would replace the scraper rather than sit beside it. A paid spike showed that `trev0n/otodom-scraper` cannot feed the FR-005 gate and saves expired offers. It also showed that cheerio-scraper with our `pageFunction` returns a JSON-identical `ad`.

## Desired End State

- **`direct_with_fallback`** (seeded): direct fetch for 20 s. On `challenged`, `http_denied`, `timeout`, `network` or `data_missing`, one Apify run with a 40 s deadline (`timeout=30`). A success looks the same to the member whichever path produced it.
- **No token, `direct_only`, or a failed mode read:** direct only, with the whole 60 s budget and never an Apify request.
- **Logs:** each ingest entry records which mode was configured and which ran, which path produced the outcome, why the fallback ran, Apify's status and error type, and each path's duration.
- **`/criteria`:** shows both the configured and the effective mode, read-only.

## Key Decisions Made

| Decision         | Choice                                                                                                                                      | Why (1 sentence)                                                                                     | Source |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| Actor            | `apify/cheerio-scraper` + our fixed `pageFunction`, `RESIDENTIAL`/`PL`                                                                      | Same `ad`, so no second mapper and the FR-005 gate holds; datacenter got 403.                        | Spike  |
| Modes            | `direct_with_fallback` (seeded), `apify_only`, `direct_only` in an owner-only singleton                                                     | Without a token it is already direct-only, so the order of the deploy steps doesn't matter.          | Plan   |
| No token         | Every mode runs as `direct_only`; banner entry; log says configured vs effective                                                            | Zero-config rule.                                                                                    | Plan   |
| Failed mode read | Degrade to `direct_only`, log `ingestion_mode_read`, never refuse                                                                           | Direct is free and is today's behaviour; the audit's "refuse" precedent does not apply.              | Plan   |
| Triggers         | `challenged`, `http_denied`, `timeout`, `network`, `data_missing`; never `shape_changed`, `not_found`, `expired`, `upstream_error`          | A 200-served block reads as `data_missing`. Both paths missing the data is logged as `both_sources`. | Plan   |
| Deadlines        | 20 s direct only before a possible fallback, otherwise 60 s; Apify 40 s with `timeout=30`; member text names no seconds                     | Never less tolerant than today's 45 s.                                                               | Plan   |
| Run params       | `maxTotalChargeUsd=0.05`, `memory=1024`, `maxRequestRetries=1`, one run per action, no Worker retry                                         | One in-run retry on a fresh proxy IP; 25× cost margin.                                               | Plan   |
| UI               | Read-only section on `/criteria` with `data-ingestion-settings-state`, `-mode`, `-mode-effective`; no visual gate                           | Members see why a fetch took 10 s; the card is read-only text.                                       | Plan   |
| Logs             | `source`, `fallback_reason`, `apify_status`, `apify_error_type`, `ingestion_mode*`, per-path durations, plus plan-derived `apify_failure`   | One entry explains every path; Apify's own words are never logged.                                   | Plan   |
| Token            | Five places, never CI or GitHub secrets                                                                                                     | Secret is read at runtime; CI can never start a paid run.                                            | Plan   |
| Member's message | The path that reached otodom speaks; otherwise the direct reason; only `apify_only` adds one neutral sentence (`extraction_failed`)         | The member reads about the listing, never about vendor or config.                                    | Plan   |
| Live calls       | Phase 3 only, via `scripts/apify-verify.mjs`: 15 per target (raised once to 25), otodom paced at 30 s, stop on first block, `live-calls.md` | The user's 2026-10-17 authorisation, scoped to this change.                                          | User   |

## Scope

**In scope:**

- the migration;
- the mode reader and the function that decides which mode runs;
- the classifier split;
- the Apify request module and the Apify leg;
- the import guard;
- the fixtures;
- the live verification script;
- orchestration in `ingestOffer` and both routes;
- the new reason;
- the log fields;
- the route tests per mode;
- the `/criteria` section;
- smoke steps;
- CLAUDE.md, the reviewer's prompt, the PRD, the roadmap, the runbook, the ingestion docs and the README.

**Out of scope:**

- `trev0n/otodom-scraper` and a second mapper;
- an admin form;
- async runs and webhooks;
- run ids;
- retries of paid calls;
- an HTML parser in the Worker;
- `APIFY_TOKEN` in CI;
- cost or source shown in the UI;
- screenshots.

## Architecture / Approach

The routes perform every free refusal first, then read `ingestion_settings` and call `resolveIngestionMode(settings, isApifyAvailable())`. Next they call `createApifyLeg()`, which returns null without a token, and then `ingestOffer(url, {mode, apify})`.

`ingestOffer` runs the direct path or the Apify path according to the effective mode and the deadlines. Both paths go through the shared `classifyAnswer`/`classifyPayload` split out of `fetch.ts`, then through the unchanged `mapAdToOffer`. `chooseOutcome` picks the reason the member reads.

The request, with the fixed `pageFunction`, lives in `apify-request.ts`, which Node can load: its only value import is the import-free `deadlines.ts`, through an explicit `.ts` specifier. Both the Worker and the live verification script use it.

## Phases at a Glance

| Phase                                  | What it delivers                                                                                                                                                                  | Key risk                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The mode table and its read         | Migration, `loadIngestionSettings`, `resolveIngestionMode`, smoke RLS steps                                                                                                       | A write policy slipping in; Studio edits must keep working                                                                                                      |
| 2. The Apify leg, offline              | Token zero-config, `deadlines.ts`, classifier split, `apify-request.ts`, `createApifyLeg`, fixture, import guard                                                                  | The direct path's behaviour drifting; existing tests must pass unmodified                                                                                       |
| 3. Live verification within the budget | `scripts/apify-verify.mjs`, one Automated row per `--case`, `--check-log`, `--check-expected`, `live-calls.md`, `live-verification.md` (~1 otodom, ~6 Apify, incl. `run-timeout`) | A gate re-run must never pay twice (`ALREADY_RECORDED` exits 0); a stale listing or an otodom block moves that case to Manual; any other mismatch stops the run |
| 4. The fallback in both routes         | Deadlines, triggers, `chooseOutcome`, `extraction_failed`, log fields, route tests per mode                                                                                       | Test stubs and the request guard must plan the new reads and requests                                                                                           |
| 5. The mode on `/criteria`             | Read-only section, `/dev/criteria` states, render test, smoke marker                                                                                                              | Showing a mode the app did not read                                                                                                                             |
| 6. Rules and documents                 | CLAUDE.md, reviewer prompt, PRD, roadmap, runbook, docs; Manual: evals, `db push`, secret, deploy, one real run                                                                   | Prompt change needs the user's paid eval run                                                                                                                    |

**Prerequisites:**

- **P1–P3** (account, scoped token with Run on `YrQuEkowkNCLdk4j2`, full-permission approval): done by the user on 2026-10-17.
- **P6/P7** (token and three verification addresses in `.env`, token in `.dev.vars`): done by the user on 2026-10-17, so Phase 3 makes its own calls in the unattended run.
- **P4** (monthly limit) and **P8** (`wrangler secret put`): before production.

**Estimated effort:** about 3–4 unattended sessions across 6 phases, plus the user's Manual rows.

## Open Risks & Assumptions

- `cf-mitigated` cannot be seen through the proxy, so `challenged` never comes from the Apify path. A block served through Apify shows up as `#error` (`http_denied`) or a non-2xx status.
- The `#error` item is read as a block (`http_denied`). An error inside the crawler that is not a block would be mislabelled. The log's `apify_failure:"run_error"` keeps it distinguishable.
- A run that times out _after_ otodom answered (rare: a normal run takes 2–9 s) is covered by fixtures only; Phase 3's `run-timeout` case verifies only a run that times out before it reaches otodom.
- `apify_failure` is a log field the plan derived to name Apify-side failures without overloading `detail`. The user can veto it during review.
- `apify/cheerio-scraper` is maintained by Apify itself, so abandonment is less likely than with trev0n; the `pageFunction` still depends on otodom's `__NEXT_DATA__`, exactly as the direct path does.

## Success Criteria (Summary)

- A blocked direct fetch still saves the offer through one Apify run, identical to a direct save. Notes, fingerprint and lost-facts behave as before.
- With no token or `direct_only`, nothing reaches Apify, and members can still add offers as they do today.
- Every live call made during the change sits within the budget in `live-calls.md`. The final real run is the user's own.
