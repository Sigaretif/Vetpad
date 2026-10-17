import { describe, expect, it } from "vitest";
import {
  APIFY_CLIENT_DEADLINE_MS,
  APIFY_RUN_TIMEOUT_S,
  DIRECT_BEFORE_FALLBACK_MS,
  INGEST_ACTION_BUDGET_MS,
} from "@/lib/otodom/deadlines";

// Expected values are written by hand from context/changes/otodom-apify-fallback/plan.md (Phase 2
// §2): the values and the order the deadlines must keep. The order is what a change must not
// break; the values pin the plan's numbers, so a change of one is a deliberate edit here too.

describe("ingestion deadlines", () => {
  it("hold the values the plan sets", () => {
    expect(INGEST_ACTION_BUDGET_MS).toBe(60_000);
    expect(DIRECT_BEFORE_FALLBACK_MS).toBe(20_000);
    expect(APIFY_CLIENT_DEADLINE_MS).toBe(40_000);
    expect(APIFY_RUN_TIMEOUT_S).toBe(30);
  });

  it("let Apify end its own run before the Worker stops waiting for it", () => {
    expect(APIFY_RUN_TIMEOUT_S * 1000).toBeLessThan(APIFY_CLIENT_DEADLINE_MS);
  });

  it("fit a direct fetch cut short and the Apify run after it into the action's budget", () => {
    expect(DIRECT_BEFORE_FALLBACK_MS + APIFY_CLIENT_DEADLINE_MS).toBeLessThanOrEqual(INGEST_ACTION_BUDGET_MS);
  });

  it("never give a fetch without a fallback less time than the 45 seconds it had before", () => {
    expect(INGEST_ACTION_BUDGET_MS).toBeGreaterThanOrEqual(45_000);
  });
});
