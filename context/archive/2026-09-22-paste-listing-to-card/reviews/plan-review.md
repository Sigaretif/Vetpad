<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Wklejony URL otodom.pl staje się zapisaną kartą oferty

- **Plan**: context/changes/paste-listing-to-card/plan.md
- **Mode**: Deep
- **Date**: 2026-09-22
- **Verdict**: REVISE → SOUND (after triage: 8/8 fixed)
- **Findings**: 2 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, 6/6 symbols ✓ (PROTECTED_ROUTES, useFormStatus, Banner variant, steps[], locationPrefix, FR-005), brief↔plan ✓, Progress↔Phase ✓ (47/47 criteria matched; 48/48 after triage)

## Findings

### F1 — Button never shows "Pobieram ogłoszenie…"

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 3 §2 — AddOfferForm; criterion 3.10
- **Detail**: SubmitButton reads `pending` from React 19 `useFormStatus()` (`src/components/auth/SubmitButton.tsx:12`), which only reports pending for forms whose `action` is a function. The plan mandates a plain `<form method="POST" action="/api/offers">` (string action), so `pending` stays false for the whole request. Criterion 3.10 cannot pass, and during a fetch of up to 45 s nothing shows work in progress, which breaks the PRD NFR "continuously visible as in progress". SignInForm has the same hidden bug, masked by millisecond sign-ins.
- **Fix**: AddOfferForm keeps its own `submitting` state set in `onSubmit` after validation passes; SubmitButton gains an optional `pending` prop that overrides `useFormStatus`. Native POST retained, no `fetch()`.
  - Strength: Keeps the redirect-with-`?error` pattern and criterion 3.4.
  - Tradeoff: Changes a shared component's props; SignInForm can adopt it later.
  - Confidence: HIGH — the browser keeps the page painted until the response arrives, so the re-render shows.
  - Blind spot: bfcache "back" restores `submitting=true`; a `pageshow` reset may be needed.
- **Decision**: FIXED (Fix in plan)

### F2 — "Bez sesji" smoke steps placed inside the signed-in window

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 3 §4 — smoke steps
- **Detail**: The plan inserts all new steps after sign-in and before sign-out. The shared cookie jar (`scripts/smoke.mjs:10`, `:30`) means "POST /api/offers bez sesji → /auth/signin" and "GET /offers/<uuid> bez sesji → /auth/signin" would run with a session. They would get `/dashboard?error=` and a 404 respectively, and smoke goes red.
- **Fix**: Place the two anonymous steps before "signin accepts correct password" (or after "signout clears session"); keep only the empty/foreign/not-an-offer steps inside the session window.
- **Decision**: FIXED (Fix in plan)

### F3 — Duplicate identity keyed on a URL otodom itself varies

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Faza 1 §1 (unique index), Faza 2 §1, Faza 3 §1
- **Detail**: The unique index is on `source_url`. `normalizeOfferUrl` accepts paths with or without `/pl` but never canonicalises to one form, so `otodom.pl/oferta/x-ID4AB` and `otodom.pl/pl/oferta/x-ID4AB` become two rows. `otodom_fetching.md:311-312` notes otodom redirects when a slug changes: the same `ID<code>` under a new slug is a new `source_url`. Also, the duplicate check happens only after the fetch (via 23505): pasting a saved card whose listing has since expired returns "Ogłoszenie nie istnieje lub wygasło" instead of opening the existing card as FR-005 promises, and every duplicate paste calls otodom again.
- **Fix A ⭐ Recommended**: Look up the normalised URL before fetching; make `otodom_id` the unique key. Normalisation always emits `/pl/oferta/<slug>`; the route selects by `source_url` before ingestion and redirects with `?duplicate=1` on a hit; the unique index moves to `otodom_id` (already `not null`) and 23505 → look up by `otodom_id`.
  - Strength: Catches slug and prefix variants; duplicates never touch otodom; an expired-but-saved listing still opens its card.
  - Tradeoff: One extra select per paste; two lookup paths in the route.
  - Confidence: HIGH — `ad.id` is stable and already stored.
  - Blind spot: Whether otodom ever reissues an ID for a republished ad is unverified.
- **Fix B**: Keep fetch-first, only change the unique key to `otodom_id`.
  - Strength: Smallest change; still catches slug and prefix variants.
  - Tradeoff: An expired duplicate still errors instead of opening the card; every duplicate costs a fetch.
  - Confidence: HIGH.
  - Blind spot: Same as A.
- **Decision**: FIXED (Fix A)

### F4 — Unhandled insert failure + no step for the hosted migration

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 3 §1 (route contract), Migration Notes
- **Detail**: The route contract covers insert outcomes "success" and "23505" only. supabase-js returns errors rather than throwing, so any other error (e.g. `42P01 relation does not exist`, an RLS violation) leaves `data` null and a natural `data.id` throws → 500, which CLAUDE.md forbids. That scenario is likely: `deployment-runbook.md:211` makes applying a migration to the hosted project a human-only step, yet no phase or checklist item orders "human runs `supabase db push`" before the Worker deploy. Deploy code first and production 500s on every paste.
- **Fix**: Add a row to the message table for any other insert error ("Nie udało się zapisać oferty. Nic nie zostało zapisane.") → `/dashboard?error=`. Add to Migration Notes / Faza 5 an explicit human step: `supabase db push` to the hosted project before the deploy that ships `/api/offers`, citing the runbook.
  - Strength: Closes the only path to a 500; makes deploy order explicit where the runbook expects it.
  - Tradeoff: One more manual step before shipping.
  - Confidence: HIGH — both behaviours are documented.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix in plan)

### F5 — PII boundary: `raw` blacklist, and phone numbers in description

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Faza 2 §3 (`raw`), criteria 2.11 / 3.7
- **Detail**: (a) `raw` is the whole 62-key `ad` minus three named keys — a blacklist resting on one observation (the brief admits it). Any other key otodom adds or already holds with advertiser data lands in the database silently. (b) Agency descriptions routinely contain "Kontakt: <imię>, tel. 600…". The plan stores description verbatim (needed for FR-011 excerpts), so criteria 2.11/3.7 ("description does not contain phone or name") fail on real listings through no bug. CLAUDE.md's rule is written about the structured fields, but literally it says the phone "never reaches the database"; the plan does not resolve that tension and leaves the implementer to find out.
- **Fix A ⭐ Recommended**: Allowlist `raw` to the keys S-04/S-09 need (characteristics, features, target, adCategory, description, images, location without the address). Scope criteria 2.11/3.7 to the absence of contactDetails/owner/agency values. Ask the user to record in the PRD that the listing text is stored as written, contacts included.
  - Strength: New keys cannot leak; the verbatim-excerpt invariant stays intact.
  - Tradeoff: Needs the user's decision on free-text PII; S-09 may miss a key it later wants (it re-fetches anyway).
  - Confidence: MED — whether S-04 needs other keys is unverified.
  - Blind spot: Advertisers' names inside the title are not addressed.
- **Fix B**: Allowlist `raw` and redact phone-like patterns in description at the fetch boundary.
  - Strength: Keeps the literal CLAUDE.md rule.
  - Tradeoff: Regex false positives on prices and areas; names cannot be redacted reliably, so it is a partial fix.
  - Confidence: LOW — Polish phone formats vary widely.
  - Blind spot: The audit prompt would quote redacted text.
- **Decision**: FIXED (Fix A)

### F6 — `/offers/<non-uuid>` → Postgres 22P02, not a 404

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 4 §1
- **Detail**: The contract says "brak wiersza → 404" but says nothing about a query error. `/offers/abc` fails with `invalid input syntax for type uuid`. It also does not say how a 404 is produced; `src/pages/` has no `404.astro`.
- **Fix**: Treat any query error or a null row as 404; validate the uuid shape before querying; return `new Response(null, { status: 404 })` (or `Astro.rewrite`). Add a signed-in smoke step for `/offers/not-a-uuid` → 404.
- **Decision**: FIXED (Fix in plan)

### F7 — Inspect script copies fetch headers instead of importing fetch.ts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Faza 2 §5
- **Detail**: Only `map.ts` is imported; the fetch path (headers, regex, expired detection) is re-implemented, so the script can succeed while the route fails — the drift the brief says the script exists to prevent.
- **Fix**: Give `fetch.ts` the same "erasable syntax, no runtime imports" constraint and import `fetchOfferAd` in the script.
- **Decision**: FIXED (Fix in plan)

### F8 — `$DB_URL` undefined in Faza 1 criteria

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1 — Automated Verification
- **Detail**: Criteria 1.2/1.3 run `psql "$DB_URL"`, but nothing defines it.
- **Fix**: Name it explicitly: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (the local Supabase default, printed by `npx supabase status`).
- **Decision**: FIXED (Fix in plan) — URL lokalnej bazy wpisany jawnie tylko w komendach weryfikacyjnych; nie trafia do kodu ani do Cloudflare
