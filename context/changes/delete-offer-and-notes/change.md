---
change_id: delete-offer-and-notes
title: Delete a listing and own notes
status: implementing
created: 2026-10-11
updated: 2026-10-11
archived_at: null
---

## Notes

Roadmap slice **S-11** (`context/foundation/roadmap.md`), Stream B "Team notes" (`S-05` → `S-11`). Backlog issue: [#22](https://github.com/Sigaretif/Vetpad/issues/22).

- **Outcome:** user can delete a saved listing — taking every member's notes on it with it — and can delete their own notes. An archived listing can be deleted as well as a live one (user's decision, 2026-10-11, in S-10's plan).
- **PRD refs:** FR-015 — "Member can delete a saved offer and their own notes. Priority: must-have"
- **Prerequisites:** S-05 (done)
- **Parallel with:** S-03, S-04, S-06, S-07, S-08, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The cascade to other members' notes is a trade the PRD accepted; deleting another member's note on its own is not, so the delete rule for notes stays authorship-scoped.

### Backlog handoff (from the roadmap)

- The database half is already in place: `offers_delete_authenticated` (`supabase/migrations/20260922202756_create_offers.sql`), `offer_notes_delete_own` and `offer_id … on delete cascade` (`supabase/migrations/20260926202537_create_offer_notes.sql`). Notes are read through `src/lib/notes.ts`.
- S-09 done: `src/pages/api/offer-refetch.ts` is the reference for a route that writes one `public.offers` row judged by its row count, and it already reports an offer deleted in the meantime on `/dashboard`.
- S-10 done: `src/pages/api/offer-archive.ts` is the neighbouring route that writes one row of the same table, with an `intent` field and a write filtered by the state it expects to leave, and it too reports an offer deleted in the meantime on `/dashboard`.
- An archived offer is deleted the same way as a live one, so the delete action also stands where S-10 shows an archived offer: its card (`src/components/offers/OfferCard.astro`, the block `#archiwum`) and its row on `/offers/archive` (`src/components/offers/OfferArchiveItem.astro`, where the title's link is stretched over the row and a button stands above that layer).
- A deleted offer leaves the board, the section under it (`src/components/offers/RecentlyArchived.astro`) and the archive's counter alike, since all three read `public.offers`.
- New states get their sections on `/dev/offer-card`, `/dev/board` and `/dev/forms`.
- Next step per the roadmap: `/10x-plan delete-offer-and-notes`.
