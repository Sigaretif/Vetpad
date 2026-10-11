import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/offer-delete";
import { type ConsoleCapture, type ConsoleEntry, captureConsole, restoreConsole } from "../../fixtures/console";
import { type RecordedRequest, isOffersRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// The route with a configured Supabase client (test values, never a real project's): this mock
// overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase runs as it does in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes come from prd.md, FR-015 (any member deletes a saved offer, live or archived;
// every member's notes on it and its audit go with it, by the cascade in the database; when two
// members delete the same offer the second learns it was already gone). The table of exits is
// Phase 1, „Trasa usuwania oferty", in context/changes/delete-offer-and-notes/plan.md, and every
// scenario states how many writes reached `offers`.
//
// How the route talks to Supabase (supabase-js / postgrest-js, as tests/fixtures/http.ts reads it):
//
// - The one request, `.from("offers").delete().eq("id", id).select("id, otodom_id")`:
//   `DELETE <SUPABASE_URL>/rest/v1/offers?id=eq.<id>&select=id,otodom_id` with
//   `Prefer: return=representation` and no body. PostgREST answers `200` with an array of the
//   rows it deleted, `[]` when it reached none — which is not an error. A `DELETE` is never
//   retried: `500` with `{ "code", "message", … }` and a rejected `fetch` (status `0`) both come
//   back at once as a result with `error` set.

/** Every request any scenario of this file made, for the one assertion at the bottom of it. */
const everyRequest: RecordedRequest[] = [];
let scenarios = 0;

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
/** The member's address is on `locals.user` in production too; no log entry may carry it. */
const USER_EMAIL = "czlonek.kanarek@vetpad.local";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000de1e7";
/** The listing's id on the portal, as the deleted row hands it back. */
const OTODOM_ID = 67215533;

const DELETED_ROW = { id: OFFER_ID, otodom_id: OTODOM_ID };

type Answer = () => Response | Promise<Response>;

function isOfferDelete(request: RecordedRequest): boolean {
  return isOffersRequest(request, "DELETE");
}

/**
 * Plans the route's one request and nothing else: the delete. Left without an answer, it reaches
 * the offer's one row. Anything further — a read, a note, an audit — is unplanned and fails the test.
 */
function stubNetwork(write?: Answer) {
  scenarios += 1;
  const stub = stubFetch((request) => {
    everyRequest.push(request);
    if (isOfferDelete(request)) return write ? write() : jsonResponse([DELETED_ROW], 200);
    return undefined;
  });
  return { requests: stub.requests, writes: () => stub.requests.filter(isOfferDelete) };
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
  return post(new Request("http://localhost/api/offer-delete", { method: "POST", body: form }), user);
}

function send(extra: Record<string, string> = {}): Promise<Response> {
  return submit({ offer_id: OFFER_ID, ...extra });
}

function location(response: Response): URL {
  // Never a 500 and never JSON: every answer of the route is a redirect.
  expect(response.status).toBe(302);
  expect(response.headers.get("Content-Type")).toBeNull();
  const header = response.headers.get("Location");
  if (header === null) throw new Error("expected a redirect with a Location header");
  return new URL(header, "http://localhost");
}

function errorOf(target: URL): string {
  expect(target.searchParams.has("deleted")).toBe(false);
  const message = target.searchParams.get("error");
  if (message === null || message === "") throw new Error("expected the redirect to carry an error message");
  return message;
}

/** The failure redirect back to the card's delete block. Returns the message. */
function cardError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
  expect(target.searchParams.get("form")).toBe("delete");
  expect(target.hash).toBe("#usuwanie");
  return errorOf(target);
}

/** The failure redirect back to the archive page. Returns the message. */
function archiveError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe("/offers/archive");
  return errorOf(target);
}

/** The failure redirect to the board, for a request that names no offer. Returns the message. */
function boardError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe("/dashboard");
  return errorOf(target);
}

function entry(level: "info" | "error", fields: Record<string, string | number | boolean>): ConsoleEntry {
  return { method: level, args: [{ level, event: "offer_delete", ...fields }] };
}

/** The fields every entry written once the offer is known carries. */
const IDS = { user_id: USER_ID, offer_id: OFFER_ID };

/** Where each `return` value sends a delete that did not fail. */
const RETURNS: [string, Record<string, string>, string][] = [
  ["return=card", { return: "card" }, "/dashboard"],
  ["return=archive", { return: "archive" }, "/offers/archive"],
];

describe("POST /api/offer-delete: a delete that reached the offer's row is one write", () => {
  it.each(RETURNS)("deletes with %s and says so where the member came from: one write", async (_label, extra, path) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const target = location(await send(extra));

    expect(target.pathname).toBe(path);
    expect(target.search).toBe("?deleted=1");
    expect(network.writes()).toHaveLength(1);
    expect(network.requests).toHaveLength(1);
    // The listing's id comes from the deleted row: after the write there is nowhere else to read it.
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "deleted", stage: "delete", ...IDS, otodom_id: OTODOM_ID }),
    ]);
  });

  it("deletes the offer's own row and asks for the deleted rows back, with no body", async () => {
    captureConsole();
    const network = stubNetwork();

    await send();

    const params = new URL(network.writes()[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe(`eq.${OFFER_ID}`);
    // Without `select`, PostgREST answers 204 with no body and a delete of nothing looks like a delete.
    expect(params.get("select")).toBe("id,otodom_id");
    // Written out by hand: the id and the columns asked back, and no filter beside them.
    expect([...params.keys()].sort()).toEqual(["id", "select"]);
    expect(network.writes()[0]?.body).toBeNull();
  });

  // `return` only chooses between two fixed addresses: the value is never put into one.
  it.each([
    ["no return field", {}],
    ["a return off the list", { return: "dashboard" }],
    ["a return in another case", { return: "Archive" }],
    ["a return that is an address", { return: "https://evil.example/" }],
    ["a return that is a protocol-relative address", { return: "//evil.example/offers/archive" }],
  ])("returns to the board with %s: one write", async (_label, extra: Record<string, string>) => {
    captureConsole();
    const network = stubNetwork();

    const target = location(await send(extra));

    expect(target.origin).toBe("http://localhost");
    expect(target.pathname).toBe("/dashboard");
    expect(target.search).toBe("?deleted=1");
    expect(network.writes()).toHaveLength(1);
  });

  // A row that does not read as the listing's id is still a deleted offer; the entry just lacks it.
  it("reports the deletion without a listing id when the row carries none: one write", async () => {
    const captured = captureConsole();
    const network = stubNetwork(() => jsonResponse([{ id: OFFER_ID, otodom_id: null }], 200));

    const target = location(await send());

    expect(target.search).toBe("?deleted=1");
    expect(network.writes()).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([entry("info", { outcome: "deleted", stage: "delete", ...IDS })]);
  });
});

// Beside the delete above: the same request for an offer another member deleted first.
describe("POST /api/offer-delete: a delete that reached no row is neither a success nor an error", () => {
  it.each(RETURNS)(
    "answers already gone with %s, never the success address: one write",
    async (_label, extra, path) => {
      const captured = captureConsole();
      const network = stubNetwork(() => jsonResponse([], 200));

      const target = location(await send(extra));

      expect(target.pathname).toBe(path);
      expect(target.search).toBe("?deleted=gone");
      expect(target.searchParams.get("deleted")).not.toBe("1");
      expect(target.searchParams.has("error")).toBe(false);
      expect(network.writes()).toHaveLength(1);
      expect(captured.entries()).toStrictEqual([
        entry("info", { outcome: "already_gone", stage: "delete", reason: "offer_missing", ...IDS, db_status: 200 }),
      ]);
    },
  );
});

// What the route knows when the write lets it down, and what it tells the member: a write the
// database rejected deleted nothing, and a write without an answer may have landed.
describe("POST /api/offer-delete: the write is judged by its error and by the rows it reached", () => {
  const FAILURES: [string, Record<string, string>, (response: Response) => string][] = [
    ["return=card, on the card", { return: "card" }, cardError],
    ["return=archive, on the archive page", { return: "archive" }, archiveError],
  ];

  it.each(FAILURES)(
    "reports a delete the database rejected with %s, without the row Postgres quotes: one write",
    async (_label, extra, read) => {
      const captured = captureConsole();
      const details = `Failing row contains (${OFFER_ID}, Mieszkanie kanarek, ${USER_EMAIL}).`;
      const network = stubNetwork(() =>
        jsonResponse({ code: "XX000", message: "internal error", details, hint: null }, 500),
      );

      const message = read(await send(extra));

      expect(message).toContain("Nie udało się usunąć oferty");
      expect(message).toContain("pozostały bez zmian");
      expect(network.writes()).toHaveLength(1);
      expect(captured.entries()).toStrictEqual([
        entry("error", {
          outcome: "failed",
          stage: "delete",
          reason: "delete_failed",
          ...IDS,
          db_code: "XX000",
          db_message: "internal error",
          db_status: 500,
        }),
      ]);
      expect(captured.text()).not.toContain("Failing row");
    },
  );

  it.each(FAILURES)(
    "does not claim the offer was kept when the delete got no answer with %s: one write",
    async (_label, extra, read) => {
      const captured = captureConsole();
      // A rejected promise, not `undefined`: the request was planned, the database just never answered.
      const network = stubNetwork(() => Promise.reject(new TypeError("fetch failed")));

      const message = read(await send(extra));

      expect(message).toContain("potwierdzić usunięcia");
      expect(message).not.toContain("pozostał");
      expect(message).not.toContain("bez zmian");
      expect(network.writes()).toHaveLength(1);
      expect(captured.entries()).toStrictEqual([
        entry("error", {
          outcome: "failed",
          stage: "delete",
          reason: "delete_unconfirmed",
          ...IDS,
          db_message: "TypeError: fetch failed",
          db_status: 0,
        }),
      ]);
    },
  );

  it("control: a delete that reached the row is done, with one write", async () => {
    captureConsole();
    const network = stubNetwork(() => jsonResponse([DELETED_ROW], 200));

    const target = location(await send());

    expect(target.searchParams.has("error")).toBe(false);
    expect(target.search).toBe("?deleted=1");
    expect(network.writes()).toHaveLength(1);
  });
});

describe("POST /api/offer-delete: a request refused before the write deletes nothing", () => {
  it("sends a signed-out visitor to the sign-in page: no request at all, no write", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    const target = location(await submit({ offer_id: OFFER_ID }, null));

    expect(target.pathname).toBe("/auth/signin");
    expect(target.search).toBe("");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "auth", reason: "signed_out" }),
    ]);
  });

  it("refuses a body that is not a form: no request at all, no write", async () => {
    const captured = captureConsole();
    const network = stubNetwork();
    const request = new Request("http://localhost/api/offer-delete", {
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
    ["an empty offer id", { offer_id: "" }],
    ["an offer id that is not a uuid", { offer_id: "1 or 1=1" }],
    ["an offer id with a query inside", { offer_id: `${OFFER_ID}?select=*` }],
    // The archive page is not where a request that names no offer came from, whatever it says.
    ["an offer id that is not a uuid, from the archive page", { offer_id: "kanarek-oferta", return: "archive" }],
  ])("refuses a form with %s on the board: no request at all, no write", async (_label, fields) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const message = boardError(await submit(fields));

    expect(message).toContain("rozpoznać oferty");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "offer_id", reason: "invalid_offer", user_id: USER_ID }),
    ]);
    expect(captured.text()).not.toContain("1 or 1=1");
    expect(captured.text()).not.toContain("kanarek-oferta");
  });
});

// One assertion over every way out of the route: the console must not carry the member's address,
// a listing's words or what Postgres quotes (CLAUDE.md, Conventions — the log's whitelist). Each
// scenario names the stage its last entry reports, so one that stopped reaching its exit fails
// instead of passing with nothing to search.
describe("POST /api/offer-delete: no log entry carries member or listing data", () => {
  const TITLE = "Mieszkanie 3 pokoje, 54,5 m², Praga-Południe";
  const DESCRIPTION = "Sprzedam mieszkanie 3-pokojowe z lokatorem";
  /** What a careless `select *` would hand back beside the two columns the route asks for. */
  const WIDE = { title: TITLE, description: DESCRIPTION, source_url: "https://www.otodom.pl/pl/oferta/x-IDKANAR1" };
  const FORBIDDEN = [USER_EMAIL, "@vetpad.local", TITLE, DESCRIPTION, "Sprzedam", "/oferta/", "Failing row"];

  const quoted = (code: string, status: number): Answer => {
    return () =>
      jsonResponse(
        {
          code,
          message: "rejected",
          details: `Failing row contains (${TITLE}, ${DESCRIPTION}, ${USER_EMAIL}).`,
          hint: null,
        },
        status,
      );
  };

  const SCENARIOS: [string, string, () => Promise<Response>][] = [
    ["auth", "a signed-out visitor", () => (stubNetwork(), submit({ offer_id: OFFER_ID }, null))],
    ["offer_id", "an offer id that is a title", () => (stubNetwork(), submit({ offer_id: TITLE }))],
    [
      "delete",
      "a delete, done, answered with the whole listing",
      () => (stubNetwork(() => jsonResponse([{ ...DELETED_ROW, ...WIDE }], 200)), send()),
    ],
    ["delete", "a delete that reached no row", () => (stubNetwork(() => jsonResponse([], 200)), send())],
    [
      "delete",
      "a delete Postgres rejected, quoting the row",
      () => (stubNetwork(quoted("XX000", 500)), send({ return: "archive" })),
    ],
  ];

  it.each(SCENARIOS)("at the %s stage: %s", async (stage, _label, run) => {
    const captured: ConsoleCapture = captureConsole();
    await run();

    const last = captured.entries().at(-1);
    expect(last?.args).toHaveLength(1);
    expect(last?.args[0]).toMatchObject({ event: "offer_delete", stage });

    const text = captured.text();
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// The shared assertion of this file (prd.md, FR-015): notes and the audit go with their offer by
// the cascade in the database. Whatever the route did above — deleted, found nothing, refused or
// failed — it sent nothing but the one delete to `offers`, and never read first. It stands last,
// so it reads the requests of every scenario before it.
describe("POST /api/offer-delete: notes and audits are never read or written", () => {
  it("sent every request of this file as a delete to `offers`, and none to `offer_notes` or `offer_audits`", () => {
    // Controls: the scenarios above did run and did write.
    expect(scenarios).toBeGreaterThan(25);
    expect(everyRequest.filter(isOfferDelete).length).toBeGreaterThan(15);

    for (const request of everyRequest) {
      expect(request.url).not.toContain("offer_notes");
      expect(request.url).not.toContain("offer_audits");
      expect(request.url).not.toContain("members");
      expect(isOfferDelete(request)).toBe(true);
      expect(new URL(request.url).searchParams.get("id")).toBe(`eq.${OFFER_ID}`);
    }
  });
});
