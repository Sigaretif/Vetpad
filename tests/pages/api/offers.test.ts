import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/offers";
import {
  APIFY_MESSAGE_CANARY,
  APIFY_TEST_TOKEN,
  apifyCalls,
  apifyDataset,
  apifyEmpty,
  apifyError,
  apifyGoneItem,
  apifyItem,
  apifyNoMarkerItem,
  apifyRunError,
  apifyRunTimeout,
  apifySilence,
  isApifyRequest,
} from "../../fixtures/apify";
import { type ConsoleCapture, type ConsoleEntry, captureConsole, restoreConsole } from "../../fixtures/console";
import {
  CHALLENGE_CANARY,
  type FetchContext,
  CHALLENGE_PAGE,
  INSERTED_OFFER_ID,
  PAGE_WITHOUT_NEXT_DATA,
  type RecordedRequest,
  emptyOffersTable,
  ingestionSettingsRow,
  isIngestionSettingsRead,
  isOffersRequest,
  isOtodomRequest,
  jsonResponse,
  otodomPage,
  otodomPageProps,
  pageWithNextData,
  responseAt,
  restoreFetch,
  stubFetch,
  unreadableResponse,
} from "../../fixtures/http";
import {
  CANARY_NAME,
  CANARY_PHONE,
  SELLER_CANARIES,
  flatSaleAd,
  omitKeys,
  rentalFlat,
  saleHouse,
} from "../../fixtures/otodom";

// The route with a configured Supabase client (test values, never a real project's): this mock
// overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase, @/lib/otodom and the Apify leg run as they do in production.
//
// `apifyToken` switches the extraction service's token on for the scenarios of the fallback. It is
// off by default and reset before every test, so every other scenario runs with no token — as
// `direct_only`, with 0 Apify requests — and the token is a test value worth nothing.
const env = vi.hoisted(() => ({ apifyToken: false }));
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  const { APIFY_TEST_TOKEN } = await import("../../fixtures/apify");
  return {
    SUPABASE_URL: SUPABASE_TEST_URL,
    SUPABASE_KEY: SUPABASE_TEST_KEY,
    ANTHROPIC_API_KEY: undefined,
    get APIFY_TOKEN() {
      return env.apifyToken ? APIFY_TEST_TOKEN : undefined;
    },
    getSecret: () => undefined,
  };
});

// Expected outcomes come from prd.md: FR-005 (a rental or a non-flat is refused naming which
// check failed, "and nothing is saved"), the Non-Functional Requirements (a fetch problem is
// reported as one, no blank or partial offer is saved; the advertiser's phone and name are
// never stored, while the description keeps the advertiser's words verbatim).

// The clock stands still, so each leg's duration in a log entry is exact: 0 unless a test moves it.
beforeEach(() => {
  env.apifyToken = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});
afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
/** The member's address is on `locals.user` in production too; no log entry may carry it. */
const USER_EMAIL = "czlonek.kanarek@vetpad.local";

/** The canonical form of the pasted URL, written out by hand (FR-005: no query, `/pl`, no trailing slash). */
const NORMALISED_URL = "https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1";
const PASTED_URL = "https://otodom.pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1/?utm_source=kanarek";

type Answer = () => Response | Promise<Response>;

/** Serves `page` for otodom and answers the route's planned Supabase requests, the mode's read among them. */
function stubNetwork(page: Answer) {
  return stubFetch((request) => {
    if (isOtodomRequest(request)) return page();
    if (isIngestionSettingsRead(request)) return ingestionSettingsRow();
    return emptyOffersTable(request);
  });
}

interface Member {
  id: string;
  email: string;
}
const MEMBER: Member = { id: USER_ID, email: USER_EMAIL };

// Every log entry below is written out by hand. `listing` is the `ID…` token of the pasted
// slug, `otodom_id` the `id` of `flatSaleAd()`.
const LISTING = "IDKANAR1";
const OTODOM_ID = 65000001;
/** The `Content-Type` `responseAt` sends unless a test says otherwise. */
const HTML = "text/html; charset=utf-8";

/**
 * The mode as every scenario without a token reads it: the seeded default, run as `direct_only`
 * because the application holds no Apify token.
 */
const NO_TOKEN_MODE = {
  ingestion_mode: "direct_with_fallback",
  ingestion_mode_effective: "direct_only",
  ingestion_mode_reason: "apify_unconfigured",
  ingestion_mode_read: "ok",
};
/** What every entry after the fetch carries in that mode: the direct leg, which took no time on a clock that stands still. */
const DIRECT_LEG = { ...NO_TOKEN_MODE, source: "direct", direct_duration_ms: 0 };

/** The entry the route leaves before it reaches for otodom.pl, so a fetch the platform cut short still has a trace. */
const STARTED: ConsoleEntry = {
  method: "info",
  args: [
    {
      level: "info",
      event: "offer_add",
      outcome: "started",
      stage: "fetch",
      user_id: USER_ID,
      listing: LISTING,
      ...NO_TOKEN_MODE,
    },
  ],
};

async function post(request: Request, user: Member | null): Promise<Response> {
  const context = {
    request,
    locals: { user },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return POST(context);
}

async function submit(url: string, user: Member | null = MEMBER): Promise<Response> {
  const form = new FormData();
  form.set("url", url);
  return post(new Request("http://localhost/api/offers", { method: "POST", body: form }), user);
}

const EXISTING_OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-000000000002";
const SAVE_FAILED = "Nie udało się zapisać oferty. Nic nie zostało zapisane.";
const UNIQUE_VIOLATION = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "offers_otodom_id_key"',
};

/**
 * otodom serves the flat for sale, and each of the route's Supabase requests is answered by
 * the test: the duplicate check by `source_url`, the insert, and the twin lookup by
 * `otodom_id`. A request the test names no answer for falls back to the empty table; a twin
 * lookup nobody planned stays unplanned.
 */
function stubDatabase({ precheck, insert, twin }: { precheck?: Answer; insert?: Answer; twin?: Answer }) {
  return stubFetch((request) => {
    if (isOtodomRequest(request)) return responseAt(otodomPage(flatSaleAd()));
    if (isIngestionSettingsRead(request)) return ingestionSettingsRow();
    const params = new URL(request.url).searchParams;
    if (isOffersRequest(request, "GET") && params.has("source_url") && precheck) return precheck();
    if (isOffersRequest(request, "GET") && params.get("otodom_id") === `eq.${OTODOM_ID}`) return twin?.();
    if (isOffersRequest(request, "POST") && insert) return insert();
    return emptyOffersTable(request);
  });
}

function location(response: Response): URL {
  expect(response.status).toBe(302);
  const header = response.headers.get("Location");
  if (header === null) throw new Error("expected a redirect with a Location header");
  return new URL(header, "http://localhost");
}

function offerInserts(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => isOffersRequest(request, "POST"));
}

describe("POST /api/offers: a refusal saves nothing (#1, FR-005)", () => {
  const EXPIRED_PAGE = otodomPage(flatSaleAd({ shouldShowExpiredAdPage: true }));
  const TRUNCATED_PAGE = pageWithNextData('{"props":{"pageProps":{"ad":{"id":65000001,"tit');
  const PAGE_WITHOUT_PAGE_PROPS = pageWithNextData('{"props":{}}');
  const PAGE_WITHOUT_AD = otodomPageProps({});

  // Each distinguishing fragment is the part of the message that names the reason. The last two
  // columns are the log entry: a refusal the product expects is info, a failure is an error,
  // and the stage tells the two `shape_changed` apart. A failure at the fetch stage also carries
  // what the answer said about itself — and nothing about a body that was never read.
  const REFUSALS: [string, Answer, string[], "info" | "error", Record<string, string | number | boolean>][] = [
    [
      "a flat for rent",
      () => responseAt(otodomPage(rentalFlat())),
      ["wynajmu"],
      "info",
      { outcome: "refused", stage: "map", reason: "not_for_sale" },
    ],
    [
      "a house for sale",
      () => responseAt(otodomPage(saleHouse())),
      ["innego rodzaju nieruchomości"],
      "info",
      { outcome: "refused", stage: "map", reason: "not_a_flat", detail: "dom" },
    ],
    [
      "a page without __NEXT_DATA__",
      () => responseAt(PAGE_WITHOUT_NEXT_DATA),
      ["przysłał stronę bez danych ogłoszenia", "mógł zablokować pobranie albo zmienić format strony"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "data_missing",
        status: 200,
        content_type: HTML,
        body_length: PAGE_WITHOUT_NEXT_DATA.length,
        marker_present: false,
      },
    ],
    [
      "a page whose __NEXT_DATA__ cannot be parsed",
      () => responseAt(TRUNCATED_PAGE),
      ["Nie udało się odczytać treści ogłoszenia", "zmienić format"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "shape_changed",
        detail: "next_data_unparseable",
        status: 200,
        content_type: HTML,
        body_length: TRUNCATED_PAGE.length,
        marker_present: true,
      },
    ],
    [
      "a page whose JSON has no pageProps",
      () => responseAt(PAGE_WITHOUT_PAGE_PROPS),
      ["Nie udało się odczytać treści ogłoszenia", "zmienić format"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "shape_changed",
        detail: "page_props_missing",
        status: 200,
        content_type: HTML,
        body_length: PAGE_WITHOUT_PAGE_PROPS.length,
        marker_present: true,
      },
    ],
    [
      "a page whose pageProps has no ad and no expiry flag",
      () => responseAt(PAGE_WITHOUT_AD),
      ["Nie udało się odczytać treści ogłoszenia", "zmienić format"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "shape_changed",
        detail: "ad_missing",
        status: 200,
        content_type: HTML,
        body_length: PAGE_WITHOUT_AD.length,
        marker_present: true,
      },
    ],
    [
      // The landing is an offer page, so it is named by its token: the slug's words stay out.
      "a redirect to the same offer under another slug, whose page carries no data",
      () =>
        responseAt(PAGE_WITHOUT_NEXT_DATA, { url: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR1" }),
      ["przysłał stronę bez danych ogłoszenia"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "data_missing",
        status: 200,
        content_type: HTML,
        landed_host: "www.otodom.pl",
        landed_listing: "IDKANAR1",
        body_length: PAGE_WITHOUT_NEXT_DATA.length,
        marker_present: false,
      },
    ],
    [
      // The page is whole and readable, and it is another listing: nothing is saved under the
      // pasted address. `listing` beside `landed_listing` shows the two tokens apart.
      "a redirect to another offer",
      () =>
        responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2" }),
      ["nie istnieje lub wygasło"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "unexpected_landing",
        status: 200,
        content_type: HTML,
        landed_host: "www.otodom.pl",
        landed_listing: "IDKANAR2",
      },
    ],
    [
      "a listing without a title",
      () => responseAt(otodomPage(omitKeys(flatSaleAd(), "title"))),
      ["zmienić format"],
      "error",
      { outcome: "failed", stage: "map", reason: "shape_changed", detail: "id, title, url or description missing" },
    ],
    [
      "an HTTP 403 from otodom",
      () => responseAt("<html></html>", { status: 403 }),
      ["odmówił", "(HTTP 403)"],
      "error",
      { outcome: "failed", stage: "fetch", reason: "http_denied", status: 403, content_type: HTML },
    ],
    [
      // The lowest status that is shown: from 400 up the number says why otodom refused.
      "an HTTP 400 from otodom",
      () => responseAt("<html></html>", { status: 400 }),
      ["odmówił", "(HTTP 400)"],
      "error",
      { outcome: "failed", stage: "fetch", reason: "http_denied", status: 400, content_type: HTML },
    ],
    [
      // Recognised by the header alone; the page's text is never read.
      "an HTTP 403 marked cf-mitigated",
      () => responseAt(CHALLENGE_PAGE, { status: 403, headers: { "cf-mitigated": "challenge" } }),
      ["zablokował pobranie ogłoszenia", "stroną zabezpieczającą przed automatami"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "challenged",
        status: 403,
        content_type: HTML,
        cf_mitigated: "challenge",
      },
    ],
    [
      "an HTTP 429 that says when to come back",
      () => responseAt("<html></html>", { status: 429, headers: { "Retry-After": "120" } }),
      ["odmówił", "(HTTP 429)"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "http_denied",
        status: 429,
        content_type: HTML,
        retry_after: "120",
      },
    ],
    [
      "an HTTP 410 from otodom",
      () => responseAt("<html></html>", { status: 410 }),
      ["nie istnieje lub wygasło"],
      "info",
      { outcome: "refused", stage: "fetch", reason: "not_found", status: 410, content_type: HTML },
    ],
    [
      "an HTTP 404 from otodom",
      () => responseAt("<html></html>", { status: 404 }),
      ["nie istnieje lub wygasło"],
      "info",
      { outcome: "refused", stage: "fetch", reason: "not_found", status: 404, content_type: HTML },
    ],
    [
      // Still otodom, on the results page: the portal no longer has the listing. A refusal.
      "a redirect to the results page",
      () =>
        responseAt(otodomPage(flatSaleAd()), {
          url: "https://www.otodom.pl/pl/wyniki/sprzedaz/kawalerka/krakow?page=2",
        }),
      ["nie istnieje lub wygasło"],
      "info",
      {
        outcome: "refused",
        stage: "fetch",
        reason: "not_found",
        status: 200,
        content_type: HTML,
        landed_host: "www.otodom.pl",
        landed_path: "/pl/wyniki/sprzedaz/kawalerka/krakow",
      },
    ],
    [
      // Anywhere else on otodom: the member reads the same sentence, the log gets an error.
      "a redirect to an otodom page nobody has seen",
      () => responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/firmy/biura-nieruchomosci" }),
      ["nie istnieje lub wygasło"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "unexpected_landing",
        status: 200,
        content_type: HTML,
        landed_host: "www.otodom.pl",
        landed_path: "/pl/firmy/biura-nieruchomosci",
      },
    ],
    [
      "an expired listing that still ships its payload",
      () => responseAt(EXPIRED_PAGE),
      ["nie istnieje lub wygasło"],
      "info",
      {
        outcome: "refused",
        stage: "fetch",
        reason: "expired",
        status: 200,
        content_type: HTML,
        body_length: EXPIRED_PAGE.length,
        marker_present: true,
      },
    ],
    [
      "an HTTP 503 from otodom",
      () => responseAt("<html></html>", { status: 503 }),
      ["chwilowo niedostępny", "(HTTP 503)"],
      "error",
      { outcome: "failed", stage: "fetch", reason: "upstream_error", status: 503, content_type: HTML },
    ],
    [
      // The answer came with 200, which explains nothing: the sentence ends right after the noun.
      // The entry names where the redirect ended, without the query string.
      "a redirect off otodom",
      () => responseAt(otodomPage(flatSaleAd()), { url: "https://consent.example/zgoda/start?next=oferta" }),
      ["odmówił pobrania ogłoszenia. Nic nie zostało zapisane"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "http_denied",
        status: 200,
        content_type: HTML,
        landed_host: "consent.example",
        landed_path: "/zgoda/start",
      },
    ],
    [
      // No `status` and nothing about a response: no headers ever arrived.
      "a fetch that never connected",
      () => Promise.reject(new TypeError("fetch failed")),
      ["Nie udało się połączyć z otodom.pl"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "network",
        error_name: "TypeError",
        error_message: "fetch failed",
        phase: "headers",
      },
    ],
    [
      "a fetch that never connected, for a reason the error names",
      () => Promise.reject(new TypeError("fetch failed", { cause: new RangeError("connect ECONNREFUSED") })),
      ["Nie udało się połączyć z otodom.pl"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "network",
        error_name: "TypeError",
        error_message: "fetch failed",
        error_cause: "RangeError: connect ECONNREFUSED",
        phase: "headers",
      },
    ],
    [
      "a fetch that timed out",
      () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
      ["Pobieranie ogłoszenia trwało zbyt długo. Nic nie zostało zapisane — spróbuj ponownie."],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "timeout",
        error_name: "TimeoutError",
        error_message: "The operation timed out.",
        phase: "headers",
      },
    ],
    [
      "a body cut short while it was being read",
      () => unreadableResponse(new TypeError("terminated")),
      ["Nie udało się połączyć z otodom.pl"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "network",
        status: 200,
        content_type: HTML,
        error_name: "TypeError",
        error_message: "terminated",
        phase: "body",
      },
    ],
    [
      // The headers did arrive, so the entry keeps what they said beside the error.
      "a body that timed out while it was being read",
      () => unreadableResponse(new DOMException("The operation timed out.", "TimeoutError")),
      ["Pobieranie ogłoszenia trwało zbyt długo. Nic nie zostało zapisane — spróbuj ponownie."],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "timeout",
        status: 200,
        content_type: HTML,
        error_name: "TimeoutError",
        error_message: "The operation timed out.",
        phase: "body",
      },
    ],
  ];

  it.each(REFUSALS)("refuses %s with its own message and no insert", async (_label, page, fragments, level, entry) => {
    const captured = captureConsole();
    const stub = stubNetwork(page);
    const target = location(await submit(PASTED_URL));

    expect(target.pathname).toBe("/dashboard");
    const message = target.searchParams.get("error");
    expect(message).not.toBeNull();
    for (const fragment of fragments) {
      expect(message).toContain(fragment);
    }
    // The refusal came from the fetched page — the fetch did happen — and no row went out.
    expect(stub.requests.filter(isOtodomRequest)).toHaveLength(1);
    expect(offerInserts(stub.requests)).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      STARTED,
      {
        method: level,
        args: [{ level, event: "offer_add", ...entry, user_id: USER_ID, listing: LISTING, ...DIRECT_LEG }],
      },
    ]);
  });
});

describe("POST /api/offers: a request refused before the network leaves one entry and no request", () => {
  /** No request is planned: any that goes out fails the test through `restoreFetch`. */
  function noNetwork() {
    return stubFetch(() => undefined);
  }

  it.each([
    ["an empty address", "", "To nie wygląda na poprawny adres URL.", "empty"],
    ["text that is not an address", "to nie jest adres", "To nie wygląda na poprawny adres URL.", "malformed"],
    [
      "an address from another portal",
      "https://www.olx.pl/d/oferta/mieszkanie-54-m-warszawa-IDKANAR1",
      "Vetpad obsługuje wyłącznie ogłoszenia z otodom.pl.",
      "foreign_host",
    ],
    [
      "an otodom address that is not an offer",
      "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/warszawa",
      "Ten adres nie prowadzi do ogłoszenia otodom.pl.",
      "not_an_offer",
    ],
  ])("refuses %s", async (_label, pasted, message, reason) => {
    const captured = captureConsole();
    const stub = noNetwork();
    const target = location(await submit(pasted));

    expect(target.pathname).toBe("/dashboard");
    expect(target.searchParams.get("error")).toBe(message);
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [{ level: "info", event: "offer_add", outcome: "refused", stage: "url", reason, user_id: USER_ID }],
      },
    ]);
  });

  it("reads a form without the address field as an empty address, never a 500", async () => {
    const captured = captureConsole();
    const stub = noNetwork();
    const request = new Request("http://localhost/api/offers", { method: "POST", body: new FormData() });
    const target = location(await post(request, MEMBER));

    expect(target.searchParams.get("error")).toBe("To nie wygląda na poprawny adres URL.");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          { level: "info", event: "offer_add", outcome: "refused", stage: "url", reason: "empty", user_id: USER_ID },
        ],
      },
    ]);
  });

  it("sends a signed-out visitor to the sign-in page", async () => {
    const captured = captureConsole();
    const stub = noNetwork();
    const target = location(await submit(PASTED_URL, null));

    expect(target.pathname).toBe("/auth/signin");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [{ level: "info", event: "offer_add", outcome: "refused", stage: "auth", reason: "signed_out" }],
      },
    ]);
  });

  it("reads a body that is not a form as an empty address", async () => {
    const captured = captureConsole();
    const stub = noNetwork();
    const request = new Request("http://localhost/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: PASTED_URL }),
    });
    const target = location(await post(request, MEMBER));

    expect(target.pathname).toBe("/dashboard");
    expect(target.searchParams.get("error")).toBe("To nie wygląda na poprawny adres URL.");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_add",
            outcome: "refused",
            stage: "body",
            reason: "unreadable_body",
            user_id: USER_ID,
          },
        ],
      },
    ]);
  });
});

describe("POST /api/offers: a flat for sale is saved once, without seller data (#1, #6)", () => {
  async function saved(): Promise<{ response: Response; requests: RecordedRequest[]; captured: ConsoleCapture }> {
    const captured = captureConsole();
    const stub = stubNetwork(() => responseAt(otodomPage(flatSaleAd())));
    const response = await submit(PASTED_URL);
    return { response, requests: stub.requests, captured };
  }

  function insertedRow(requests: RecordedRequest[]): Record<string, unknown> {
    const inserts = offerInserts(requests);
    expect(inserts).toHaveLength(1);
    const body = inserts[0]?.body;
    if (typeof body !== "string") throw new Error("expected the insert to carry a JSON body");
    return JSON.parse(body) as Record<string, unknown>;
  }

  it("sends exactly one insert and opens the new offer's card", async () => {
    const { response, requests } = await saved();
    expect(offerInserts(requests)).toHaveLength(1);
    const target = location(response);
    expect(target.pathname).toBe(`/offers/${INSERTED_OFFER_ID}`);
    expect(target.search).toBe("");
  });

  it("checks for a duplicate and fetches the listing under the normalised URL", async () => {
    const { requests } = await saved();
    const duplicateCheck = requests.find((request) => isOffersRequest(request, "GET"));
    expect(duplicateCheck).toBeDefined();
    expect(new URL(duplicateCheck?.url ?? "").searchParams.get("source_url")).toBe(`eq.${NORMALISED_URL}`);
    expect(requests.filter(isOtodomRequest).map((request) => request.url)).toEqual([NORMALISED_URL]);
  });

  it("stores the normalised URL and the signed-in member as the author", async () => {
    const row = insertedRow((await saved()).requests);
    expect(row.source_url).toBe(NORMALISED_URL);
    expect(row.created_by).toBe(USER_ID);
  });

  it("sends no seller phone, name or account id outside the listing's text", async () => {
    const { description: _description, raw, ...columns } = insertedRow((await saved()).requests);
    expect(raw).toBeTypeOf("object");
    const { description: _rawDescription, ...rawRest } = raw as Record<string, unknown>;
    const serialised = JSON.stringify({ ...columns, raw: rawRest });
    for (const canary of SELLER_CANARIES) {
      expect(serialised).not.toContain(canary);
    }
  });

  it("keeps the phone and the name the advertiser typed into the description, verbatim", async () => {
    const row = insertedRow((await saved()).requests);
    expect(row.description).toContain(CANARY_PHONE);
    expect(row.description).toContain(CANARY_NAME);
  });

  it("logs the start and the save, and nothing as an error", async () => {
    const { captured } = await saved();
    expect(captured.entries()).toStrictEqual([
      STARTED,
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_add",
            outcome: "saved",
            stage: "insert",
            user_id: USER_ID,
            listing: LISTING,
            otodom_id: OTODOM_ID,
            offer_id: INSERTED_OFFER_ID,
            ...DIRECT_LEG,
          },
        ],
      },
    ]);
  });
});

// What the route knows when the database lets it down, and what it tells the member: a failed
// duplicate check has fetched nothing, an insert without an answer may have landed, and a
// unique violation means the listing is saved even when its card cannot be found.
describe("POST /api/offers: a database failure is logged with its code and told as it is", () => {
  /** The entry written right before the route answered. */
  function finalEntry(captured: ConsoleCapture): ConsoleEntry | undefined {
    return captured.entries().at(-1);
  }

  function errorMessage(response: Response): string | null {
    const target = location(response);
    expect(target.pathname).toBe("/dashboard");
    return target.searchParams.get("error");
  }

  it("reports a failed duplicate check as one, before anything is fetched", async () => {
    const captured = captureConsole();
    const stub = stubDatabase({ precheck: () => jsonResponse({ code: "PGRST301", message: "JWT expired" }, 401) });

    expect(errorMessage(await submit(PASTED_URL))).toContain("sprawdzić, czy ta oferta jest już zapisana");
    expect(stub.requests.filter(isOtodomRequest)).toHaveLength(0);
    expect(offerInserts(stub.requests)).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "error",
        args: [
          {
            level: "error",
            event: "offer_add",
            outcome: "failed",
            stage: "precheck",
            reason: "precheck_failed",
            db_code: "PGRST301",
            db_message: "JWT expired",
            db_status: 401,
            user_id: USER_ID,
            listing: LISTING,
          },
        ],
      },
    ]);
  });

  it("opens the card of an offer already saved under this address, without fetching it", async () => {
    const captured = captureConsole();
    const stub = stubDatabase({ precheck: () => jsonResponse([{ id: EXISTING_OFFER_ID }], 200) });

    const target = location(await submit(PASTED_URL));
    expect(target.pathname).toBe(`/offers/${EXISTING_OFFER_ID}`);
    expect(target.searchParams.get("duplicate")).toBe("1");
    expect(stub.requests.filter(isOtodomRequest)).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_add",
            outcome: "duplicate",
            stage: "precheck",
            user_id: USER_ID,
            listing: LISTING,
            offer_id: EXISTING_OFFER_ID,
          },
        ],
      },
    ]);
  });

  // The token names the listing; the rest of the slug repeats the words of its title.
  it.each([
    ["only the token that ends the slug", "mieszkanie-IDEALNE-warszawa-IDKANAR1", { listing: "IDKANAR1" }],
    ["no listing for a slug without a token", "mieszkanie-bez-tokenu", {}],
  ])("logs %s", async (_label, slug, listing) => {
    const captured = captureConsole();
    stubDatabase({ precheck: () => jsonResponse([{ id: EXISTING_OFFER_ID }], 200) });

    const target = location(await submit(`https://www.otodom.pl/pl/oferta/${slug}`));
    expect(target.pathname).toBe(`/offers/${EXISTING_OFFER_ID}`);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_add",
            outcome: "duplicate",
            stage: "precheck",
            user_id: USER_ID,
            ...listing,
            offer_id: EXISTING_OFFER_ID,
          },
        ],
      },
    ]);
  });

  it("logs the code of an insert that row-level security refused", async () => {
    const captured = captureConsole();
    const message = 'new row violates row-level security policy for table "offers"';
    stubDatabase({ insert: () => jsonResponse({ code: "42501", message }, 403) });

    expect(errorMessage(await submit(PASTED_URL))).toBe(SAVE_FAILED);
    expect(finalEntry(captured)).toStrictEqual({
      method: "error",
      args: [
        {
          level: "error",
          event: "offer_add",
          outcome: "failed",
          stage: "insert",
          reason: "insert_failed",
          db_code: "42501",
          db_message: message,
          db_status: 403,
          user_id: USER_ID,
          listing: LISTING,
          otodom_id: OTODOM_ID,
          ...DIRECT_LEG,
        },
      ],
    });
  });

  it("logs a check violation without the rejected row Postgres quotes in its details", async () => {
    const captured = captureConsole();
    const message = 'new row for relation "offers" violates check constraint "offers_price_check"';
    const details = `Failing row contains (65000001, Mieszkanie, Kontakt: ${CANARY_NAME}, tel. ${CANARY_PHONE}).`;
    stubDatabase({ insert: () => jsonResponse({ code: "23514", message, details, hint: null }, 400) });

    expect(errorMessage(await submit(PASTED_URL))).toBe(SAVE_FAILED);
    expect(finalEntry(captured)).toStrictEqual({
      method: "error",
      args: [
        {
          level: "error",
          event: "offer_add",
          outcome: "failed",
          stage: "insert",
          reason: "insert_failed",
          db_code: "23514",
          db_message: message,
          db_status: 400,
          user_id: USER_ID,
          listing: LISTING,
          otodom_id: OTODOM_ID,
          ...DIRECT_LEG,
        },
      ],
    });
    expect(captured.text()).not.toContain("Failing row");
    expect(captured.text()).not.toContain(CANARY_PHONE);
    expect(captured.text()).not.toContain(CANARY_NAME);
  });

  it("does not claim that nothing was saved when the insert got no answer", async () => {
    const captured = captureConsole();
    // A rejected promise, not `undefined`: the request was planned, the database just never answered.
    stubDatabase({ insert: () => Promise.reject(new TypeError("fetch failed")) });

    const message = errorMessage(await submit(PASTED_URL));
    expect(message).toContain("potwierdzić zapisu");
    expect(message).not.toContain("Nic nie zostało zapisane");
    expect(finalEntry(captured)).toStrictEqual({
      method: "error",
      args: [
        {
          level: "error",
          event: "offer_add",
          outcome: "failed",
          stage: "insert",
          reason: "insert_unconfirmed",
          db_message: "TypeError: fetch failed",
          db_status: 0,
          user_id: USER_ID,
          listing: LISTING,
          otodom_id: OTODOM_ID,
          ...DIRECT_LEG,
        },
      ],
    });
  });

  it("opens the card of the same listing saved under another address", async () => {
    const captured = captureConsole();
    stubDatabase({
      insert: () => jsonResponse(UNIQUE_VIOLATION, 409),
      twin: () => jsonResponse([{ id: EXISTING_OFFER_ID }], 200),
    });

    const target = location(await submit(PASTED_URL));
    expect(target.pathname).toBe(`/offers/${EXISTING_OFFER_ID}`);
    expect(target.searchParams.get("duplicate")).toBe("1");
    expect(finalEntry(captured)).toStrictEqual({
      method: "info",
      args: [
        {
          level: "info",
          event: "offer_add",
          outcome: "duplicate",
          stage: "twin",
          user_id: USER_ID,
          listing: LISTING,
          otodom_id: OTODOM_ID,
          offer_id: EXISTING_OFFER_ID,
          ...DIRECT_LEG,
        },
      ],
    });
  });

  it("says the listing is already saved when its twin cannot be seen", async () => {
    const captured = captureConsole();
    stubDatabase({ insert: () => jsonResponse(UNIQUE_VIOLATION, 409), twin: () => jsonResponse([], 200) });

    const message = errorMessage(await submit(PASTED_URL));
    expect(message).toContain("jest już zapisane");
    expect(message).not.toContain("Nic nie zostało zapisane");
    expect(finalEntry(captured)).toStrictEqual({
      method: "error",
      args: [
        {
          level: "error",
          event: "offer_add",
          outcome: "failed",
          stage: "twin",
          reason: "twin_missing",
          user_id: USER_ID,
          listing: LISTING,
          otodom_id: OTODOM_ID,
          ...DIRECT_LEG,
        },
      ],
    });
  });

  it("says the listing is already saved when the twin lookup fails, and logs the lookup's error", async () => {
    const captured = captureConsole();
    stubDatabase({
      insert: () => jsonResponse(UNIQUE_VIOLATION, 409),
      twin: () => jsonResponse({ code: "XX000", message: "internal error" }, 500),
    });

    expect(errorMessage(await submit(PASTED_URL))).toContain("jest już zapisane");
    expect(finalEntry(captured)).toStrictEqual({
      method: "error",
      args: [
        {
          level: "error",
          event: "offer_add",
          outcome: "failed",
          stage: "twin",
          reason: "twin_lookup_failed",
          db_code: "XX000",
          db_message: "internal error",
          db_status: 500,
          user_id: USER_ID,
          listing: LISTING,
          otodom_id: OTODOM_ID,
          ...DIRECT_LEG,
        },
      ],
    });
  });
});

// The fallback (context/changes/otodom-apify-fallback/plan.md, Phase 4): which mode runs, when the
// one Apify run follows the direct fetch, and which reason the member reads. Every scenario states
// how many requests reached otodom.pl and Apify, and how many inserts reached `offers`, beside
// what it claims. The token is the fixture's test value; no request leaves the stub.

type LegAnswer = (context: FetchContext) => Response | Promise<Response>;

interface Ingest {
  /** The answer to the mode's read. Left out, the row holds the seeded default. */
  settings?: Answer;
  /** What otodom serves. Left out, a request to otodom is unplanned and fails the test. */
  page?: LegAnswer;
  /** What Apify answers a run with. Left out, a request to Apify is unplanned and fails the test. */
  apify?: LegAnswer;
  /** The duplicate check's answer. Left out, the table holds no offer under the address. */
  precheck?: Answer;
}

function stubIngest({ settings = () => ingestionSettingsRow(), page, apify, precheck }: Ingest) {
  const stub = stubFetch((request, context) => {
    if (isOtodomRequest(request)) return page?.(context);
    if (isApifyRequest(request)) return apify?.(context);
    if (isIngestionSettingsRead(request)) return settings();
    if (precheck && isOffersRequest(request, "GET") && new URL(request.url).searchParams.has("source_url")) {
      return precheck();
    }
    return emptyOffersTable(request);
  });
  return {
    requests: stub.requests,
    otodom: () => stub.requests.filter(isOtodomRequest).length,
    apify: () => apifyCalls(stub.requests).length,
    writes: () => offerInserts(stub.requests).length,
    modeReads: () => stub.requests.filter(isIngestionSettingsRead).length,
  };
}

/** The last entry's fields. */
function lastFields(captured: ConsoleCapture): unknown {
  const last = captured.entries().at(-1);
  expect(last?.args).toHaveLength(1);
  return last?.args[0];
}

function boardError(response: Response): string | null {
  const target = location(response);
  expect(target.pathname).toBe("/dashboard");
  return target.searchParams.get("error");
}

const FALLBACK_MODE = {
  ingestion_mode: "direct_with_fallback",
  ingestion_mode_effective: "direct_with_fallback",
  ingestion_mode_read: "ok",
};
const APIFY_ONLY_MODE = {
  ingestion_mode: "apify_only",
  ingestion_mode_effective: "apify_only",
  ingestion_mode_read: "ok",
};
const IDS = { user_id: USER_ID, listing: LISTING };

const DENIED_403 =
  "otodom.pl odmówił pobrania ogłoszenia (HTTP 403). Nic nie zostało zapisane — spróbuj ponownie za chwilę.";
const EXTRACTION_FAILED =
  "Nie udało się pobrać ogłoszenia z otodom.pl. Nic nie zostało zapisane — spróbuj ponownie później, a jeśli problem się powtarza, daj znać administratorowi.";
const TIMED_OUT = "Pobieranie ogłoszenia trwało zbyt długo. Nic nie zostało zapisane — spróbuj ponownie.";

const forbidden403: LegAnswer = () => responseAt("<html></html>", { status: 403 });
const apifySale: LegAnswer = () => apifyDataset([apifyItem()]);

describe("POST /api/offers: direct_with_fallback with a token runs one Apify run after a refused direct fetch", () => {
  beforeEach(() => {
    env.apifyToken = true;
  });

  const TRIGGERS: [string, LegAnswer, string][] = [
    ["a 403", forbidden403, "http_denied"],
    [
      "a 403 marked cf-mitigated",
      () => responseAt(CHALLENGE_PAGE, { status: 403, headers: { "cf-mitigated": "challenge" } }),
      "challenged",
    ],
    ["a 429", () => responseAt("<html></html>", { status: 429 }), "http_denied"],
    [
      "a landing off otodom",
      () => responseAt(otodomPage(flatSaleAd()), { url: "https://consent.example/zgoda" }),
      "http_denied",
    ],
    ["a timeout", () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")), "timeout"],
    ["a network error", () => Promise.reject(new TypeError("fetch failed")), "network"],
    ["a page without data", () => responseAt(PAGE_WITHOUT_NEXT_DATA), "data_missing"],
  ];

  it.each(TRIGGERS)(
    "saves the listing Apify read after %s: otodom 1, Apify 1, writes 1",
    async (_label, page, fallbackReason) => {
      const captured = captureConsole();
      const network = stubIngest({ page, apify: apifySale });

      const target = location(await submit(PASTED_URL));

      expect(target.pathname).toBe(`/offers/${INSERTED_OFFER_ID}`);
      expect(network.otodom()).toBe(1);
      expect(network.apify()).toBe(1);
      expect(network.writes()).toBe(1);
      // The mapper keeps the seller out of the row whichever leg brought the ad.
      const body = offerInserts(network.requests)[0]?.body ?? "";
      const { description: _description, raw, ...columns } = JSON.parse(body) as Record<string, unknown>;
      const { description: _rawDescription, ...rawRest } = raw as Record<string, unknown>;
      const serialised = JSON.stringify({ ...columns, raw: rawRest });
      for (const canary of SELLER_CANARIES) expect(serialised).not.toContain(canary);
      expect(captured.entries()).toStrictEqual([
        {
          method: "info",
          args: [{ level: "info", event: "offer_add", outcome: "started", stage: "fetch", ...IDS, ...FALLBACK_MODE }],
        },
        {
          method: "info",
          args: [
            {
              level: "info",
              event: "offer_add",
              outcome: "saved",
              stage: "insert",
              ...IDS,
              ...FALLBACK_MODE,
              otodom_id: OTODOM_ID,
              offer_id: INSERTED_OFFER_ID,
              source: "apify",
              fallback_reason: fallbackReason,
              apify_status: 201,
              direct_duration_ms: 0,
              apify_duration_ms: 0,
            },
          ],
        },
      ]);
    },
  );

  const NO_FALLBACK: [string, LegAnswer, string][] = [
    ["a 404", () => responseAt("<html></html>", { status: 404 }), "not_found"],
    ["a 410", () => responseAt("<html></html>", { status: 410 }), "not_found"],
    ["an expired listing", () => responseAt(otodomPage(flatSaleAd({ shouldShowExpiredAdPage: true }))), "expired"],
    ["a 503", () => responseAt("<html></html>", { status: 503 }), "upstream_error"],
    [
      "a redirect to another offer",
      () =>
        responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2" }),
      "unexpected_landing",
    ],
    [
      "a page whose data cannot be parsed",
      () => responseAt(pageWithNextData('{"props":{"pageProps":{"ad":{"id":65000001,"tit')),
      "shape_changed",
    ],
    ["a flat for rent", () => responseAt(otodomPage(rentalFlat())), "not_for_sale"],
    ["a house for sale", () => responseAt(otodomPage(saleHouse())), "not_a_flat"],
  ];

  it.each(NO_FALLBACK)("runs no Apify run after %s: otodom 1, Apify 0, writes 0", async (_label, page, reason) => {
    const captured = captureConsole();
    const network = stubIngest({ page });

    boardError(await submit(PASTED_URL));

    expect(network.otodom()).toBe(1);
    expect(network.apify()).toBe(0);
    expect(network.writes()).toBe(0);
    const fields = lastFields(captured);
    expect(fields).toMatchObject({ reason, source: "direct", direct_duration_ms: 0, ...FALLBACK_MODE });
    for (const key of ["fallback_reason", "apify_status", "apify_failure", "apify_duration_ms"]) {
      expect(fields).not.toHaveProperty(key);
    }
  });

  it("lets Apify's 410 win after a direct 403: the member reads not-found, otodom 1, Apify 1, writes 0", async () => {
    const captured = captureConsole();
    const network = stubIngest({ page: forbidden403, apify: () => apifyDataset([apifyGoneItem()]) });

    expect(boardError(await submit(PASTED_URL))).toBe("Ogłoszenie nie istnieje lub wygasło. Nic nie zostało zapisane.");
    expect(network.otodom()).toBe(1);
    expect(network.apify()).toBe(1);
    expect(network.writes()).toBe(0);
    expect(captured.entries().at(-1)).toStrictEqual({
      method: "info",
      args: [
        {
          level: "info",
          event: "offer_add",
          outcome: "refused",
          stage: "fetch",
          reason: "not_found",
          status: 410,
          landed_host: "www.otodom.pl",
          landed_listing: "IDKANAR1",
          ...IDS,
          ...FALLBACK_MODE,
          source: "apify",
          fallback_reason: "http_denied",
          apify_status: 201,
          direct_duration_ms: 0,
          apify_duration_ms: 0,
        },
      ],
    });
  });

  it("reads a run that could not read the page as a refusal: otodom 1, Apify 1, writes 0", async () => {
    const captured = captureConsole();
    const network = stubIngest({ page: forbidden403, apify: () => apifyDataset([apifyRunError()]) });

    expect(boardError(await submit(PASTED_URL))).toBe(
      "otodom.pl odmówił pobrania ogłoszenia. Nic nie zostało zapisane — spróbuj ponownie za chwilę.",
    );
    expect(network.otodom()).toBe(1);
    expect(network.apify()).toBe(1);
    expect(network.writes()).toBe(0);
    expect(captured.entries().at(-1)).toStrictEqual({
      method: "error",
      args: [
        {
          level: "error",
          event: "offer_add",
          outcome: "failed",
          stage: "fetch",
          reason: "http_denied",
          ...IDS,
          ...FALLBACK_MODE,
          source: "apify",
          fallback_reason: "http_denied",
          apify_status: 201,
          apify_failure: "run_error",
          direct_duration_ms: 0,
          apify_duration_ms: 0,
        },
      ],
    });
    expect(captured.text()).not.toContain(APIFY_MESSAGE_CANARY);
  });

  const NOT_REACHED: [string, LegAnswer, Record<string, string | number>][] = [
    [
      "400 run-failed",
      () => apifyRunTimeout(),
      { apify_failure: "http", apify_status: 400, apify_error_type: "run-failed" },
    ],
    [
      "401",
      () => apifyError(401, "user-or-token-not-found"),
      { apify_failure: "http", apify_status: 401, apify_error_type: "user-or-token-not-found" },
    ],
    [
      "402",
      () => apifyError(402, "payment-required"),
      { apify_failure: "http", apify_status: 402, apify_error_type: "payment-required" },
    ],
    [
      "403 insufficient-permissions",
      () => apifyError(403, "insufficient-permissions"),
      { apify_failure: "http", apify_status: 403, apify_error_type: "insufficient-permissions" },
    ],
    [
      "403 full-permission-actor-not-approved",
      () => apifyError(403, "full-permission-actor-not-approved"),
      { apify_failure: "http", apify_status: 403, apify_error_type: "full-permission-actor-not-approved" },
    ],
    [
      "408",
      () => apifyError(408, "run-timeout-exceeded"),
      { apify_failure: "http", apify_status: 408, apify_error_type: "run-timeout-exceeded" },
    ],
    [
      "429",
      () => apifyError(429, "rate-limit-exceeded"),
      { apify_failure: "http", apify_status: 429, apify_error_type: "rate-limit-exceeded" },
    ],
    ["a network error", () => Promise.reject(new TypeError("fetch failed")), { apify_failure: "network" }],
    ["an empty dataset", () => apifyEmpty(), { apify_failure: "empty_dataset", apify_status: 201 }],
    [
      "a malformed item",
      () => apifyDataset([{ requestedUrl: NORMALISED_URL, status: "200" }]),
      { apify_failure: "malformed_item", apify_status: 201 },
    ],
  ];

  it.each(NOT_REACHED)(
    "lets the direct reason win when Apify answers %s: otodom 1, Apify 1, writes 0",
    async (_label, apify, apifyFields) => {
      const captured = captureConsole();
      const network = stubIngest({ page: forbidden403, apify });

      expect(boardError(await submit(PASTED_URL))).toBe(DENIED_403);
      expect(network.otodom()).toBe(1);
      expect(network.apify()).toBe(1);
      expect(network.writes()).toBe(0);
      // At error: the outcome is a failure, and a configuration fault or a run-failed would be one
      // even if it were not.
      expect(captured.entries().at(-1)).toStrictEqual({
        method: "error",
        args: [
          {
            level: "error",
            event: "offer_add",
            outcome: "failed",
            stage: "fetch",
            reason: "http_denied",
            status: 403,
            content_type: HTML,
            ...IDS,
            ...FALLBACK_MODE,
            source: "direct",
            fallback_reason: "http_denied",
            ...apifyFields,
            direct_duration_ms: 0,
            apify_duration_ms: 0,
          },
        ],
      });
      expect(captured.text()).not.toContain(APIFY_MESSAGE_CANARY);
      expect(captured.text()).not.toContain(APIFY_TEST_TOKEN);
    },
  );

  it("keeps data_missing from both legs and says so: otodom 1, Apify 1, writes 0", async () => {
    const captured = captureConsole();
    const network = stubIngest({
      page: () => responseAt(PAGE_WITHOUT_NEXT_DATA),
      apify: () => apifyDataset([apifyNoMarkerItem()]),
    });

    expect(boardError(await submit(PASTED_URL))).toBe(
      "otodom.pl przysłał stronę bez danych ogłoszenia — mógł zablokować pobranie albo zmienić format strony. Nic nie zostało zapisane.",
    );
    expect(network.otodom()).toBe(1);
    expect(network.apify()).toBe(1);
    expect(network.writes()).toBe(0);
    expect(lastFields(captured)).toStrictEqual({
      level: "error",
      event: "offer_add",
      outcome: "failed",
      stage: "fetch",
      reason: "data_missing",
      detail: "both_sources",
      status: 200,
      landed_host: "www.otodom.pl",
      landed_listing: "IDKANAR1",
      marker_present: false,
      ...IDS,
      ...FALLBACK_MODE,
      source: "apify",
      fallback_reason: "data_missing",
      apify_status: 201,
      direct_duration_ms: 0,
      apify_duration_ms: 0,
    });
  });
});

describe("POST /api/offers: the other modes, the missing token and a failed read of the mode", () => {
  it("saves through Apify alone in apify_only: otodom 0, Apify 1, writes 1", async () => {
    env.apifyToken = true;
    const captured = captureConsole();
    const network = stubIngest({ settings: () => ingestionSettingsRow("apify_only"), apify: apifySale });

    expect(location(await submit(PASTED_URL)).pathname).toBe(`/offers/${INSERTED_OFFER_ID}`);
    expect(network.otodom()).toBe(0);
    expect(network.apify()).toBe(1);
    expect(network.writes()).toBe(1);
    expect(lastFields(captured)).toStrictEqual({
      level: "info",
      event: "offer_add",
      outcome: "saved",
      stage: "insert",
      ...IDS,
      ...APIFY_ONLY_MODE,
      otodom_id: OTODOM_ID,
      offer_id: INSERTED_OFFER_ID,
      source: "apify",
      apify_status: 201,
      apify_duration_ms: 0,
    });
  });

  it("says extraction_failed when Apify never reaches otodom in apify_only: otodom 0, Apify 1, writes 0", async () => {
    env.apifyToken = true;
    const captured = captureConsole();
    const network = stubIngest({
      settings: () => ingestionSettingsRow("apify_only"),
      apify: () => apifyError(401, "user-or-token-not-found"),
    });

    expect(boardError(await submit(PASTED_URL))).toBe(EXTRACTION_FAILED);
    expect(network.otodom()).toBe(0);
    expect(network.apify()).toBe(1);
    expect(network.writes()).toBe(0);
    expect(lastFields(captured)).toStrictEqual({
      level: "error",
      event: "offer_add",
      outcome: "failed",
      stage: "fetch",
      reason: "extraction_failed",
      ...IDS,
      ...APIFY_ONLY_MODE,
      source: "apify",
      apify_status: 401,
      apify_error_type: "user-or-token-not-found",
      apify_failure: "http",
      apify_duration_ms: 0,
    });
  });

  it("fetches directly alone in direct_only, even with a token: otodom 1, Apify 0, writes 0", async () => {
    env.apifyToken = true;
    const captured = captureConsole();
    const network = stubIngest({ settings: () => ingestionSettingsRow("direct_only"), page: forbidden403 });

    expect(boardError(await submit(PASTED_URL))).toBe(DENIED_403);
    expect(network.otodom()).toBe(1);
    expect(network.apify()).toBe(0);
    expect(network.writes()).toBe(0);
    expect(lastFields(captured)).toMatchObject({
      reason: "http_denied",
      ingestion_mode: "direct_only",
      ingestion_mode_effective: "direct_only",
      ingestion_mode_read: "ok",
      source: "direct",
    });
    expect(lastFields(captured)).not.toHaveProperty("ingestion_mode_reason");
  });

  it("runs a configured apify_only as direct_only without a token: otodom 1, Apify 0, writes 1", async () => {
    const captured = captureConsole();
    const network = stubIngest({
      settings: () => ingestionSettingsRow("apify_only"),
      page: () => responseAt(otodomPage(flatSaleAd())),
    });

    expect(location(await submit(PASTED_URL)).pathname).toBe(`/offers/${INSERTED_OFFER_ID}`);
    expect(network.otodom()).toBe(1);
    expect(network.apify()).toBe(0);
    expect(network.writes()).toBe(1);
    expect(lastFields(captured)).toStrictEqual({
      level: "info",
      event: "offer_add",
      outcome: "saved",
      stage: "insert",
      ...IDS,
      otodom_id: OTODOM_ID,
      offer_id: INSERTED_OFFER_ID,
      ingestion_mode: "apify_only",
      ingestion_mode_effective: "direct_only",
      ingestion_mode_reason: "apify_unconfigured",
      ingestion_mode_read: "ok",
      source: "direct",
      direct_duration_ms: 0,
    });
  });

  // With a token and a direct 403 — a trigger — so a read taken for the seeded default would show
  // as an Apify request.
  it.each([
    [
      "error",
      () => jsonResponse({ code: "XX000", message: "internal error", details: null, hint: null }, 500),
      { db_code: "XX000", db_status: 500 },
    ],
    ["missing_row", () => jsonResponse([], 200), { db_status: 200 }],
    ["off_list", () => ingestionSettingsRow("najpierw_apify"), {}],
  ] as const)(
    "runs a failed read (%s) as direct_only: otodom 1, Apify 0, writes 0",
    async (read, settings, dbFields) => {
      env.apifyToken = true;
      const captured = captureConsole();
      const network = stubIngest({ settings, page: forbidden403 });

      expect(boardError(await submit(PASTED_URL))).toBe(DENIED_403);
      expect(network.otodom()).toBe(1);
      expect(network.apify()).toBe(0);
      expect(network.writes()).toBe(0);
      const failedMode = {
        ingestion_mode_effective: "direct_only",
        ingestion_mode_reason: "mode_read_failed",
        ingestion_mode_read: read,
      };
      expect(captured.entries()).toStrictEqual([
        {
          method: "info",
          args: [
            {
              level: "info",
              event: "offer_add",
              outcome: "started",
              stage: "fetch",
              ...IDS,
              ...failedMode,
              ...dbFields,
            },
          ],
        },
        {
          method: "error",
          args: [
            {
              level: "error",
              event: "offer_add",
              outcome: "failed",
              stage: "fetch",
              reason: "http_denied",
              status: 403,
              content_type: HTML,
              ...IDS,
              ...failedMode,
              source: "direct",
              direct_duration_ms: 0,
            },
          ],
        },
      ]);
    },
  );

  it("opens a duplicate by address without reading the mode: otodom 0, Apify 0, writes 0", async () => {
    env.apifyToken = true;
    captureConsole();
    const network = stubIngest({ precheck: () => jsonResponse([{ id: EXISTING_OFFER_ID }], 200) });

    expect(location(await submit(PASTED_URL)).pathname).toBe(`/offers/${EXISTING_OFFER_ID}`);
    expect(network.modeReads()).toBe(0);
    expect(network.otodom()).toBe(0);
    expect(network.apify()).toBe(0);
    expect(network.writes()).toBe(0);
  });
});

// The deadlines (src/lib/otodom/deadlines.ts), each one millisecond short and on the dot, against
// a side that never answers. The values are written out by hand from the plan.
describe("POST /api/offers: each leg ends at its deadline, and no timer outlives the action", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-17T10:00:00.000Z"));
  });

  /** Lets the route run until `done` holds, without moving the fake clock. */
  async function until(done: () => boolean): Promise<void> {
    for (let turn = 0; turn < 500 && !done(); turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(done()).toBe(true);
  }

  function track(promise: Promise<Response>) {
    const state = { settled: false };
    const settled = promise.finally(() => {
      state.settled = true;
    });
    return { state, settled };
  }

  it("falls back at 20 000 ms of a silent direct fetch, and not at 19 999: otodom 1, Apify 1, writes 1", async () => {
    env.apifyToken = true;
    const captured = captureConsole();
    const network = stubIngest({ page: apifySilence, apify: apifySale });
    const { state, settled } = track(submit(PASTED_URL));

    await until(() => network.otodom() === 1);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(state.settled).toBe(false);
    expect(network.apify()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const target = location(await settled);

    expect(target.pathname).toBe(`/offers/${INSERTED_OFFER_ID}`);
    expect(network.otodom()).toBe(1);
    expect(network.apify()).toBe(1);
    expect(network.writes()).toBe(1);
    expect(lastFields(captured)).toMatchObject({
      source: "apify",
      fallback_reason: "timeout",
      direct_duration_ms: 20_000,
      apify_duration_ms: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["direct_only with a token", true, () => ingestionSettingsRow("direct_only")],
    ["no token", false, () => ingestionSettingsRow()],
    ["a failed read of the mode", true, () => jsonResponse({ code: "XX000", message: "internal error" }, 500)],
  ] as const)(
    "gives a silent direct fetch 60 000 ms in %s, and not 59 999: otodom 1, Apify 0, writes 0",
    async (_label, token, settings) => {
      env.apifyToken = token;
      const captured = captureConsole();
      const network = stubIngest({ settings, page: apifySilence });
      const { state, settled } = track(submit(PASTED_URL));

      await until(() => network.otodom() === 1);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(state.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(boardError(await settled)).toBe(TIMED_OUT);
      expect(network.otodom()).toBe(1);
      expect(network.apify()).toBe(0);
      expect(network.writes()).toBe(0);
      expect(lastFields(captured)).toMatchObject({
        reason: "timeout",
        source: "direct",
        ingestion_mode_effective: "direct_only",
        direct_duration_ms: 60_000,
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ["direct_with_fallback, after a direct 403", "direct_with_fallback", forbidden403, DENIED_403, 1],
    ["apify_only", "apify_only", undefined, EXTRACTION_FAILED, 0],
  ] as const)(
    "gives a silent Apify run 40 000 ms in %s, and not 39 999",
    async (_label, mode, page, message, otodom) => {
      env.apifyToken = true;
      const captured = captureConsole();
      const network = stubIngest({ settings: () => ingestionSettingsRow(mode), page, apify: apifySilence });
      const { state, settled } = track(submit(PASTED_URL));

      await until(() => network.apify() === 1);
      await vi.advanceTimersByTimeAsync(39_999);
      expect(state.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(boardError(await settled)).toBe(message);
      expect(network.otodom()).toBe(otodom);
      expect(network.apify()).toBe(1);
      expect(network.writes()).toBe(0);
      expect(lastFields(captured)).toMatchObject({ apify_failure: "timeout", apify_duration_ms: 40_000 });
      expect(lastFields(captured)).not.toHaveProperty("apify_status");
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

// One assertion over every way out of the route: whatever a later change adds to an entry, the
// console must not carry the listing's words, the seller, the member's address or the pasted
// query (prd.md, Non-Functional Requirements; CLAUDE.md, "Secrets and data access"). Each
// scenario also names the stage its last entry reports, so a scenario that stopped reaching
// its exit — and therefore logs nothing worth searching — fails instead of passing empty.
describe("POST /api/offers: no log entry carries listing, seller or member data (#6)", () => {
  const TITLE = "Mieszkanie 3 pokoje, 54,5 m², Praga-Południe";
  const FAILING_ROW = `Failing row contains (65000001, ${TITLE}, Kontakt: ${CANARY_NAME}, tel. ${CANARY_PHONE}).`;
  /** The slug of the offer a redirect lands on in one scenario; only its `ID…` token may be logged. */
  const LANDED_SLUG_WORDS = "kawalerka-po-remoncie";
  // Forbidden on every way out.
  const COMMON = [
    ...SELLER_CANARIES,
    CANARY_PHONE,
    CANARY_NAME,
    USER_EMAIL,
    TITLE,
    "Failing row",
    "utm_source",
    "olx.pl",
    NORMALISED_URL,
    // The path of an offer page, the pasted one or the one a redirect landed on.
    "/oferta/",
    // The words of the pasted slug; only its `ID…` token may be logged.
    "mieszkanie-54-m-warszawa",
    LANDED_SLUG_WORDS,
    // A fetched page's text.
    CHALLENGE_CANARY,
    // Apify's words — an error's message, a run's `#debug` — and the token.
    APIFY_MESSAGE_CANARY,
    APIFY_TEST_TOKEN,
  ];
  // What every scenario is searched for unless its row says otherwise. An entry whose subject is
  // where a redirect landed carries the landing's host — `www.otodom.pl` when the portal kept the
  // request — so only such a row names `COMMON`, in its fourth column.
  const STRICT = [...COMMON, "otodom.pl", "mieszkanie", "warszawa"];

  /** A row's own terms: the list it is searched for, and a text its log has to carry. */
  interface Searched {
    forbidden: readonly string[];
    present?: string;
  }

  const jsonBody = () =>
    new Request("http://localhost/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: PASTED_URL }),
    });

  const SCENARIOS: [string, string, () => Promise<Response>, Searched?][] = [
    [
      "auth",
      "a signed-out visitor",
      () => {
        stubFetch(() => undefined);
        return submit(PASTED_URL, null);
      },
    ],
    [
      "body",
      "a body that is not a form",
      () => {
        stubFetch(() => undefined);
        return post(jsonBody(), MEMBER);
      },
    ],
    [
      "url",
      "an address from another portal",
      () => {
        stubFetch(() => undefined);
        return submit("https://www.olx.pl/d/oferta/mieszkanie-54-m-warszawa-IDKANAR1?utm_source=kanarek");
      },
    ],
    [
      "precheck",
      "a failed duplicate check",
      () => {
        stubDatabase({ precheck: () => jsonResponse({ code: "PGRST301", message: "JWT expired" }, 401) });
        return submit(PASTED_URL);
      },
    ],
    [
      "precheck",
      "a duplicate by address",
      () => {
        stubDatabase({ precheck: () => jsonResponse([{ id: EXISTING_OFFER_ID }], 200) });
        return submit(PASTED_URL);
      },
    ],
    [
      "fetch",
      "an HTTP 403 from otodom",
      () => {
        stubNetwork(() => responseAt("<html></html>", { status: 403 }));
        return submit(PASTED_URL);
      },
    ],
    [
      "fetch",
      "a challenge page marked cf-mitigated, with a canary in its text",
      () => {
        stubNetwork(() => responseAt(CHALLENGE_PAGE, { status: 403, headers: { "cf-mitigated": "challenge" } }));
        return submit(PASTED_URL);
      },
    ],
    [
      // The one challenge page whose text the fetch does read.
      "fetch",
      "a challenge page served with 200 and no header, with a canary in its text",
      () => {
        stubNetwork(() => responseAt(CHALLENGE_PAGE));
        return submit(PASTED_URL);
      },
    ],
    [
      "fetch",
      "a redirect off otodom whose query string carries the offer's address",
      () => {
        const next = encodeURIComponent(NORMALISED_URL);
        const url = `https://consent.example/zgoda/start?next=${next}&back=${NORMALISED_URL}&utm_source=kanarek#krok-1`;
        stubNetwork(() => responseAt(otodomPage(flatSaleAd()), { url }));
        return submit(PASTED_URL);
      },
    ],
    [
      "fetch",
      "a network error whose message quotes the whole address",
      () => {
        const error = new TypeError(`request to ${NORMALISED_URL}?utm_source=kanarek failed, reason: socket hang up`, {
          cause: new RangeError(`connect ECONNREFUSED ${PASTED_URL}`),
        });
        stubNetwork(() => Promise.reject(error));
        return submit(PASTED_URL);
      },
    ],
    [
      "fetch",
      "a redirect to another offer",
      () => {
        const url = `https://www.otodom.pl/pl/oferta/${LANDED_SLUG_WORDS}-IDKANAR2?utm_source=kanarek`;
        stubNetwork(() => responseAt(otodomPage(flatSaleAd()), { url }));
        return submit(PASTED_URL);
      },
      { forbidden: COMMON, present: "IDKANAR2" },
    ],
    [
      // The path keeps its shape and loses the slug, so this row allows the segment's name alone.
      "fetch",
      "a redirect to a page under another offer",
      () => {
        const url = `https://www.otodom.pl/pl/oferta/${LANDED_SLUG_WORDS}-IDKANAR2/galeria?utm_source=kanarek`;
        stubNetwork(() => responseAt(otodomPage(flatSaleAd()), { url }));
        return submit(PASTED_URL);
      },
      { forbidden: COMMON.filter((text) => text !== "/oferta/"), present: "/pl/oferta/<slug>/galeria" },
    ],
    [
      "fetch",
      "a redirect off otodom to a page that repeats the offer's address in its path",
      () => {
        const url = `https://consent.example/r/${encodeURIComponent(NORMALISED_URL)}`;
        stubNetwork(() => responseAt(otodomPage(flatSaleAd()), { url }));
        return submit(PASTED_URL);
      },
      { forbidden: STRICT, present: "/r/<slug>" },
    ],
    [
      // The path is logged, so the fixture's path shares no word with the offer's slug.
      "fetch",
      "a redirect to the results page",
      () => {
        const url = "https://www.otodom.pl/pl/wyniki/sprzedaz/kawalerka/krakow?utm_source=kanarek";
        stubNetwork(() => responseAt(otodomPage(flatSaleAd()), { url }));
        return submit(PASTED_URL);
      },
      { forbidden: COMMON, present: "/pl/wyniki/sprzedaz/kawalerka/krakow" },
    ],
    [
      "fetch",
      "an Apify refusal after a direct 403, whose message carries a canary",
      () => {
        env.apifyToken = true;
        stubIngest({ page: forbidden403, apify: () => apifyError(401, "user-or-token-not-found") });
        return submit(PASTED_URL);
      },
    ],
    [
      "fetch",
      "an Apify run that could not read the page, whose #debug carries a canary",
      () => {
        env.apifyToken = true;
        stubIngest({ page: forbidden403, apify: () => apifyDataset([apifyRunError()]) });
        return submit(PASTED_URL);
      },
    ],
    [
      "fetch",
      "an Apify run past its timeout, whose message carries a canary",
      () => {
        env.apifyToken = true;
        stubIngest({ page: forbidden403, apify: () => apifyRunTimeout() });
        return submit(PASTED_URL);
      },
    ],
    [
      "insert",
      "a flat saved through Apify",
      () => {
        env.apifyToken = true;
        stubIngest({ page: forbidden403, apify: apifySale });
        return submit(PASTED_URL);
      },
    ],
    [
      "map",
      "a house for sale",
      () => {
        stubNetwork(() => responseAt(otodomPage(saleHouse())));
        return submit(PASTED_URL);
      },
    ],
    [
      "insert",
      "a saved flat",
      () => {
        stubNetwork(() => responseAt(otodomPage(flatSaleAd())));
        return submit(PASTED_URL);
      },
    ],
    [
      "insert",
      "an insert Postgres rejected, quoting the row in its details",
      () => {
        const message = 'new row for relation "offers" violates check constraint "offers_price_check"';
        stubDatabase({
          insert: () => jsonResponse({ code: "23514", message, details: FAILING_ROW, hint: null }, 400),
        });
        return submit(PASTED_URL);
      },
    ],
    [
      "twin",
      "a twin lookup that failed, quoting the row in its details",
      () => {
        stubDatabase({
          insert: () => jsonResponse({ ...UNIQUE_VIOLATION, details: FAILING_ROW }, 409),
          twin: () => jsonResponse({ code: "XX000", message: "internal error", details: FAILING_ROW }, 500),
        });
        return submit(PASTED_URL);
      },
    ],
  ];

  it.each(SCENARIOS)("at the %s stage: %s", async (stage, _label, run, searched = { forbidden: STRICT }) => {
    const captured = captureConsole();
    await run();

    const last = captured.entries().at(-1);
    expect(last?.args).toHaveLength(1);
    expect(last?.args[0]).toMatchObject({ event: "offer_add", stage });

    const text = captured.text();
    for (const forbidden of searched.forbidden) {
      expect(text).not.toContain(forbidden);
    }
    if (searched.present !== undefined) expect(text).toContain(searched.present);
  });
});
