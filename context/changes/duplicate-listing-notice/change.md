---
change_id: duplicate-listing-notice
title: Duplicate listing notice — paste a saved URL and land on the existing card
status: impl_reviewed
created: 2026-09-26
updated: 2026-09-26
archived_at: null
---

## Notes

Roadmap slice S-07 (`context/foundation/roadmap.md`), PRD ref FR-005, prerequisite S-02 (done).

Outcome: user can paste a URL that is already saved — with or without tracking parameters — and lands on the existing card with a notice naming the member who saved it, instead of creating a second entry.

Open unknown from the roadmap: FR-005's offer of a manual re-fetch on the duplicate notice needs the re-fetch from S-09; whichever lands second connects them (Owner: team, non-blocking).

Wording change approved by the user during Phase 2 (2026-09-26): a deleted author reads „osoba z usuniętym kontem” („…zapisana przez osobę z usuniętym kontem…”, „Zapisane przez osobę z usuniętym kontem · <data>”), not „konto usunięte”. The PRD, `lessons.md`, CLAUDE.md and the code carry the new wording; `plan.md`, `plan-brief.md` and the comment in the already-applied `20260923153747_offers_keep_after_author_deleted.sql` keep the old one as history.
