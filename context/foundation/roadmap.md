---
project: Vetpad
version: 1
status: draft
created: 2026-09-21
updated: 2026-10-27
prd_version: 1
main_goal: market-feedback
top_blocker: time
milestone_id: team-vets-listings-in-vetpad
milestone_seq: 1
milestone_status: done
---

# Roadmap: Vetpad

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: Team vets listings in Vetpad** — Status: done

- **Intent:** The three-person team saves otodom.pl listings, audits them against its own criteria with every finding quoted from the listing, and records attributed notes beside the audit — enough to retire the spreadsheet for the rest of the search.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every S-NN below is `done`.
- **Scope anchors:** FR-001 – FR-015, US-01.

## Vision recap

A small group searching for an apartment together keeps blind links in spreadsheets and Notion pages: a week later nobody remembers why a listing was saved, and nobody arrives at a viewing knowing what the listing failed to say. Vetpad replaces those passive tools with an active one — it fetches the listing itself, audits it against the team's own criteria, and reports what is missing, risky or expensive, quoting the listing's own words for every claim. Real-estate portals will not build this, because they serve sellers, not buyers.

## North star

**S-02: Member pastes an otodom.pl URL and gets a saved card with the listing's full content** — the first proof that Vetpad holds substance rather than a blind link, and the first contact with the ingestion risk that everything downstream depends on.

> "North star" here means the smallest end-to-end slice whose delivery proves the product can work at all — placed as early as its prerequisites allow, because the audit, the notes and the board only matter if a pasted link reliably becomes a saved listing. It is sequenced first under the `market-feedback` goal: whether the portal serves requests from the hosting platform, and whether its data can be mapped without inventing facts, can only be learned against real listings.

## At a glance

| ID   | Change ID                | Outcome (user can …)                                                                | Prerequisites | PRD refs                      | Status |
| ---- | ------------------------ | ----------------------------------------------------------------------------------- | ------------- | ----------------------------- | ------ |
| S-01 | closed-team-sign-in      | sign in only with a pre-seeded account; nobody can register                         | —             | FR-001                        | done   |
| S-02 | paste-listing-to-card    | paste an otodom.pl URL and read the saved listing's text, parameters and photos     | S-01          | US-01, FR-004, FR-005, FR-007 | done   |
| S-03 | team-search-criteria     | define and edit the team's shared hard limits and their own additional requirements | S-01          | FR-002, FR-003                | done   |
| S-04 | grounded-listing-audit   | run an AI audit on a saved listing and read findings, each quoted from the listing  | S-02, S-03    | US-01, FR-010, FR-011         | done   |
| S-05 | member-notes             | write their own Pros / Cons / Observations note and read everyone's, attributed     | S-02          | US-01, FR-012, FR-013         | done   |
| S-06 | shared-offer-board       | browse every saved listing on one board with its audit status                       | S-02          | FR-006                        | done   |
| S-07 | duplicate-listing-notice | paste an already-saved URL and land on the existing card, told who saved it         | S-02          | FR-005                        | done   |
| S-08 | location-map-link        | open a Google Maps search for a listing's location in one click                     | S-02          | FR-008                        | done   |
| S-09 | refetch-and-stale-audit  | re-fetch a listing on demand, keep every note, and see when an audit has gone stale | S-04, S-05    | FR-009, FR-003                | done   |
| S-10 | archive-and-restore      | archive a listing off the board, see who archived it, and restore it                | S-06          | FR-014                        | done   |
| S-11 | delete-offer-and-notes   | delete a mistaken listing, and delete their own notes                               | S-05          | FR-015                        | done   |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                         | Chain                                      | Note                                                                                                                                         |
| ------ | ----------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Vetting loop                  | `S-01` → `S-02` → `S-03` → `S-04` → `S-09` | The `market-feedback` spine: ingestion, then the audit, as early as possible. `S-03` can run beside `S-02`. `S-09` joins Stream B at `S-05`. |
| B      | Team notes                    | `S-05` → `S-11`                            | `S-05` and `S-11` done — notes are written, read and deleted on the offer card.                                                              |
| C      | Board hygiene                 | `S-06` → `S-10`                            | `S-06` and `S-10` done — the board is on `/dashboard`, the archive on `/offers/archive`.                                                     |
| D      | Listing identity and location | `S-07`, `S-08`                             | Two independent slices hanging off `S-02`; either can be picked up by a spare agent run.                                                     |

## Baseline

What's already in place in the codebase as of `2026-09-21` (auto-researched + user-confirmed).
Slices below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — per tech-stack.md: Astro SSR with React islands, Tailwind, shadcn. Only starter screens exist; `src/pages/dashboard.astro` is a placeholder greeting.
- **Backend / API:** partial — only the auth routes in `src/pages/api/auth/` (signin, signup, signout); no domain routes.
- **Data:** partial — Supabase client wired (`src/lib/supabase.ts`) and three local accounts seeded (`supabase/seed.sql`); no `supabase/migrations/`, no domain tables.
- **Auth:** partial — sign-in works and `src/middleware.ts` protects `/dashboard`, but registration is still open (`/auth/signup`, `enable_signup = true` in `supabase/config.toml`), contrary to FR-001; `scripts/smoke.mjs` creates its account through that signup route.
- **Deploy / infra:** present — deployed to Cloudflare Workers (Free plan) at `vetpad.vetpad.workers.dev`, auto-deploy from `master` via Workers Builds; CI runs lint, type check, build and a smoke job (`.github/workflows/ci.yml`). See `context/foundation/deployment-runbook.md`.
- **Observability:** partial — platform request logs and live tail are enabled; no application-level error tracking.

## Foundations

None. Every absent or partial layer in the Baseline is first needed by a user-facing slice, so each is introduced inside the first slice that uses it: the first domain table and its access policies arrive with S-02, the model-provider integration with S-04, and closing registration is itself the user-visible slice S-01.

## Slices

### S-01: Sign-in is closed to the team's pre-seeded accounts

- **Outcome:** user can sign in only with one of the team's pre-seeded accounts; the registration page and route are gone, and an outsider cannot create an account.
- **Change ID:** closed-team-sign-in
- **PRD refs:** FR-001
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Who creates the three accounts in the hosted project, and when — a human-only action per the runbook. — Owner: user. Block: no.
- **Risk:** Sequenced before any team data exists because read access is open to every signed-in member (FR-013): while registration stays open, anyone who registers can read every saved listing and note. Removing signup also breaks every smoke step that creates its account inline, so the smoke job needs a pre-seeded test account in the same change.
- **Status:** done

### S-02: Paste a listing URL and get a saved card

- **Outcome:** user can paste an otodom.pl listing URL, press "Add", and read the saved card — description, parameters and hotlinked photo gallery — without reopening the portal; an invalid URL shows an error, and a failed fetch is reported as a fetch problem with nothing saved.
- **Change ID:** paste-listing-to-card
- **PRD refs:** US-01, FR-004, FR-005, FR-007
- **Prerequisites:** S-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - Does otodom.pl serve requests from the hosting platform's egress addresses, reliably? The extraction-service fallback is documented but adopting it is a user decision. — Owner: user. Block: no. Resolved 2026-10-17: the user adopted the fallback (change `otodom-apify-fallback`) — it sits beside the direct fetch, selected by `public.ingestion_settings`.
  - How does "unknown" look on the card (PRD Open Question 2)? The semantics are binding — the plan picks a presentation and says so. — Owner: user. Block: no.
- **Risk:** The north star, and it carries the product guardrails that are easiest to break silently: the seller's phone and name must be dropped at the fetch boundary, a stated `"0"` for rent (and any similar numeric field) must read as unknown, and a failed fetch must never leave a blank or partial offer. Ingestion must also show progress and give up within about a minute (Non-Functional Requirements).
- **Status:** done

### S-03: Team search criteria

- **Outcome:** user can set the team's shared hard limits (city, price range, minimum square meters), write their own additional-requirements text that only they own, and edit or delete either at any time.
- **Change ID:** team-search-criteria
- **PRD refs:** FR-002, FR-003
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-05, S-06, S-07, S-08, S-10, S-11
- **Blockers:** —
- **Unknowns:** —
- **Risk:** On the audit's path, so it is sequenced alongside the north star rather than after the board. FR-003's stale flag is only completed in S-09, once audits exist to go stale; this slice records enough to tell that criteria changed.
- **Status:** done

### S-04: Grounded AI audit of a saved listing

- **Outcome:** user can press "Run AI Audit" on a saved listing and read the decision-critical missing information with the questions it implies, the mandatory conditions, the explicitly stated extra costs and the red flags — every positive finding with a verbatim excerpt of the listing, missing items flagged without one — and the card shows it as audited.
- **Change ID:** grounded-listing-audit
- **PRD refs:** US-01, FR-010, FR-011
- **Prerequisites:** S-02, S-03
- **Parallel with:** S-05, S-06, S-07, S-08, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - ~~How does the member see a roughly three-minute audit continuously in progress, and how is it failed and retried past that limit?~~ Resolved 2026-10-09 in S-04: the audit button is a React island that follows the route's answer as a stream of lines — the stage the audit is in, with the time running, and a sign of life every few seconds while the model works. The model call is abandoned after 165 seconds and reported as failed with a retry offered; an attempt whose request died reads as interrupted after 175 seconds and can then be run again (`src/lib/audit/failure.ts` holds the limits). — Owner: team.
  - ~~How is the model's structured output checked — hand-rolled, or with a validation library the user approves?~~ Resolved in S-04 (decided in its plan, 2026-10-06): hand-rolled, no library — see Open Roadmap Question 3. — Owner: user.
  - ~~Does the audit's per-request CPU still fit the hosting platform's free plan on the longest listing?~~ Measured 2026-10-09 on production: one audit of a listing of 1472 characters took 27 ms of CPU — over the free plan's 10 ms, and it completed, because the plan tolerates infrequent overruns. The audit is not the expensive request: ordinary page renders read 17–48 ms in the same log. Nobody confirmed that listing was the longest saved. The user stays on the free plan; numbers and the trigger to revisit are in `context/foundation/deployment-runbook.md`, "The CPU ceiling is reached". — Owner: team.
- **Risk:** Carries the product's hardest promise — a finding that cannot be quoted from the listing is not reported — so it comes right after its two inputs exist, per `market-feedback`. Only listing text and criteria may reach the model provider; notes never do, and the seller's personal data never reaches the prompt.
- **Status:** done

### S-05: Member notes beside the listing

- **Outcome:** user can write and edit their own note on a listing in three fields — Pros, Cons, General Observations — displayed alongside the audit, and read every other member's note with its author's name.
- **Change ID:** member-notes
- **PRD refs:** US-01, FR-012, FR-013
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-06, S-07, S-08, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Authorship is the only restriction in the access model: a member edits and deletes only their own note, while every member reads all of them. A missing or permissive access policy here is a live exposure, not a later hardening task.
- **Status:** done

### S-06: Shared offer board

- **Outcome:** user can browse every saved listing on one shared board, each marked "Not Audited" or audited.
- **Change ID:** shared-offer-board
- **PRD refs:** FR-006
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-07, S-08, S-09, S-11
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Until it lands, a saved card is only reachable right after pasting it — the team cannot abandon the spreadsheet without a board. Every card reads "Not Audited" until S-04 exists. The Topbar's „Oferty" (`src/components/Topbar.astro`) and the card's „← Wróć do ofert" (`src/pages/offers/[id].astro`) already point at `/dashboard` and promise this board, while `/dashboard` still renders only the add-offer form; this slice makes the board that destination, or moves both links if the board takes another route.
- **Status:** done

### S-07: Duplicate listing notice

- **Outcome:** user can paste a URL that is already saved — with or without tracking parameters — and lands on the existing card with a notice naming the member who saved it, instead of creating a second entry.
- **Change ID:** duplicate-listing-notice
- **PRD refs:** FR-005
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-08, S-09, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - FR-005's offer of a manual re-fetch on the duplicate notice needs the re-fetch from S-09; whichever lands second connects them. — Owner: team. Block: no.
- **Risk:** Low. Stripping query parameters is the whole identity rule; cross-portal and relisting matching stay parked.
- **Status:** done

### S-08: One-click map link

- **Outcome:** user can open a Google Maps search for a listing's location, generated from its scraped location text, in one click.
- **Change ID:** location-map-link
- **PRD refs:** FR-008
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07, S-09, S-10, S-11
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low. The link is a coarse vicinity check by design; an address missing from the listing must not be filled in with a guess.
- **Status:** done

### S-09: Re-fetch a listing and flag stale audits

- **Outcome:** user can re-fetch a listing's data on demand, finds every note exactly as its author left it, and sees an existing audit marked stale — and is prompted to re-run it — when the listing's data or the team's criteria changed.
- **Change ID:** refetch-and-stale-audit
- **PRD refs:** FR-009, FR-003
- **Prerequisites:** S-04, S-05
- **Parallel with:** S-06, S-07, S-08, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - ~~How is a broken scrape told apart from a real listing change? False staleness trains the team to ignore the flag.~~ Resolved 2026-10-09 in this slice's plan: a field the saved listing states and the re-fetched one no longer does halts the save until the member overwrites deliberately (`src/lib/offer-refetch.ts`); a wrongly changed value is not detected. Recorded in the PRD's resolved block under Open Questions. — Owner: user.
- **Risk:** Sequenced after both audits and notes exist, because its two invariants — notes survive a re-fetch, audits are flagged and never silently re-run or removed — can only be verified once there is something to preserve. A re-fetch that fails must leave the stored listing untouched.
- **Status:** done

### S-10: Archive and restore listings

- **Outcome:** user can archive a listing to hide it from the board, sees who archived it and a visible "recently archived" section or counter, and can view and restore archived listings.
- **Change ID:** archive-and-restore
- **PRD refs:** FR-014
- **Prerequisites:** S-06
- **Parallel with:** S-03, S-04, S-05, S-07, S-08, S-09, S-11
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mitigates the shared-board risk that one member hides a flat the others still want; recording and showing who archived it is the whole mitigation, so it cannot be dropped.
- **Status:** done

### S-11: Delete a listing and own notes

- **Outcome:** user can delete a saved listing — taking every member's notes on it with it — and can delete their own notes. An archived listing can be deleted as well as a live one (user's decision, 2026-10-11, in S-10's plan).
- **Change ID:** delete-offer-and-notes
- **PRD refs:** FR-015
- **Prerequisites:** S-05
- **Parallel with:** S-03, S-04, S-06, S-07, S-08, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The cascade to other members' notes is a trade the PRD accepted; deleting another member's note on its own is not, so the delete rule for notes stays authorship-scoped.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Issue                                                | Change ID                | Suggested issue title                                       | Ready for `/10x-plan` | Notes                                                                              |
| ---------- | ---------------------------------------------------- | ------------------------ | ----------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| S-01       | [#12](https://github.com/Sigaretif/Vetpad/issues/12) | closed-team-sign-in      | Close registration; sign-in only for pre-seeded accounts    | done                  | Done; archived 2026-09-22                                                          |
| S-02       | [#13](https://github.com/Sigaretif/Vetpad/issues/13) | paste-listing-to-card    | Save an otodom listing from a pasted URL and show its card  | done                  | Done; archived 2026-09-23 → `context/archive/2026-09-22-paste-listing-to-card/`    |
| S-03       | [#14](https://github.com/Sigaretif/Vetpad/issues/14) | team-search-criteria     | Shared hard limits and per-member additional requirements   | done                  | Done; archived 2026-09-29 → `context/archive/2026-09-27-team-search-criteria/`     |
| S-04       | [#15](https://github.com/Sigaretif/Vetpad/issues/15) | grounded-listing-audit   | AI audit of a saved listing with verbatim excerpts          | done                  | Done; archived 2026-10-09 → `context/archive/2026-10-06-grounded-listing-audit/`   |
| S-05       | [#16](https://github.com/Sigaretif/Vetpad/issues/16) | member-notes             | Per-member Pros / Cons / Observations notes, attributed     | done                  | Done; archived 2026-09-27 → `context/archive/2026-09-26-member-notes/`             |
| S-06       | [#17](https://github.com/Sigaretif/Vetpad/issues/17) | shared-offer-board       | Shared board of saved listings with audit status            | done                  | Done; archived 2026-09-26 → `context/archive/2026-09-26-shared-offer-board/`       |
| S-07       | [#18](https://github.com/Sigaretif/Vetpad/issues/18) | duplicate-listing-notice | Redirect duplicate URLs to the existing card with notice    | done                  | Done; archived 2026-09-26 → `context/archive/2026-09-26-duplicate-listing-notice/` |
| S-08       | [#19](https://github.com/Sigaretif/Vetpad/issues/19) | location-map-link        | One-click Google Maps search from listing location          | done                  | Done; archived 2026-10-09 → `context/archive/2026-10-09-location-map-link/`        |
| S-09       | [#20](https://github.com/Sigaretif/Vetpad/issues/20) | refetch-and-stale-audit  | Manual re-fetch that preserves notes and flags stale audits | done                  | Done; archived 2026-10-11 → `context/archive/2026-10-09-refetch-and-stale-audit/`  |
| S-10       | [#21](https://github.com/Sigaretif/Vetpad/issues/21) | archive-and-restore      | Archive, restore and show who archived a listing            | done                  | Done; archived 2026-10-11 → `context/archive/2026-10-11-archive-and-restore/`      |
| S-11       | [#22](https://github.com/Sigaretif/Vetpad/issues/22) | delete-offer-and-notes   | Delete a listing and a member's own notes                   | done                  | Done; archived 2026-10-11 → `context/archive/2026-10-11-delete-offer-and-notes/`   |

## Open Roadmap Questions

1. ~~**How is a parser failure told apart from a real listing change?**~~ Resolved 2026-10-09 in S-09 (decided in its plan): a field the saved listing states and the re-fetched one no longer does halts the save until the member overwrites deliberately; a wrongly changed value is not detected. Recorded in the PRD's resolved block under Open Questions. — Owner: user.
2. ~~**What does "unknown" look like in the interface?**~~ Resolved 2026-09-22 in S-02: an unstated attribute reads „nie podano w ogłoszeniu", and every parameter on the card always has its row. Recorded in the PRD's resolved block under Open Questions. — Owner: user.
3. ~~**Is a validation library acceptable for checking the audit's structured output, or does validation stay hand-rolled?**~~ Resolved in S-04 (decided in its plan, 2026-10-06): validation stays hand-rolled and no library is added. The model provider enforces the answer's shape from a JSON Schema, hand-written readers check that shape on arrival and on every read from the database (`src/lib/audit/schema.ts`), and the one check no library could make — that an excerpt really stands in the listing — is `src/lib/audit/grounding.ts`. Narrowed before that on 2026-09-22, when S-02 settled URL normalisation hand-rolled (`src/lib/otodom/url.ts`). The project rules still require the user's go-ahead before a library is added. — Owner: user.
4. ~~**If otodom.pl starts refusing the hosting platform's requests, is the documented extraction-service fallback adopted?**~~ Resolved 2026-09-22: not adopted now; parked with its trigger condition — see "Extraction-service fallback for ingestion (Apify)" under Parked. Resolved again 2026-10-17: adopted by the user in the change `otodom-apify-fallback` — `apify/cheerio-scraper` with our own `pageFunction`, beside the direct fetch, the mode chosen by the owner in `public.ingestion_settings` (`context/foundation/ingestion/otodom_apify.md`). — Owner: user.
5. ~~**When does the hosting plan move off the free tier?**~~ Answered 2026-10-09 after S-04's production audit: not now. Most requests already run over the free plan's 10 ms of CPU (the audit 27 ms, page renders 17–48 ms) and none has failed; the user stays on the free tier until the first `1102` or `exceededCpu` (`context/foundation/deployment-runbook.md`, "The CPU ceiling is reached"). — Owner: user.

## Parked

- **Automated background fetching or notifications** — Why parked: PRD §Non-Goals; every fetch, re-fetch and audit is a deliberate manual action.
- **Browser userscript for one-click saving** — Why parked: PRD §Non-Goals; ingestion is copy-and-paste of a URL.
- **olx.pl ingestion** — Why parked: PRD §Non-Goals; otodom.pl only in v1, olx is the first post-MVP source.
- **Price or description history** — Why parked: PRD §Non-Goals; a re-fetch overwrites, the team sees only that an audit went stale.
- **Photo or Vision analysis** — Why parked: PRD §Non-Goals; the audit reads text and parameters only.
- **Cross-portal or relisting duplicate matching** — Why parked: PRD §Non-Goals; identity is the URL with query parameters stripped.
- **Map plotting or commute routing beyond FR-016** — Why parked: PRD §Non-Goals; no map of all offers, no commute times on the board, nothing calculated on its own. Commute times from one offer to the team's points (FR-016, added to the PRD 2026-10-26) are delivered outside M-1 by the change `commute-times`.
- **Cost scenarios or a viewing/contact planner** — Why parked: PRD §Non-Goals.
- **Mobile usability** — Why parked: PRD §Non-Goals; desktop browsers only.
- **Multi-tenancy** — Why parked: PRD §Non-Goals; one shared space, three pre-seeded accounts.
- **Granular aspect or room note structure** — Why parked: PRD §Non-Goals; Pros, Cons and General Observations only.
- **Real-time collaborative editing** — Why parked: PRD §Non-Goals; notes are per-person and never co-edited.
- **Registration and password reset** — Why parked: FR-001; a password is reissued by the database administrator.

## Milestone History

- **M-1: Team vets listings in Vetpad** (`team-vets-listings-in-vetpad`) — closed 2026-10-11. All eleven slices (S-01 – S-11) are done: the team saves otodom.pl listings, audits them against its own criteria with every positive finding quoted from the listing, and keeps attributed notes beside the audit, covering FR-001 – FR-015 and US-01.

## Done

- **S-01: user can sign in only with one of the team's pre-seeded accounts; the registration page and route are gone, and an outsider cannot create an account.** — Archived 2026-09-22 → `context/archive/2026-09-21-closed-team-sign-in/`. Lesson: —.
- **S-02: user can paste an otodom.pl listing URL, press "Add", and read the saved card — description, parameters and hotlinked photo gallery — without reopening the portal; an invalid URL shows an error, and a failed fetch is reported as a fetch problem with nothing saved.** — Archived 2026-09-23 → `context/archive/2026-09-22-paste-listing-to-card/`. Lesson: —.
- **S-06: user can browse every saved listing on one shared board, each marked "Not Audited" or audited.** — Archived 2026-09-26 → `context/archive/2026-09-26-shared-offer-board/`. Lesson: —.
- **S-07: user can paste a URL that is already saved — with or without tracking parameters — and lands on the existing card with a notice naming the member who saved it, instead of creating a second entry.** — Archived 2026-09-26 → `context/archive/2026-09-26-duplicate-listing-notice/`. Lesson: —.
- **S-05: user can write and edit their own note on a listing in three fields — Pros, Cons, General Observations — displayed alongside the audit, and read every other member's note with its author's name.** — Archived 2026-09-27 → `context/archive/2026-09-26-member-notes/`. Lesson: —.
- **S-03: user can set the team's shared hard limits (city, price range, minimum square meters), write their own additional-requirements text that only they own, and edit or delete either at any time.** — Archived 2026-09-29 → `context/archive/2026-09-27-team-search-criteria/`. Lesson: —.
- **S-04: user can press "Run AI Audit" on a saved listing and read the decision-critical missing information with the questions it implies, the mandatory conditions, the explicitly stated extra costs and the red flags — every positive finding with a verbatim excerpt of the listing, missing items flagged without one — and the card shows it as audited.** — Archived 2026-10-09 → `context/archive/2026-10-06-grounded-listing-audit/`. Lesson: —.
- **S-08: user can open a Google Maps search for a listing's location, generated from its scraped location text, in one click.** — Archived 2026-10-09 → `context/archive/2026-10-09-location-map-link/`. Lesson: —.
- **S-09: user can re-fetch a listing's data on demand, finds every note exactly as its author left it, and sees an existing audit marked stale — and is prompted to re-run it — when the listing's data or the team's criteria changed.** — Archived 2026-10-11 → `context/archive/2026-10-09-refetch-and-stale-audit/`. Lesson: —.
- **S-10: user can archive a listing to hide it from the board, sees who archived it and a visible "recently archived" section or counter, and can view and restore archived listings.** — Archived 2026-10-11 → `context/archive/2026-10-11-archive-and-restore/`. Lesson: —.
- **S-11: user can delete a saved listing — taking every member's notes on it with it — and can delete their own notes. An archived listing can be deleted as well as a live one (user's decision, 2026-10-11, in S-10's plan).** — Archived 2026-10-11 → `context/archive/2026-10-11-delete-offer-and-notes/`. Lesson: —.
- **Photo viewer inside the card (lightbox)** — taken off `## Parked` 2026-10-17: browsing twenty photos per listing became a real friction, the condition the parking named. Delivered outside M-1 by the change `offer-photo-lightbox` (sharp gallery thumbnails from the `medium`/`large` variants and an in-card lightbox with keyboard navigation, a counter and focus return). Archived 2026-10-17 → `context/archive/2026-10-17-offer-photo-lightbox/`. Lesson: —.
- **Extraction-service fallback for ingestion (Apify)** — taken off `## Parked` 2026-10-17 by the user's decision; the paid spike of that day chose the route. Delivered outside M-1 by the change `otodom-apify-fallback`: when otodom.pl refuses the direct fetch, a member's add or re-fetch falls back to one `apify/cheerio-scraper` run with our own `pageFunction` through the residential proxy, returning otodom's own `ad` so every ingestion guardrail applies unchanged; the owner switches the mode in Supabase Studio (`direct_with_fallback`, `apify_only`, or `direct_only` as the kill switch, in `public.ingestion_settings`), and `/criteria` shows it. Verified in production 2026-10-17. Route, request and failure modes: `context/foundation/ingestion/otodom_apify.md`. Archived 2026-10-17 → `context/archive/2026-10-17-otodom-apify-fallback/`. Lesson: —.
- **Commute times to the team's points (FR-016)** — added to the PRD 2026-10-26 by the user's decision, outside M-1, which had parked commute routing. Delivered outside M-1 by the change `commute-times`: the team keeps up to six named points on `/criteria`, and on an offer's card a member deliberately presses „Policz dojazdy” to get the time and distance to every point by public transport (the next working day, 08:00 Warsaw time) and by car, as a table with one Google map. Nothing Google returns is stored, so a reload shows the idle section again; the application caps Routes at 300 calls a Europe/Warsaw day (`public.commute_usage`), since Google's quotas cannot be lowered on this account. Verified in production 2026-10-27. Setup and failures: `context/foundation/user-manual/set-up-google-maps.md`, `context/foundation/deployment-runbook.md`. Archived 2026-10-27 → `context/archive/2026-10-26-commute-times/`. Lesson: —.
