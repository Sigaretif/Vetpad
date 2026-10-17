---
change_id: otodom-apify-fallback
title: Apify ingestion fallback for otodom.pl with a switchable ingestion mode
status: implementing
created: 2026-10-17
updated: 2026-10-17
archived_at: null
---

## Notes

Add Apify (trev0n/otodom-scraper, verified in context/foundation/ingestion/otodom_apify.md) as an ingestion fallback for otodom.pl, taking "Extraction-service fallback for ingestion (Apify)" off ## Parked in context/foundation/roadmap.md by the user's decision of 2026-10-17. Both the add path (FR-004) and the re-fetch path (FR-009) go through it. The ingestion mode is switchable without an admin panel: a singleton row in Supabase that members can read but not write (changed only by the owner in Supabase Studio), with modes direct-with-Apify-fallback, Apify-only, and direct-only as a cost kill switch. APIFY_TOKEN follows the zero-config pattern: no token means direct-only plus a banner entry. The change must also deliver a click-by-click manual prerequisites section (Apify account, scoped token, spending cap, where the token goes) and update the CLAUDE.md rule that currently says the fallback replaces the scraper rather than sitting beside it, together with the code-reviewer criteria. The change will be implemented unattended with /10x-goal-implement, so every step needing a secret, a paid call or a db push must be a Manual row.
