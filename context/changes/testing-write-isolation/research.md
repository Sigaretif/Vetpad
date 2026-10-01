---
date: 2026-10-01T21:10:25+02:00
researcher: Claude Code (session of Wiktor Ortel)
git_commit: b33fd20cf83a40ddbb25c8be952ac5601a69cbf4
branch: master
repository: Sigaretif/Vetpad
topic: "Test plan Phase 2 — ground risk #5 (a write on X changes Y) in code and in scripts/smoke.mjs"
tags: [research, testing, rls, write-isolation, smoke, offer_notes, member_requirements, team_criteria, offers]
status: complete
last_updated: 2026-10-01
last_updated_by: Claude Code (session of Wiktor Ortel)
---

# Research: Test plan Phase 2 — write isolation (risk #5)

**Date**: 2026-10-01T21:10:25+02:00
**Researcher**: Claude Code (session of Wiktor Ortel)
**Git Commit**: b33fd20cf83a40ddbb25c8be952ac5601a69cbf4
**Branch**: master
**Repository**: Sigaretif/Vetpad

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` (risk #5: a write on X
changes Y). Find the real failure path in code, verify or correct the risk response
guidance, list what `scripts/smoke.mjs` already asserts about `offer_notes` and
`member_requirements` RLS, name the cheapest useful test layer, and flag speculative
risks and misleading hot-spot evidence.

## Summary

1. **No defect found.** A probe against the local Supabase (publishable key, two
   seeded members, fixtures deleted afterwards — see "Probe" below) ran 15 write
   attempts; in each one, the rows of the member who was not writing were byte-identical
   before and after, except where the PRD says they must go (the FR-015 cascade). Phase 2
   is regression protection for S-09/S-10/S-11, not a bug hunt.
2. **The isolation lives in the migrations, not in `src/`.** `src/pages/api/` holds
   five write calls in four routes, and each binds the row to the session's user;
   none reads an author from the form. What keeps one member off another's row is
   the three `*_own` policies (insert, update, delete) on each authored table plus the
   freeze triggers.
3. **The guidance is right in intent and imprecise on the denial signatures.**
   "42501 on a blocked write" holds for an insert or upsert only. A denied
   cross-member `UPDATE`/`DELETE` is not an error at all: `200` with `[]` when the
   request carries `Prefer: return=representation`, and **`204` with an empty body
   without it** — the same answer a successful delete gives. A status-only assertion
   cannot tell them apart.
4. **Smoke already covers the "denied" half well and the "identical" half weakly.**
   It has eight anon or cross-member denial steps on notes and requirements (four per
   table: anon read, cross-member patch, delete and forged insert). What it lacks
   is the scenario the plan tells us to challenge: two members' rows side by side, one
   member writes successfully, the other's row is compared in full. Eight concrete gaps
   are listed under "Gaps".
5. **Three of the plan's write operations have no application code yet** — offer
   re-fetch (S-09), note delete and offer delete (S-11) — and archive (S-10) has no
   schema either. Their database half is testable today through the Data API; their
   route half is not, and belongs to those slices.
6. **Cheapest layer: `scripts/smoke.mjs`**, as the plan says — roughly a dozen steps
   and one before/after snapshot helper. One branch is unreachable there and needs a
   hermetic Vitest test: the "RLS filtered the update, zero rows" branch in
   `src/pages/api/criteria.ts`.

## Detailed Findings

### 1. Which operations write which tables

All write calls under `src/` (grep for `.insert(`/`.update(`/`.upsert(`/`.delete(`/`.rpc(`,
excluding `src/pages/dev/`): five, in four files.

| Operation | Code | Row it can reach |
|---|---|---|
| offer save | `src/pages/api/offers.ts:84-85` — `.insert({ ...result.offer, source_url, created_by: user.id })` | a new row only |
| note insert/update | `src/pages/api/notes.ts:68-70` — `.upsert({ offer_id, author_id: user.id, ...fields }, { onConflict: "offer_id,author_id" })` | the session user's note on that offer |
| limits save/clear | `src/pages/api/criteria.ts:72-81` — `.update({...}).eq("id", true).select("id")` | the shared singleton |
| requirements save | `src/pages/api/requirements.ts:81-83` — `.upsert({ author_id: user.id, body }, { onConflict: "author_id" })` | the session user's row |
| requirements delete | `src/pages/api/requirements.ts:60` — `.delete().eq("author_id", user.id)` | the session user's row |

Not in `src/` at this commit: an offer update (re-fetch, FR-009/S-09), an offer
delete and a note delete (FR-015/S-11), an archive write (FR-014/S-10). Roadmap
status for S-09, S-10, S-11 is `proposed` (`context/foundation/roadmap.md:52-54`).

Because the publishable key reaches PostgREST directly, the routes are not the
boundary: any member can send any write the policies admit (`CLAUDE.md`, Secrets and
data access; `lessons.md`, first lesson). The policies and triggers are therefore the
thing under test, and the Data API is the right place to attack them.

### 2. Policies, cascades and freeze triggers (the oracle's implementation)

Oracle (PRD): FR-012 own note only; FR-013 everyone reads; FR-015 delete an offer and
own notes, the cascade accepted; FR-002/FR-003 shared limits, own requirements; NFR
`prd.md:119` "No system action modifies or destroys human-authored text. After any
re-fetch, every note reads exactly as its author last left it."

- `offer_notes` — `20260926202537_create_offer_notes.sql`
  - `offer_id … on delete cascade` (`:26`), `author_id … on delete set null` (`:27`),
    `unique (offer_id, author_id)` (`:37`).
  - select: `auth.uid() is not null` (`:113-117`); insert: `with check (author_id = auth.uid())`
    (`:120-124`); update: `using`/`with check (author_id = auth.uid())` (`:128-133`);
    delete: `using (author_id = auth.uid())` (`:136-140`).
  - Freeze on update: `id`, `offer_id`, `created_at`, `author_id` restored from the old
    row, `updated_at := now()` (`20260927133501_offer_notes_server_timestamps.sql:39-61`);
    insert dates forced to `now()` (`:16-34`).
- `member_requirements` — `20260927144141_create_team_criteria.sql`
  - `author_id uuid primary key … on delete cascade` (`:131`).
  - select open to members (`:312-316`); insert/update/delete `author_id = auth.uid()`
    (`:319-338`).
  - Freeze: `author_id`, `created_at`; `updated_at` moves only when `body` changes
    (`20260928074737_tighten_team_criteria_checks.sql:65-80`).
- `team_criteria` — select and update for any member, no insert/delete policy
  (`20260927144141…:288-303`); signature trigger sets `updated_by`/`updated_at`
  itself and only on a real change (`:85-119`).
- `criteria_revision` — select only (`:347-351`); bumped by `security definer`
  triggers on a real change (`:221-263`).
- `offers` — full CRUD for any member (`20260922202756_create_offers.sql:87-113`);
  `created_by` frozen, null only once the account is gone
  (`20260923153747_offers_keep_after_author_deleted.sql:30-45`).

No trigger on `offers` writes to `offer_notes`, and no trigger on either criteria
table writes to the other; the only cross-table writes in the nine migrations are the
`offer_notes.offer_id` cascade, the three `on delete set null`/`cascade` actions hanging
off `auth.users`, the `members` sync and the revision bump.

### 3. Probe: what PostgREST actually answers (local Supabase, 2026-10-01)

Run once with the publishable key and the sessions of `sigaretif1` (A) and
`sigaretif2` (B) from `supabase/seed.sql`; two fixture offers saved by A, notes
A-on-O1, B-on-O1, B-on-O2; requirements for both. Cleanup confirmed 0 fixture offers
left. Script kept outside the repository (session scratchpad).

| # | Attempt | Answer | Other member's rows |
|---|---|---|---|
| 1 | B `PATCH` A's note, no `Prefer` | **204**, empty body | identical |
| 2 | same, `Prefer: return=representation` | 200, `[]` | identical |
| 3 | B `DELETE` A's note, no `Prefer` | **204**, empty body (`content-range: */0` only with `count=exact`) | identical |
| 4 | B plain `INSERT` signed as A | 403, `42501` | identical |
| 5 | B **upsert** (`resolution=merge-duplicates`) onto A's existing note | 403, `42501` | identical |
| 6 | anon `INSERT` | **401**, `42501` | identical |
| 7 | anon `PATCH` | 200, `[]` | identical |
| 8 | B `PATCH offer_notes?offer_id=eq.O1` (no author filter) | 200, 1 row — B's own | A's note on O1 identical |
| 9 | B `PATCH` offer O1: title, description, `fetched_at`, `created_by: B` | 200, 1 row, `created_by` still A | all 3 notes identical, `updated_at` included |
| 9b | B `PATCH` offer `created_by: null` | 200, `created_by` still A | — |
| 10 | B upsert requirements signed as A | 403, `42501` | identical |
| 11 | B `DELETE member_requirements` with a filter matching both rows | 200, 1 row — B's own | A's row remains |
| 12 | A `PATCH member_requirements` with a filter matching both | 200, 1 row — A's own | — |
| 13 | B `PATCH` the team limits | 200, signed `updated_by: B` | both requirements identical |
| 14 | `DELETE offer_notes` with no filter | 400, `21000` "DELETE requires a WHERE clause" | — |
| 15 | B `DELETE` offer O1 (saved by A, holding A's and B's notes) | 200, 1 row | both O1 notes gone; B's note on O2 identical |

Rows 8, 11 and 12 are the plan's "the UPDATE succeeded, so only the targeted row
changed" case, and under the current policies the claim holds. Row 15 is FR-015: the
cascade removes A's note although B has no delete policy on it (the referential action
is not subject to the caller's RLS), and it takes nothing from another offer.

### 4. Verdict on the risk response guidance

| Guidance | Verdict | Correction |
|---|---|---|
| "After every write operation, other members' rows are identical to before" | Correct as the thing to prove; true in all 15 probe rows | "Identical" needs a full-row before/after comparison (`select=*`, dates included). Smoke's current "unchanged" steps compare one text field with `bodyIncludes` (`scripts/smoke.mjs:603-606`, `:746-749`). |
| "RLS denial = HTTP 200 with `[]` on read" | Correct (`smoke.mjs:575`, `:716-717`; probe 7) | Holds for a denied `UPDATE`/`DELETE` too, but **only with `Prefer: return=representation`**. Without it the answer is 204 and empty (probe 1, 3). |
| "42501 on a blocked write" | Partly correct | True for an insert or an upsert whose new row fails `with check` (probe 4, 5, 10) — 403 for a member, **401 for anon** (probe 6). False for a cross-member update/delete, which raises nothing. Also raised by `team_criteria_before_update` when `auth.uid()` is null (`…create_team_criteria.sql:106-109`), which is not an RLS denial. |
| Challenge "a denied cross-member update/delete surfaces as an error at all" | Confirmed: it does not (probe 1–3) | Every write-isolation step must assert a row count, never a status alone. |
| "Avoid asserting only 'no error'" | Correct, and smoke breaks it in three cleanup steps | `smoke.mjs:799-808` expect `{ status: 204 }` on deletes with no `Prefer`; they pass whether or not a row existed. Harmless as cleanup, but the second member's requirements are never read between `:706` and their delete at `:805`, so nothing proves they survived the first member's edit and delete. |
| Operation list: "offer re-fetch, note delete, offer delete" | Speculative at the route level | No such code in `src/` (finding 1). Testable now only as Data API writes standing in for them; say so in §6.3 so S-09/S-11 add the route-level check. |
| Likely cheapest layer: smoke against local Supabase | Confirmed | A stub cannot answer for a policy, a trigger or a cascade. One exception below (gap 8). |

### 5. What `scripts/smoke.mjs` already asserts

Notes (fixture offer saved by A; **only A has a note on it**):

- one note per member per offer after two saves — `:570-574`
- anon reads none — `:575`; B reads it — `:576-580`
- B `PATCH` → 200, 0 rows — `:581-591`; B `DELETE` → 200, 0 rows — `:592-596`
- B insert signed as A → 403 `42501` — `:597-601` (helper `:221-229`)
- "note is unchanged": A reads `pros`, body includes the edited text — `:602-606`
- author's own patch of `id`/`offer_id`/`author_id`/dates accepted and undone — `:607-608`
  (helpers `:233-260`)
- deleting the fixture offer returns 1 row and its notes read as 0 — `:820-834`

Requirements (both A and B have a row from `:706`):

- A has one row — `:713`; anon reads none — `:714-718`; B reads A's — `:719-723`
- B `PATCH`/`DELETE` A's row → 200, 0 rows — `:724-739`
- B insert signed as A → 403 `42501` — `:740-744` (helper `:374-382`)
- "requirements are unchanged": body includes the edited text — `:745-749`
- author's patch of author and dates accepted, undone, revision +0 — `:750-759`
- A's delete through the route, A's row gone — `:778-783`

Limits and counter: no insert/delete of the singleton, no write to the counter,
check violation `23514`, signature kept, revision deltas — `:611-682`, `:784-796`.

The harness compares `status`, `location*`, `errorCode`, `bodyIncludes`, `rows`,
`minRows`, `revisionDelta` (`:858-868`). It has no "same as before" expectation;
`withRevision` (`:321-326`) is the existing pattern for wrapping a step between two
reads and reporting a delta.

In-process tests: `tests/pages/api/` holds `offers.test.ts` only; there is no test
for the notes, criteria or requirements routes.

### 6. Gaps (what a regression could change without turning smoke red)

1. **No successful write next to another member's row on the same offer.** B never
   has a note on the fixture offer, so "B's PATCH returns 0 rows" proves the denial
   but not that a write which does succeed stays on its own row (probe 8).
2. **"Unchanged" is one field, not the row.** `:602-606` and `:745-749` would pass
   if `cons`, `observations` or `updated_at` moved.
3. **B's requirements are never re-read** after A's edit, A's delete (`:778-783`) or
   the limits clear (`:784-788`); their only later touch is a 204 delete (`:804-808`).
4. **Offer write → notes.** `:761-771` patches the fixture offer while A's note
   exists, and no step reads the note afterwards. This is the FR-009 invariant's
   only current stand-in.
5. **`offers.created_by` freeze has no step.** `created_by` appears in smoke only
   in the fixture insert (`:210`). Probe 9/9b show the trigger works; nothing guards it.
6. **The cascade is checked on one note and one offer.** It does not show that
   another member's note goes too (FR-015 "every member's notes"), nor that a note
   on a different offer stays ("takes more").
7. **Forged upsert is untested.** Both routes write with an upsert; smoke forges
   with a plain insert only (`:224-228`, `:377-381`).
8. **`src/pages/api/criteria.ts:93-96`** ("An update RLS filters out answers 200
   with no rows; that is a failed save") has no test, and real policies cannot
   produce that answer for a signed-in member, so smoke cannot reach it. A Vitest
   route test stubbing the `PATCH` to answer `200 []` can — pattern:
   `tests/pages/api/offers.test.ts` with `tests/fixtures/http.ts`.

Related, by design rather than a gap: `requirements.ts:60` deletes without
`.select()`, so zero rows reads as success — the doc comment states that deleting
absent requirements is not an error (`requirements.ts:28`). S-11's note delete and
offer delete should decide this explicitly rather than inherit it.

### 7. Cheapest useful layer

- **Integration in `scripts/smoke.mjs` (CI `smoke` job, `.github/workflows/ci.yml:28-56`)**
  for gaps 1–7. Shape: give B a note on the fixture offer and create a second
  fixture offer with a note; add a snapshot wrapper on the `withRevision` pattern
  that reads the other member's rows with `select=*` before and after a step and
  reports whether they match; assert `rows` on every write, with
  `Prefer: return=representation`. The existing cleanup order (offer deleted last)
  already removes everything.
- **Hermetic Vitest** for gap 8 only.
- Not e2e, and not a stubbed-client test of the policies: a stub would return
  whatever the test told it to.

### 8. Speculative or misleading evidence

- **Hot-spot `src/`**: the four write routes cannot address another member's row
  (finding 1); churn there did not raise this risk's likelihood.
- **Hot-spot `scripts/`**: churn is smoke growing with each slice — coverage, not
  instability.
- **Hot-spot `supabase/migrations/` (9 commits/30d)**: valid signal. Three of the
  nine migrations name a review finding as their source in their header comment
  (`20260926194251`, `20260927133501`, `20260928074737`), and a fourth (`20260923153747`)
  is the fix for impl-review finding F4 according to `lessons.md` — triggers and checks
  have needed correcting before.
- **"A re-fetch overwrites notes"**: no re-fetch exists, and no trigger links
  `offers` to `offer_notes` except the delete cascade. The live form of the risk is
  S-09 choosing delete-and-reinsert over update — the cascade would then wipe every
  note. A stand-in `PATCH` in smoke guards the schema; the S-09 route needs its own
  check.

## Code References

- `src/pages/api/notes.ts:68-70` — note upsert bound to `user.id`
- `src/pages/api/requirements.ts:60`, `:81-83` — own delete, own upsert
- `src/pages/api/criteria.ts:72-96` — limits update and the zero-row branch
- `src/pages/api/offers.ts:84-85` — the only offer write
- `supabase/migrations/20260926202537_create_offer_notes.sql:24-46`, `:113-140` — table, policies
- `supabase/migrations/20260927133501_offer_notes_server_timestamps.sql:16-61` — insert dates, freeze
- `supabase/migrations/20260927144141_create_team_criteria.sql:85-119`, `:130-139`, `:288-351` — signature trigger, requirements, policies
- `supabase/migrations/20260928074737_tighten_team_criteria_checks.sql:65-80` — requirements freeze
- `supabase/migrations/20260923153747_offers_keep_after_author_deleted.sql:30-45` — `created_by` freeze
- `scripts/smoke.mjs:158-187` — `supabaseRest` (reports `rows` only for an array body)
- `scripts/smoke.mjs:321-326` — `withRevision`, the before/after wrapper to imitate
- `scripts/smoke.mjs:569-608`, `:712-759`, `:797-834` — notes RLS, requirements RLS, cleanup and cascade
- `tests/pages/api/offers.test.ts`, `tests/fixtures/http.ts` — route test and HTTP-edge stub

## Architecture Insights

- Authorship isolation is two layers per table: a `*_own` policy decides who may
  write the row, and a `before update` trigger decides which columns even the
  author may not change. A test of one does not cover the other.
- PostgREST's answer to a denied write depends on the `Prefer` header, so the
  assertion style is part of the contract: `return=representation` plus a row count.
- Smoke is ordered and stateful; a check is only meaningful once the row it could
  wrongly touch exists (the file says so at `:569` and `:712`). New steps go after
  both members' rows exist and before cleanup.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — "Declare `on delete` on every author column":
  supported; each of the four columns referencing `auth.users` states its action
  (`offers.created_by` set null, `offer_notes.author_id` set null,
  `team_criteria.updated_by` set null, `member_requirements.author_id` cascade).
- `context/archive/2026-09-26-member-notes/`, `context/archive/2026-09-27-team-search-criteria/`
  — the slices that added the smoke steps listed in finding 5; not re-read in full.
- `context/foundation/roadmap.md:237-239` — S-09 "rewrites `public.offers` only",
  S-11 "the database half is already in place": both supported by finding 2 and probe 9, 15.

## Related Research

- `context/archive/2026-09-30-testing-ingestion-guardrails/` — Phase 1 of the same rollout.

## Open Questions

1. **Account deletion is outside smoke's reach.** `on delete set null` on a note's
   author and `on delete cascade` on requirements fire only when a row leaves
   `auth.users`, which needs an admin path; smoke uses the publishable key alone and
   `CLAUDE.md` forbids introducing a secret key. Whether Phase 2 covers it (for
   example with SQL against the local container in the CI job) or leaves it in §7 as
   deliberately untested is the user's call. Not probed in this research.
2. **Should gap 8 be in this phase?** The plan's row says "integration (smoke)" only;
   the Vitest test is small but is a second layer.
3. The policies hold only while `enable_anonymous_sign_ins = false`
   (`supabase/config.toml:171`); smoke sees the local setting, never the hosted one.
4. Observed, outside #5: a member can re-id an offer through the Data API unless a
   note references it (probe: 409 `23503` with notes present). Not assessed further.
