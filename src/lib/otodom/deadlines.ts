// The time limits of one ingestion action — adding an offer (FR-004) or re-fetching it (FR-009) —
// and of each way it may fetch the listing: directly from otodom.pl, or through the extraction
// service (Apify) when the direct fetch was refused.
//
// No imports at all: the request module (`./apify-request.ts`) and scripts/otodom-inspect.mjs load
// this file under Node's type stripping, so the chain of imports ends here.
//
// The order is what matters, and tests/lib/otodom/deadlines.test.ts pins it:
// - `APIFY_RUN_TIMEOUT_S * 1000 < APIFY_CLIENT_DEADLINE_MS` — Apify ends its own run, and says so,
//   before the Worker stops waiting for the answer;
// - `DIRECT_BEFORE_FALLBACK_MS + APIFY_CLIENT_DEADLINE_MS <= INGEST_ACTION_BUDGET_MS` — a direct
//   fetch cut short and the Apify run after it fit together in the action's budget;
// - `INGEST_ACTION_BUDGET_MS >= 45_000` — the deadline of a fetch that has no fallback after it is
//   never less tolerant than the 45 seconds it was before the fallback existed.

/** The whole action's budget, and the deadline of a direct fetch that no Apify run can follow. */
export const INGEST_ACTION_BUDGET_MS = 60_000;

/** The deadline of a direct fetch that an Apify run may follow. */
export const DIRECT_BEFORE_FALLBACK_MS = 20_000;

/** How long the Worker waits for Apify's answer to one run. */
export const APIFY_CLIENT_DEADLINE_MS = 40_000;

/** How long Apify lets the run take (`timeout`, in seconds, a parameter of the run). */
export const APIFY_RUN_TIMEOUT_S = 30;
