# Commute times (FR-016) — Plan Brief

> Full plan: `context/changes/commute-times/plan.md`
> Research: `context/changes/commute-times/research.md`

## What & Why

The team keeps up to six named points (e.g. „Praca Wiktor”, „Dom rodzinny”) on `/criteria`. On an offer's card, a member presses „Policz dojazdy” and sees the time and distance from the flat to every point, by public transport and by car, in a table and on one Google map. Each press is a fresh calculation, and nothing Google returns is stored. The reason is that Google Maps Platform's EEA terms do not permit caching times, distances or polylines, and a recalculation costs next to nothing.

## Starting Point

- The offer already stores its coordinates and its location label and street, but nothing reads the coordinates.
- No table holds places.
- `src/pages/api/audits.ts` is the reference for a paid, fetch-driven action. Apify is the reference for an optional, server-only integration.

## Desired End State

- **`/criteria`** has a „Punkty dojazdu” section with full CRUD for every member. Deletion goes through a confirmation dialog, and there is a cap of six.
- **The offer card** has a „Dojazdy” section. It offers the calculation only when everything free has passed: the offer is live, it has a route start, the points are readable and there is at least one, and the key is set. After a press it shows:
  - the table with a Komunikacja/Samochód switch;
  - the departure day;
  - the start used, with the „szacunek okolicy” sentence;
  - Google attribution;
  - the map, loaded only then.
- **A reload** returns the section to idle.
- **With no keys**, everything renders, and the banner names both Google keys.

## Key Decisions Made

| Decision                  | Choice                                                                                                                                                                                                                        | Why (1 sentence)                                                                | Source                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- |
| Storage of results (OQ 2) | Nothing stored, neither in the DB nor in the browser; visible until reload                                                                                                                                                    | EEA SST §20.2 / ToS §3.3.2(b) forbid it, and re-running is cheap                | User 2026-10-26, PRD          |
| Staleness (OQ 4)          | None, because nothing is stored; `criteria_revision` untouched                                                                                                                                                                | No stored result means nothing can go stale                                     | User 2026-10-26, PRD          |
| Route start (OQ 3)        | otodom coordinates, else label + street as `waypoint.address`, else unavailable                                                                                                                                               | Coordinates are the listing's data, not Google's                                | User 2026-10-26, PRD          |
| Points table              | Name + address, four policies on `auth.uid() is not null`, own module, unreadable by the audit (ESLint)                                                                                                                       | Members' personal data; flat roles                                              | User 2026-10-26, Research     |
| Cap on points             | At most 6: DB trigger `VP002` + route check                                                                                                                                                                                   | 12 calls per press, 6 distinguishable colours, well within 50 subrequests       | Plan                          |
| Routing call              | `computeRoutes` per point × mode (TRANSIT, DRIVE without `routingPreference`), Essentials SKU, no retry, no Route Matrix                                                                                                      | Matrix returns no polyline                                                      | User 2026-10-26, Research     |
| TRANSIT departure         | 08:00 Warsaw on the first Mon–Fri after today, whatever the hour; holidays not skipped                                                                                                                                        | A simple pure function; the date shows in the table                             | Plan                          |
| Partial failure           | „brak trasy” per point; 400 in both modes → row „Google odrzucił adres…”; 400 in one mode, every point 400 in one mode, or any other error → whole failure                                                                    | A mistyped address does not block the team; our own bad request fails loudly    | User 2026-10-26               |
| Archived offer            | Calculation refused (`offer_archived`) before the key check                                                                                                                                                                   | Like the audit: paid, and the offer is set aside                                | User 2026-10-26, PRD FR-014   |
| Double press              | Button disabled while running; no DB lock                                                                                                                                                                                     | A cheap, stateless call                                                         | User 2026-10-26               |
| Daily cap                 | 300 Routes calls per Warsaw day in `public.commute_usage`, written only by `reserve_commute_calls` (security definer, atomic, `VP003`); reserved before Google, never refunded; a counter error refuses (`usage_unavailable`) | Google's daily quotas cannot be lowered on this account; 31 × 300 < 10 000 free | User 2026-10-26 (GCP console) |
| Keys                      | `GOOGLE_MAPS_SERVER_KEY` and `GOOGLE_MAPS_BROWSER_KEY`, both server/secret optional, 5 places, never CI; the browser key goes to the map island as a prop — a narrow exception written into CLAUDE.md                         | Runtime read, no rebuild to rotate                                              | User 2026-10-26               |
| Map                       | `@vis.gl/react-google-maps` (≥1.8 `Polyline encodedPath`), plain `Marker`, dark scheme, mounted only after a result, never in `preview`                                                                                       | No map bill on opening a card or a `/dev` page                                  | User 2026-10-26, Plan         |
| Route colours             | `--route-1..6` role tokens, converted to hex by reading back a canvas pixel                                                                                                                                                   | `strokeColor` accepts hex only                                                  | Plan                          |
| Visual gate               | None; kitchen-sink entries still added                                                                                                                                                                                        | User's choice                                                                   | User 2026-10-26               |

## Scope

**In scope:**

- the points table, its read and its CRUD route and island;
- the Routes client and the pure rules (departure, origin, outcome);
- `POST /api/commute` (NDJSON);
- the card section, the map island and the colour tokens;
- the ESLint guards, log fields, stub, tests, smoke and `/dev` entries;
- CLAUDE.md, README, `.env.example`, the runbook, the user manual and the reviewer criteria;
- the user's paid eval and one real calculation.

**Out of scope:**

- any stored Google output;
- the Geocoding API and Route Matrix;
- traffic-aware routing;
- route steps or descriptions;
- commute data on the board;
- a holiday calendar;
- a point author column;
- CSP;
- Playwright;
- any Google key in CI.

## Architecture / Approach

`/criteria` is the place where points are kept: a form island posts to `api/commute-points`, which writes `public.commute_points` under RLS.

On the card, `CommuteRunner` POSTs `offer_id` to `api/commute`. The route works through these steps:

1. the free refusals (offer, archive, start, points);
2. the key check (`createRoutesClient`);
3. the reservation of 2N calls on the day's counter (`daily_limit`, `usage_unavailable`);
4. a `started` log entry;
5. 2N parallel `computeRoutes` calls, with 10 s deadlines and no retry;
6. `decideCommuteOutcome`;
7. one NDJSON `done`/`failed` line and one log entry.

The island then renders the table and mounts `CommuteMap`, which receives the browser key as a prop from `[id].astro`.

Addresses go only to Routes. They never reach the log, the browser or the audit.

## Phases at a Glance

| Phase                  | What it delivers                                                                                                           | Key risk                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Team data           | Points table + RLS + cap, CRUD on `/criteria`, audit lint, smoke RLS; daily counter + reservation function, `test:db`      | Cap race — advisory lock in the trigger; counter race — one atomic upsert   |
| 2. Google offline      | Keys/zero-config, Routes client, departure/origin/outcome rules, stub, lint, log fields                                    | An undocumented 400 vs 200 for a bad address — both handled                 |
| 3. `POST /api/commute` | The paid route with the reservation before Google, route tests with Google and reservation counts, privacy canaries, smoke | Ordering of free refusals, key check and reservation                        |
| 4. Card section        | Runner + table + switch, one map after a result, route tokens, `/dev/offer-card`                                           | The map script loading in `/dev`, before a press, or again on a mode switch |
| 5. Rules & docs        | CLAUDE.md exception and rules, reviewer criteria (preflight), README/runbook/manual                                        | Reviewer drift; paid eval run by the user                                   |
| 6. Manual              | Google Cloud per the manual, `db push` on consent, one real press                                                          | Billing surprises — capped by the app's daily counter and the free trial    |

**Prerequisites:** the PRD decisions recorded (done 2026-10-26); local Supabase for smoke. For Phase 6, Google Cloud is set up per `context/foundation/user-manual/set-up-google-maps.md`.
**Estimated effort:** ~4–5 sessions across 5 implementation phases + one manual phase.

## Open Risks & Assumptions

- Whether Routes answers an unreadable address with 400 or with 200 and empty `routes` is undocumented. Both are handled, and Phase 6 shows the real one only if the user picks such a point.
- `google.maps.Marker` is deprecated (no removal date, ≥12 months' notice). Moving to `AdvancedMarker` would need a Map ID.
- With a single point whose address Google rejects, the whole-failure sentence shows instead of the per-point row. This precedence is deliberate.
- The browser key sits in the card's HTML for any signed-in member. Its protection is the referrer restriction and the API restriction; the app's counter does not cover map loads made with a copied key outside the app, and Google's quotas cannot be lowered.
- A member can call `reserve_commute_calls` through the Data API and spend the day's allowance without calculating. It cannot reset or raise it; accepted, since the same member can press the button.
- `context/foundation/roadmap.md` still lists "Map plotting or commute-time routing" as parked. This plan does not edit the roadmap.

## Success Criteria (Summary)

- A member keeps the team's points on `/criteria`, and on any live offer gets times and distances for both modes plus a map in one deliberate press, with every limitation (area estimate, departure day, no route, rejected address) stated in the card.
- With no keys, nothing breaks and the banner says why. No test, smoke step or `/dev` page ever reaches Google.
- Nothing Google returned survives a reload.
