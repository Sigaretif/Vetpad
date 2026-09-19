# Ingestion notes

Per-portal reference notes on how listing data is fetched: request shapes, field
mappings, and the `robots.txt` boundaries each portal publishes. The two direct-fetch
documents were verified live against production on 2026-09-16; `otodom_apify.md` on
2026-09-19.

| File                 | Portal    | Status in Vetpad                                                       |
| -------------------- | --------- | ---------------------------------------------------------------------- |
| `otodom_fetching.md` | otodom.pl | the MVP's only source (`@context/foundation/prd.md`, FR-004)           |
| `otodom_apify.md`    | otodom.pl | the fallback if fetching otodom directly from the Worker stops working |
| `olx_fetching.md`    | olx.pl    | post-MVP; the first source added after v1 (Non-Goals)                  |

## Read these for the mechanics, not the architecture

The direct-fetch documents were written for a different product — a daily cron job
on a VM sending email digests. That deployment is an explicit Vetpad Non-Goal: there are
no scheduled jobs, no background re-fetching and no notifications, and every
fetch is a deliberate manual action. Take the request shapes, the selectors and
the field mappings; leave the scheduling, the delivery and the VM assumptions.

The runtime constraints that do apply are in `@CLAUDE.md` under
`### Cloudflare Workers runtime`. Section 9.1 of `otodom_fetching.md` is the
exception to the "mechanics, not architecture" rule above: it is specific to this
project's runtime and records what Cloudflare's platform does and does not allow
a scraper to do — including the one thing local workerd cannot show you, that a
Worker egresses from a Cloudflare datacenter range.

## Update convention

Edit in place when a portal changes shape, and re-date the verification line at
the top of the file you touched. These are living notes, not a changelog.
