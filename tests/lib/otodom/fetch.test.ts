import { afterEach, describe, expect, it } from "vitest";
import { ingestOffer } from "@/lib/otodom";
import { fetchOfferAd } from "@/lib/otodom/fetch";
import type { FetchFailureReason, FetchOfferResult } from "@/lib/otodom/types";
import {
  CHALLENGE_PAGE,
  PAGE_WITHOUT_NEXT_DATA,
  otodomPage,
  otodomPageProps,
  pageWithNextData,
  responseAt,
  restoreFetch,
  stubFetch,
  unreadableResponse,
} from "../../fixtures/http";
import { FLAT_SALE_URL, flatSaleAd, omitKeys, rentalFlat, saleHouse } from "../../fixtures/otodom";

// Expected results are written by hand from the reason contract of the change
// `otodom-fetch-sub-reasons` (rows in check order, the first match wins), the failure table in
// otodom_fetching.md section 7.1 and prd.md, Non-Functional Requirements ("the member is shown
// an explicit failure identifying it as a fetch problem. No blank, partial or silently empty
// offer is ever created or saved"). Every failure is compared whole, with `toStrictEqual`: a key
// that should be absent is part of the claim. The network is stubbed at the HTTP edge; nothing
// here reaches otodom.pl.

afterEach(restoreFetch);

/** The `Content-Type` `responseAt` sends unless a test says otherwise. */
const HTML = "text/html; charset=utf-8";

/** Serves `response` for the one otodom request the fetch makes. */
function serve(response: () => Response) {
  return stubFetch((request) => (request.url === FLAT_SALE_URL ? response() : undefined));
}

async function fetchAd(signal: AbortSignal = new AbortController().signal): Promise<FetchOfferResult> {
  return fetchOfferAd(FLAT_SALE_URL, signal);
}

function failure(result: FetchOfferResult): Extract<FetchOfferResult, { ok: false }> {
  // A failure carries no ad at all — nothing a caller could map and save by mistake.
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("ad");
  if (result.ok) throw new Error("expected a failure, got an ad");
  return result;
}

describe("fetchOfferAd: a page without usable listing data names what is missing (#1)", () => {
  // A page that carries no marker at all is not known to be a changed format — a block served
  // with 200 looks the same — so it has a reason of its own. The other three did carry the
  // marker, and `detail` says how far the reading got.
  const SHAPES: [string, string, { reason: FetchFailureReason; detail?: string }, boolean][] = [
    ["a page without __NEXT_DATA__", PAGE_WITHOUT_NEXT_DATA, { reason: "data_missing" }, false],
    ["a challenge page served with 200 and no header", CHALLENGE_PAGE, { reason: "data_missing" }, false],
    [
      "__NEXT_DATA__ with truncated JSON",
      pageWithNextData('{"props":{"pageProps":{"ad":{"id":65000001,"tit'),
      { reason: "shape_changed", detail: "next_data_unparseable" },
      true,
    ],
    [
      "JSON without props",
      pageWithNextData('{"page":"/[lang]/ad/[id]","buildId":"test"}'),
      { reason: "shape_changed", detail: "page_props_missing" },
      true,
    ],
    [
      "JSON without props.pageProps",
      pageWithNextData('{"props":{}}'),
      { reason: "shape_changed", detail: "page_props_missing" },
      true,
    ],
    [
      "pageProps without ad and without the expired flag",
      otodomPageProps({}),
      { reason: "shape_changed", detail: "ad_missing" },
      true,
    ],
    [
      "pageProps with ad: null and without the expired flag",
      otodomPageProps({ ad: null }),
      { reason: "shape_changed", detail: "ad_missing" },
      true,
    ],
  ];

  it.each(SHAPES)("reports %s", async (_label, html, named, markerPresent) => {
    const stub = serve(() => responseAt(html));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      ...named,
      status: 200,
      evidence: { contentType: HTML, bodyLength: html.length, markerPresent },
    });
    expect(stub.requests).toHaveLength(1);
  });
});

describe("fetchOfferAd: an expired offer is expired, never an empty offer (#1)", () => {
  it("reports ad.shouldShowExpiredAdPage: true as expired, although the ad is present", async () => {
    const html = otodomPage(flatSaleAd({ shouldShowExpiredAdPage: true }));
    serve(() => responseAt(html));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "expired",
      status: 200,
      evidence: { contentType: HTML, bodyLength: html.length, markerPresent: true },
    });
  });

  it("reports pageProps.shouldShowExpiredAdPage: true without an ad as expired", async () => {
    const html = otodomPageProps({ shouldShowExpiredAdPage: true });
    serve(() => responseAt(html));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "expired",
      status: 200,
      evidence: { contentType: HTML, bodyLength: html.length, markerPresent: true },
    });
  });
});

describe("fetchOfferAd: an HTTP status names its own reason (#1)", () => {
  // 404/410: removed or wrong URL. Other 4xx (403, 429 above all): the portal refused. 5xx: the
  // portal failing, not refusing — never read as a block (otodom_fetching.md 7.1, 9.1).
  const STATUSES: [number, FetchFailureReason][] = [
    [404, "not_found"],
    [410, "not_found"],
    [403, "http_denied"],
    [429, "http_denied"],
    [500, "upstream_error"],
    [503, "upstream_error"],
  ];

  // No `bodyLength`, no `markerPresent`: the body of an answer outside 2xx is never read.
  it.each(STATUSES)("reports HTTP %i as %s, with the status", async (status, reason) => {
    serve(() => responseAt(otodomPage(flatSaleAd()), { status }));
    expect(failure(await fetchAd())).toStrictEqual({ ok: false, reason, status, evidence: { contentType: HTML } });
  });

  it("carries retry-after of a 429", async () => {
    serve(() => responseAt("<html></html>", { status: 429, headers: { "Retry-After": "120" } }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "http_denied",
      status: 429,
      evidence: { contentType: HTML, retryAfter: "120" },
    });
  });

  it("carries the content type the answer names", async () => {
    serve(() => responseAt("{}", { status: 403, headers: { "Content-Type": "application/json" } }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "http_denied",
      status: 403,
      evidence: { contentType: "application/json" },
    });
  });

  it("carries where a refused request had landed", async () => {
    serve(() => responseAt("<html></html>", { status: 403, url: FLAT_SALE_URL }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "http_denied",
      status: 403,
      evidence: { contentType: HTML, landedHost: "www.otodom.pl", landedListing: "IDKANAR1" },
    });
  });
});

describe("fetchOfferAd: an answer marked cf-mitigated is a recognised block, whatever its status (#1)", () => {
  // Beside each: the same answer without the header, which the status alone names.
  const MITIGATED: [number, Record<string, unknown>][] = [
    [
      200,
      {
        reason: "data_missing",
        status: 200,
        evidence: { contentType: HTML, bodyLength: CHALLENGE_PAGE.length, markerPresent: false },
      },
    ],
    [403, { reason: "http_denied", status: 403, evidence: { contentType: HTML } }],
    [503, { reason: "upstream_error", status: 503, evidence: { contentType: HTML } }],
  ];

  it.each(MITIGATED)("reports HTTP %i with the header as challenged", async (status) => {
    serve(() => responseAt(CHALLENGE_PAGE, { status, headers: { "cf-mitigated": "challenge" } }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "challenged",
      status,
      evidence: { contentType: HTML, cfMitigated: "challenge" },
    });
  });

  it.each(MITIGATED)("reports HTTP %i without the header by its status", async (status, expected) => {
    serve(() => responseAt(CHALLENGE_PAGE, { status }));
    expect(failure(await fetchAd())).toStrictEqual({ ok: false, ...expected });
  });

  it("reads an empty cf-mitigated header as no header", async () => {
    serve(() => responseAt(CHALLENGE_PAGE, { status: 403, headers: { "cf-mitigated": "" } }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "http_denied",
      status: 403,
      evidence: { contentType: HTML },
    });
  });
});

describe("fetchOfferAd: where a followed redirect lands (#1)", () => {
  it("treats a redirect off otodom (a consent or anti-bot page) as refused, and drops its query", async () => {
    serve(() =>
      responseAt(otodomPage(flatSaleAd()), {
        url: "https://consent.example/zgoda/start?next=https%3A%2F%2Fwww.otodom.pl%2Fpl%2Foferta%2Fmieszkanie-54-m-warszawa-IDKANAR1&utm_source=kanarek#krok-1",
      }),
    );
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "http_denied",
      status: 200,
      evidence: { contentType: HTML, landedHost: "consent.example", landedPath: "/zgoda/start" },
    });
  });

  // A results page is where the portal sends a listing it no longer has.
  it.each([
    [
      "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/warszawa",
      "www.otodom.pl",
      "/pl/wyniki/sprzedaz/mieszkanie/warszawa",
    ],
    ["https://www.otodom.pl/pl/wyniki", "www.otodom.pl", "/pl/wyniki"],
    ["https://www.otodom.pl/wyniki", "www.otodom.pl", "/wyniki"],
    ["https://otodom.pl/wyniki/?page=2", "otodom.pl", "/wyniki/"],
  ])("treats a redirect to the results page %s as not found", async (url, landedHost, landedPath) => {
    serve(() => responseAt(otodomPage(flatSaleAd()), { url }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "not_found",
      status: 200,
      evidence: { contentType: HTML, landedHost, landedPath },
    });
  });

  // Anywhere else on otodom is a landing nobody has seen: a failure to look at, not a refusal.
  it.each([
    ["https://www.otodom.pl/pl/firmy/biura-nieruchomosci", "/pl/firmy/biura-nieruchomosci"],
    ["https://www.otodom.pl/", "/"],
    ["https://www.otodom.pl/pl/wynikiX/sprzedaz", "/pl/wynikiX/sprzedaz"],
    ["https://www.otodom.pl/pl/oferta/kawalerka-IDKANAR2/galeria", "/pl/oferta/kawalerka-IDKANAR2/galeria"],
  ])("treats a redirect to %s as an unexpected landing", async (url, landedPath) => {
    serve(() => responseAt(otodomPage(flatSaleAd()), { url }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "unexpected_landing",
      status: 200,
      evidence: { contentType: HTML, landedHost: "www.otodom.pl", landedPath },
    });
  });

  it("treats a landing address it cannot parse as an unexpected landing, without a host", async () => {
    serve(() => responseAt(otodomPage(flatSaleAd()), { url: "to nie jest adres" }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "unexpected_landing",
      status: 200,
      evidence: { contentType: HTML },
    });
  });

  it("follows a redirect to the same offer under a changed slug", async () => {
    serve(() =>
      responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/oferta/mieszkanie-3-pokoje-IDKANAR1" }),
    );
    expect(await fetchAd()).toStrictEqual({ ok: true, ad: flatSaleAd() });
  });

  // The landing is named by its token alone: the rest of the slug repeats the listing's title.
  it("names the offer a redirect landed on by its token when that page carries no data", async () => {
    serve(() =>
      responseAt(PAGE_WITHOUT_NEXT_DATA, { url: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2/" }),
    );
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "data_missing",
      status: 200,
      evidence: {
        contentType: HTML,
        landedHost: "www.otodom.pl",
        landedListing: "IDKANAR2",
        bodyLength: PAGE_WITHOUT_NEXT_DATA.length,
        markerPresent: false,
      },
    });
  });

  it("names no listing for an offer slug without a token", async () => {
    serve(() => responseAt(PAGE_WITHOUT_NEXT_DATA, { url: "https://www.otodom.pl/pl/oferta/kawalerka-bez-tokenu" }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "data_missing",
      status: 200,
      evidence: {
        contentType: HTML,
        landedHost: "www.otodom.pl",
        bodyLength: PAGE_WITHOUT_NEXT_DATA.length,
        markerPresent: false,
      },
    });
  });
});

describe("fetchOfferAd: a request that never completes (#1)", () => {
  // No `status` and nothing about a response: no headers ever arrived.
  it("reports a thrown TypeError as a network failure, with its name and message", async () => {
    serve(() => {
      throw new TypeError("fetch failed");
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: { errorName: "TypeError", errorMessage: "fetch failed", phase: "headers" },
    });
  });

  it("replaces an address the error message quotes, query string included", async () => {
    serve(() => {
      throw new TypeError(`request to ${FLAT_SALE_URL}?utm_source=kanarek failed, reason: socket hang up`);
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: {
        errorName: "TypeError",
        errorMessage: "request to <url> failed, reason: socket hang up",
        phase: "headers",
      },
    });
  });

  it("carries the cause of the error, with its addresses replaced too", async () => {
    serve(() => {
      throw new TypeError("fetch failed", {
        cause: new RangeError(`connect ECONNREFUSED http://otodom.pl/oferta/mieszkanie-IDKANAR1?utm_source=kanarek`),
      });
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: {
        errorName: "TypeError",
        errorMessage: "fetch failed",
        errorCause: "RangeError: connect ECONNREFUSED <url>",
        phase: "headers",
      },
    });
  });

  it("carries a cause that is plain text", async () => {
    serve(() => {
      throw new TypeError("fetch failed", { cause: "socket closed" });
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: { errorName: "TypeError", errorMessage: "fetch failed", errorCause: "socket closed", phase: "headers" },
    });
  });

  it("reports an aborted signal as a timeout", async () => {
    serve(() => responseAt(otodomPage(flatSaleAd())));
    const controller = new AbortController();
    controller.abort();
    expect(failure(await fetchAd(controller.signal))).toStrictEqual({
      ok: false,
      reason: "timeout",
      evidence: { errorName: "AbortError", errorMessage: "This operation was aborted", phase: "headers" },
    });
  });

  it("reports a signal that timed out as a timeout", async () => {
    serve(() => responseAt(otodomPage(flatSaleAd())));
    const controller = new AbortController();
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
    expect(failure(await fetchAd(controller.signal))).toStrictEqual({
      ok: false,
      reason: "timeout",
      evidence: { errorName: "TimeoutError", errorMessage: "The operation timed out.", phase: "headers" },
    });
  });

  it("reports a rejection named TimeoutError as a timeout, even with a signal that is not aborted", async () => {
    serve(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "timeout",
      evidence: { errorName: "TimeoutError", errorMessage: "The operation timed out.", phase: "headers" },
    });
  });
});

describe("fetchOfferAd: a body that cannot be read (#1)", () => {
  // The headers did arrive, so the entry keeps what they said beside the error.
  it("reports a body cut short as a network failure in the body phase", async () => {
    serve(() => unreadableResponse(new TypeError("terminated"), { url: FLAT_SALE_URL }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      status: 200,
      evidence: {
        contentType: HTML,
        landedHost: "www.otodom.pl",
        landedListing: "IDKANAR1",
        errorName: "TypeError",
        errorMessage: "terminated",
        phase: "body",
      },
    });
  });

  it("reports a signal aborted while the body was being read as a timeout", async () => {
    const controller = new AbortController();
    serve(() => {
      const reason = new DOMException("The operation timed out.", "TimeoutError");
      controller.abort(reason);
      return unreadableResponse(reason);
    });
    expect(failure(await fetchAd(controller.signal))).toStrictEqual({
      ok: false,
      reason: "timeout",
      status: 200,
      evidence: {
        contentType: HTML,
        errorName: "TimeoutError",
        errorMessage: "The operation timed out.",
        phase: "body",
      },
    });
  });
});

describe("fetchOfferAd: a readable page (#1)", () => {
  it("returns the page's ad unchanged", async () => {
    const stub = serve(() => responseAt(otodomPage(flatSaleAd())));
    expect(await fetchAd()).toStrictEqual({ ok: true, ad: flatSaleAd() });
    expect(stub.requests).toEqual([{ method: "GET", url: FLAT_SALE_URL, body: null }]);
  });
});

describe("ingestOffer: pasted URL to a mapped offer (#1, FR-005)", () => {
  it("fetches the normalised URL and returns it with the mapped offer", async () => {
    const stub = serve(() => responseAt(otodomPage(flatSaleAd())));
    const result = await ingestOffer(
      "otodom.pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1/?utm_source=kanarek#galeria",
      new AbortController().signal,
    );
    if (!result.ok) throw new Error(`expected an offer, got a refusal: ${result.reason}`);
    expect(result.url).toBe("https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1");
    expect(result.offer.otodom_id).toBe(65000001);
    expect(result.offer.title).toBe("Mieszkanie 3 pokoje, 54,5 m², Praga-Południe");
    expect(stub.requests.map((request) => request.url)).toEqual([
      "https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1",
    ]);
  });

  it.each([
    ["a foreign host", "https://www.olx.pl/d/oferta/mieszkanie-54-m-warszawa-IDKANAR1", "foreign_host"],
    [
      "an otodom path that is not an offer",
      "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/warszawa",
      "not_an_offer",
    ],
  ])("refuses %s without a single request", async (_label, url, reason) => {
    const stub = stubFetch(() => undefined);
    const result = await ingestOffer(url, new AbortController().signal);
    expect(result).toStrictEqual({ ok: false, stage: "url", reason });
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses a flat for rent as not for sale, after the fetch", async () => {
    const stub = serve(() => responseAt(otodomPage(rentalFlat())));
    const result = await ingestOffer(FLAT_SALE_URL, new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("offer");
    expect(result).toMatchObject({ stage: "map", reason: "not_for_sale" });
    expect(stub.requests).toHaveLength(1);
  });

  it("refuses a house for sale as not a flat, after the fetch", async () => {
    serve(() => responseAt(otodomPage(saleHouse())));
    const result = await ingestOffer(FLAT_SALE_URL, new AbortController().signal);
    expect(result).not.toHaveProperty("offer");
    expect(result).toMatchObject({ ok: false, stage: "map", reason: "not_a_flat" });
  });

  it("passes a fetch failure through with its status and what the answer said about itself", async () => {
    serve(() => responseAt("<html></html>", { status: 403 }));
    expect(await ingestOffer(FLAT_SALE_URL, new AbortController().signal)).toStrictEqual({
      ok: false,
      stage: "fetch",
      reason: "http_denied",
      status: 403,
      evidence: { contentType: HTML },
    });
  });

  // `shape_changed` comes from two places: only the stage tells a page whose data cannot be
  // read from a payload the mapper no longer recognises.
  it("names the fetch as the stage when the page's data cannot be parsed", async () => {
    const html = pageWithNextData('{"props":{"pageProps":{"ad":{"id":65000001,"tit');
    serve(() => responseAt(html));
    expect(await ingestOffer(FLAT_SALE_URL, new AbortController().signal)).toStrictEqual({
      ok: false,
      stage: "fetch",
      reason: "shape_changed",
      detail: "next_data_unparseable",
      status: 200,
      evidence: { contentType: HTML, bodyLength: html.length, markerPresent: true },
    });
  });

  it("names the mapper as the stage when the listing has no title", async () => {
    serve(() => responseAt(otodomPage(omitKeys(flatSaleAd(), "title"))));
    expect(await ingestOffer(FLAT_SALE_URL, new AbortController().signal)).toStrictEqual({
      ok: false,
      stage: "map",
      reason: "shape_changed",
      detail: "id, title, url or description missing",
    });
  });
});
