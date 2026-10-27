import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/offer-refetch";
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
  CHALLENGE_PAGE,
  type FetchContext,
  PAGE_WITHOUT_NEXT_DATA,
  type RecordedRequest,
  ingestionSettingsRow,
  isIngestionSettingsRead,
  isOffersRequest,
  isOtodomRequest,
  jsonResponse,
  otodomPage,
  pageWithNextData,
  responseAt,
  restoreFetch,
  stubFetch,
} from "../../fixtures/http";
import {
  type Ad,
  CANARY_NAME,
  CANARY_PHONE,
  SELLER_CANARIES,
  flatSaleAd,
  rentalFlat,
  saleHouse,
  withCharacteristic,
} from "../../fixtures/otodom";

// The route with a configured Supabase client (test values, never a real project's): this mock
// overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase, @/lib/otodom, the Apify leg, @/lib/offer-refetch and @/lib/audit/input run as
// they do in production.
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
    GOOGLE_MAPS_SERVER_KEY: undefined,
    GOOGLE_MAPS_BROWSER_KEY: undefined,
    get APIFY_TOKEN() {
      return env.apifyToken ? APIFY_TEST_TOKEN : undefined;
    },
    getSecret: () => undefined,
  };
});

// Expected outcomes come from prd.md: FR-009 (a member re-fetches a saved listing on demand; the
// scraped data is replaced and nothing else), the Guardrails (human-authored notes are never
// overwritten by machine action; a failed fetch is reported as a fetch problem), FR-005 (only a
// sale of a flat is kept) and the Non-Functional Requirements (the advertiser's phone and name
// are never stored). The table of outcomes is "Desired End State" in
// context/changes/refetch-and-stale-audit/plan.md, and every scenario states how many requests
// reached otodom and how many writes reached `offers`.
//
// How the route talks to Supabase (supabase-js / postgrest-js, as tests/fixtures/http.ts reads it):
//
// - The stored row, `.from("offers").select("source_url, otodom_id, <the audit's columns>")
//   .eq("id", id).maybeSingle()`: `GET <SUPABASE_URL>/rest/v1/offers?select=source_url,otodom_id,
//   title,…&id=eq.<id>`. `200 []` becomes `data: null` with no error (no such offer), `[row]`
//   becomes `row`; `500` with `{ "code", "message", … }` is a result with `error` set, at once.
// - The write, `.from("offers").update(values).eq("id", id).select("<the audit's columns>")`:
//   `PATCH <SUPABASE_URL>/rest/v1/offers?id=eq.<id>&select=title,…` with
//   `Prefer: return=representation`; the body is `JSON.stringify(values)`. PostgREST answers `200`
//   with an array of the rows it changed, `[]` when it reached none — which is not an error. A
//   `PATCH` is never retried: a rejected `fetch` comes back at once as an error with status `0`.

/** Every request any scenario of this file made, for the one assertion at the bottom of it. */
const everyRequest: RecordedRequest[] = [];
let scenarios = 0;

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
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000f37c4";

/** The stored address, and the only address a re-fetch may ask otodom for. */
const STORED_URL = "https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1";
const LISTING = "IDKANAR1";
const OTODOM_ID = 65000001;
const TITLE = "Mieszkanie 3 pokoje, 54,5 m², Praga-Południe";
const HTML = "text/html; charset=utf-8";

/**
 * The stored row as the route's read returns it, written out by hand: what `flatSaleAd()` is in
 * `public.offers` — the description as plain text, every enum as its token.
 */
const STORED_ROW: Record<string, unknown> = {
  source_url: STORED_URL,
  otodom_id: OTODOM_ID,
  title: TITLE,
  description: `Sprzedam mieszkanie 3-pokojowe, 54,5 m², 7. piętro w bloku z 1975 roku.\n\nKontakt: ${CANARY_NAME}, tel. ${CANARY_PHONE}.`,
  price: 599000,
  price_currency: "PLN",
  price_per_m: 10990.83,
  area_m2: 54.5,
  rooms: 3,
  floors_total: 10,
  build_year: 1975,
  rent: 650,
  rent_currency: "PLN",
  floor: "floor_7",
  market: "secondary",
  building_type: "block",
  construction_status: "ready_to_use",
  building_ownership: "full_ownership",
  heating: "urban",
  windows_type: "plastic",
  building_material: "concrete_plate",
  energy_certificate: "c",
  advert_type: "PRIVATE",
  free_from: "2026-11-01",
  location_label: "Praga-Południe, Warszawa, mazowieckie",
  street_name: "ul. Kanarkowa",
  features: ["balkon", "winda"],
};

/** The listing as otodom serves it now, with the rent the advertiser no longer states. */
function adWithoutRent(): Ad {
  return withCharacteristic(flatSaleAd(), "rent", null);
}

/** The listing with another price: a stated value that changed into another stated value. */
function adWithNewPrice(): Ad {
  return withCharacteristic(flatSaleAd(), "price", { value: "579000", localizedValue: "579 000 zł" });
}

type Answer = () => Response | Promise<Response>;
type LegAnswer = (context: FetchContext) => Response | Promise<Response>;

function isStoredRead(request: RecordedRequest): boolean {
  return isOffersRequest(request, "GET") && new URL(request.url).searchParams.has("id");
}

function isOfferWrite(request: RecordedRequest): boolean {
  return isOffersRequest(request, "PATCH");
}

/** What PostgREST answers a write with: the changed row, cut down to the columns `select` names. */
function echoWrite(request: RecordedRequest): Response {
  const columns = (new URL(request.url).searchParams.get("select") ?? "").split(",");
  const sent = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
  return jsonResponse([Object.fromEntries(columns.map((column) => [column, sent[column]]))], 200);
}

interface Network {
  /** What otodom serves. Left out, a request to otodom is unplanned and fails the test. */
  page?: LegAnswer;
  /** What Apify answers a run with. Left out, a request to Apify is unplanned and fails the test. */
  apify?: LegAnswer;
  /** The answer to the mode's read. Left out, the row holds the seeded default. */
  settings?: Answer;
  /** The stored row the read finds; `null` for an offer that is not there. */
  stored?: Record<string, unknown> | null;
  /** The read's whole answer, instead of `stored`. */
  read?: Answer;
  /** The write's answer. Left out, the write is echoed back the way PostgREST does. */
  write?: Answer;
}

/**
 * Plans the route's requests and nothing else: the read of the stored row, the read of the mode,
 * the listing page, an Apify run where the scenario plans one, and the write. Anything further —
 * a note, an audit — is unplanned and fails the test.
 */
function stubNetwork({
  page,
  apify,
  settings = () => ingestionSettingsRow(),
  stored = STORED_ROW,
  read,
  write,
}: Network) {
  scenarios += 1;
  const stub = stubFetch((request, context) => {
    everyRequest.push(request);
    if (isOtodomRequest(request)) return page?.(context);
    if (isApifyRequest(request)) return apify?.(context);
    if (isIngestionSettingsRead(request)) return settings();
    if (isStoredRead(request)) return read ? read() : jsonResponse(stored === null ? [] : [stored], 200);
    if (isOfferWrite(request)) return write ? write() : echoWrite(request);
    return undefined;
  });
  return {
    requests: stub.requests,
    otodom: () => stub.requests.filter(isOtodomRequest),
    apify: () => apifyCalls(stub.requests),
    writes: () => stub.requests.filter(isOfferWrite),
    modeReads: () => stub.requests.filter(isIngestionSettingsRead),
  };
}

interface Member {
  id: string;
  email: string;
}
const MEMBER: Member = { id: USER_ID, email: USER_EMAIL };

async function post(request: Request, user: Member | null): Promise<Response> {
  const context = {
    request,
    locals: { user },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return POST(context);
}

async function submit(fields: Record<string, string>, user: Member | null = MEMBER): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return post(new Request("http://localhost/api/offer-refetch", { method: "POST", body: form }), user);
}

function refetch(acceptLost?: string): Promise<Response> {
  return submit(acceptLost === undefined ? { offer_id: OFFER_ID } : { offer_id: OFFER_ID, accept_lost: acceptLost });
}

function location(response: Response): URL {
  // Never a 500 and never JSON: every answer of the route is a redirect.
  expect(response.status).toBe(302);
  expect(response.headers.get("Content-Type")).toBeNull();
  const header = response.headers.get("Location");
  if (header === null) throw new Error("expected a redirect with a Location header");
  return new URL(header, "http://localhost");
}

/** The failure redirect back to the card's re-fetch block. Returns the message. */
function cardError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
  expect(target.searchParams.get("form")).toBe("refetch");
  expect(target.hash).toBe("#pobranie");
  const message = target.searchParams.get("error");
  if (message === null || message === "") throw new Error("expected the redirect to carry an error message");
  return message;
}

/** The failure redirect to the board, for an offer there is no card of. Returns the message. */
function boardError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe("/dashboard");
  const message = target.searchParams.get("error");
  if (message === null || message === "") throw new Error("expected the redirect to carry an error message");
  return message;
}

function writtenRow(writes: RecordedRequest[]): Record<string, unknown> {
  expect(writes).toHaveLength(1);
  const body = writes[0]?.body;
  if (typeof body !== "string") throw new Error("expected the write to carry a JSON body");
  return JSON.parse(body) as Record<string, unknown>;
}

/** The fields every entry written once the offer and its address are known carries. */
const IDS = { user_id: USER_ID, offer_id: OFFER_ID, listing: LISTING };

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
/**
 * What every entry after the fetch carries in that mode: the identifiers, the mode, and the direct
 * leg, which took no time on a clock that stands still.
 */
const AFTER = { ...IDS, ...NO_TOKEN_MODE, source: "direct", direct_duration_ms: 0 };

/** The entry the route leaves before it reaches for otodom.pl, so a fetch the platform cut short still has a trace. */
const STARTED: ConsoleEntry = {
  method: "info",
  args: [{ level: "info", event: "offer_refetch", outcome: "started", stage: "fetch", ...IDS, ...NO_TOKEN_MODE }],
};

function entry(level: "info" | "error", fields: Record<string, string | number | boolean>): ConsoleEntry {
  return { method: level, args: [{ level, event: "offer_refetch", ...fields }] };
}

const KEPT = "Zapisane dane oferty pozostały bez zmian";

describe("POST /api/offer-refetch: a successful fetch overwrites the row and says whether the audit's data changed", () => {
  it("reports an unchanged listing: one fetch, one write, a new fetch date", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(flatSaleAd())) });
    const before = Date.now();

    const target = location(await refetch());

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?refetched=unchanged");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    // The row is overwritten even when nothing changed: the fetch date is this fetch's.
    const fetchedAt = Date.parse(String(writtenRow(network.writes()).fetched_at));
    expect(fetchedAt).toBeGreaterThanOrEqual(before);
    expect(fetchedAt).toBeLessThanOrEqual(Date.now());
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("info", { outcome: "saved", stage: "update", ...AFTER, otodom_id: OTODOM_ID, changed: false }),
    ]);
  });

  it("reports a changed listing when a stated price became another stated price", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(adWithNewPrice())) });

    const target = location(await refetch());

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?refetched=changed");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    expect(writtenRow(network.writes()).price).toBe(579000);
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("info", { outcome: "saved", stage: "update", ...AFTER, otodom_id: OTODOM_ID, changed: true }),
    ]);
  });

  // The comparison goes through the database's rows: a `numeric` PostgREST sends as text, and an
  // id it sends as text, are the same listing — not a change.
  it("reads numbers the database sends as text as the same listing", async () => {
    captureConsole();
    const stored = { ...STORED_ROW, otodom_id: "65000001", price: "599000.00", area_m2: "54.50" };
    const network = stubNetwork({ page: () => responseAt(otodomPage(flatSaleAd())), stored });

    const target = location(await refetch());

    expect(target.search).toBe("?refetched=unchanged");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
  });

  it("asks otodom for the stored address in its normalised form and writes to the offer's own row", async () => {
    captureConsole();
    const stored = {
      ...STORED_ROW,
      source_url: "https://otodom.pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1/?utm_source=kanarek",
    };
    const network = stubNetwork({ page: () => responseAt(otodomPage(flatSaleAd())), stored });

    await refetch();

    expect(network.otodom().map((request) => request.url)).toEqual([STORED_URL]);
    const params = new URL(network.writes()[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe(`eq.${OFFER_ID}`);
    // Without `select`, PostgREST answers 204 with no body and a filtered write looks like a save.
    expect(params.get("select")).not.toBeNull();
    // The stored row, the mode, the page and the write — and nothing else.
    expect(network.requests).toHaveLength(4);
    expect(network.modeReads()).toHaveLength(1);
  });

  it("sends the mapper's columns and the fetch date — never the row's identity, address or author", async () => {
    captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(flatSaleAd())) });

    await refetch();
    const row = writtenRow(network.writes());

    // Written out by hand, not imported from the code under test.
    expect(Object.keys(row).sort()).toEqual(
      [
        "advert_type",
        "area_m2",
        "build_year",
        "building_material",
        "building_ownership",
        "building_type",
        "construction_status",
        "description",
        "energy_certificate",
        "features",
        "fetched_at",
        "floor",
        "floors_total",
        "free_from",
        "heating",
        "images",
        "latitude",
        "listed_at",
        "listing_modified_at",
        "location_label",
        "longitude",
        "market",
        "otodom_id",
        "price",
        "price_currency",
        "price_per_m",
        "raw",
        "rent",
        "rent_currency",
        "rooms",
        "street_name",
        "title",
        "windows_type",
      ].sort(),
    );
    for (const forbidden of ["id", "source_url", "created_by", "created_at"]) {
      expect(row).not.toHaveProperty(forbidden);
    }
    // Neither the member nor the stored address travels in any column.
    const body = network.writes()[0]?.body ?? "";
    expect(body).not.toContain(USER_ID);
    expect(body).not.toContain(OFFER_ID);
  });

  it("writes no seller phone, name or account id outside the listing's text", async () => {
    captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(flatSaleAd())) });

    await refetch();
    const { description, raw, ...columns } = writtenRow(network.writes());

    expect(raw).toBeTypeOf("object");
    const { description: _rawDescription, ...rawRest } = raw as Record<string, unknown>;
    const serialised = JSON.stringify({ ...columns, raw: rawRest });
    for (const canary of SELLER_CANARIES) {
      expect(serialised).not.toContain(canary);
    }
    // Control: the fixture does hold them, in the words the advertiser typed, which stay verbatim.
    expect(description).toContain(CANARY_PHONE);
    expect(description).toContain(CANARY_NAME);
  });
});

describe("POST /api/offer-refetch: a fact the stored listing states and the fetched one does not stops the save", () => {
  it("holds the save and names the columns that would be lost: one fetch, no write", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(adWithoutRent())) });

    const target = location(await refetch());

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    // The amount and its currency go together: the mapper states no currency without an amount.
    expect(target.searchParams.get("lost")).toBe("rent,rent_currency");
    expect(target.searchParams.has("error")).toBe(false);
    expect(target.searchParams.has("refetched")).toBe(false);
    expect(target.hash).toBe("#pobranie");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("info", {
        outcome: "held",
        stage: "lost_facts",
        reason: "lost_facts",
        ...AFTER,
        otodom_id: OTODOM_ID,
        lost_columns: "rent,rent_currency",
      }),
    ]);
  });

  it.each([
    ["exactly the columns that are lost", "rent,rent_currency"],
    ["more than is lost", "heating,rent_currency,rent"],
  ])("overwrites the row when the member agreed to %s: one fetch, one write", async (_label, accepted) => {
    const captured = captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(adWithoutRent())) });

    const target = location(await refetch(accepted));

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?refetched=changed");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    const row = writtenRow(network.writes());
    // An unstated fact is `null` — never zero.
    expect(row.rent).toBeNull();
    expect(row.rent_currency).toBeNull();
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("info", {
        outcome: "saved",
        stage: "update",
        ...AFTER,
        otodom_id: OTODOM_ID,
        changed: true,
        lost_columns: "rent,rent_currency",
      }),
    );
  });

  it.each([
    ["only a part of what is lost", "rent"],
    ["a column that is not lost", "heating"],
    ["tokens that are no columns of the listing", "rent,RENT_CURRENCY,id,source_url,<script>,*"],
    ["nothing", ""],
  ])("holds the save again when the member agreed to %s: one fetch, no write", async (_label, accepted) => {
    captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(adWithoutRent())) });

    const target = location(await refetch(accepted));

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    // The whole list again, not the part that was not agreed to: the member sees what goes.
    expect(target.searchParams.get("lost")).toBe("rent,rent_currency");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
  });

  // The control for the rule: a value that changed is not a loss, with or without an agreement.
  it("does not hold a listing whose stated fact only changed, whatever the form agreed to", async () => {
    captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(adWithNewPrice())) });

    const target = location(await refetch(""));

    expect(target.searchParams.has("lost")).toBe(false);
    expect(target.search).toBe("?refetched=changed");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
  });
});

// A stored row that does not read is exactly what a re-fetch repairs: it is overwritten without
// the lost-facts rule, and the answer says neither "changed" nor "unchanged".
describe("POST /api/offer-refetch: a stored row that does not read does not block the re-fetch", () => {
  it.each([
    ["a blank title", { ...STORED_ROW, title: "   " }],
    ["a zero where a price stands", { ...STORED_ROW, price: 0 }],
    ["amenities that are not a list", { ...STORED_ROW, features: "balkon" }],
  ])("overwrites a row with %s and answers neutrally: one fetch, one write", async (_label, stored) => {
    const captured = captureConsole();
    // The fetched listing lacks the rent the stored row states: with a readable row this is held.
    const network = stubNetwork({ page: () => responseAt(otodomPage(adWithoutRent())), stored });

    const target = location(await refetch());

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?refetched=saved");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    // No `changed` at all: there was nothing to compare with.
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("info", { outcome: "saved", stage: "update", ...AFTER, otodom_id: OTODOM_ID }),
    ]);
  });

  it("answers neutrally when the row the write returned does not read: one fetch, one write", async () => {
    const captured = captureConsole();
    const network = stubNetwork({
      page: () => responseAt(otodomPage(flatSaleAd())),
      write: () => jsonResponse([{ title: TITLE }], 200),
    });

    const target = location(await refetch());

    expect(target.search).toBe("?refetched=saved");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("info", { outcome: "saved", stage: "update", ...AFTER, otodom_id: OTODOM_ID }),
    );
  });
});

describe("POST /api/offer-refetch: a failed fetch says why and leaves the stored row alone", () => {
  const EXPIRED_PAGE = otodomPage(flatSaleAd({ shouldShowExpiredAdPage: true }));

  // Each fragment is the part of the message that names the reason. The last two columns are the
  // log entry: a refusal the product expects is info, a failure is an error.
  const FAILURES: [string, Answer, string[], "info" | "error", Record<string, string | number | boolean>][] = [
    [
      "an expired listing that still ships its payload",
      () => responseAt(EXPIRED_PAGE),
      ["nie istnieje już na otodom.pl lub wygasło"],
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
      "an HTTP 404 from otodom",
      () => responseAt("<html></html>", { status: 404 }),
      ["nie istnieje już na otodom.pl lub wygasło"],
      "info",
      { outcome: "refused", stage: "fetch", reason: "not_found", status: 404, content_type: HTML },
    ],
    [
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
      "an HTTP 403 from otodom",
      () => responseAt("<html></html>", { status: 403 }),
      ["odmówił", "(HTTP 403)"],
      "error",
      { outcome: "failed", stage: "fetch", reason: "http_denied", status: 403, content_type: HTML },
    ],
    [
      "an HTTP 503 from otodom",
      () => responseAt("<html></html>", { status: 503 }),
      ["chwilowo niedostępny", "(HTTP 503)"],
      "error",
      { outcome: "failed", stage: "fetch", reason: "upstream_error", status: 503, content_type: HTML },
    ],
    [
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
      "a fetch that timed out",
      () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
      [`Pobieranie ogłoszenia trwało zbyt długo. ${KEPT} — spróbuj ponownie.`],
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
      "a page without __NEXT_DATA__",
      () => responseAt(PAGE_WITHOUT_NEXT_DATA),
      ["przysłał stronę bez danych ogłoszenia", "zmienić format strony"],
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
      // The page is whole and readable, and it is another listing's.
      "a redirect to another offer",
      () =>
        responseAt(otodomPage(flatSaleAd()), { url: "https://www.otodom.pl/pl/oferta/kawalerka-po-remoncie-IDKANAR2" }),
      ["nie istnieje już na otodom.pl lub wygasło"],
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
      "a listing that became a rental",
      () => responseAt(otodomPage(rentalFlat())),
      ["dotyczy teraz wynajmu"],
      "info",
      { outcome: "refused", stage: "map", reason: "not_for_sale" },
    ],
    [
      "a listing that is no longer a flat",
      () => responseAt(otodomPage(saleHouse())),
      ["dotyczy teraz innego rodzaju nieruchomości"],
      "info",
      { outcome: "refused", stage: "map", reason: "not_a_flat", detail: "dom" },
    ],
  ];

  it.each(FAILURES)("reports %s on the card: one fetch, no write", async (_label, page, fragments, level, fields) => {
    const captured = captureConsole();
    const network = stubNetwork({ page });

    const message = cardError(await refetch());

    for (const fragment of fragments) {
      expect(message).toContain(fragment);
    }
    // Nothing was saved before, and something is saved now: the sentence says the row was kept.
    expect(message).toContain(KEPT);
    expect(message).not.toContain("Nic nie zostało zapisane");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([STARTED, entry(level, { ...fields, ...AFTER })]);
  });

  // The address answers with a whole flat for sale — only not the one this row is.
  it("refuses a listing with another otodom id under the stored address: one fetch, no write", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ page: () => responseAt(otodomPage(flatSaleAd({ id: 65000002 }))) });

    const message = cardError(await refetch("rent,rent_currency"));

    expect(message).toContain("inne ogłoszenie");
    expect(message).toContain(KEPT);
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("info", { outcome: "refused", stage: "identity", reason: "other_listing", ...AFTER, otodom_id: 65000002 }),
    ]);
  });
});

describe("POST /api/offer-refetch: a request refused before the fetch reaches otodom with nothing", () => {
  it("sends a signed-out visitor to the sign-in page: no request at all", async () => {
    const captured = captureConsole();
    const network = stubNetwork({});

    const target = location(await submit({ offer_id: OFFER_ID }, null));

    expect(target.pathname).toBe("/auth/signin");
    expect(target.search).toBe("");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "auth", reason: "signed_out" }),
    ]);
  });

  it("refuses a body that is not a form: no request at all", async () => {
    const captured = captureConsole();
    const network = stubNetwork({});
    const request = new Request("http://localhost/api/offer-refetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: OFFER_ID }),
    });

    const message = boardError(await post(request, MEMBER));

    expect(message).toContain("formularza");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "body", reason: "unreadable_body", user_id: USER_ID }),
    ]);
  });

  it.each([
    ["no offer id", {}],
    ["an offer id that is not a uuid", { offer_id: "1 or 1=1" }],
    ["an offer id with a query inside", { offer_id: `${OFFER_ID}?select=*` }],
  ])("refuses a form with %s on the board: no request at all", async (_label, fields: Record<string, string>) => {
    const captured = captureConsole();
    const network = stubNetwork({});

    const message = boardError(await submit(fields));

    expect(message).toContain("rozpoznać oferty");
    expect(network.requests).toHaveLength(0);
    // The value itself is not logged: it is whatever the request carried.
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "offer_id", reason: "invalid_offer", user_id: USER_ID }),
    ]);
  });

  it("refuses an offer that is not there on the board: one read, no fetch, no write", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ stored: null });

    const message = boardError(await refetch());

    expect(message).toContain("Nie ma takiej oferty");
    expect(network.requests).toHaveLength(1);
    expect(network.otodom()).toHaveLength(0);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "refused",
        stage: "offer",
        reason: "offer_missing",
        user_id: USER_ID,
        offer_id: OFFER_ID,
      }),
    ]);
  });

  // Beside the offer that is not there: a read that failed is not a missing offer.
  it("reports a failed read of the stored row on the card: no fetch, no write", async () => {
    const captured = captureConsole();
    const details = `Failing row contains (${TITLE}, ${CANARY_NAME}).`;
    const network = stubNetwork({
      read: () => jsonResponse({ code: "XX000", message: "internal error", details, hint: null }, 500),
    });

    const message = cardError(await refetch());

    expect(message).toContain("odczytać zapisanej oferty");
    expect(message).toContain("pozostały bez zmian");
    expect(network.otodom()).toHaveLength(0);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "offer",
        reason: "offer_read_failed",
        user_id: USER_ID,
        offer_id: OFFER_ID,
        db_code: "XX000",
        db_message: "internal error",
        db_status: 500,
      }),
    ]);
    expect(captured.text()).not.toContain("Failing row");
  });

  // Any member can change `source_url` through the Data API: the Worker must not fetch what
  // stands there unless it is an otodom offer's address.
  it.each([
    ["another host", "https://evil.example/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1", "foreign_host"],
    [
      "an otodom host as a subdomain of another",
      "https://www.otodom.pl.evil.example/pl/oferta/x-IDKANAR1",
      "foreign_host",
    ],
    ["an otodom page that is not an offer", "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie", "not_an_offer"],
    ["a script address", "javascript:alert(document.cookie)", "malformed"],
    ["an internal address", "http://169.254.169.254/latest/meta-data/", "foreign_host"],
    ["an empty text", "", "empty"],
    ["a value that is not a text", null, "empty"],
  ])("refuses a stored address that is %s: no fetch, no write", async (_label, sourceUrl, reason) => {
    const captured = captureConsole();
    const network = stubNetwork({ stored: { ...STORED_ROW, source_url: sourceUrl } });

    const message = cardError(await refetch());

    expect(message).toContain("Zapisany adres tej oferty");
    expect(message).toContain("niczego nie pobrano");
    expect(message).toContain(KEPT);
    // The read of the stored row, and nothing after it — to any host.
    expect(network.requests).toHaveLength(1);
    expect(network.otodom()).toHaveLength(0);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "url", reason, user_id: USER_ID, offer_id: OFFER_ID }),
    ]);
    expect(captured.text()).not.toContain("evil.example");
    expect(captured.text()).not.toContain("169.254");
  });
});

// What the route knows when the write lets it down, and what it tells the member: a write that
// reached no row saved nothing, and a write without an answer may have landed.
describe("POST /api/offer-refetch: the write is judged by its error and by the rows it reached", () => {
  const page = () => responseAt(otodomPage(adWithNewPrice()));

  it("reports a write that reached no row as a failed save, on the board: one fetch, one write", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ page, write: () => jsonResponse([], 200) });

    const message = boardError(await refetch());

    expect(message).toContain("Nie udało się zapisać pobranych danych");
    expect(message).toContain("usunięta");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("error", {
        outcome: "failed",
        stage: "update",
        reason: "offer_gone",
        ...AFTER,
        otodom_id: OTODOM_ID,
        db_status: 200,
      }),
    );
  });

  it("reports a write the database rejected, without the row Postgres quotes in its details", async () => {
    const captured = captureConsole();
    const dbMessage = 'new row for relation "offers" violates check constraint "offers_price_check"';
    const details = `Failing row contains (65000001, ${TITLE}, Kontakt: ${CANARY_NAME}, tel. ${CANARY_PHONE}).`;
    const network = stubNetwork({
      page,
      write: () => jsonResponse({ code: "23514", message: dbMessage, details, hint: null }, 400),
    });

    const message = cardError(await refetch());

    expect(message).toContain("Nie udało się zapisać pobranych danych");
    expect(message).toContain(KEPT);
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("error", {
        outcome: "failed",
        stage: "update",
        reason: "update_failed",
        ...AFTER,
        otodom_id: OTODOM_ID,
        db_code: "23514",
        db_message: dbMessage,
        db_status: 400,
      }),
    );
    expect(captured.text()).not.toContain("Failing row");
    expect(captured.text()).not.toContain(CANARY_PHONE);
    expect(captured.text()).not.toContain(CANARY_NAME);
  });

  it("does not claim the row was kept when the write got no answer", async () => {
    const captured = captureConsole();
    // A rejected promise, not `undefined`: the request was planned, the database just never answered.
    const network = stubNetwork({ page, write: () => Promise.reject(new TypeError("fetch failed")) });

    const message = cardError(await refetch());

    expect(message).toContain("potwierdzić zapisu");
    expect(message).not.toContain("pozostały bez zmian");
    expect(network.otodom()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("error", {
        outcome: "failed",
        stage: "update",
        reason: "update_unconfirmed",
        ...AFTER,
        otodom_id: OTODOM_ID,
        db_message: "TypeError: fetch failed",
        db_status: 0,
      }),
    );
  });
});

// The fallback (context/changes/otodom-apify-fallback/plan.md, Phase 4): which mode runs, when the
// one Apify run follows the direct fetch, and which reason the member reads. Every scenario states
// how many requests reached otodom.pl and Apify, and how many writes reached `offers`, beside what
// it claims. The token is the fixture's test value; no request leaves the stub.

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

const DENIED_403 = `otodom.pl odmówił pobrania ogłoszenia (HTTP 403). ${KEPT} — spróbuj ponownie za chwilę.`;
const EXTRACTION_FAILED = `Nie udało się pobrać ogłoszenia z otodom.pl. ${KEPT} — spróbuj ponownie później, a jeśli problem się powtarza, daj znać administratorowi.`;
const TIMED_OUT = `Pobieranie ogłoszenia trwało zbyt długo. ${KEPT} — spróbuj ponownie.`;

const forbidden403: LegAnswer = () => responseAt("<html></html>", { status: 403 });
const apifySale: LegAnswer = () => apifyDataset([apifyItem()]);

/** The last entry's fields. */
function lastFields(captured: ConsoleCapture): unknown {
  const last = captured.entries().at(-1);
  expect(last?.args).toHaveLength(1);
  return last?.args[0];
}

describe("POST /api/offer-refetch: direct_with_fallback with a token runs one Apify run after a refused direct fetch", () => {
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
    "overwrites the row with the listing Apify read after %s: otodom 1, Apify 1, writes 1",
    async (_label, page, fallbackReason) => {
      const captured = captureConsole();
      const network = stubNetwork({ page, apify: apifySale });

      const target = location(await refetch());

      expect(target.search).toBe("?refetched=unchanged");
      expect(network.otodom()).toHaveLength(1);
      expect(network.apify()).toHaveLength(1);
      expect(network.writes()).toHaveLength(1);
      // The mapper keeps the seller out of the row whichever leg brought the ad.
      const { description: _description, raw, ...columns } = writtenRow(network.writes());
      const { description: _rawDescription, ...rawRest } = raw as Record<string, unknown>;
      const serialised = JSON.stringify({ ...columns, raw: rawRest });
      for (const canary of SELLER_CANARIES) expect(serialised).not.toContain(canary);
      expect(captured.entries()).toStrictEqual([
        {
          method: "info",
          args: [
            { level: "info", event: "offer_refetch", outcome: "started", stage: "fetch", ...IDS, ...FALLBACK_MODE },
          ],
        },
        entry("info", {
          outcome: "saved",
          stage: "update",
          ...IDS,
          ...FALLBACK_MODE,
          otodom_id: OTODOM_ID,
          changed: false,
          source: "apify",
          fallback_reason: fallbackReason,
          apify_status: 201,
          direct_duration_ms: 0,
          apify_duration_ms: 0,
        }),
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
    ["a listing that became a rental", () => responseAt(otodomPage(rentalFlat())), "not_for_sale"],
    ["a listing that is no longer a flat", () => responseAt(otodomPage(saleHouse())), "not_a_flat"],
  ];

  it.each(NO_FALLBACK)("runs no Apify run after %s: otodom 1, Apify 0, writes 0", async (_label, page, reason) => {
    const captured = captureConsole();
    const network = stubNetwork({ page });

    cardError(await refetch());

    expect(network.otodom()).toHaveLength(1);
    expect(network.apify()).toHaveLength(0);
    expect(network.writes()).toHaveLength(0);
    const fields = lastFields(captured);
    expect(fields).toMatchObject({ reason, source: "direct", direct_duration_ms: 0, ...FALLBACK_MODE });
    for (const key of ["fallback_reason", "apify_status", "apify_failure", "apify_duration_ms"]) {
      expect(fields).not.toHaveProperty(key);
    }
  });

  it("lets Apify's 410 win after a direct 403: the member reads not-found, otodom 1, Apify 1, writes 0", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ page: forbidden403, apify: () => apifyDataset([apifyGoneItem()]) });

    expect(cardError(await refetch())).toBe(`Ogłoszenie nie istnieje już na otodom.pl lub wygasło. ${KEPT}.`);
    expect(network.otodom()).toHaveLength(1);
    expect(network.apify()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("info", {
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
      }),
    );
  });

  it("reads a run that could not read the page as a refusal: otodom 1, Apify 1, writes 0", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ page: forbidden403, apify: () => apifyDataset([apifyRunError()]) });

    expect(cardError(await refetch())).toBe(
      `otodom.pl odmówił pobrania ogłoszenia. ${KEPT} — spróbuj ponownie za chwilę.`,
    );
    expect(network.otodom()).toHaveLength(1);
    expect(network.apify()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("error", {
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
      }),
    );
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
      () => apifyDataset([{ requestedUrl: STORED_URL, status: "200" }]),
      { apify_failure: "malformed_item", apify_status: 201 },
    ],
  ];

  it.each(NOT_REACHED)(
    "lets the direct reason win when Apify answers %s: otodom 1, Apify 1, writes 0",
    async (_label, apify, apifyFields) => {
      const captured = captureConsole();
      const network = stubNetwork({ page: forbidden403, apify });

      expect(cardError(await refetch())).toBe(DENIED_403);
      expect(network.otodom()).toHaveLength(1);
      expect(network.apify()).toHaveLength(1);
      expect(network.writes()).toHaveLength(0);
      expect(captured.entries().at(-1)).toStrictEqual(
        entry("error", {
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
        }),
      );
      expect(captured.text()).not.toContain(APIFY_MESSAGE_CANARY);
      expect(captured.text()).not.toContain(APIFY_TEST_TOKEN);
    },
  );

  it("keeps data_missing from both legs and says so: otodom 1, Apify 1, writes 0", async () => {
    const captured = captureConsole();
    const network = stubNetwork({
      page: () => responseAt(PAGE_WITHOUT_NEXT_DATA),
      apify: () => apifyDataset([apifyNoMarkerItem()]),
    });

    expect(cardError(await refetch())).toBe(
      `otodom.pl przysłał stronę bez danych ogłoszenia — mógł zablokować pobranie albo zmienić format strony. ${KEPT}.`,
    );
    expect(network.otodom()).toHaveLength(1);
    expect(network.apify()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(lastFields(captured)).toStrictEqual({
      level: "error",
      event: "offer_refetch",
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

describe("POST /api/offer-refetch: the other modes, the missing token and a failed read of the mode", () => {
  it("overwrites the row through Apify alone in apify_only: otodom 0, Apify 1, writes 1", async () => {
    env.apifyToken = true;
    const captured = captureConsole();
    const network = stubNetwork({ settings: () => ingestionSettingsRow("apify_only"), apify: apifySale });

    expect(location(await refetch()).search).toBe("?refetched=unchanged");
    expect(network.otodom()).toHaveLength(0);
    expect(network.apify()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    expect(lastFields(captured)).toStrictEqual({
      level: "info",
      event: "offer_refetch",
      outcome: "saved",
      stage: "update",
      ...IDS,
      ...APIFY_ONLY_MODE,
      otodom_id: OTODOM_ID,
      changed: false,
      source: "apify",
      apify_status: 201,
      apify_duration_ms: 0,
    });
  });

  it("says extraction_failed when Apify never reaches otodom in apify_only: otodom 0, Apify 1, writes 0", async () => {
    env.apifyToken = true;
    const captured = captureConsole();
    const network = stubNetwork({
      settings: () => ingestionSettingsRow("apify_only"),
      apify: () => apifyError(401, "user-or-token-not-found"),
    });

    expect(cardError(await refetch())).toBe(EXTRACTION_FAILED);
    expect(network.otodom()).toHaveLength(0);
    expect(network.apify()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(lastFields(captured)).toStrictEqual({
      level: "error",
      event: "offer_refetch",
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
    const network = stubNetwork({ settings: () => ingestionSettingsRow("direct_only"), page: forbidden403 });

    expect(cardError(await refetch())).toBe(DENIED_403);
    expect(network.otodom()).toHaveLength(1);
    expect(network.apify()).toHaveLength(0);
    expect(network.writes()).toHaveLength(0);
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
    const network = stubNetwork({
      settings: () => ingestionSettingsRow("apify_only"),
      page: () => responseAt(otodomPage(flatSaleAd())),
    });

    expect(location(await refetch()).search).toBe("?refetched=unchanged");
    expect(network.otodom()).toHaveLength(1);
    expect(network.apify()).toHaveLength(0);
    expect(network.writes()).toHaveLength(1);
    expect(lastFields(captured)).toStrictEqual({
      level: "info",
      event: "offer_refetch",
      outcome: "saved",
      stage: "update",
      ...IDS,
      otodom_id: OTODOM_ID,
      changed: false,
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
      const network = stubNetwork({ settings, page: forbidden403 });

      expect(cardError(await refetch())).toBe(DENIED_403);
      expect(network.otodom()).toHaveLength(1);
      expect(network.apify()).toHaveLength(0);
      expect(network.writes()).toHaveLength(0);
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
              event: "offer_refetch",
              outcome: "started",
              stage: "fetch",
              ...IDS,
              ...failedMode,
              ...dbFields,
            },
          ],
        },
        entry("error", {
          outcome: "failed",
          stage: "fetch",
          reason: "http_denied",
          status: 403,
          content_type: HTML,
          ...IDS,
          ...failedMode,
          source: "direct",
          direct_duration_ms: 0,
        }),
      ]);
    },
  );

  it("reads no mode for a request refused before the fetch: otodom 0, Apify 0, writes 0", async () => {
    env.apifyToken = true;
    captureConsole();
    const network = stubNetwork({ stored: { ...STORED_ROW, source_url: "https://www.olx.pl/d/oferta/x-IDKANAR1" } });

    cardError(await refetch());

    expect(network.modeReads()).toHaveLength(0);
    expect(network.otodom()).toHaveLength(0);
    expect(network.apify()).toHaveLength(0);
    expect(network.writes()).toHaveLength(0);
  });
});

// The deadlines (src/lib/otodom/deadlines.ts), each one millisecond short and on the dot, against
// a side that never answers. The values are written out by hand from the plan.
describe("POST /api/offer-refetch: each leg ends at its deadline, and no timer outlives the action", () => {
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
    const network = stubNetwork({ page: apifySilence, apify: apifySale });
    const { state, settled } = track(refetch());

    await until(() => network.otodom().length === 1);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(state.settled).toBe(false);
    expect(network.apify()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(location(await settled).search).toBe("?refetched=unchanged");
    expect(network.otodom()).toHaveLength(1);
    expect(network.apify()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
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
      const network = stubNetwork({ settings, page: apifySilence });
      const { state, settled } = track(refetch());

      await until(() => network.otodom().length === 1);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(state.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(cardError(await settled)).toBe(TIMED_OUT);
      expect(network.otodom()).toHaveLength(1);
      expect(network.apify()).toHaveLength(0);
      expect(network.writes()).toHaveLength(0);
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
      const network = stubNetwork({ settings: () => ingestionSettingsRow(mode), page, apify: apifySilence });
      const { state, settled } = track(refetch());

      await until(() => network.apify().length === 1);
      await vi.advanceTimersByTimeAsync(39_999);
      expect(state.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(cardError(await settled)).toBe(message);
      expect(network.otodom()).toHaveLength(otodom);
      expect(network.apify()).toHaveLength(1);
      expect(network.writes()).toHaveLength(0);
      expect(lastFields(captured)).toMatchObject({ apify_failure: "timeout", apify_duration_ms: 40_000 });
      expect(lastFields(captured)).not.toHaveProperty("apify_status");
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

// One assertion over every way out of the route: the console must not carry the listing's words,
// the seller, the member's address or the stored address (CLAUDE.md, Conventions — the log's
// whitelist). Each scenario names the stage its last entry reports, so one that stopped reaching
// its exit fails instead of passing with nothing to search.
describe("POST /api/offer-refetch: no log entry carries listing, seller or member data", () => {
  const FORBIDDEN = [
    ...SELLER_CANARIES,
    CANARY_PHONE,
    CANARY_NAME,
    USER_EMAIL,
    TITLE,
    "Sprzedam mieszkanie",
    "Failing row",
    STORED_URL,
    "/oferta/",
    "mieszkanie-54-m-warszawa",
    "utm_source",
    CHALLENGE_CANARY,
    // Apify's words — an error's message, a run's `#debug` — and the token.
    APIFY_MESSAGE_CANARY,
    APIFY_TEST_TOKEN,
    // A lost column is named, never quoted: its currency stands in for what it held (the amount's
    // digits also begin the listing's otodom id, which an entry does carry).
    "PLN",
  ];

  const SCENARIOS: [string, string, () => Promise<Response>][] = [
    ["auth", "a signed-out visitor", () => (stubNetwork({}), submit({ offer_id: OFFER_ID }, null))],
    ["offer_id", "an unreadable offer id", () => (stubNetwork({}), submit({ offer_id: TITLE }))],
    ["offer", "an offer that is not there", () => (stubNetwork({ stored: null }), refetch())],
    [
      "url",
      "a stored address with a query string, on another host",
      () => (
        stubNetwork({
          stored: { ...STORED_ROW, source_url: "https://www.olx.pl/d/oferta/mieszkanie-54-m-warszawa?utm_source=k" },
        }),
        refetch()
      ),
    ],
    [
      "fetch",
      "a challenge page with a canary in its text",
      () => (
        stubNetwork({
          page: () => responseAt(CHALLENGE_PAGE, { status: 403, headers: { "cf-mitigated": "challenge" } }),
        }),
        refetch()
      ),
    ],
    [
      "fetch",
      "a network error whose message quotes the whole address",
      () => (
        stubNetwork({
          page: () => Promise.reject(new TypeError(`request to ${STORED_URL}?utm_source=kanarek failed`)),
        }),
        refetch()
      ),
    ],
    [
      "fetch",
      "an Apify refusal after a direct 403, whose message carries a canary",
      () => (
        (env.apifyToken = true),
        stubNetwork({ page: forbidden403, apify: () => apifyError(401, "user-or-token-not-found") }),
        refetch()
      ),
    ],
    [
      "fetch",
      "an Apify run that could not read the page, whose #debug carries a canary",
      () => (
        (env.apifyToken = true),
        stubNetwork({ page: forbidden403, apify: () => apifyDataset([apifyRunError()]) }),
        refetch()
      ),
    ],
    [
      "fetch",
      "an Apify run past its timeout, whose message carries a canary",
      () => ((env.apifyToken = true), stubNetwork({ page: forbidden403, apify: () => apifyRunTimeout() }), refetch()),
    ],
    [
      "update",
      "a listing saved through Apify",
      () => ((env.apifyToken = true), stubNetwork({ page: forbidden403, apify: apifySale }), refetch()),
    ],
    [
      "map",
      "a listing that became a rental",
      () => (stubNetwork({ page: () => responseAt(otodomPage(rentalFlat())) }), refetch()),
    ],
    [
      "lost_facts",
      "a held save",
      () => (stubNetwork({ page: () => responseAt(otodomPage(adWithoutRent())) }), refetch()),
    ],
    [
      "update",
      "an accepted loss, saved",
      () => (stubNetwork({ page: () => responseAt(otodomPage(adWithoutRent())) }), refetch("rent,rent_currency")),
    ],
    [
      "update",
      "a write Postgres rejected, quoting the row in its details",
      () => (
        stubNetwork({
          page: () => responseAt(otodomPage(flatSaleAd())),
          write: () =>
            jsonResponse(
              {
                code: "23514",
                message: "violates check constraint",
                details: `Failing row contains (${TITLE}, ${CANARY_NAME}, ${CANARY_PHONE}, 650, PLN).`,
              },
              400,
            ),
        }),
        refetch()
      ),
    ],
  ];

  it.each(SCENARIOS)("at the %s stage: %s", async (stage, _label, run) => {
    const captured: ConsoleCapture = captureConsole();
    await run();

    const last = captured.entries().at(-1);
    expect(last?.args).toHaveLength(1);
    expect(last?.args[0]).toMatchObject({ event: "offer_refetch", stage });

    const text = captured.text();
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// The shared assertion of this file (CLAUDE.md, Product invariants): whatever a re-fetch did
// above — saved, held, refused or failed — it asked for no note and no audit and wrote to
// neither. It stands last, so it reads the requests of every scenario before it.
describe("POST /api/offer-refetch: notes and audits are never read or written", () => {
  it("sent every request of this file to otodom, Apify, `offers` or the mode, and none to `offer_notes` or `offer_audits`", () => {
    // Controls: the scenarios above did run, did reach otodom and did write.
    expect(scenarios).toBeGreaterThan(40);
    expect(everyRequest.filter(isOtodomRequest).length).toBeGreaterThan(10);
    expect(everyRequest.filter(isOfferWrite).length).toBeGreaterThan(5);

    // Widened on purpose by the fallback (otodom-apify-fallback, Phase 4): the read of the mode
    // and the Apify runs are allowed; notes and audits stay out.
    expect(everyRequest.filter(isApifyRequest).length).toBeGreaterThan(5);
    for (const request of everyRequest) {
      expect(request.url).not.toContain("offer_notes");
      expect(request.url).not.toContain("offer_audits");
      expect(
        isOtodomRequest(request) ||
          isStoredRead(request) ||
          isOfferWrite(request) ||
          isIngestionSettingsRead(request) ||
          isApifyRequest(request),
      ).toBe(true);
    }
  });
});
