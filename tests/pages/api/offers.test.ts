import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/offers";
import { type ConsoleCapture, type ConsoleEntry, captureConsole, restoreConsole } from "../../fixtures/console";
import {
  CHALLENGE_CANARY,
  CHALLENGE_PAGE,
  INSERTED_OFFER_ID,
  PAGE_WITHOUT_NEXT_DATA,
  type RecordedRequest,
  emptyOffersTable,
  isOffersRequest,
  isOtodomRequest,
  jsonResponse,
  otodomPage,
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
// @/lib/supabase and @/lib/otodom run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes come from prd.md: FR-005 (a rental or a non-flat is refused naming which
// check failed, "and nothing is saved"), the Non-Functional Requirements (a fetch problem is
// reported as one, no blank or partial offer is saved; the advertiser's phone and name are
// never stored, while the description keeps the advertiser's words verbatim).

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
/** The member's address is on `locals.user` in production too; no log entry may carry it. */
const USER_EMAIL = "czlonek.kanarek@vetpad.local";

/** The canonical form of the pasted URL, written out by hand (FR-005: no query, `/pl`, no trailing slash). */
const NORMALISED_URL = "https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1";
const PASTED_URL = "https://otodom.pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1/?utm_source=kanarek";

type Answer = () => Response | Promise<Response>;

/** Serves `page` for otodom and answers the route's planned Supabase requests. */
function stubNetwork(page: Answer) {
  return stubFetch((request) => (isOtodomRequest(request) ? page() : emptyOffersTable(request)));
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

/** The entry the route leaves before it reaches for otodom.pl, so a fetch the platform cut short still has a trace. */
const STARTED: ConsoleEntry = {
  method: "info",
  args: [{ level: "info", event: "offer_add", outcome: "started", stage: "fetch", user_id: USER_ID, listing: LISTING }],
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
      // The landing is an offer page, so it is named by its token: the slug's words stay out.
      "a redirect to another offer whose page carries no data",
      () =>
        responseAt(PAGE_WITHOUT_NEXT_DATA, { url: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2" }),
      ["przysłał stronę bez danych ogłoszenia"],
      "error",
      {
        outcome: "failed",
        stage: "fetch",
        reason: "data_missing",
        status: 200,
        content_type: HTML,
        landed_host: "www.otodom.pl",
        landed_listing: "IDKANAR2",
        body_length: PAGE_WITHOUT_NEXT_DATA.length,
        marker_present: false,
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
      ["dłużej niż 45 sekund"],
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
      // The headers did arrive, so the entry keeps what they said beside the error.
      "a body that timed out while it was being read",
      () => unreadableResponse(new DOMException("The operation timed out.", "TimeoutError")),
      ["dłużej niż 45 sekund"],
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
      { method: level, args: [{ level, event: "offer_add", ...entry, user_id: USER_ID, listing: LISTING }] },
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
        },
      ],
    });
  });
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
      "a redirect to another offer whose page carries no data",
      () => {
        const url = `https://www.otodom.pl/pl/oferta/${LANDED_SLUG_WORDS}-IDKANAR2?utm_source=kanarek`;
        stubNetwork(() => responseAt(PAGE_WITHOUT_NEXT_DATA, { url }));
        return submit(PASTED_URL);
      },
      { forbidden: COMMON, present: "IDKANAR2" },
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
