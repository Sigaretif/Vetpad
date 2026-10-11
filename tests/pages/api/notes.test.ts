import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/notes";
import { type ConsoleCapture, type ConsoleEntry, captureConsole, restoreConsole } from "../../fixtures/console";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// The route with a configured Supabase client (test values, never a real project's): this mock
// overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase runs as it does in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes come from prd.md: FR-012 (a member writes and changes their own note, saved
// exactly as typed), FR-015 (a member deletes their own note, and nobody else's) and FR-013 (the
// author is the session's member, never something a form says). The table of exits is Phase 1,
// „Intencja usunięcia i log w trasie notatek", in context/changes/delete-offer-and-notes/plan.md,
// and every scenario states how many writes reached `offer_notes`.
//
// How the route talks to Supabase (supabase-js / postgrest-js, as tests/fixtures/http.ts reads it):
//
// - The save, `.from("offer_notes").upsert(row, { onConflict: "offer_id,author_id" })`:
//   `POST <SUPABASE_URL>/rest/v1/offer_notes?on_conflict=offer_id,author_id` with
//   `Prefer: resolution=merge-duplicates`; the body is `JSON.stringify(row)`. Without `select`
//   PostgREST answers `201` with no body. An offer that is not there answers `409` with
//   `{ "code": "23503", … }`, a note the table's checks refuse `400` with `{ "code": "23514", … }`.
// - The delete, `.from("offer_notes").delete().eq("offer_id", id).eq("author_id", userId)
//   .select("id")`: `DELETE <SUPABASE_URL>/rest/v1/offer_notes?offer_id=eq.<id>
//   &author_id=eq.<userId>&select=id` with `Prefer: return=representation` and no body. PostgREST
//   answers `200` with an array of the rows it deleted, `[]` when it reached none — which is not
//   an error.
// - Neither is retried: `500` with `{ "code", "message", … }` and a rejected `fetch` (status `0`)
//   both come back at once as a result with `error` set.

/** Every request any scenario of this file made, for the one assertion at the bottom of it. */
const everyRequest: RecordedRequest[] = [];
let scenarios = 0;

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
/** The member's address is on `locals.user` in production too; no log entry may carry it. */
const USER_EMAIL = "czlonek.kanarek@vetpad.local";
/** Another member: an id a forged form names as the author. It must reach no request. */
const OTHER_MEMBER_ID = "7a2b9c1d-3e4f-4a5b-8c6d-0000000a4c11";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-00000000a07e";
const NOTE_ID = "5e8d2f17-4a6b-4c9d-b1e2-00000000a07e";

/** A note's three fields, each a canary: no log entry and no address may carry any of them. */
const NOTE = {
  pros: "kanarek-zalety: jasna kuchnia, balkon od południa",
  cons: "kanarek-wady: głośna ulica",
  observations: "kanarek-obserwacje: zapytać o fundusz remontowy",
};

type Answer = () => Response | Promise<Response>;

function isNoteSave(request: RecordedRequest): boolean {
  return isTableRequest(request, "offer_notes", "POST");
}

function isNoteDelete(request: RecordedRequest): boolean {
  return isTableRequest(request, "offer_notes", "DELETE");
}

interface Network {
  /** The save's answer. Left out, the note is saved. */
  save?: Answer;
  /** The delete's answer. Left out, the delete reaches the member's one note. */
  remove?: Answer;
}

/**
 * Plans the route's two writes and nothing else. Anything further — a read of the note, of the
 * offer or of a member — is unplanned and fails the test.
 */
function stubNetwork({ save, remove }: Network = {}) {
  scenarios += 1;
  const stub = stubFetch((request) => {
    everyRequest.push(request);
    if (isNoteSave(request)) return save ? save() : new Response(null, { status: 201 });
    if (isNoteDelete(request)) return remove ? remove() : jsonResponse([{ id: NOTE_ID }], 200);
    return undefined;
  });
  return {
    requests: stub.requests,
    saves: () => stub.requests.filter(isNoteSave),
    deletes: () => stub.requests.filter(isNoteDelete),
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
  return post(new Request("http://localhost/api/notes", { method: "POST", body: form }), user);
}

function remove(extra: Record<string, string> = {}): Promise<Response> {
  return submit({ offer_id: OFFER_ID, intent: "delete", ...extra });
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
  expect(target.searchParams.has("note")).toBe(false);
  const message = target.searchParams.get("error");
  if (message === null || message === "") throw new Error("expected the redirect to carry an error message");
  return message;
}

/** The failure redirect of a delete, back to the card's notes. Returns the message. */
function deleteError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
  // Named, so the card does not open the note editor for it.
  expect(target.searchParams.get("form")).toBe("note-delete");
  expect(target.hash).toBe("#notatki");
  return errorOf(target);
}

/** The failure redirect of a save, back to the note editor: no `form`, as before this change. */
function saveError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
  expect(target.searchParams.has("form")).toBe(false);
  expect(target.hash).toBe("#notatki");
  return errorOf(target);
}

/** The failure redirect to the board, for a request there is no card of. Returns the message. */
function boardError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe("/dashboard");
  return errorOf(target);
}

function sentRow(saves: RecordedRequest[]): Record<string, unknown> {
  expect(saves).toHaveLength(1);
  const body = saves[0]?.body;
  if (typeof body !== "string") throw new Error("expected the save to carry a JSON body");
  return JSON.parse(body) as Record<string, unknown>;
}

function entry(level: "info" | "error", fields: Record<string, string | number | boolean>): ConsoleEntry {
  return { method: level, args: [{ level, event: "note", ...fields }] };
}

/** The fields every entry written once the offer is known carries, beside `intent`. */
const IDS = { user_id: USER_ID, offer_id: OFFER_ID };

describe("POST /api/notes: deleting the member's own note is one write", () => {
  it("deletes and says so on the card: one delete, no save", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    const target = location(await remove());

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?note=deleted");
    expect(target.hash).toBe("#notatki");
    expect(network.deletes()).toHaveLength(1);
    expect(network.saves()).toHaveLength(0);
    expect(network.requests).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "deleted", stage: "delete", intent: "delete", ...IDS }),
    ]);
  });

  it("filters by the offer and by the session's member, and asks for the deleted rows back", async () => {
    captureConsole();
    const network = stubNetwork();

    await remove();

    const params = new URL(network.deletes()[0]?.url ?? "").searchParams;
    expect(params.get("offer_id")).toBe(`eq.${OFFER_ID}`);
    expect(params.get("author_id")).toBe(`eq.${USER_ID}`);
    // Without `select`, PostgREST answers 204 with no body and a delete of nothing looks like a delete.
    expect(params.get("select")).toBe("id");
    // Written out by hand: a delete without both filters would reach other members' notes.
    expect([...params.keys()].sort()).toEqual(["author_id", "offer_id", "select"]);
    expect(network.deletes()[0]?.body).toBeNull();
  });

  // The author is the session's member, whatever the form says (FR-013).
  it("never takes the author, or a note id, from the form: one delete", async () => {
    captureConsole();
    const network = stubNetwork();

    const target = location(
      await remove({ author_id: OTHER_MEMBER_ID, id: OTHER_MEMBER_ID, note_id: OTHER_MEMBER_ID }),
    );

    expect(target.search).toBe("?note=deleted");
    expect(network.deletes()).toHaveLength(1);
    const url = network.deletes()[0]?.url ?? "";
    expect(new URL(url).searchParams.get("author_id")).toBe(`eq.${USER_ID}`);
    expect(url).not.toContain(OTHER_MEMBER_ID);
  });

  // The fields are neither read nor validated: a delete sent with the editor's text still deletes,
  // and one sent with no text at all is not refused as a blank note.
  it.each([
    ["no note fields", {}],
    ["blank note fields", { pros: "", cons: "  ", observations: "" }],
    ["the editor's text", NOTE],
    ["a field over the limit", { pros: "x".repeat(5001) }],
  ])("deletes with %s and sends none of them: one delete, no save", async (_label, fields: Record<string, string>) => {
    captureConsole();
    const network = stubNetwork();

    const target = location(await remove(fields));

    expect(target.search).toBe("?note=deleted");
    expect(network.deletes()).toHaveLength(1);
    expect(network.saves()).toHaveLength(0);
    expect(network.deletes()[0]?.url).not.toContain("kanarek");
  });
});

// Beside the delete above: the same request from a member who has no note on the offer.
describe("POST /api/notes: a delete that reached no row is neither a success nor an error", () => {
  it("answers already gone, never the address of a deleted note: one delete", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ remove: () => jsonResponse([], 200) });

    const target = location(await remove());

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("?note=gone");
    expect(target.searchParams.get("note")).not.toBe("deleted");
    expect(target.searchParams.has("error")).toBe(false);
    expect(target.hash).toBe("#notatki");
    expect(network.deletes()).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "already_gone",
        stage: "delete",
        reason: "note_missing",
        intent: "delete",
        ...IDS,
        db_status: 200,
      }),
    ]);
  });
});

describe("POST /api/notes: a delete is judged by its error and by the rows it reached", () => {
  it("reports a delete the database rejected, without the row Postgres quotes: one delete", async () => {
    const captured = captureConsole();
    const details = `Failing row contains (${NOTE_ID}, ${NOTE.pros}, ${USER_EMAIL}).`;
    const network = stubNetwork({
      remove: () => jsonResponse({ code: "XX000", message: "internal error", details, hint: null }, 500),
    });

    const message = deleteError(await remove());

    expect(message).toContain("Nie udało się usunąć notatki");
    expect(message).toContain("pozostała bez zmian");
    expect(network.deletes()).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "delete",
        reason: "delete_failed",
        intent: "delete",
        ...IDS,
        db_code: "XX000",
        db_message: "internal error",
        db_status: 500,
      }),
    ]);
    expect(captured.text()).not.toContain("Failing row");
    expect(captured.text()).not.toContain("kanarek");
  });

  it("does not claim the note was kept when the delete got no answer: one delete", async () => {
    const captured = captureConsole();
    // A rejected promise, not `undefined`: the request was planned, the database just never answered.
    const network = stubNetwork({ remove: () => Promise.reject(new TypeError("fetch failed")) });

    const message = deleteError(await remove());

    expect(message).toContain("potwierdzić usunięcia");
    expect(message).not.toContain("pozostała");
    expect(message).not.toContain("bez zmian");
    expect(network.deletes()).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "delete",
        reason: "delete_unconfirmed",
        intent: "delete",
        ...IDS,
        db_message: "TypeError: fetch failed",
        db_status: 0,
      }),
    ]);
  });
});

describe("POST /api/notes: a request refused before the write changes nothing", () => {
  it.each([
    ["a save", { offer_id: OFFER_ID, ...NOTE }],
    ["a delete", { offer_id: OFFER_ID, intent: "delete" }],
  ])("sends a signed-out visitor to the sign-in page for %s: no request at all", async (_label, fields) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const target = location(await submit(fields, null));

    expect(target.pathname).toBe("/auth/signin");
    expect(target.search).toBe("");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "auth", reason: "signed_out" }),
    ]);
  });

  it("refuses a body that is not a form: no request at all", async () => {
    const captured = captureConsole();
    const network = stubNetwork();
    const request = new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: OFFER_ID, intent: "delete" }),
    });

    const message = boardError(await post(request, MEMBER));

    expect(message).toContain("formularza notatki");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "body", reason: "unreadable_body", user_id: USER_ID }),
    ]);
  });

  // An intent off the list neither saves nor deletes — with a whole note in the form beside it.
  it.each([
    ["an intent off the list", "archive"],
    ["delete in another case", "Delete"],
    ["save with a space", "save "],
    ["an intent with a canary", "kanarek-intencja"],
  ])("refuses %s on the board: no save, no delete", async (_label, intent) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const message = boardError(await submit({ offer_id: OFFER_ID, intent, ...NOTE }));

    expect(message).toContain("Nieznana akcja formularza notatki");
    expect(network.saves()).toHaveLength(0);
    expect(network.deletes()).toHaveLength(0);
    expect(network.requests).toHaveLength(0);
    // The value itself is not logged: it is whatever the request carried.
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "intent", reason: "unknown_intent", user_id: USER_ID }),
    ]);
    expect(captured.text()).not.toContain("kanarek");
  });

  it.each([
    ["a save with no offer id", { ...NOTE }, "save"],
    ["a save with an offer id that is not a uuid", { offer_id: "1 or 1=1", ...NOTE }, "save"],
    ["a delete with no offer id", { intent: "delete" }, "delete"],
    ["a delete with an offer id that has a query inside", { intent: "delete", offer_id: `${OFFER_ID}&x=1` }, "delete"],
  ])("refuses %s on the board: no request at all", async (_label, fields: Record<string, string>, intent) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const message = boardError(await submit(fields));

    expect(message).toBe("Nie znaleziono oferty, do której należy notatka.");
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "offer_id", reason: "invalid_offer", intent, user_id: USER_ID }),
    ]);
    expect(captured.text()).not.toContain("1 or 1=1");
  });
});

// The save as it was before the route learned to delete (FR-012): the same upsert, the same
// addresses. Only the log entries are new.
describe("POST /api/notes: a save sends the same upsert with or without an intent", () => {
  const SAVES: [string, Record<string, string>][] = [
    ["no intent", {}],
    ["an empty intent", { intent: "" }],
    ["intent=save", { intent: "save" }],
  ];

  it.each(SAVES)("saves with %s and returns to the card's notes: one save, no delete", async (_label, extra) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const target = location(await submit({ offer_id: OFFER_ID, ...NOTE, ...extra }));

    expect(target.pathname).toBe(`/offers/${OFFER_ID}`);
    expect(target.search).toBe("");
    expect(target.hash).toBe("#notatki");
    expect(network.saves()).toHaveLength(1);
    expect(network.deletes()).toHaveLength(0);
    expect(network.requests).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "saved", stage: "save", intent: "save", ...IDS }),
    ]);
    expect(captured.text()).not.toContain("kanarek");
  });

  it.each(SAVES)("sends the offer, the session's member and the three fields with %s", async (_label, extra) => {
    captureConsole();
    const network = stubNetwork();

    await submit({ offer_id: OFFER_ID, ...NOTE, author_id: OTHER_MEMBER_ID, ...extra });

    // Written out by hand: the row, and nothing a form field could add to it — `intent` included.
    expect(sentRow(network.saves())).toStrictEqual({ offer_id: OFFER_ID, author_id: USER_ID, ...NOTE });
    expect(network.saves()[0]?.body).not.toContain(OTHER_MEMBER_ID);
    expect(new URL(network.saves()[0]?.url ?? "").searchParams.get("on_conflict")).toBe("offer_id,author_id");
  });

  it("stores a textarea's CRLF line breaks as LF and nothing else changed: one save", async () => {
    captureConsole();
    const network = stubNetwork();

    await submit({ offer_id: OFFER_ID, pros: "  pierwsza\r\ndruga  ", cons: "", observations: "" });

    expect(sentRow(network.saves())).toStrictEqual({
      offer_id: OFFER_ID,
      author_id: USER_ID,
      pros: "  pierwsza\ndruga  ",
      cons: "",
      observations: "",
    });
  });

  it.each([
    ["a blank note", { pros: "", cons: "   ", observations: "\n" }, "blank_note", "Wpisz coś"],
    ["a field over the limit", { pros: "x".repeat(5001), cons: "", observations: "" }, "note_too_long", "5000"],
  ])("refuses %s on the card without a write: no save", async (_label, fields, reason, fragment) => {
    const captured = captureConsole();
    const network = stubNetwork();

    const message = saveError(await submit({ offer_id: OFFER_ID, ...fields }));

    expect(message).toContain(fragment);
    expect(network.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "note", reason, intent: "save", ...IDS }),
    ]);
  });

  // Beside the limit refused above: a field exactly at it is saved.
  it("saves a field exactly at the limit: one save", async () => {
    captureConsole();
    const network = stubNetwork();

    const target = location(await submit({ offer_id: OFFER_ID, pros: "x".repeat(5000) }));

    expect(target.searchParams.has("error")).toBe(false);
    expect(network.saves()).toHaveLength(1);
  });

  it("reports an offer that is not there (23503) on the board: one save", async () => {
    const captured = captureConsole();
    const network = stubNetwork({
      save: () =>
        jsonResponse({ code: "23503", message: "violates foreign key constraint", details: null, hint: null }, 409),
    });

    const message = boardError(await submit({ offer_id: OFFER_ID, ...NOTE }));

    expect(message).toBe("Nie znaleziono oferty, do której należy notatka.");
    expect(network.saves()).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "refused",
        stage: "save",
        reason: "offer_missing",
        intent: "save",
        ...IDS,
        db_code: "23503",
      }),
    ]);
  });

  it("reports a note the table's check refuses (23514) as a blank note, on the card: one save", async () => {
    const captured = captureConsole();
    const details = `Failing row contains (${NOTE_ID}, ${NOTE.pros}).`;
    const network = stubNetwork({
      save: () => jsonResponse({ code: "23514", message: "violates check constraint", details, hint: null }, 400),
    });

    const message = saveError(await submit({ offer_id: OFFER_ID, ...NOTE }));

    expect(message).toBe("Wpisz coś w co najmniej jednym polu notatki.");
    expect(network.saves()).toHaveLength(1);
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "refused",
        stage: "save",
        reason: "blank_note",
        intent: "save",
        ...IDS,
        db_code: "23514",
      }),
    ]);
    expect(captured.text()).not.toContain("kanarek");
  });

  it.each([
    ["the database rejected", () => jsonResponse({ code: "XX000", message: "internal error", hint: null }, 500)],
    ["got no answer", () => Promise.reject(new TypeError("fetch failed"))],
  ])("reports a save that %s as a failed save, on the card: one save", async (_label, save: Answer) => {
    const captured = captureConsole();
    const network = stubNetwork({ save });

    const message = saveError(await submit({ offer_id: OFFER_ID, ...NOTE }));

    expect(message).toBe("Nie udało się zapisać notatki. Spróbuj ponownie.");
    expect(network.saves()).toHaveLength(1);
    expect(network.deletes()).toHaveLength(0);
    const last = captured.entries().at(-1);
    expect(last?.method).toBe("error");
    expect(last?.args[0]).toMatchObject({ event: "note", outcome: "failed", stage: "save", reason: "save_failed" });
    expect(captured.text()).not.toContain("kanarek");
  });
});

// One assertion over every way out of the route: the console must not carry the member's address,
// a word of the note or what Postgres quotes (CLAUDE.md, Conventions — the log's whitelist). Each
// scenario names the stage its last entry reports, so one that stopped reaching its exit fails
// instead of passing with nothing to search.
describe("POST /api/notes: no log entry carries the note or the member's address", () => {
  const FORBIDDEN = [USER_EMAIL, "@vetpad.local", "kanarek", NOTE.pros, NOTE.cons, NOTE.observations, "Failing row"];

  const quoted = (code: string, status: number): Answer => {
    return () =>
      jsonResponse(
        {
          code,
          message: "rejected",
          details: `Failing row contains (${NOTE.pros}, ${NOTE.cons}, ${NOTE.observations}, ${USER_EMAIL}).`,
          hint: null,
        },
        status,
      );
  };
  const save = (extra: Record<string, string> = {}) => submit({ offer_id: OFFER_ID, ...NOTE, ...extra });

  const SCENARIOS: [string, string, () => Promise<Response>][] = [
    ["auth", "a signed-out visitor", () => (stubNetwork(), submit({ offer_id: OFFER_ID, ...NOTE }, null))],
    ["intent", "an intent that is a note", () => (stubNetwork(), save({ intent: NOTE.pros }))],
    ["offer_id", "an offer id that is a note", () => (stubNetwork(), submit({ ...NOTE, offer_id: NOTE.cons }))],
    ["note", "a note over the limit", () => (stubNetwork(), save({ pros: `kanarek ${"x".repeat(5000)}` }))],
    ["save", "a note, saved", () => (stubNetwork(), save())],
    ["save", "a save Postgres rejected, quoting the row", () => (stubNetwork({ save: quoted("XX000", 500) }), save())],
    ["save", "a save the check refused, quoting the row", () => (stubNetwork({ save: quoted("23514", 400) }), save())],
    ["delete", "a delete sent with the editor's text", () => (stubNetwork(), remove(NOTE))],
    ["delete", "a delete that reached no row", () => (stubNetwork({ remove: () => jsonResponse([], 200) }), remove())],
    [
      "delete",
      "a delete Postgres rejected, quoting the row",
      () => (stubNetwork({ remove: quoted("XX000", 500) }), remove()),
    ],
  ];

  it.each(SCENARIOS)("at the %s stage: %s", async (stage, _label, run) => {
    const captured: ConsoleCapture = captureConsole();
    await run();

    const last = captured.entries().at(-1);
    expect(last?.args).toHaveLength(1);
    expect(last?.args[0]).toMatchObject({ event: "note", stage });

    const text = captured.text();
    for (const forbidden of FORBIDDEN) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// The shared assertion of this file: the route writes the member's own note and reads nothing. It
// stands last, so it reads the requests of every scenario before it.
describe("POST /api/notes: every request is a write of the session member's own note", () => {
  it("sent every request of this file to `offer_notes`, each naming the session's member", () => {
    // Controls: the scenarios above did run, did save and did delete.
    expect(scenarios).toBeGreaterThan(40);
    expect(everyRequest.filter(isNoteSave).length).toBeGreaterThan(12);
    expect(everyRequest.filter(isNoteDelete).length).toBeGreaterThan(10);

    for (const request of everyRequest) {
      expect(isNoteSave(request) || isNoteDelete(request)).toBe(true);
      expect(request.url).not.toContain(OTHER_MEMBER_ID);
      if (isNoteDelete(request)) {
        const params = new URL(request.url).searchParams;
        expect(params.get("author_id")).toBe(`eq.${USER_ID}`);
        expect(params.get("offer_id")).toBe(`eq.${OFFER_ID}`);
      } else {
        expect(JSON.parse(request.body ?? "{}")).toMatchObject({ author_id: USER_ID, offer_id: OFFER_ID });
      }
    }
  });
});
