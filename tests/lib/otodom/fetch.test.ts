import { afterEach, describe, expect, it } from "vitest";
import { ingestOffer } from "@/lib/otodom";
import { fetchOfferAd } from "@/lib/otodom/fetch";
import type { FetchFailureReason, FetchOfferResult } from "@/lib/otodom/types";
import {
  PAGE_WITHOUT_NEXT_DATA,
  otodomPage,
  otodomPageProps,
  pageWithNextData,
  responseAt,
  restoreFetch,
  stubFetch,
} from "../../fixtures/http";
import { FLAT_SALE_URL, flatSaleAd, omitKeys, rentalFlat, saleHouse } from "../../fixtures/otodom";

// Expected reasons are written by hand from the failure table in otodom_fetching.md section 7.1
// and prd.md, Non-Functional Requirements ("the member is shown an explicit failure identifying
// it as a fetch problem. No blank, partial or silently empty offer is ever created or saved").
// The network is stubbed at the HTTP edge; nothing here reaches otodom.pl.

afterEach(restoreFetch);

/** Serves `response` for the one otodom request the fetch makes. */
function serve(response: () => Response) {
  return stubFetch((request) => (request.url === FLAT_SALE_URL ? response() : undefined));
}

async function fetchAd(signal: AbortSignal = new AbortController().signal): Promise<FetchOfferResult> {
  return fetchOfferAd(FLAT_SALE_URL, signal);
}

function failure(result: FetchOfferResult): { reason: FetchFailureReason; status?: number } {
  // A failure carries no ad at all — nothing a caller could map and save by mistake.
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("ad");
  if (result.ok) throw new Error("expected a failure, got an ad");
  return result;
}

describe("fetchOfferAd: a page without usable listing data is a changed shape (#1)", () => {
  const SHAPES: [string, string][] = [
    ["a page without __NEXT_DATA__", PAGE_WITHOUT_NEXT_DATA],
    ["__NEXT_DATA__ with truncated JSON", pageWithNextData('{"props":{"pageProps":{"ad":{"id":65000001,"tit')],
    ["JSON without props", pageWithNextData('{"page":"/[lang]/ad/[id]","buildId":"test"}')],
    ["JSON without props.pageProps", pageWithNextData('{"props":{}}')],
    ["pageProps without ad and without the expired flag", otodomPageProps({})],
    ["pageProps with ad: null and without the expired flag", otodomPageProps({ ad: null })],
  ];

  it.each(SHAPES)("reports %s as shape_changed", async (_label, html) => {
    const stub = serve(() => responseAt(html));
    expect(failure(await fetchAd()).reason).toBe("shape_changed");
    expect(stub.requests).toHaveLength(1);
  });
});

describe("fetchOfferAd: an expired offer is expired, never an empty offer (#1)", () => {
  it("reports ad.shouldShowExpiredAdPage: true as expired, although the ad is present", async () => {
    serve(() => responseAt(otodomPage(flatSaleAd({ shouldShowExpiredAdPage: true }))));
    expect(failure(await fetchAd()).reason).toBe("expired");
  });

  it("reports pageProps.shouldShowExpiredAdPage: true without an ad as expired", async () => {
    serve(() => responseAt(otodomPageProps({ shouldShowExpiredAdPage: true })));
    expect(failure(await fetchAd()).reason).toBe("expired");
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

  it.each(STATUSES)("reports HTTP %i as %s, with the status", async (status, reason) => {
    serve(() => responseAt("<html></html>", { status }));
    expect(failure(await fetchAd())).toEqual({ ok: false, reason, status });
  });
});

describe("fetchOfferAd: where a followed redirect lands (#1)", () => {
  it("treats a redirect off otodom (a consent or anti-bot page) as refused", async () => {
    serve(() => responseAt(otodomPage(flatSaleAd()), { url: "https://consent.example/" }));
    expect(failure(await fetchAd()).reason).toBe("http_denied");
  });

  it("treats a redirect to an otodom page that is not an offer as not found", async () => {
    serve(() =>
      responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/warszawa" }),
    );
    expect(failure(await fetchAd()).reason).toBe("not_found");
  });

  it("follows a redirect to the same offer under a changed slug", async () => {
    serve(() =>
      responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/oferta/mieszkanie-3-pokoje-IDKANAR1" }),
    );
    expect(await fetchAd()).toEqual({ ok: true, ad: flatSaleAd() });
  });
});

describe("fetchOfferAd: a request that never completes (#1)", () => {
  it("reports a thrown TypeError as a network failure", async () => {
    serve(() => {
      throw new TypeError("fetch failed");
    });
    expect(failure(await fetchAd()).reason).toBe("network");
  });

  it("reports an aborted signal as a timeout", async () => {
    serve(() => responseAt(otodomPage(flatSaleAd())));
    const controller = new AbortController();
    controller.abort();
    expect(failure(await fetchAd(controller.signal)).reason).toBe("timeout");
  });

  it("reports a signal that timed out as a timeout", async () => {
    serve(() => responseAt(otodomPage(flatSaleAd())));
    const controller = new AbortController();
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
    expect(failure(await fetchAd(controller.signal)).reason).toBe("timeout");
  });
});

describe("fetchOfferAd: a readable page (#1)", () => {
  it("returns the page's ad unchanged", async () => {
    const stub = serve(() => responseAt(otodomPage(flatSaleAd())));
    expect(await fetchAd()).toEqual({ ok: true, ad: flatSaleAd() });
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
    expect(result).toEqual({ ok: false, stage: "url", reason });
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

  it("passes a fetch failure through with its status", async () => {
    serve(() => responseAt("<html></html>", { status: 403 }));
    expect(await ingestOffer(FLAT_SALE_URL, new AbortController().signal)).toEqual({
      ok: false,
      stage: "fetch",
      reason: "http_denied",
      status: 403,
    });
  });

  // The same reason from two places: only the stage tells a page that lost its data from a
  // payload the mapper no longer recognises.
  it("names the fetch as the stage when the page carries no listing data", async () => {
    serve(() => responseAt(PAGE_WITHOUT_NEXT_DATA));
    expect(await ingestOffer(FLAT_SALE_URL, new AbortController().signal)).toEqual({
      ok: false,
      stage: "fetch",
      reason: "shape_changed",
    });
  });

  it("names the mapper as the stage when the listing has no title", async () => {
    serve(() => responseAt(otodomPage(omitKeys(flatSaleAd(), "title"))));
    expect(await ingestOffer(FLAT_SALE_URL, new AbortController().signal)).toEqual({
      ok: false,
      stage: "map",
      reason: "shape_changed",
      detail: "id, title, url or description missing",
    });
  });
});
