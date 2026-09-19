# Ingestion notes

Per-portal reference notes on how listing data is fetched: request shapes, field
mappings, and the `robots.txt` boundaries each portal publishes. Verified live
against production on 2026-09-16.

| File                 | Portal    | Status in Vetpad                                             |
| -------------------- | --------- | ------------------------------------------------------------ |
| `otodom_fetching.md` | otodom.pl | the MVP's only source (`@context/foundation/prd.md`, FR-004) |
| `olx_fetching.md`    | olx.pl    | post-MVP; the first source added after v1 (Non-Goals)        |

## Read these for the mechanics, not the architecture

Both documents were written for a different product — a daily cron job on a VM
sending email digests. That deployment is an explicit Vetpad Non-Goal: there are
no scheduled jobs, no background re-fetching and no notifications, and every
fetch is a deliberate manual action. Take the request shapes, the selectors and
the field mappings; leave the scheduling, the delivery and the VM assumptions.

The runtime constraints that do apply are in `@CLAUDE.md` under
`### Cloudflare Workers runtime`.

## Update convention

Edit in place when a portal changes shape, and re-date the verification line at
the top of the file you touched. These are living notes, not a changelog.
