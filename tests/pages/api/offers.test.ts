import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/offers";
import {
  INSERTED_OFFER_ID,
  PAGE_WITHOUT_NEXT_DATA,
  type RecordedRequest,
  emptyOffersTable,
  isOffersRequest,
  isOtodomRequest,
  otodomPage,
  responseAt,
  restoreFetch,
  stubFetch,
} from "../../fixtures/http";
import { CANARY_NAME, CANARY_PHONE, SELLER_CANARIES, flatSaleAd, rentalFlat, saleHouse } from "../../fixtures/otodom";

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

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";

/** The canonical form of the pasted URL, written out by hand (FR-005: no query, `/pl`, no trailing slash). */
const NORMALISED_URL = "https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1";
const PASTED_URL = "https://otodom.pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1/?utm_source=kanarek";

/** Serves `page` for otodom and answers the route's planned Supabase requests. */
function stubNetwork(page: () => Response) {
  return stubFetch((request) => (isOtodomRequest(request) ? page() : emptyOffersTable(request)));
}

async function submit(url: string): Promise<Response> {
  const form = new FormData();
  form.set("url", url);
  const context = {
    request: new Request("http://localhost/api/offers", { method: "POST", body: form }),
    locals: { user: { id: USER_ID } },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return POST(context);
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
  // Each distinguishing fragment is the part of the message that names the reason.
  const REFUSALS: [string, () => Response, string[]][] = [
    ["a flat for rent", () => responseAt(otodomPage(rentalFlat())), ["wynajmu"]],
    ["a house for sale", () => responseAt(otodomPage(saleHouse())), ["innego rodzaju nieruchomości"]],
    ["a page without __NEXT_DATA__", () => responseAt(PAGE_WITHOUT_NEXT_DATA), ["zmienić format"]],
    ["an HTTP 403 from otodom", () => responseAt("<html></html>", { status: 403 }), ["odmówił", "(HTTP 403)"]],
  ];

  it.each(REFUSALS)("refuses %s with its own message and no insert", async (_label, page, fragments) => {
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
  });
});

describe("POST /api/offers: a flat for sale is saved once, without seller data (#1, #6)", () => {
  async function saved(): Promise<{ response: Response; requests: RecordedRequest[] }> {
    const stub = stubNetwork(() => responseAt(otodomPage(flatSaleAd())));
    const response = await submit(PASTED_URL);
    return { response, requests: stub.requests };
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
});
