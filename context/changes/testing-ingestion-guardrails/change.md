---
change_id: testing-ingestion-guardrails
title: Test runner and ingestion guardrails (test-plan rollout Phase 1)
status: implemented
created: 2026-09-30
updated: 2026-09-30
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Test runner and ingestion guardrails".
Risks covered: #1 (ingestion saves a false or incomplete offer), #6 storage half (seller phone/name reaches the database), #7 (stored non-https URL renders into href/src). Test types planned: unit on recorded otodom fixtures, Astro Container API render; bootstrap Vitest and wire npm test into CI (vitest needs the user's explicit go-ahead per CLAUDE.md).
Risk response intent:
- #1: on recorded payloads, an absent/empty/unparseable/"0" numeric attribute becomes unknown, a rental or non-flat is refused naming which check failed, and a page without usable listing data is a fetch error with nothing persisted — oracle is the PRD and ingestion/otodom_fetching.md §7, never the mapper's current output.
- #6 (storage): the persisted row contains no seller phone or name even when the fixture carries them — assert absence of forbidden fields, not only presence of expected ones.
- #7: a non-https URL from a database row never reaches href or src; a null result renders no link or image — test the invalid inputs, not only a valid URL.
