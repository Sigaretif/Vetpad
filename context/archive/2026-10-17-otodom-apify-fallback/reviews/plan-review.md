<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Apify ingestion fallback with a switchable mode

- **Plan**: context/changes/otodom-apify-fallback/plan.md
- **Mode**: Deep (claims verified directly against the code; no live calls)
- **Date**: 2026-10-17
- **Verdict**: REVISE → SOUND after triage (all 9 findings fixed, 2026-10-17)
- **Findings**: 3 critical, 4 warnings, 2 observations

Judged above all on whether `/10x-goal-implement` can run every phase to green with nobody to ask. The approach is sound; three narrow contract defects would stop or silently hollow out the unattended run.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | FAIL    |

## Grounding

11/11 paths ✓ (index.ts, fetch.ts, failure.ts, log.ts, config-status.ts, CriteriaView.astro, _criteria-fixtures.ts, create_audit_settings.sql, tests/fixtures/anthropic.ts, tests/eslint.config.test.ts, code-reviewer system.ts); symbols ✓ (`loadAuditSettings` settings.ts:115, `auditNoNotesConfig` eslint.config.js:121, `REQUEST_HEADERS` fetch.ts:4 — exists but is not exported); line refs ✓ (offers.ts:73-91, offer-refetch.ts:136-148, offer-refetch.test.ts:1020-1032, every "45" location listed at plan:105-115 matches the grep exactly); Progress↔Phase ✓ (6/6 phases, every criterion has a row, no checkboxes in phase blocks); brief↔plan ✓.

## The six suspicions

| #   | Suspicion                          | Result                                                                                                                                                                                                                                                                                          | Finding |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Import constraint vs phase order   | **Confirmed**, and worse: the gate meant to catch it cannot                                                                                                                                                                                                                                     | F2      |
| 2   | No-repeat rule vs `redirect` case  | **Confirmed**, plus a second collision with `invalid-token`                                                                                                                                                                                                                                     | F3      |
| 3   | Phase 3 SKIPPED path               | **Confirmed** that every Automated row passes on SKIPPED; the dependency is weaker than stated — but the bigger defect is that no row ever runs the cases                                                                                                                                       | F1, F7  |
| 4   | Phase 2/3 forcing route-test edits | **Refuted** for Phase 2/3; Phase 4 has an unplanned edit that will throw                                                                                                                                                                                                                        | F4      |
| 5   | Grep false positives               | Phase 3 grep passes today (exit 1, verified); Phase 4 grep matches exactly the listed sites, with one realistic trap                                                                                                                                                                            | F8      |
| 6   | CLAUDE.md hard rules               | Zero-config four places ✓, no module-scope state ✓, logEvent whitelist ✓, smoke never reaches Apify/otodom ✓, `supabase migration new` ✓ (supabase is a devDep, package.json:64), secrets/evals/db push/deploy are Manual ✓. **One gap**: the RLS exception and the reviewer's automatic-fail 2 | F6      |

## Findings

### F1 — No row runs the live cases; the unattended executor will never make them

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Success Criteria / Progress 3.1–3.5
- **Detail**: `/10x-goal-implement` gives the phase to a subagent whose hard boundary is "implement code changes ONLY" (`.claude/skills/10x-goal-implement/SKILL.md:110`), and main runs only the phase's `#### Automated` commands (`SKILL.md:131`). Phase 3's Automated rows are `node --check`, `--check-log`, a grep and `npm test` (plan:469-472) — none runs `--case`. So even with P6/P7 done, no call is made, or one is made inside the subagent, off the transcript the goal evaluator reads (`SKILL.md:99`). Follow-ons: `live-calls.md` is "written by the script" (plan:454) but nothing invokes the script with `--case`, so `--check-log` meets a missing file whose behaviour is undefined; `live-verification.md` has no named author; files a script writes are not in the subagent's `TOUCHED` list, so they surface as `DIRTY (not staged)` and miss the phase commit (`SKILL.md:183`). Also, if a `--case` were an ordinary gate, a failing gate gets two self-fix re-runs (`SKILL.md:150`) — i.e. repeat paid calls.
- **Fix A ⭐ Recommended**: Add one Automated row per case (`node --env-file-if-exists=.env scripts/apify-verify.mjs --case invalid-token`, … `sale`, `rental`, `expired`, `redirect`), then `--check-log`, then an offline `--check-expected` that compares the recorded results with the case table.
  - Strength: The calls happen in main, narrated, in a fixed order; the existing gate machinery records them.
  - Tradeoff: The script's exit codes must be specified: `--case` exits 0 once a result is recorded (match or not) and exits 0 printing `SKIPPED` (writing a SKIPPED row) when prerequisites are missing; it exits non-zero only when it refuses (budget, BLOCKED, repeat) — so a self-fix re-run is refused by the script, not paid twice. `--check-expected` is the gate that turns a mismatch red → STOP; `--check-log` fails on a missing file. Name main as the author of `live-verification.md` from the script's printed conclusions, and list both files as Phase 3 touched files.
  - Confidence: HIGH — follows directly from the skill's text.
  - Blind spot: Whether the goal session's sandbox has network access to api.apify.com and otodom.pl.
- **Fix B**: Make the five cases Manual rows only; the agent writes the script and a SKIPPED log, the user runs the cases.
  - Strength: No paid or third-party call can happen unattended; matches the likely reality (P6/P7 are "Not done", plan:29-30).
  - Tradeoff: Drops the user's authorisation for the agent to verify live; the pageFunction first runs live only when the user acts.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A, refined by the user's triage answer (repeat → `ALREADY_RECORDED`, exit 0; `BLOCKED`/`SKIPPED` exit 0; `STALE` in `--check-expected`; ≠0 only for budget exhausted or a malformed log)

### F2 — `apify-request.ts` needs `deadlines.ts` two phases before it exists, and the gate cannot see it

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3 (plan:337, :346), Phase 4 §1 (plan:490, :505), criterion 2.5
- **Detail**: Phase 2 says `apify-request.ts` has "no value imports" (plan:337) yet takes `timeout=` "from the deadlines module" (plan:346), which Phase 4 creates (plan:490) and states as a value import (plan:505). The existing modules get away with "`import type` only" because the import is erased (`fetch.ts:1`, `map.ts:1`, `url.ts:1`); a _value_ import with the repo's extensionless style (`./deadlines`, as `index.ts:1-4`) does not resolve under Node ESM, so `scripts/apify-verify.mjs` and `scripts/otodom-inspect.mjs` (which loads via type stripping, `otodom-inspect.mjs:4-5,11-13`) would crash at load. An explicit `.ts` specifier works everywhere: Astro's tsconfig sets `allowImportingTsExtensions: true`, `noEmit: true`, `moduleResolution: "Bundler"` (`node_modules/astro/tsconfigs/base.json:8,10,19`), Vite/Vitest resolve it, Node 22.23 strips it; no ESLint import-extension rule exists. Criterion 2.5 `node --check scripts/otodom-inspect.mjs` only parses syntax and never resolves imports, so it passes on exactly the breakage it claims to guard.
- **Fix**: Move Phase 4 §1 (deadlines.ts and its test) into Phase 2; state that `apify-request.ts` and `otodom-inspect.mjs` import it as `./deadlines.ts` / `../src/lib/otodom/deadlines.ts`, and reword "no value imports" to "no value imports except zero-import sibling modules, by `.ts` specifier". Replace 2.5 with `node scripts/otodom-inspect.mjs --help` (loads every import, prints usage, exits 0 offline — `otodom-inspect.mjs:34-37`) plus `node -e "await import('./src/lib/otodom/apify-request.ts')"`; Phase 4 keeps the `--help` check after the inspect script's `45_000` swap.
- **Decision**: FIXED as offered, refined by the user's triage answer (`deadlines.ts` stays import-free; gate uses `node --input-type=module -e`; a lint rejection of the `.ts` specifier is a STOP)

### F3 — The no-repeat rule refuses the `redirect` case (and possibly `sale`)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Live-call budget (plan:60), Phase 3 case table (plan:446-450)
- **Detail**: The script "refuses a (target, listing ID) pair already recorded with a result" (plan:60). `sale` records (apify, ID-X); `redirect` is Apify "on the sale URL with an altered slug and the same ID" (plan:450) — the same pair, so the script must refuse its own case, and the budget table counts it (plan:45: 5 Apify calls). Second collision: `invalid-token` runs first and the plan never says which URL it sends; if it is the sale URL, its recorded 401 makes (apify, ID-X) taken and `sale`'s Apify leg is refused too. The row stores only the ID token (plan:67), so keying on the URL is not available.
- **Fix**: Key the rule on (target, case, listing ID): a case is never repeated, different cases may share a listing. State that `invalid-token` sends the sale URL and, being refused before start, does not count as a result for the rule or for pacing (consistent with plan:57).
- **Decision**: FIXED as offered, refined by the user's triage answer (`invalid-token` counts toward the Apify budget; rows carry `billed` and `reached_otodom`; pacing checked only between `reached_otodom: yes` rows)

### F4 — Phase 4 route tests will throw on the `astro:env/server` mock

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §6 (plan:576-605)
- **Detail**: Suspicion 4 is refuted for Phases 2–3: no route changes there, and `tests/setup.ts:7-12` gains `APIFY_TOKEN` in Phase 2, so the "unmodified" claim (plan:332) holds. Phase 4 is the trap: both routes start importing `isApifyAvailable` from `config-status.ts`, which reads `ANTHROPIC_API_KEY` and `APIFY_TOKEN` at module load (`config-status.ts:1,22`), and `apify.ts`. `tests/pages/api/offers.test.ts:36-39` (and `offer-refetch.test.ts` the same way) mock the module with only `SUPABASE_URL`, `SUPABASE_KEY`, `getSecret`; Vitest 5.0.3 throws `No "APIFY_TOKEN" export is defined on the mock` for any missing export. The scenarios also need the token on in some cases and off in others, which needs the getter used in `tests/pages/api/audits.test.ts:55-62`. The plan's §6 "Stubs" bullet covers only the `ingestion_settings` read.
- **Fix**: Add to Phase 4 §6: both route tests' `vi.mock("astro:env/server")` gain `ANTHROPIC_API_KEY: undefined` and an `APIFY_TOKEN` getter switched per scenario (pattern: `audits.test.ts:55-62`, value `APIFY_TEST_TOKEN`).
- **Decision**: FIXED as offered, refined by the user's triage answer (toggle off by default, reset in `beforeEach`; `*.unconfigured.test.ts` cover the no-token module; other importers get the same entries)

### F5 — The deadline mechanism is unspecified and `AbortSignal.timeout` defeats the fake-timer test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 §2 (plan:516), §6 Deadlines (plan:603)
- **Detail**: `ingestOffer` "creates its own signals from the deadlines"; the test asserts the deadline "using fake timers on a silent stub". The routes' current idiom is `AbortSignal.timeout(45_000)` (`offers.ts:91`, `offer-refetch.ts:148`), whose internal timer the fake-timer set used in this repo does not drive (`audits.test.ts:87` fakes `setTimeout/clearTimeout/setInterval/clearInterval/Date` only). The repo already solved this: `audits.ts:260-275` builds its deadline from `AbortController` + `setTimeout`, cleared when the call ends. With two legs in sequence, an uncleared first timer is also a leak. The abort reason must stay a `DOMException` named `TimeoutError`, or `isAbort`/the classifier (`fetch.ts:39-44`) stops reading it as `timeout` — which is itself a fallback trigger.
- **Fix**: Specify `audits.ts:260-275` as the pattern: one `AbortController` + `setTimeout` per leg, aborted with `new DOMException(…, "TimeoutError")`, cleared in `finally`; the test advances fake time to 19 999 / 20 000 ms (and 59 999 / 60 000) and asserts the outcome.
  - Strength: Reuses an existing, tested idiom; makes the deadline test deterministic.
  - Tradeoff: Slightly more code than `AbortSignal.timeout`.
  - Confidence: MED — whether this Vitest's fake timers drive `AbortSignal.timeout` was not run here; the existing code chose the controller pattern for exactly this reason (comment at `audits.ts:260`).
  - Blind spot: Behaviour of the composed signals under workerd is not exercised by tests.
- **Decision**: FIXED as offered, refined by the user's triage answer (one `legDeadline` helper in `index.ts`; direct timer cleared before Apify starts, fresh 40 s controller; boundary tests on all three legs plus `vi.getTimerCount() === 0`)

### F6 — The owner-only singleton breaks the RLS hard rule and the reviewer's automatic-fail 2

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 (plan:229-233), Phase 6 §1–§2
- **Detail**: CLAUDE.md:20 requires one policy per operation and allows a select-only table only when "written only by a `security definer` trigger". `ingestion_settings` has no trigger and no write path at all (written by `postgres` in Studio). `packages/code-reviewer/src/prompts/system.ts:30` makes "a new table without one policy per operation" an automatic fail, so the paid PR review will fail the migration, and a future agent reading CLAUDE.md:20 may "fix" it with policies. Phase 6 adds a Structure reference bullet (plan:711) but amends neither CLAUDE.md:20 nor system.ts:30. (Everything else in suspicion 6 checks out — see the table above.)
- **Fix**: Phase 6 §1 extends the exception at CLAUDE.md:20 to "a table changed only by the owner in Studio (`postgres`, `bypassrls`)", citing the new migration; Phase 6 §2 amends automatic-fail 2 at system.ts:30 the same way. Both are covered by the paid evals already in 6.5.
- **Decision**: FIXED as offered, refined by the user's triage answer (CLAUDE.md edit moved to Phase 1 with the migration, narrow exception with its reason; `system.ts` stays in Phase 6; migration comment carries the reason)

### F7 — On SKIPPED the run continues on evidence never gathered, and Manual 3.5 is not ordered before the deploy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 (plan:456, :463, :476), Phase 6 Manual 6.8
- **Detail**: Every Automated row of Phase 3 is satisfiable on SKIPPED (3.2 explicitly, plan:470), and the run moves on — which is fine, because the dependency is weaker than "the evidence the rest of the plan relies on" (plan:456): Phases 4–6 are built on synthetic fixtures derived from the spike, not on Phase 3 output. What actually goes unverified is narrower and real: the _modified_ pageFunction (`response.status`, `pagePropsPresent`) and `timeout=30` — the spike ran with `timeout=120` (`spike-apify.md:125`) and lists run-sync timeout behaviour as unverified (`spike-apify.md:88-89`); Phase 3's cases do not probe it either. With P6/P7 "Not done" (plan:29-30) SKIPPED is the likely outcome, and nothing orders 3.5 before 6.8, so the code could deploy with the pageFunction never run.
- **Fix**: Reword plan:456 to "evidence that the committed request module behaves as the fixtures assume"; add to 3.5 and 6.8 that 3.5 is done (cases run, no mismatch) before the change ships; note in "Open Risks" that the `timeout=30` path is covered only by fixtures (408 / empty dataset → no reach).
- **Decision**: FIXED as offered, refined by the user's triage answer (new live case `run-timeout` with `timeout=1` overridden in the script only; observed shape pinned as a fixture; 6.8 names 3.12 as its precondition; residual risk noted)

### F8 — Grep gates: one realistic false positive and two loose ends

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Criteria 4.5 and 3.3
- **Detail**: Run on today's tree, the 4.5 pattern hits exactly the sites at plan:105-115 (verified); CLAUDE.md and docs are outside its paths. Traps: (a) a test proving the number was removed with `not.toContain("45 sekund")` — the natural assertion — matches the pattern and fails the gate; (b) the route comments "may take 45 s" (`offers.ts:89`, `offer-refetch.ts:146`) are caught by the grep but not named in Phase 4 §5; (c) `45 s` at end of line escapes ` s[^a-z]`. The 3.3 grep exits 1 on today's folder (verified); plan.md:434 has `otodom.pl/` without the path, so it does not match; `live-verification.md` and this review must keep the address shape out.
- **Fix**: In Phase 4 §3/§6 say the timeout tests assert the new sentence exactly (no negative `45` assertion), and list the two route comments among the edits.
- **Decision**: FIXED as offered, refined by the user's triage answer — with one deviation: the answer's pattern `(^|[^0-9])45( sekund|_000| s([^a-z]|$))` gives 14 hits under GNU grep but 0 under the ugrep wrapper that `grep` is in the agent's shell (the gate would pass vacuously); `\b45( sekund|_000| s([^a-z]|$))` gives 14/14 in both and catches end-of-line "45 s", so the plan uses it

### F9 — The `sale` comparison needs the whitelist the script cannot reach

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 case `sale` (plan:447), pacing (plan:58)
- **Detail**: `fetchOfferAd` returns the full `ad` (`types.ts:47`), while Apify returns it narrowed by the `KEEP` list that lives only inside the `APIFY_PAGE_FUNCTION` string; "whitelisted `ad` JSON-equal" leaves the script to re-derive that list. Plan:58 says the direct leg uses `REQUEST_HEADERS` from `fetch.ts`, which is not exported (`fetch.ts:4`) — calling `fetchOfferAd` already uses it.
- **Fix**: State that the script calls `fetchOfferAd` for the direct leg and compares on the Apify item's own key set (top-level keys, plus `location.{coordinates,reverseGeocoding,address}` and `target.{OfferType,ProperType}`), and that the mapped `OfferInsert` deep-equality is the decisive check.
- **Decision**: FIXED with one change, per the user's triage answer (the comparison set comes from whitelist constants exported by `apify-request.ts`, from which `APIFY_PAGE_FUNCTION` is assembled; plus a no-extra-key leak check; `OfferInsert` deep equality decides)
