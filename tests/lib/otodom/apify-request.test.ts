import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  APIFY_ACTOR_ID,
  APIFY_AD_KEYS,
  APIFY_ENDPOINT,
  APIFY_LOCATION_KEYS,
  APIFY_PAGE_FUNCTION,
  APIFY_RUN_PARAMS,
  APIFY_TARGET_KEYS,
  buildApifyRequest,
  readApifyAnswer,
} from "@/lib/otodom/apify-request";
import {
  APIFY_MESSAGE_CANARY,
  APIFY_TEST_TOKEN,
  apifyExpiredItem,
  apifyItem,
  apifyNoMarkerItem,
  apifyRunError,
} from "../../fixtures/apify";
import {
  CANARY_NAME,
  CANARY_PHONE,
  CANARY_STREET,
  FLAT_SALE_DESCRIPTION_HTML,
  FLAT_SALE_URL,
  SELLER_CANARIES,
  flatSaleAd,
} from "../../fixtures/otodom";

// Expected values are written by hand from context/changes/otodom-apify-fallback/plan.md (Phase 2
// §4: the constants, the request, the four cases of reading an answer) and spike-apify.md (the
// `KEEP` list, the `#error` item, the run's request). Nothing here sends a request: the request is
// built and read, and the `pageFunction` runs in a `node:vm` context of its own against a stub of
// what cheerio-scraper hands it.

const OTHER_URL = "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2";

describe("the request to Apify", () => {
  it("runs cheerio-scraper by its technical id, synchronously, with the dataset as the answer", () => {
    expect(APIFY_ACTOR_ID).toBe("YrQuEkowkNCLdk4j2");
    expect(APIFY_ENDPOINT).toBe("https://api.apify.com/v2/acts/YrQuEkowkNCLdk4j2/run-sync-get-dataset-items");
  });

  it("puts the run's limits in the address, and nothing else", () => {
    const { url } = buildApifyRequest(FLAT_SALE_URL);
    const parsed = new URL(url);

    expect(`${parsed.origin}${parsed.pathname}`).toBe(APIFY_ENDPOINT);
    expect(Object.fromEntries(parsed.searchParams)).toStrictEqual({
      maxTotalChargeUsd: "0.05",
      timeout: "30",
      memory: "1024",
    });
    expect(APIFY_RUN_PARAMS).toStrictEqual({ maxTotalChargeUsd: "0.05", timeout: "30", memory: "1024" });
    // No token: it travels in a header, which the leg adds.
    expect(url).not.toContain("token");
    expect(url).not.toContain(APIFY_TEST_TOKEN);
  });

  it("sends one start address, the fixed pageFunction, the residential proxy in Poland and one request", () => {
    expect(buildApifyRequest(FLAT_SALE_URL).body).toStrictEqual({
      startUrls: [{ url: FLAT_SALE_URL }],
      pageFunction: APIFY_PAGE_FUNCTION,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "PL" },
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 1,
      maxConcurrency: 1,
    });
  });

  it("varies only the start address: the pageFunction carries nothing of the request", () => {
    const first = buildApifyRequest(FLAT_SALE_URL).body;
    const second = buildApifyRequest(OTHER_URL).body;

    expect(second.pageFunction).toBe(first.pageFunction);
    expect(second.startUrls).toStrictEqual([{ url: OTHER_URL }]);
    expect(APIFY_PAGE_FUNCTION).not.toContain("IDKANAR");
    expect(APIFY_PAGE_FUNCTION).not.toContain("otodom.pl");
  });

  it("copies the spike's KEEP list, the three location keys and the two target keys", () => {
    expect(APIFY_AD_KEYS).toStrictEqual([
      "id",
      "url",
      "title",
      "description",
      "characteristics",
      "features",
      "adCategory",
      "images",
      "createdAt",
      "modifiedAt",
      "advertType",
      "shouldShowExpiredAdPage",
    ]);
    expect(APIFY_LOCATION_KEYS).toStrictEqual(["coordinates", "reverseGeocoding", "address"]);
    expect(APIFY_TARGET_KEYS).toStrictEqual(["OfferType", "ProperType"]);
  });
});

describe("readApifyAnswer", () => {
  it("reads a finished run's one item, every field checked", () => {
    const ad = { id: 65000001, title: "Mieszkanie" };
    expect(readApifyAnswer(201, [apifyItem(ad)], FLAT_SALE_URL)).toStrictEqual({
      ok: true,
      apifyStatus: 201,
      item: {
        requestedUrl: FLAT_SALE_URL,
        loadedUrl: FLAT_SALE_URL,
        status: 200,
        markerPresent: true,
        parseError: false,
        pagePropsPresent: true,
        pagePropsExpired: null,
        ad,
      },
    });
  });

  it.each([
    ["absent", undefined],
    ["null", null],
  ])("reads a loadedUrl that is %s as an unknown landing", (_label, loadedUrl) => {
    const result = readApifyAnswer(201, [apifyItem(null, { loadedUrl })], FLAT_SALE_URL);
    expect(result).toMatchObject({ ok: true, item: { loadedUrl: "" } });
  });

  // Outside 2xx: the error's type token is kept and its message never is.
  it.each([
    [401, "user-or-token-not-found"],
    [403, "insufficient-permissions"],
    [403, "full-permission-actor-not-approved"],
    [402, "payment-required"],
    [408, "run-timeout-exceeded"],
    [429, "rate-limit-exceeded"],
  ])("reads HTTP %i %s as an http failure with its type", (status, type) => {
    const json = { error: { type, message: `${APIFY_MESSAGE_CANARY}: ${type}` } };
    const result = readApifyAnswer(status, json, FLAT_SALE_URL);

    expect(result).toStrictEqual({ ok: false, apifyFailure: "http", apifyStatus: status, apifyErrorType: type });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
  });

  it.each([
    ["a body that was not JSON", undefined],
    ["an error without a type", { error: { message: APIFY_MESSAGE_CANARY } }],
    ["a type that is free text", { error: { type: `${APIFY_MESSAGE_CANARY} with spaces`, message: "x" } }],
    ["a type that is not a string", { error: { type: 401 } }],
    ["an array", []],
  ])("reads a refusal carrying %s as an http failure without a type", (_label, json) => {
    const result = readApifyAnswer(502, json, FLAT_SALE_URL);
    expect(result).toStrictEqual({ ok: false, apifyFailure: "http", apifyStatus: 502 });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
  });

  it("reads an empty dataset as empty_dataset", () => {
    expect(readApifyAnswer(201, [], FLAT_SALE_URL)).toStrictEqual({
      ok: false,
      apifyFailure: "empty_dataset",
      apifyStatus: 201,
    });
  });

  it("reads the run's #error item as run_error, carrying nothing of its #debug", () => {
    const result = readApifyAnswer(201, [apifyRunError()], FLAT_SALE_URL);
    expect(result).toStrictEqual({ ok: false, apifyFailure: "run_error", apifyStatus: 201 });
    expect(JSON.stringify(result)).not.toContain(APIFY_MESSAGE_CANARY);
  });

  it.each<[string, unknown]>([
    ["a body that was not JSON", undefined],
    ["an object in place of the dataset", { items: [apifyItem()] }],
    ["two items", [apifyItem(), apifyItem()]],
    ["an item that is not an object", ["item"]],
    ["an item that is an array", [[apifyItem()]]],
    ["an item about another address", [apifyItem(flatSaleAd(), { requestedUrl: OTHER_URL })]],
    ["an item without requestedUrl", [apifyItem(flatSaleAd(), { requestedUrl: undefined })]],
    ["a loadedUrl that is not a string", [apifyItem(flatSaleAd(), { loadedUrl: 42 })]],
    ["a status written as text", [apifyItem(flatSaleAd(), { status: "200" })]],
    ["a status that is null", [apifyItem(flatSaleAd(), { status: null })]],
    ["a status that is not an HTTP status", [apifyItem(flatSaleAd(), { status: 2000 })]],
    ["a status that is not whole", [apifyItem(flatSaleAd(), { status: 200.5 })]],
    ["markerPresent written as text", [apifyItem(flatSaleAd(), { markerPresent: "true" })]],
    ["parseError missing", [apifyItem(flatSaleAd(), { parseError: undefined })]],
    ["pagePropsPresent missing", [apifyItem(flatSaleAd(), { pagePropsPresent: undefined })]],
    ["pagePropsExpired written as text", [apifyItem(flatSaleAd(), { pagePropsExpired: "true" })]],
    ["an ad that is an array", [apifyItem(null, { ad: [flatSaleAd()] })]],
    ["an ad that is text", [apifyItem(null, { ad: "ad" })]],
    ["an ad that is missing", [apifyItem(null, { ad: undefined })]],
  ])("reads %s as malformed_item", (_label, json) => {
    expect(readApifyAnswer(201, json, FLAT_SALE_URL)).toStrictEqual({
      ok: false,
      apifyFailure: "malformed_item",
      apifyStatus: 201,
    });
  });

  // Beside the malformed items: the same fields in the shapes the pageFunction does return.
  it.each<[string, Record<string, unknown>]>([
    ["an expired flag", apifyExpiredItem()],
    ["no marker and no ad", apifyNoMarkerItem()],
    ["pagePropsExpired: true", apifyItem(null, { pagePropsExpired: true })],
    ["otodom's own 410", apifyItem(null, { status: 410 })],
  ])("reads an item with %s as an item", (_label, item) => {
    expect(readApifyAnswer(201, [item], FLAT_SALE_URL).ok).toBe(true);
  });
});

/** What cheerio-scraper hands the pageFunction, as far as it reads it. */
interface StubContext {
  nextData: string | null;
  status?: number;
  noResponse?: boolean;
}

/**
 * Runs `APIFY_PAGE_FUNCTION` in a context of its own, as Apify does, and hands back its output the
 * way the dataset stores it — as JSON. `$` answers the `__NEXT_DATA__` script's text, or `""` for
 * a page without it, as cheerio does.
 */
async function runPageFunction({ nextData, status = 200, noResponse = false }: StubContext): Promise<unknown> {
  const pageFunction = runInNewContext(`(${APIFY_PAGE_FUNCTION})`) as (context: unknown) => Promise<unknown>;
  const $ = (selector: string) => ({
    first: () => ({ text: () => (selector === "script#__NEXT_DATA__" && nextData !== null ? nextData : "") }),
  });
  const output = await pageFunction({
    $,
    request: { url: FLAT_SALE_URL, loadedUrl: FLAT_SALE_URL },
    response: noResponse ? undefined : { status, headers: {} },
  });
  return JSON.parse(JSON.stringify(output)) as unknown;
}

function nextDataOf(pageProps: Record<string, unknown>): string {
  return JSON.stringify({ props: { pageProps }, page: "/[lang]/ad/[id]", buildId: "test" });
}

function record(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

describe("APIFY_PAGE_FUNCTION, run against a stub of the page", () => {
  it("returns the narrowed ad of a readable page, with the facts the classifier reads", async () => {
    const output = record(await runPageFunction({ nextData: nextDataOf({ ad: flatSaleAd() }) }));
    const { ad, ...facts } = output;

    expect(facts).toStrictEqual({
      requestedUrl: FLAT_SALE_URL,
      loadedUrl: FLAT_SALE_URL,
      status: 200,
      markerPresent: true,
      parseError: false,
      pagePropsPresent: true,
      pagePropsExpired: null,
    });
    const narrowed = record(ad);
    expect(narrowed.title).toBe("Mieszkanie 3 pokoje, 54,5 m², Praga-Południe");
    expect(narrowed.target).toStrictEqual({ OfferType: "sprzedaz", ProperType: "mieszkanie" });
    expect(record(narrowed.location).address).toStrictEqual({
      street: { name: CANARY_STREET },
      city: null,
      district: null,
      province: null,
    });
  });

  it("copies no key outside the whitelist", async () => {
    const ad = record(record(await runPageFunction({ nextData: nextDataOf({ ad: flatSaleAd() }) })).ad);

    for (const key of Object.keys(ad)) {
      expect([...APIFY_AD_KEYS, "location", "target"]).toContain(key);
    }
    for (const key of Object.keys(record(ad.location))) {
      expect(APIFY_LOCATION_KEYS).toContain(key);
    }
    for (const key of Object.keys(record(ad.target))) {
      expect(APIFY_TARGET_KEYS).toContain(key);
    }
    // The control: the source held keys the whitelist drops, among them the seller's.
    const source = flatSaleAd();
    expect(Object.keys(source)).toEqual(expect.arrayContaining(["owner", "contactDetails", "agency", "slug"]));
    expect(Object.keys(record(source.target))).toEqual(expect.arrayContaining(["seller_id", "user_id"]));
  });

  it("lets no seller phone, name or account id out, outside the listing's own text", async () => {
    const output = record(await runPageFunction({ nextData: nextDataOf({ ad: flatSaleAd() }) }));
    const { description, ...rest } = record(output.ad);
    const serialised = JSON.stringify({ ...output, ad: rest });

    for (const canary of SELLER_CANARIES) {
      expect(serialised).not.toContain(canary);
    }
    // The advertiser's own words stay verbatim (prd.md, Non-Functional Requirements).
    expect(description).toBe(FLAT_SALE_DESCRIPTION_HTML);
    // The control: the input held every canary outside the description.
    const { description: _inputDescription, ...inputRest } = flatSaleAd();
    const input = JSON.stringify(inputRest);
    for (const canary of [CANARY_NAME, CANARY_PHONE, ...SELLER_CANARIES]) {
      expect(input).toContain(canary);
    }
  });

  it("produces an item readApifyAnswer reads", async () => {
    const output = await runPageFunction({ nextData: nextDataOf({ ad: flatSaleAd() }) });
    expect(readApifyAnswer(201, [output], FLAT_SALE_URL).ok).toBe(true);
  });

  it.each<[string, StubContext, Record<string, unknown>]>([
    [
      "a page without the marker",
      { nextData: null },
      { markerPresent: false, parseError: false, pagePropsPresent: false, pagePropsExpired: null, ad: null },
    ],
    [
      "a marker whose text does not parse",
      { nextData: '{"props":{"pageProps":{"ad":{"id":65000001,"tit' },
      { markerPresent: true, parseError: true, pagePropsPresent: false, pagePropsExpired: null, ad: null },
    ],
    [
      "data without pageProps",
      { nextData: '{"props":{}}' },
      { markerPresent: true, parseError: false, pagePropsPresent: false, pagePropsExpired: null, ad: null },
    ],
    [
      "pageProps without an ad, flagged expired",
      { nextData: nextDataOf({ shouldShowExpiredAdPage: true }) },
      { markerPresent: true, parseError: false, pagePropsPresent: true, pagePropsExpired: true, ad: null },
    ],
    [
      "pageProps with ad: null",
      { nextData: nextDataOf({ ad: null, shouldShowExpiredAdPage: false }) },
      { markerPresent: true, parseError: false, pagePropsPresent: true, pagePropsExpired: false, ad: null },
    ],
    [
      "an ad that is an array",
      { nextData: nextDataOf({ ad: [flatSaleAd()] }) },
      { markerPresent: true, parseError: false, pagePropsPresent: true, pagePropsExpired: null, ad: null },
    ],
  ])("reports %s", async (_label, context, expected) => {
    expect(await runPageFunction(context)).toStrictEqual({
      requestedUrl: FLAT_SALE_URL,
      loadedUrl: FLAT_SALE_URL,
      status: 200,
      ...expected,
    });
  });

  it("reads the status from response.status", async () => {
    expect(record(await runPageFunction({ nextData: null, status: 410 })).status).toBe(410);
  });

  it("reports no status when there was no response", async () => {
    expect(record(await runPageFunction({ nextData: null, noResponse: true })).status).toBeNull();
  });

  it("keeps an ad's own expired flag", async () => {
    const ad = record(
      record(await runPageFunction({ nextData: nextDataOf({ ad: flatSaleAd({ shouldShowExpiredAdPage: true }) }) })).ad,
    );
    expect(ad.shouldShowExpiredAdPage).toBe(true);
  });
});
