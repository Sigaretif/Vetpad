# Live verification — conclusions (Phase 3)

Run 2026-10-17 through `scripts/apify-verify.mjs`. The calls themselves are in `live-calls.md` (otodom 1/15, Apify 6/15, every otodom-reaching request ≥ 30 s apart, no block). Listings are named by their ID token only.

## invalid-token — PASS

A junk token on `ID4DzV5` was refused with 401 `user-or-token-not-found` before any run started. `readApifyAnswer` reads it as `apifyFailure: "http"`. This proves the token travels only in the Bearer header and that a bad token is a fetch failure, not data.

## sale — PASS

The direct `ad` of `ID4DzV5` (62 keys, `owner`/`contactDetails`/`agency` among them) and the Apify `ad` of the same listing (14 keys) are JSON-equal on every whitelisted key the direct `ad` holds. The Apify `ad` has no key outside `APIFY_AD_KEYS`/`APIFY_LOCATION_KEYS`/`APIFY_TARGET_KEYS`. The two `OfferInsert`s from `mapAdToOffer` are deep-equal. This proves that the committed `pageFunction` drops the seller's data inside Apify and that the Worker maps an Apify result exactly like a direct one. The item had `pagePropsExpired: null` and `requestedUrl` equal to the address sent.

## rental — PASS

`ID4DzRm` (a flat for rent) was fetched through Apify and refused by the FR-005 gate as `not_for_sale`.

## expired — PASS

`ID4AkRi` answered 410 through Apify, landed on the same listing token and was classified `not_found`.

## redirect — PASS

The sale address with an altered slug and the same ID token (`normalizeOfferUrl` keeps the slug, so the altered slug was really sent) landed on the same listing token and was accepted.

## run-timeout — MISMATCH (run stopped here)

With the committed request and only `timeout=1` overridden, `run-sync-get-dataset-items` answered **HTTP 400 with `error.type` `run-failed`**. It did not answer 408, and it did not answer 201 with an empty dataset, which are the two shapes the plan and the Phase 2 fixtures assume. `readApifyAnswer` reads it as `apifyFailure: "http"` with `apifyStatus: 400`, an Apify failure that did not reach otodom, so a member would read the direct leg's reason. That behaviour is safe, but it is not the expected result. Per the plan, the unattended run stopped instead of changing the expectations or the classifier to fit.

What remains unknown and is the user's to decide:

- Whether the 1 s run started on Apify's side, and so whether it was billed and whether it reached otodom. The script recorded `billed: no` (a 400 answer) and `reached_otodom: yes` (conservative, for pacing). Console → Runs → Usage settles this (P5).
- Whether 400 `run-failed` is what Apify returns for every run that exceeds its `timeout`, or only for one this short, and so whether the fixture `apifyError(408, …)` in `tests/fixtures/apify.ts` should become (or be joined by) a 400 `run-failed` case, and whether `run-failed` belongs among the configuration-fault types logged at `error` in Phase 4.

## Residual risk

A run that times out _after_ otodom answered (rare: a normal run here took 2–9 s) is covered by fixtures only. `run-timeout` checks only a run that times out before it reaches otodom, and even that case has not yet matched its expected shape.

## run-timeout — user's decision (2026-10-17)

The observed 400 `run-failed` is accepted as the expected shape of a run that exceeds its `timeout=`;
the plan's `run-timeout` row was amended accordingly. Classification stays as the code already does
it: `apifyFailure: "http"`, `apifyStatus: 400`, `apifyErrorType: "run-failed"`, not reached otodom, so
the member reads the direct leg's reason (`extraction_failed` in `apify_only`). `run-failed` is logged
at `error` but is not a configuration fault. On resume, Phase 3 pins the shape as `apifyRunTimeout()`
in `tests/fixtures/apify.ts` with one test in `tests/lib/otodom/apify.test.ts`, and `--check-expected`
accepts it; no live call is repeated. Billing and whether the run reached otodom: see the cost column
once the user has read Console → Runs (P5); the row keeps `reached_otodom: yes` for pacing.

Console → Runs, read by the user on 2026-10-17: that run's status is **TIMED-OUT** ("This Actor
timed out"), 0 results, duration 1 s, usage **$0.000**. So 400 `run-failed` is what run-sync answers
for a run that exceeded its `timeout=`; the run was effectively unbilled and produced no dataset —
consistent with it not reaching otodom (the `reached_otodom: yes` in `live-calls.md` stays as the
conservative pacing value).

On resume (2026-10-17) the shape was pinned as `apifyRunTimeout()` in `tests/fixtures/apify.ts`, with one test in `tests/lib/otodom/apify.test.ts`. `--check-expected` now expects `http` 400 `run-failed` for `run-timeout`, which therefore reads PASS. No live case was repeated. The cost column of that row in `live-calls.md` holds `$0.000`, taken from Console.
