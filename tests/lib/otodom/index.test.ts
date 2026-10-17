import { describe, expect, it } from "vitest";
import { FALLBACK_TRIGGERS, chooseOutcome } from "@/lib/otodom";
import type { ApifyLegResult } from "@/lib/otodom/apify";
import type { FetchOfferResult } from "@/lib/otodom/types";
import { flatSaleAd } from "../../fixtures/otodom";

// Expected outcomes are written by hand from context/changes/otodom-apify-fallback/plan.md (Phase 4
// §2): an Apify leg that reached otodom.pl knows about the listing and its reason wins; one that
// did not knows nothing, so the direct reason wins — or `extraction_failed` when no direct leg ran
// (`apify_only`); a page without data on both legs keeps `data_missing` with `both_sources`. Each
// case states the reason the member reads, `source` and `fallbackReason`. Pure: no network.

const DIRECT_403: FetchOfferResult = {
  ok: false,
  reason: "http_denied",
  status: 403,
  evidence: { contentType: "text/html" },
};
const DIRECT_NO_DATA: FetchOfferResult = {
  ok: false,
  reason: "data_missing",
  status: 200,
  evidence: { markerPresent: false },
};

const APIFY_SUCCESS: ApifyLegResult = { ok: true, ad: flatSaleAd(), reachedOtodom: true, apifyStatus: 201 };
const APIFY_GONE: ApifyLegResult = {
  ok: false,
  reason: "not_found",
  status: 410,
  evidence: { source: "apify", landedHost: "www.otodom.pl", landedListing: "IDKANAR1" },
  reachedOtodom: true,
  apifyStatus: 201,
};
const APIFY_RUN_ERROR: ApifyLegResult = {
  ok: false,
  reason: "http_denied",
  evidence: { source: "apify" },
  reachedOtodom: true,
  apifyFailure: "run_error",
  apifyStatus: 201,
};
const APIFY_NO_DATA: ApifyLegResult = {
  ok: false,
  reason: "data_missing",
  status: 200,
  evidence: { source: "apify", markerPresent: false },
  reachedOtodom: true,
  apifyStatus: 201,
};
const APIFY_REFUSED: ApifyLegResult = {
  ok: false,
  reachedOtodom: false,
  apifyFailure: "http",
  apifyStatus: 401,
  apifyErrorType: "user-or-token-not-found",
};

describe("FALLBACK_TRIGGERS", () => {
  it("holds the direct reasons after which one Apify run follows, and no other", () => {
    expect([...FALLBACK_TRIGGERS].sort()).toStrictEqual(
      ["challenged", "data_missing", "http_denied", "network", "timeout"].sort(),
    );
  });
});

describe("chooseOutcome", () => {
  it("lets an Apify leg that read the listing win after a refused direct fetch", () => {
    expect(chooseOutcome(DIRECT_403, APIFY_SUCCESS)).toStrictEqual({
      fetched: { ok: true, ad: flatSaleAd() },
      source: "apify",
      fallbackReason: "http_denied",
    });
  });

  it("lets an Apify leg's own reason about the listing win: the member reads not-found", () => {
    expect(chooseOutcome(DIRECT_403, APIFY_GONE)).toStrictEqual({
      fetched: {
        ok: false,
        reason: "not_found",
        status: 410,
        evidence: { source: "apify", landedHost: "www.otodom.pl", landedListing: "IDKANAR1" },
      },
      source: "apify",
      fallbackReason: "http_denied",
    });
  });

  it("reads a run that reached otodom and could not read the page as a refusal, from Apify", () => {
    expect(chooseOutcome(DIRECT_403, APIFY_RUN_ERROR)).toStrictEqual({
      fetched: { ok: false, reason: "http_denied", evidence: { source: "apify" } },
      source: "apify",
      fallbackReason: "http_denied",
    });
  });

  it("keeps data_missing from both legs, and says so", () => {
    expect(chooseOutcome(DIRECT_NO_DATA, APIFY_NO_DATA)).toStrictEqual({
      fetched: {
        ok: false,
        reason: "data_missing",
        status: 200,
        detail: "both_sources",
        evidence: { source: "apify", markerPresent: false },
      },
      source: "apify",
      fallbackReason: "data_missing",
    });
  });

  // The control for the case above: data_missing from Apify alone is not both sources.
  it("does not say both sources when only the Apify leg found no data", () => {
    expect(chooseOutcome(DIRECT_403, APIFY_NO_DATA)).toStrictEqual({
      fetched: { ok: false, reason: "data_missing", status: 200, evidence: { source: "apify", markerPresent: false } },
      source: "apify",
      fallbackReason: "http_denied",
    });
  });

  it("lets the direct reason win when the Apify leg never reached otodom", () => {
    expect(chooseOutcome(DIRECT_403, APIFY_REFUSED)).toStrictEqual({
      fetched: DIRECT_403,
      source: "direct",
      fallbackReason: "http_denied",
    });
  });

  it("reads extraction_failed in apify_only when the Apify leg never reached otodom", () => {
    expect(chooseOutcome(null, APIFY_REFUSED)).toStrictEqual({
      fetched: { ok: false, reason: "extraction_failed", evidence: { source: "apify" } },
      source: "apify",
    });
  });

  it("gives no fallback reason in apify_only, where no direct leg ran", () => {
    expect(chooseOutcome(null, APIFY_SUCCESS)).toStrictEqual({
      fetched: { ok: true, ad: flatSaleAd() },
      source: "apify",
    });
  });
});
