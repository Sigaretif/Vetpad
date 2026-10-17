import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApifyLeg, type ApifyLeg, type ApifyLegResult } from "@/lib/otodom/apify";
import { APIFY_PAGE_FUNCTION } from "@/lib/otodom/apify-request";
import { mapAdToOffer } from "@/lib/otodom/map";
import type { FetchEvidence, FetchFailureReason } from "@/lib/otodom/types";
import {
  APIFY_MESSAGE_CANARY,
  APIFY_TEST_TOKEN,
  RESULTS_LANDING,
  apifyCalls,
  apifyDataset,
  apifyEmpty,
  apifyError,
  apifyExpiredItem,
  apifyGoneItem,
  apifyItem,
  apifyNoMarkerItem,
  apifyNoPagePropsItem,
  apifyParseErrorItem,
  apifyRentalItem,
  apifyResultsItem,
  apifyRunError,
  apifyRunTimeout,
  apifySilence,
  isApifyRequest,
  recordApifyHeaders,
} from "../../fixtures/apify";
import {
  restoreFetch,
  stubFetch,
  unreadableResponse,
  type FetchContext,
  type RecordedRequest,
} from "../../fixtures/http";
import { FLAT_SALE_URL, SELLER_CANARIES, flatSaleAd } from "../../fixtures/otodom";

// The token is switched per test: on by default here, off where the zero-config state is the claim.
const env = vi.hoisted(() => ({ token: true }));

vi.mock("astro:env/server", async () => {
  const { APIFY_TEST_TOKEN: token } = await import("../../fixtures/apify");
  return {
    SUPABASE_URL: undefined,
    SUPABASE_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    get APIFY_TOKEN() {
      return env.token ? token : undefined;
    },
    getSecret: () => undefined,
  };
});

// Expected results are written by hand from context/changes/otodom-apify-fallback/plan.md (Phase 2
// §4–§5: one request with the token in a Bearer header, no retry, an item classified by the direct
// fetch's own checks with `source: "apify"` on its evidence, every other end named by our own
// reason) and spike-apify.md (the `#error` item is a page Apify could not read: a refusal). The
// network is stubbed at the HTTP edge: nothing here reaches Apify or otodom.pl, and every case
// states how many requests reached Apify — one, never a retry.

beforeEach(() => {
  env.token = true;
});

afterEach(restoreFetch);

/** Answers every Apify run with `answer`, and records the headers each run was sent with. */
function serve(answer: (request: RecordedRequest, context: FetchContext) => Response | Promise<Response>) {
  const headers: Headers[] = [];
  const record = recordApifyHeaders(headers);
  const stub = stubFetch((request, context) => {
    if (!isApifyRequest(request)) return undefined;
    record(request, context);
    return answer(request, context);
  });
  return { stub, headers };
}

function leg(): ApifyLeg {
  const built = createApifyLeg();
  if (built === null) throw new Error("expected a leg: the token is on");
  return built;
}

async function fetchAd(signal: AbortSignal = new AbortController().signal): Promise<ApifyLegResult> {
  return leg().fetchAd(FLAT_SALE_URL, signal);
}

/** Where `FLAT_SALE_URL` landed, as the classifier names an offer page: by host and token. */
const LANDED_ON_OFFER: FetchEvidence = { landedHost: "www.otodom.pl", landedListing: "IDKANAR1" };

describe("createApifyLeg", () => {
  it("gives no leg without a token, and nothing is sent", () => {
    env.token = false;
    const { stub } = serve(() => apifyEmpty());

    expect(createApifyLeg()).toBeNull();
    expect(apifyCalls(stub.requests)).toHaveLength(0);
  });

  it("builds a fresh leg on every call", () => {
    expect(createApifyLeg()).not.toBe(createApifyLeg());
  });
});

describe("ApifyLeg.fetchAd: the one request", () => {
  it("sends one POST with the token in a Bearer header and nowhere else", async () => {
    const { stub, headers } = serve(() => apifyDataset([apifyItem()]));
    await fetchAd();

    expect(stub.requests).toHaveLength(1);
    expect(apifyCalls(stub.requests)).toHaveLength(1);
    const [request] = stub.requests;
    expect(request.method).toBe("POST");
    expect(headers).toHaveLength(1);
    expect(headers[0].get("authorization")).toBe(`Bearer ${APIFY_TEST_TOKEN}`);
    expect(headers[0].get("content-type")).toBe("application/json");
    expect(request.url).not.toContain(APIFY_TEST_TOKEN);
    expect(request.body).not.toContain(APIFY_TEST_TOKEN);
  });

  it("carries the run's parameters, the proxy, one request with one retry, and the fixed pageFunction", async () => {
    const { stub } = serve(() => apifyDataset([apifyItem()]));
    await fetchAd();

    const url = new URL(stub.requests[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api.apify.com/v2/acts/YrQuEkowkNCLdk4j2/run-sync-get-dataset-items",
    );
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      maxTotalChargeUsd: "0.05",
      timeout: "30",
      memory: "1024",
    });
    expect(JSON.parse(stub.requests[0].body ?? "null")).toStrictEqual({
      startUrls: [{ url: FLAT_SALE_URL }],
      pageFunction: APIFY_PAGE_FUNCTION,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "PL" },
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 1,
      maxConcurrency: 1,
    });
  });
});

describe("ApifyLeg.fetchAd: an item is classified as a direct answer would be", () => {
  it("returns a readable page's ad unchanged", async () => {
    const { stub } = serve(() => apifyDataset([apifyItem()]));
    expect(await fetchAd()).toStrictEqual({ ok: true, ad: flatSaleAd(), reachedOtodom: true, apifyStatus: 201 });
    expect(apifyCalls(stub.requests)).toHaveLength(1);
  });

  // The ad the fixture's item carries still holds the seller's data, as if Apify's whitelist had let
  // it through: the Worker's own mapper is what keeps it out of the row.
  it("hands the mapper an ad whose row keeps no seller phone, name or account id outside the listing's text", async () => {
    serve(() => apifyDataset([apifyItem()]));
    const result = await fetchAd();
    if (!result.ok) throw new Error(`expected an ad, got ${JSON.stringify(result)}`);

    const mapped = mapAdToOffer(result.ad);
    if (!mapped.ok) throw new Error(`expected an offer, got ${mapped.reason}`);
    const { description: _description, raw, ...columns } = mapped.offer;
    const { description: _rawDescription, ...rawRest } = raw;
    const serialised = JSON.stringify({ ...columns, raw: rawRest });
    for (const canary of SELLER_CANARIES) {
      expect(serialised).not.toContain(canary);
    }
    // The control: what the leg handed over did carry them.
    const { description: _adDescription, ...adRest } = result.ad as Record<string, unknown>;
    for (const canary of SELLER_CANARIES) {
      expect(JSON.stringify(adRest)).toContain(canary);
    }
  });

  it("passes a rental on whole: the mapper's gate refuses it, as after a direct fetch", async () => {
    serve(() => apifyDataset([apifyRentalItem()]));
    const result = await fetchAd();
    if (!result.ok) throw new Error(`expected an ad, got ${JSON.stringify(result)}`);

    expect(result).toMatchObject({ reachedOtodom: true, apifyStatus: 201 });
    expect(mapAdToOffer(result.ad)).toMatchObject({ ok: false, reason: "not_for_sale" });
  });

  const ANSWERS: [string, () => Record<string, unknown>, FetchFailureReason, number, FetchEvidence, string?][] = [
    ["otodom's 410", apifyGoneItem, "not_found", 410, LANDED_ON_OFFER],
    ["otodom's 404", () => apifyItem(null, { status: 404 }), "not_found", 404, LANDED_ON_OFFER],
    ["otodom's 403", () => apifyItem(null, { status: 403 }), "http_denied", 403, LANDED_ON_OFFER],
    ["otodom's 429", () => apifyItem(null, { status: 429 }), "http_denied", 429, LANDED_ON_OFFER],
    ["otodom's 503", () => apifyItem(null, { status: 503 }), "upstream_error", 503, LANDED_ON_OFFER],
    [
      "a landing off otodom",
      () => apifyItem(flatSaleAd(), { loadedUrl: "https://consent.example/zgoda/start?next=kanarek" }),
      "http_denied",
      200,
      { landedHost: "consent.example", landedPath: "/zgoda/start" },
    ],
    [
      "a landing on the results page",
      apifyResultsItem,
      "not_found",
      200,
      { landedHost: "www.otodom.pl", landedPath: new URL(RESULTS_LANDING).pathname },
    ],
    [
      "a landing on another offer",
      () => apifyItem(flatSaleAd(), { loadedUrl: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2" }),
      "unexpected_landing",
      200,
      { landedHost: "www.otodom.pl", landedListing: "IDKANAR2" },
    ],
    [
      "a landing elsewhere on otodom",
      () => apifyItem(flatSaleAd(), { loadedUrl: "https://www.otodom.pl/pl/firmy/biura-nieruchomosci" }),
      "unexpected_landing",
      200,
      { landedHost: "www.otodom.pl", landedPath: "/pl/firmy/biura-nieruchomosci" },
    ],
    ["an ad flagged expired", apifyExpiredItem, "expired", 200, { ...LANDED_ON_OFFER, markerPresent: true }],
    [
      "pageProps flagged expired, without an ad",
      () => apifyItem(null, { pagePropsExpired: true }),
      "expired",
      200,
      { ...LANDED_ON_OFFER, markerPresent: true },
    ],
    ["a page without the marker", apifyNoMarkerItem, "data_missing", 200, { ...LANDED_ON_OFFER, markerPresent: false }],
    [
      "a marker that did not parse",
      apifyParseErrorItem,
      "shape_changed",
      200,
      { ...LANDED_ON_OFFER, markerPresent: true },
      "next_data_unparseable",
    ],
    [
      "data without pageProps",
      apifyNoPagePropsItem,
      "shape_changed",
      200,
      { ...LANDED_ON_OFFER, markerPresent: true },
      "page_props_missing",
    ],
    [
      "pageProps without an ad",
      () => apifyItem(null),
      "shape_changed",
      200,
      { ...LANDED_ON_OFFER, markerPresent: true },
      "ad_missing",
    ],
  ];

  it.each(ANSWERS)("reads %s as %s", async (_label, item, reason, status, evidence, detail) => {
    const { stub } = serve(() => apifyDataset([item()]));
    expect(await fetchAd()).toStrictEqual({
      ok: false,
      reason,
      ...(detail === undefined ? {} : { detail }),
      status,
      evidence: { source: "apify", ...evidence },
      reachedOtodom: true,
      apifyStatus: 201,
    });
    expect(apifyCalls(stub.requests)).toHaveLength(1);
  });

  it("reads an item without a landing address as no redirect, and reads the page", async () => {
    serve(() => apifyDataset([apifyItem(flatSaleAd(), { loadedUrl: null })]));
    expect(await fetchAd()).toStrictEqual({ ok: true, ad: flatSaleAd(), reachedOtodom: true, apifyStatus: 201 });
  });
});

describe("ApifyLeg.fetchAd: the run's own error reached otodom and reads as a refusal", () => {
  it("reads the #error item as http_denied with no status, carrying nothing of its #debug", async () => {
    const { stub } = serve(() => apifyDataset([apifyRunError()]));
    const result = await fetchAd();

    expect(result).toStrictEqual({
      ok: false,
      reason: "http_denied",
      evidence: { source: "apify" },
      reachedOtodom: true,
      apifyFailure: "run_error",
      apifyStatus: 201,
    });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
    expect(apifyCalls(stub.requests)).toHaveLength(1);
  });
});

describe("ApifyLeg.fetchAd: a run that never reached otodom says why, once", () => {
  it.each([
    [401, "user-or-token-not-found"],
    [403, "insufficient-permissions"],
    [403, "full-permission-actor-not-approved"],
    [402, "payment-required"],
    [408, "run-timeout-exceeded"],
    [429, "rate-limit-exceeded"],
  ])("reads HTTP %i %s as an http failure with its type and without its message", async (status, type) => {
    const { stub } = serve(() => apifyError(status, type));
    const result = await fetchAd();

    expect(result).toStrictEqual({
      ok: false,
      reachedOtodom: false,
      apifyFailure: "http",
      apifyStatus: status,
      apifyErrorType: type,
    });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
    // No retry, whatever the status: a 408 or a 429 is not asked again.
    expect(apifyCalls(stub.requests)).toHaveLength(1);
  });

  it("reads a run that exceeded its timeout (400 run-failed, observed live) as an http failure before otodom", async () => {
    const { stub } = serve(() => apifyRunTimeout());
    const result = await fetchAd();

    expect(result).toStrictEqual({
      ok: false,
      reachedOtodom: false,
      apifyFailure: "http",
      apifyStatus: 400,
      apifyErrorType: "run-failed",
    });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
    expect(apifyCalls(stub.requests)).toHaveLength(1);
  });

  it("reads a refusal whose body is not JSON as an http failure without a type", async () => {
    serve(() => new Response(`<html>${APIFY_MESSAGE_CANARY}</html>`, { status: 502 }));
    const result = await fetchAd();

    expect(result).toStrictEqual({ ok: false, reachedOtodom: false, apifyFailure: "http", apifyStatus: 502 });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
  });

  it.each<[string, () => Response, string]>([
    ["an empty dataset", apifyEmpty, "empty_dataset"],
    ["a dataset that is not JSON", () => new Response(`${APIFY_MESSAGE_CANARY} [`, { status: 201 }), "malformed_item"],
    ["an object in place of the dataset", () => apifyDataset({ items: [] } as unknown as unknown[]), "malformed_item"],
    ["two items", () => apifyDataset([apifyItem(), apifyItem()]), "malformed_item"],
    [
      "an item about another address",
      () =>
        apifyDataset([
          apifyItem(flatSaleAd(), {
            requestedUrl: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2",
          }),
        ]),
      "malformed_item",
    ],
    [
      "an item whose status is text",
      () => apifyDataset([apifyItem(flatSaleAd(), { status: "200" })]),
      "malformed_item",
    ],
    ["an item whose ad is an array", () => apifyDataset([apifyItem(null, { ad: [flatSaleAd()] })]), "malformed_item"],
  ])("reads %s as %s", async (_label, answer, apifyFailure) => {
    const { stub } = serve(answer);
    const result = await fetchAd();

    expect(result).toStrictEqual({ ok: false, reachedOtodom: false, apifyFailure, apifyStatus: 201 });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
    expect(apifyCalls(stub.requests)).toHaveLength(1);
  });

  it("reads a rejected request as network, with nothing of the error", async () => {
    const { stub } = serve(() => Promise.reject(new TypeError(`fetch failed: ${APIFY_MESSAGE_CANARY}`)));
    const result = await fetchAd();

    expect(result).toStrictEqual({ ok: false, reachedOtodom: false, apifyFailure: "network" });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
    expect(apifyCalls(stub.requests)).toHaveLength(1);
  });

  it("reads a service that never answers as timeout once the deadline aborts the request", async () => {
    const controller = new AbortController();
    const { stub } = serve((_request, context) => {
      const silence = apifySilence(context);
      controller.abort(new DOMException("The deadline passed.", "TimeoutError"));
      return silence;
    });

    expect(await fetchAd(controller.signal)).toStrictEqual({
      ok: false,
      reachedOtodom: false,
      apifyFailure: "timeout",
    });
    expect(apifyCalls(stub.requests)).toHaveLength(1);
  });

  it("reads a body cut after the status as network, with the status", async () => {
    serve(() => unreadableResponse(new TypeError("terminated"), { status: 201 }));
    expect(await fetchAd()).toStrictEqual({
      ok: false,
      reachedOtodom: false,
      apifyFailure: "network",
      apifyStatus: 201,
    });
  });

  it("reads a body cut by the deadline as timeout, with the status", async () => {
    const controller = new AbortController();
    serve(() => {
      controller.abort(new DOMException("The deadline passed.", "TimeoutError"));
      return unreadableResponse(new TypeError("terminated"), { status: 201 });
    });
    expect(await fetchAd(controller.signal)).toStrictEqual({
      ok: false,
      reachedOtodom: false,
      apifyFailure: "timeout",
      apifyStatus: 201,
    });
  });
});
