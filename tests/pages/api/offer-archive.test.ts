import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/offer-archive";
import { type ConsoleCapture, type ConsoleEntry, captureConsole, restoreConsole } from "../../fixtures/console";
import { type RecordedRequest, isOffersRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// The route with a configured Supabase client (test values, never a real project's): this mock
// overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase runs as it does in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes come from prd.md: FR-014 (any member archives an offer and any member restores
// it; the database, not the request, records who archived it and when; when two members archive
// the same offer the first one stays signed; an archived offer keeps its notes and its audit) and
// FR-005 (nothing is ever restored as a side effect). The table of exits is Phase 2, „Trasa
// archiwizacji", in context/changes/archive-and-restore/plan.md, and every scenario states how
// many writes reached `offers`.
//
// How the route talks to Supabase (supabase-js / postgrest-js, as tests/fixtures/http.ts reads it):
//
// - The stored row, `.from("offers").select("id, archived_at, archived_by").eq("id", id)
//   .maybeSingle()`: `GET <SUPABASE_URL>/rest/v1/offers?select=id,archived_at,archived_by
//   &id=eq.<id>`. `200 []` becomes `data: null` with no error (no such offer), `[row]` becomes
//   `row`; `500` with `{ "code", "message", … }` is a result with `error` set, at once.
// - Archiving, `.update({ archived_at }).eq("id", id).is("archived_at", null).select("id")`:
//   `PATCH <SUPABASE_URL>/rest/v1/offers?id=eq.<id>&archived_at=is.null&select=id` with
//   `Prefer: return=representation`. Restoring, `.update({ archived_at: null }).eq("id", id)
//   .not("archived_at", "is", null).select("id")`: the same with `archived_at=not.is.null`.
//   PostgREST answers `200` with an array of the rows it changed, `[]` when it reached none —
//   which is not an error. A `PATCH` is never retried: a rejected `fetch` comes back at once as an
//   error with status `0`. The trigger's refusal of an archiving it cannot sign answers `403` with
//   `{ "code": "42501", … }` (supabase/migrations/20261011160031_offers_archive.sql).

/** Every request any scenario of this file made, for the one assertion at the bottom of it. */
const everyRequest: RecordedRequest[] = [];
let scenarios = 0;

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
/** The member's address is on `locals.user` in production too; no log entry may carry it. */
const USER_EMAIL = "czlonek.kanarek@vetpad.local";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000a4c17";
/** Whoever archived the offer before: the card names them from the row, the route never does. */
const ARCHIVER_ID = "7a2b9c1d-3e4f-4a5b-8c6d-0000000a4c11";
const ARCHIVED_AT = "2026-10-07T18:30:00.123456+00:00";

const LIVE_ROW = { id: OFFER_ID, archived_at: null, archived_by: null };
const ARCHIVED_ROW = { id: OFFER_ID, archived_at: ARCHIVED_AT, archived_by: ARCHIVER_ID };

type Answer = () => Response | Promise<Response>;

function isStoredRead(request: RecordedRequest): boolean {
  return isOffersRequest(request, "GET");
}

function isOfferWrite(request: RecordedRequest): boolean {
  return isOffersRequest(request, "PATCH");
}

interface Network {
  /** The stored row the read finds; `null` for an offer that is not there. */
  stored?: Record<string, unknown> | null;
  /** The read's whole answer, instead of `stored`. */
  read?: Answer;
  /** The write's answer. Left out, the write reaches the offer's one row. */
  write?: Answer;
}

/**
 * Plans the route's two requests and nothing else: the read of the stored row and the write.
 * Anything further — a note, an audit, a member — is unplanned and fails the test.
 */
function stubNetwork({ stored = LIVE_ROW, read, write }: Network = {}) {
  scenarios += 1;
  const stub = stubFetch((request) => {
    everyRequest.push(request);
    if (isStoredRead(request)) return read ? read() : jsonResponse(stored === null ? [] : [stored], 200);
    if (isOfferWrite(request)) return write ? write() : jsonResponse([{ id: OFFER_ID }], 200);
    return undefined;
  });
  return {
    requests: stub.requests,
    reads: () => stub.requests.filter(isStoredRead),
    writes: () => stub.requests.filter(isOfferWrite),
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
  return post(new Request("http://localhost/api/offer-archive", { method: "POST", body: form }), user);
}

function send(intent: string, extra: Record<string, string> = {}): Promise<Response> {
  return submit({ offer_id: OFFER_ID, intent, ...extra });
}

function location(response: Response): URL {
  // Never a 500 and never JSON: every answer of the route is a redirect.
  expect(response.status).toBe(302);
  expect(response.headers.get("Content-Type")).toBeNull();
  const header = response.headers.get("Location");
  if (header === null) throw new Error("expected a redirect with a Location header");
  return new URL(header, "http://localhost");
}

/** The failure redirect back to the card's archive block. Returns the message. */
function cardError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
  expect(target.searchParams.get("form")).toBe("archive");
  expect(target.searchParams.has("archive")).toBe(false);
  expect(target.hash).toBe("#archiwum");
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

function entry(level: "info" | "error", fields: Record<string, string | number | boolean>): ConsoleEntry {
  return { method: level, args: [{ level, event: "offer_archive", ...fields }] };
}

/** The fields every entry written once the intent and the offer are known carries, beside `intent`. */
const IDS = { user_id: USER_ID, offer_id: OFFER_ID };

describe("POST /api/offer-archive: archiving a live offer is one read and one write of the intent", () => {
  it("archives and returns to the card: one read, one write", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    const target = location(await send("archive"));

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?archive=archived");
    expect(network.reads()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    expect(network.requests).toHaveLength(2);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "archived", stage: "update", intent: "archive", ...IDS }),
    ]);
  });

  it("reads only the offer's id and its archive columns", async () => {
    captureConsole();
    const network = stubNetwork();

    await send("archive");

    const params = new URL(network.reads()[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe(`eq.${OFFER_ID}`);
    expect(params.get("select")).toBe("id,archived_at,archived_by");
  });

  it("writes to the offer's own row, only while it is still live, and asks for the changed rows back", async () => {
    captureConsole();
    const network = stubNetwork();

    await send("archive");

    const params = new URL(network.writes()[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe(`eq.${OFFER_ID}`);
    // The first member to archive stays signed: a second write finds no live row.
    expect(params.get("archived_at")).toBe("is.null");
    // Without `select`, PostgREST answers 204 with no body and a filtered write looks like a save.
    expect(params.get("select")).toBe("id");
  });

  it("sends a date and nothing else — no signature, no id and no author", async () => {
    captureConsole();
    const network = stubNetwork();
    const before = Date.now();

    await send("archive");
    const row = writtenRow(network.writes());

    // Written out by hand. The date only says "archive": the trigger writes its own over it.
    expect(Object.keys(row)).toEqual(["archived_at"]);
    const sent = Date.parse(String(row.archived_at));
    expect(sent).toBeGreaterThanOrEqual(before);
    expect(sent).toBeLessThanOrEqual(Date.now());
    for (const forbidden of ["archived_by", "id", "created_by"]) {
      expect(row).not.toHaveProperty(forbidden);
    }
    // The member's id travels in no column at all: the trigger signs the archiving.
    expect(network.writes()[0]?.body).not.toContain(USER_ID);
  });

  // `return` only says where a restore from the archive page goes back to.
  it.each([
    ["no return field", {}],
    ["return=card", { return: "card" }],
    ["return=archive", { return: "archive" }],
    ["a return that is an address", { return: "https://evil.example/" }],
  ])("returns to the card with %s: one write", async (_label, extra: Record<string, string>) => {
    captureConsole();
    const network = stubNetwork();

    const target = location(await send("archive", extra));

    expect(target.origin).toBe("http://localhost");
    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?archive=archived");
    expect(network.writes()).toHaveLength(1);
  });
});

describe("POST /api/offer-archive: restoring an archived offer is one read and one write of null", () => {
  it("restores and returns to the card: one read, one write", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ stored: ARCHIVED_ROW });

    const target = location(await send("restore"));

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?archive=restored");
    expect(network.reads()).toHaveLength(1);
    expect(network.writes()).toHaveLength(1);
    expect(network.requests).toHaveLength(2);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "restored", stage: "update", intent: "restore", ...IDS }),
    ]);
  });

  it("writes null to the offer's own row, only while it is still archived", async () => {
    captureConsole();
    const network = stubNetwork({ stored: ARCHIVED_ROW });

    await send("restore");

    const params = new URL(network.writes()[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe(`eq.${OFFER_ID}`);
    expect(params.get("archived_at")).toBe("not.is.null");
    expect(params.get("select")).toBe("id");
    // Written out by hand: the trigger clears the signature, the route never names it.
    expect(writtenRow(network.writes())).toStrictEqual({ archived_at: null });
    for (const forbidden of ["archived_by", "id", "created_by"]) {
      expect(writtenRow(network.writes())).not.toHaveProperty(forbidden);
    }
    expect(network.writes()[0]?.body).not.toContain(USER_ID);
    expect(network.writes()[0]?.body).not.toContain(ARCHIVER_ID);
  });

  it("returns to the archive page when the form came from there: one write", async () => {
    captureConsole();
    const network = stubNetwork({ stored: ARCHIVED_ROW });

    const target = location(await send("restore", { return: "archive" }));

    expect(target.pathname).toBe("/offers/archive");
    expect(target.search).toBe("?restored=1");
    expect(network.writes()).toHaveLength(1);
  });

  it.each([
    ["return=card", { return: "card" }],
    ["a return off the list", { return: "dashboard" }],
    ["a return that is an address", { return: "//evil.example/offers/archive" }],
  ])("returns to the card with %s: one write", async (_label, extra: Record<string, string>) => {
    captureConsole();
    const network = stubNetwork({ stored: ARCHIVED_ROW });

    const target = location(await send("restore", extra));

    expect(target.origin).toBe("http://localhost");
    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?archive=restored");
    expect(network.writes()).toHaveLength(1);
  });
});

// Beside the two writes above: the same requests on an offer already where the member wants it.
describe("POST /api/offer-archive: an offer already in the state asked for is not written to", () => {
  it("answers already-archived for an archiving of an archived offer: one read, no write, no error", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ stored: ARCHIVED_ROW });

    const target = location(await send("archive"));

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?archive=already-archived");
    expect(target.searchParams.has("error")).toBe(false);
    expect(network.reads()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "unchanged",
        stage: "offer",
        reason: "already_archived",
        intent: "archive",
        ...IDS,
      }),
    ]);
    // Who archived it first is the card's to say, from the row: neither the address nor the log names them.
    expect(target.href).not.toContain(ARCHIVER_ID);
    expect(captured.text()).not.toContain(ARCHIVER_ID);
  });

  // An offer whose archiving member's account is gone is still archived: the date carries the state.
  it("answers already-archived for an offer archived by a deleted account: no write", async () => {
    captureConsole();
    const network = stubNetwork({ stored: { ...ARCHIVED_ROW, archived_by: null } });

    const target = location(await send("archive"));

    expect(target.search).toBe("?archive=already-archived");
    expect(network.writes()).toHaveLength(0);
  });

  it.each([
    ["from the card", {}],
    // The archive page no longer lists the offer: the card is where its state is told.
    ["from the archive page", { return: "archive" }],
  ])(
    "answers already-live for a restore of a live offer %s: one read, no write, no error",
    async (_label, extra: Record<string, string>) => {
      const captured = captureConsole();
      const network = stubNetwork({ stored: LIVE_ROW });

      const target = location(await send("restore", extra));

      expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
      expect(target.search).toBe("?archive=already-live");
      expect(network.reads()).toHaveLength(1);
      expect(network.writes()).toHaveLength(0);
      expect(captured.entries()).toStrictEqual([
        entry("info", { outcome: "unchanged", stage: "offer", reason: "already_live", intent: "restore", ...IDS }),
      ]);
    },
  );
});

// What the route knows when the write lets it down, and what it tells the member: a write that
// reached no row changed nothing the member did, and a write without an answer may have landed.
describe("POST /api/offer-archive: the write is judged by its error and by the rows it reached", () => {
  const INTENTS: [string, Record<string, unknown>][] = [
    ["archive", LIVE_ROW],
    ["restore", ARCHIVED_ROW],
  ];

  // Another member archived, restored or deleted the offer between the read and the write.
  it.each(INTENTS)(
    "reports intent=%s answered 200 [] as a failure, never as done: one write",
    async (intent, stored) => {
      const captured = captureConsole();
      const network = stubNetwork({ stored, write: () => jsonResponse([], 200) });

      const message = cardError(await send(intent, { return: "archive" }));

      expect(message).toContain("zmienił się w trakcie zapisu");
      expect(network.writes()).toHaveLength(1);
      expect(captured.entries()).toStrictEqual([
        entry("error", { outcome: "failed", stage: "update", reason: "state_changed", intent, ...IDS, db_status: 200 }),
      ]);
    },
  );

  // Each fragment is the word that tells the two failures apart; the other one's must be absent.
  it.each([
    ["archive", LIVE_ROW, "zarchiwizować", "przywrócić"],
    ["restore", ARCHIVED_ROW, "przywrócić", "zarchiwizować"],
  ])(
    "reports a write of intent=%s the database rejected, without the row Postgres quotes: one write",
    async (intent, stored, own, other) => {
      const captured = captureConsole();
      const details = `Failing row contains (${OFFER_ID}, Mieszkanie kanarek, ${USER_EMAIL}).`;
      const network = stubNetwork({
        stored,
        write: () => jsonResponse({ code: "XX000", message: "internal error", details, hint: null }, 500),
      });

      const message = cardError(await send(intent));

      expect(message).toContain(own);
      expect(message).not.toContain(other);
      expect(network.writes()).toHaveLength(1);
      expect(captured.entries()).toStrictEqual([
        entry("error", {
          outcome: "failed",
          stage: "update",
          reason: "update_failed",
          intent,
          ...IDS,
          db_code: "XX000",
          db_message: "internal error",
          db_status: 500,
        }),
      ]);
      expect(captured.text()).not.toContain("Failing row");
    },
  );

  it("reports an archiving the database could not sign (42501) as a session problem: one write", async () => {
    const captured = captureConsole();
    const dbMessage = "an offer can only be archived by a signed-in member";
    const network = stubNetwork({
      write: () => jsonResponse({ code: "42501", message: dbMessage, details: null, hint: null }, 403),
    });

    const message = cardError(await send("archive"));

    expect(message).toContain("sesji");
    expect(message).toContain("Zaloguj się ponownie");
    expect(network.writes()).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "update",
        reason: "unsigned",
        intent: "archive",
        ...IDS,
        db_code: "42501",
        db_message: dbMessage,
        db_status: 403,
      }),
    ]);
  });

  it.each(INTENTS)(
    "does not claim the state was kept when the write of intent=%s got no answer: one write",
    async (intent, stored) => {
      const captured = captureConsole();
      // A rejected promise, not `undefined`: the request was planned, the database just never answered.
      const network = stubNetwork({ stored, write: () => Promise.reject(new TypeError("fetch failed")) });

      const message = cardError(await send(intent));

      expect(message).toContain("potwierdzić zapisu");
      expect(message).not.toContain("pozostała");
      expect(message).not.toContain("bez zmian");
      expect(network.writes()).toHaveLength(1);
      expect(captured.entries()).toStrictEqual([
        entry("error", {
          outcome: "failed",
          stage: "update",
          reason: "update_unconfirmed",
          intent,
          ...IDS,
          db_message: "TypeError: fetch failed",
          db_status: 0,
        }),
      ]);
    },
  );

  it("control: a write that reached the row is done, with one write", async () => {
    captureConsole();
    const network = stubNetwork({ write: () => jsonResponse([{ id: OFFER_ID }], 200) });

    const target = location(await send("archive"));

    expect(target.searchParams.has("error")).toBe(false);
    expect(target.search).toBe("?archive=archived");
    expect(network.writes()).toHaveLength(1);
  });
});

describe("POST /api/offer-archive: a request refused before the write changes nothing", () => {
  it("sends a signed-out visitor to the sign-in page: no request at all, no write", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    const target = location(await submit({ offer_id: OFFER_ID, intent: "archive" }, null));

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
    const request = new Request("http://localhost/api/offer-archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: OFFER_ID, intent: "archive" }),
    });

    const message = boardError(await post(request, MEMBER));

    expect(message).toContain("formularza");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "body", reason: "unreadable_body", user_id: USER_ID }),
    ]);
  });

  // The two actions undo each other, so neither is the default.
  it.each([
    ["no intent", { offer_id: OFFER_ID }],
    ["an empty intent", { offer_id: OFFER_ID, intent: "" }],
    ["an intent off the list", { offer_id: OFFER_ID, intent: "delete" }],
    ["an intent in another case", { offer_id: OFFER_ID, intent: "Archive" }],
    ["an intent with a canary", { offer_id: OFFER_ID, intent: "kanarek-intencja" }],
  ])("refuses a form with %s on the board: no request at all, no write", async (_label, fields) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const message = boardError(await submit(fields));

    expect(message).toContain("Nieznana akcja");
    expect(network.requests).toHaveLength(0);
    // The value itself is not logged: it is whatever the request carried.
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "intent", reason: "unknown_intent", user_id: USER_ID }),
    ]);
    expect(captured.text()).not.toContain("kanarek-intencja");
  });

  it.each([
    ["no offer id", { intent: "archive" }],
    ["an offer id that is not a uuid", { intent: "archive", offer_id: "1 or 1=1" }],
    ["an offer id with a query inside", { intent: "restore", offer_id: `${OFFER_ID}?select=*` }],
  ])("refuses a form with %s on the board: no request at all, no write", async (_label, fields) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const message = boardError(await submit(fields));

    expect(message).toContain("rozpoznać oferty");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "refused",
        stage: "offer_id",
        reason: "invalid_offer",
        intent: fields.intent,
        user_id: USER_ID,
      }),
    ]);
    expect(captured.text()).not.toContain("1 or 1=1");
  });

  it.each(["archive", "restore"])(
    "refuses intent=%s for an offer that is not there, on the board: one read, no write",
    async (intent) => {
      const captured = captureConsole();
      const network = stubNetwork({ stored: null });

      const message = boardError(await send(intent));

      expect(message).toContain("Nie ma już takiej oferty");
      expect(network.requests).toHaveLength(1);
      expect(network.writes()).toHaveLength(0);
      expect(captured.entries()).toStrictEqual([
        entry("info", { outcome: "refused", stage: "offer", reason: "offer_missing", intent, ...IDS }),
      ]);
    },
  );

  // Beside the offer that is not there: a read that failed is not a missing offer.
  it("reports a failed read of the stored row on the card: one read, no write", async () => {
    const captured = captureConsole();
    const details = `Failing row contains (${OFFER_ID}, Mieszkanie kanarek).`;
    const network = stubNetwork({
      read: () => jsonResponse({ code: "XX000", message: "internal error", details, hint: null }, 500),
    });

    const message = cardError(await send("archive"));

    expect(message).toContain("odczytać");
    expect(message).toContain("bez zmian");
    expect(network.reads()).toHaveLength(1);
    expect(network.writes()).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "offer",
        reason: "offer_read_failed",
        intent: "archive",
        ...IDS,
        db_code: "XX000",
        db_message: "internal error",
        db_status: 500,
      }),
    ]);
    expect(captured.text()).not.toContain("Failing row");
  });
});

// One assertion over every way out of the route: the console must not carry the member's address,
// a listing's words or what Postgres quotes (CLAUDE.md, Conventions — the log's whitelist). Each
// scenario names the stage its last entry reports, so one that stopped reaching its exit fails
// instead of passing with nothing to search.
describe("POST /api/offer-archive: no log entry carries member or listing data", () => {
  const TITLE = "Mieszkanie 3 pokoje, 54,5 m², Praga-Południe";
  const DESCRIPTION = "Sprzedam mieszkanie 3-pokojowe z lokatorem";
  /** What a careless `select *` would bring back beside the three columns the route asks for. */
  const WIDE = { title: TITLE, description: DESCRIPTION, source_url: "https://www.otodom.pl/pl/oferta/x-IDKANAR1" };
  const FORBIDDEN = [
    USER_EMAIL,
    "@vetpad.local",
    TITLE,
    DESCRIPTION,
    "Sprzedam",
    "/oferta/",
    "Failing row",
    ARCHIVER_ID,
  ];

  const quoted = (code: string, status: number): Answer => {
    return () =>
      jsonResponse(
        {
          code,
          message: "rejected",
          details: `Failing row contains (${TITLE}, ${DESCRIPTION}, ${USER_EMAIL}, ${ARCHIVER_ID}).`,
          hint: null,
        },
        status,
      );
  };

  const SCENARIOS: [string, string, () => Promise<Response>][] = [
    ["auth", "a signed-out visitor", () => (stubNetwork(), submit({ offer_id: OFFER_ID, intent: "archive" }, null))],
    ["intent", "an intent that is a title", () => (stubNetwork(), submit({ offer_id: OFFER_ID, intent: TITLE }))],
    ["offer_id", "an offer id that is a title", () => (stubNetwork(), submit({ offer_id: TITLE, intent: "archive" }))],
    ["offer", "an offer that is not there", () => (stubNetwork({ stored: null }), send("restore"))],
    ["offer", "a failed read that quotes a row", () => (stubNetwork({ read: quoted("XX000", 500) }), send("archive"))],
    [
      "offer",
      "an offer already archived, read with its listing",
      () => (stubNetwork({ stored: { ...ARCHIVED_ROW, ...WIDE } }), send("archive")),
    ],
    ["update", "an archiving, saved", () => (stubNetwork({ stored: { ...LIVE_ROW, ...WIDE } }), send("archive"))],
    [
      "update",
      "a restore, saved",
      () => (stubNetwork({ stored: { ...ARCHIVED_ROW, ...WIDE } }), send("restore", { return: "archive" })),
    ],
    [
      "update",
      "a write that reached no row",
      () => (stubNetwork({ write: () => jsonResponse([], 200) }), send("archive")),
    ],
    [
      "update",
      "a write Postgres rejected, quoting the row",
      () => (stubNetwork({ write: quoted("23514", 400) }), send("archive")),
    ],
  ];

  it.each(SCENARIOS)("at the %s stage: %s", async (stage, _label, run) => {
    const captured: ConsoleCapture = captureConsole();
    await run();

    const last = captured.entries().at(-1);
    expect(last?.args).toHaveLength(1);
    expect(last?.args[0]).toMatchObject({ event: "offer_archive", stage });

    const text = captured.text();
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// The shared assertion of this file (prd.md, FR-014): whatever the route did above — archived,
// restored, left alone, refused or failed — it asked for no note, no audit and no member, and
// wrote to none. It stands last, so it reads the requests of every scenario before it.
describe("POST /api/offer-archive: notes and audits are never read or written", () => {
  it("sent every request of this file to `offers`, and none to `offer_notes` or `offer_audits`", () => {
    // Controls: the scenarios above did run, did read and did write.
    expect(scenarios).toBeGreaterThan(40);
    expect(everyRequest.filter(isStoredRead).length).toBeGreaterThan(20);
    expect(everyRequest.filter(isOfferWrite).length).toBeGreaterThan(15);

    for (const request of everyRequest) {
      expect(request.url).not.toContain("offer_notes");
      expect(request.url).not.toContain("offer_audits");
      expect(request.url).not.toContain("members");
      expect(isStoredRead(request) || isOfferWrite(request)).toBe(true);
    }
  });
});
