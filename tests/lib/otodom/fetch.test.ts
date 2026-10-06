import { afterEach, describe, expect, it } from "vitest";
import { ingestOffer } from "@/lib/otodom";
import { fetchOfferAd } from "@/lib/otodom/fetch";
import type { FetchEvidence, FetchFailureReason, FetchOfferResult } from "@/lib/otodom/types";
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

  // Another host's status says nothing about the offer: its 404 is not a listing that is gone,
  // and its 503 is not the portal failing. The landing is checked before the status.
  it.each([404, 410, 503])("treats HTTP %i from a page off otodom as refused, not by its status", async (status) => {
    serve(() => responseAt("<html></html>", { status, url: "https://consent.example/zgoda/start" }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "http_denied",
      status,
      evidence: { contentType: HTML, landedHost: "consent.example", landedPath: "/zgoda/start" },
    });
  });

  it("still reads a block marked cf-mitigated first, wherever the request landed", async () => {
    serve(() =>
      responseAt(CHALLENGE_PAGE, {
        status: 403,
        url: "https://consent.example/zgoda/start",
        headers: { "cf-mitigated": "challenge" },
      }),
    );
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "challenged",
      status: 403,
      evidence: {
        contentType: HTML,
        cfMitigated: "challenge",
        landedHost: "consent.example",
        landedPath: "/zgoda/start",
      },
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
    // A path that merely ends like a results page is not one.
    ["https://www.otodom.pl/pl/blog/wyniki", "/pl/blog/wyniki"],
  ])("treats a redirect to %s as an unexpected landing", async (url, landedPath) => {
    serve(() => responseAt(otodomPage(flatSaleAd()), { url }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "unexpected_landing",
      status: 200,
      evidence: { contentType: HTML, landedHost: "www.otodom.pl", landedPath },
    });
  });

  // A slug repeats the listing's title, whatever page it stands on: the path keeps its shape and
  // loses the slug, and the offer is named by its token.
  it.each<[string, FetchFailureReason, FetchEvidence]>([
    [
      // A path that merely ends like an offer page is not one.
      "https://www.otodom.pl/pl/archiwum/oferta/kawalerka-po-remoncie-IDKANAR2",
      "unexpected_landing",
      { landedHost: "www.otodom.pl", landedPath: "/pl/archiwum/oferta/<slug>", landedListing: "IDKANAR2" },
    ],
    [
      "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2/galeria",
      "unexpected_landing",
      { landedHost: "www.otodom.pl", landedPath: "/pl/oferta/<slug>/galeria", landedListing: "IDKANAR2" },
    ],
    [
      "https://www.otodom.pl/pl/oferta/kawalerka-bez-tokenu/galeria",
      "unexpected_landing",
      { landedHost: "www.otodom.pl", landedPath: "/pl/oferta/<slug>/galeria" },
    ],
    [
      "https://www.otodom.pl/en/ad/kawalerka-po-remoncie-IDKANAR2",
      "unexpected_landing",
      { landedHost: "www.otodom.pl", landedPath: "/en/ad/<slug>", landedListing: "IDKANAR2" },
    ],
    [
      "https://m.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2?utm_source=kanarek",
      "http_denied",
      { landedHost: "m.otodom.pl", landedPath: "/pl/oferta/<slug>", landedListing: "IDKANAR2" },
    ],
    [
      "https://www.otodom.pl./pl/oferta/kawalerka-po-remoncie-IDKANAR2",
      "http_denied",
      { landedHost: "www.otodom.pl.", landedPath: "/pl/oferta/<slug>", landedListing: "IDKANAR2" },
    ],
    [
      // A foreign page that repeats the offer's address in its own path, encoded into one segment.
      "https://consent.example/r/https%3A%2F%2Fwww.otodom.pl%2Fpl%2Foferta%2Fkawalerka-po-remoncie-IDKANAR2",
      "http_denied",
      { landedHost: "consent.example", landedPath: "/r/<slug>", landedListing: "IDKANAR2" },
    ],
    [
      "https://consent.example/r/https%3A%2F%2Fwww.otodom.pl%2Fpl%2FOferta%2Fkawalerka-bez-tokenu",
      "http_denied",
      { landedHost: "consent.example", landedPath: "/r/<slug>" },
    ],
    [
      "https://consent.example/r/https://www.otodom.pl/pl/oferta/kawalerka-bez-tokenu",
      "http_denied",
      { landedHost: "consent.example", landedPath: "/r/https://www.otodom.pl/pl/oferta/<slug>" },
    ],
  ])("logs the landing %s without its slug", async (url, reason, landed) => {
    serve(() => responseAt(otodomPage(flatSaleAd()), { url }));
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason,
      status: 200,
      evidence: { contentType: HTML, ...landed },
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

  it("follows a redirect to the offer under a path without the language prefix", async () => {
    serve(() =>
      responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/oferta/mieszkanie-3-pokoje-IDKANAR1" }),
    );
    expect(await fetchAd()).toStrictEqual({ ok: true, ad: flatSaleAd() });
  });

  // Another offer's page is complete and readable, and it is not the listing the member pasted:
  // saving it under the pasted address would be an invented fact. The body is never read.
  it("refuses a redirect to another offer, although its page carries a whole ad", async () => {
    serve(() =>
      responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2" }),
    );
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "unexpected_landing",
      status: 200,
      evidence: { contentType: HTML, landedHost: "www.otodom.pl", landedListing: "IDKANAR2" },
    });
  });

  // Without a token on the landing there is nothing to compare, and the page is read.
  it("reads the page of an offer whose slug has no token", async () => {
    serve(() => responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/oferta/kawalerka-bez-tokenu" }));
    expect(await fetchAd()).toStrictEqual({ ok: true, ad: flatSaleAd() });
  });

  // The landing is named by its token alone: the rest of the slug repeats the listing's title.
  it("names the offer a redirect landed on by its token when that page carries no data", async () => {
    serve(() =>
      responseAt(PAGE_WITHOUT_NEXT_DATA, { url: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR1/" }),
    );
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "data_missing",
      status: 200,
      evidence: {
        contentType: HTML,
        landedHost: "www.otodom.pl",
        landedListing: "IDKANAR1",
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

describe("fetchOfferAd: a token is read from the end of the slug alone (#6)", () => {
  // A word of the title that happens to start with "ID" is still a word of the title.
  it("names no listing for a slug whose only ID-like word is not its last", async () => {
    serve(() =>
      responseAt(PAGE_WITHOUT_NEXT_DATA, { url: "https://www.otodom.pl/pl/oferta/kawalerka-IDealna-lokalizacja" }),
    );
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

  it.each([
    [
      "an address with its scheme in capitals",
      "request to HTTPS://WWW.OTODOM.PL/pl/oferta/slowa-IDKANAR1?utm_source=kanarek failed",
      "request to <url> failed",
    ],
    [
      "an address without a scheme",
      "Invalid URL: www.otodom.pl/pl/oferta/slowa-tytulu-IDKANAR1?utm_source=kanarek",
      "Invalid URL: <url>",
    ],
    [
      "an offer's path alone",
      "redirect to /pl/oferta/slowa-tytulu-IDKANAR1?utm_source=kanarek not allowed",
      "redirect to <url> not allowed",
    ],
    [
      "an offer's path in capitals",
      "redirect to /PL/OFERTA/SLOWA-IDKANAR1 not allowed",
      "redirect to <url> not allowed",
    ],
  ])("replaces %s in the error message", async (_label, message, errorMessage) => {
    serve(() => {
      throw new TypeError(message);
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: { errorName: "TypeError", errorMessage, phase: "headers" },
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

  it("carries a cause without a name as its message alone", async () => {
    serve(() => {
      throw new TypeError("fetch failed", { cause: { message: "socket closed by peer" } });
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: {
        errorName: "TypeError",
        errorMessage: "fetch failed",
        errorCause: "socket closed by peer",
        phase: "headers",
      },
    });
  });

  it("carries a cause with an empty name as its message alone", async () => {
    serve(() => {
      throw new TypeError("fetch failed", { cause: { name: "", message: "socket closed by peer" } });
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: {
        errorName: "TypeError",
        errorMessage: "fetch failed",
        errorCause: "socket closed by peer",
        phase: "headers",
      },
    });
  });

  // The code is often the one part of a cause that says what happened.
  it("carries the code of a cause between its name and its message", async () => {
    serve(() => {
      const cause = Object.assign(new Error("connect ECONNREFUSED 203.0.113.7:443"), { code: "ECONNREFUSED" });
      throw new TypeError("fetch failed", { cause });
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: {
        errorName: "TypeError",
        errorMessage: "fetch failed",
        errorCause: "Error ECONNREFUSED: connect ECONNREFUSED 203.0.113.7:443",
        phase: "headers",
      },
    });
  });

  it("carries a cause that has a code and no message", async () => {
    serve(() => {
      const cause = Object.assign(new AggregateError([], ""), { code: "ECONNRESET" });
      throw new TypeError("fetch failed", { cause });
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: {
        errorName: "TypeError",
        errorMessage: "fetch failed",
        errorCause: "AggregateError ECONNRESET",
        phase: "headers",
      },
    });
  });

  it.each([
    ["a name alone", new AggregateError([], "")],
    ["a code that is not text", { name: "SystemError", code: 104 }],
    ["a code that is not a code", { name: "SystemError", code: "see https://www.otodom.pl/pl/oferta/slowa-IDKANAR1" }],
  ])("leaves out a cause that holds %s", async (_label, cause) => {
    serve(() => {
      throw new TypeError("fetch failed", { cause });
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: { errorName: "TypeError", errorMessage: "fetch failed", phase: "headers" },
    });
  });

  it("leaves out a name that is not text", async () => {
    serve(() => {
      throw Object.assign(new Error("fetch failed"), { name: 42 });
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: { errorMessage: "fetch failed", phase: "headers" },
    });
  });

  // Nothing obliges a runtime to reject with an Error. The text is typed as one only because
  // the lint rule on rejection reasons would otherwise keep a test from doing what a runtime may.
  it("carries a rejection that is plain text as the message, with its addresses replaced", async () => {
    const text = `socket hang up at ${FLAT_SALE_URL}?utm_source=kanarek` as unknown as Error;
    serve(() => {
      throw text;
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "network",
      evidence: { errorMessage: "socket hang up at <url>", phase: "headers" },
    });
  });

  it("reports a rejection named AbortError as a timeout, even with a signal that is not aborted", async () => {
    serve(() => {
      throw new DOMException("This operation was aborted", "AbortError");
    });
    expect(failure(await fetchAd())).toStrictEqual({
      ok: false,
      reason: "timeout",
      evidence: { errorName: "AbortError", errorMessage: "This operation was aborted", phase: "headers" },
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

describe("fetchOfferAd: an aborted signal is a timeout, whatever the error is called (#1)", () => {
  it("reports a body cut short under an aborted signal as a timeout", async () => {
    const controller = new AbortController();
    serve(() => {
      controller.abort();
      return unreadableResponse(new TypeError("terminated"));
    });
    expect(failure(await fetchAd(controller.signal))).toStrictEqual({
      ok: false,
      reason: "timeout",
      status: 200,
      evidence: { contentType: HTML, errorName: "TypeError", errorMessage: "terminated", phase: "body" },
    });
  });
});

describe("fetchOfferAd: a header the answer does not send is an absent key (#1)", () => {
  it("carries no content type for an answer without one", async () => {
    serve(() => new Response(null, { status: 403 }));
    expect(failure(await fetchAd())).toStrictEqual({ ok: false, reason: "http_denied", status: 403, evidence: {} });
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
