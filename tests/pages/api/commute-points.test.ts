import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/commute-points";
import { type ConsoleCapture, captureConsole, restoreConsole } from "../../fixtures/console";
import {
  type RecordedRequest,
  isCommutePointsRequest,
  jsonResponse,
  restoreFetch,
  stubFetch,
} from "../../fixtures/http";

// The route with a configured Supabase client (test values, never a real project's): this mock
// overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase and @/lib/commute/points run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from context/changes/commute-times/plan.md (Phase 1, „Form
// route”): `intent` is `save` (the default) or `delete`; `id` is empty for a new point; every
// failure redirects to `/criteria?error=<msg>&form=points#punkty` with one sentence per reason, the
// cap (VP002) as „Zespół ma już 6 punktów — usuń któryś, żeby dodać nowy.”; an update that reached
// no row is a point deleted in the meantime; a delete filtered by `id` that reached no row lands on
// `/criteria?point=gone#punkty`, never on a deletion; one log entry per way out, never carrying the
// name or the address. Every scenario states how many writes reached `public.commute_points`.

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const POINT_ID = "0b9f0c2e-7d1a-4c55-9a53-00000000c0de";

/** A point's two fields, each a canary: no log entry may carry either of them. */
const NAME_CANARY = "kanarek-nazwa-punktu";
const ADDRESS_CANARY = "kanarek-adres ul. Ukryta 7, Warszawa";

type Answer = () => Response | Promise<Response>;

interface Network {
  insert?: Answer;
  update?: Answer;
  remove?: Answer;
}

/** Plans the route's three writes and nothing else: a read of the points is unplanned and fails the test. */
function stubNetwork({ insert, update, remove }: Network = {}) {
  const stub = stubFetch((request) => {
    if (isCommutePointsRequest(request, "POST")) return insert ? insert() : jsonResponse([{ id: POINT_ID }], 201);
    if (isCommutePointsRequest(request, "PATCH")) return update ? update() : jsonResponse([{ id: POINT_ID }], 200);
    if (isCommutePointsRequest(request, "DELETE")) return remove ? remove() : jsonResponse([{ id: POINT_ID }], 200);
    return undefined;
  });
  const of = (method: string) => () => stub.requests.filter((request) => isCommutePointsRequest(request, method));
  return { requests: stub.requests, inserts: of("POST"), updates: of("PATCH"), deletes: of("DELETE") };
}

function contextFor(request: Request, signedIn = true): APIContext {
  return {
    request,
    locals: { user: signedIn ? { id: USER_ID, email: "czlonek.kanarek@vetpad.local" } : null },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}

async function submit(fields: Record<string, string>, signedIn = true): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return POST(contextFor(new Request("http://localhost/api/commute-points", { method: "POST", body: form }), signedIn));
}

const NEW_POINT = { name: NAME_CANARY, address: ADDRESS_CANARY };

function location(response: Response): URL {
  // Never a 500 and never JSON: every answer of the route is a redirect.
  expect(response.status).toBe(302);
  const header = response.headers.get("Location");
  if (header === null) throw new Error("expected a redirect with a Location header");
  return new URL(header, "http://localhost");
}

/** The failure redirect: back to the points section of /criteria, naming the form. Returns the message. */
function pointsError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe("/criteria");
  expect(target.searchParams.get("form")).toBe("points");
  expect(target.searchParams.has("point")).toBe(false);
  expect(target.hash).toBe("#punkty");
  const message = target.searchParams.get("error");
  if (message === null || message === "") throw new Error("expected the redirect to carry an error message");
  return message;
}

/** The redirect of a write that succeeded: the section, with nothing in the query. */
function expectSuccess(response: Response): void {
  const target = location(response);
  expect(target.pathname).toBe("/criteria");
  expect(target.search).toBe("");
  expect(target.hash).toBe("#punkty");
}

function sentRow(writes: RecordedRequest[]): Record<string, unknown> {
  expect(writes).toHaveLength(1);
  const body = writes[0]?.body;
  if (typeof body !== "string") throw new Error("expected the write to carry a JSON body");
  return JSON.parse(body) as Record<string, unknown>;
}

/** The one entry the request wrote, checked for the event, and that it names no place. */
function onlyEntry(captured: ConsoleCapture): Record<string, unknown> {
  const entries = captured.entries();
  expect(entries).toHaveLength(1);
  const [fields] = entries[0]?.args ?? [];
  expect(fields).toMatchObject({ event: "commute_point" });
  expect(captured.text()).not.toContain("kanarek-nazwa");
  expect(captured.text()).not.toContain("kanarek-adres");
  expect(captured.text()).not.toContain("Ukryta");
  return fields as Record<string, unknown>;
}

function pgError(code: string, status: number): Answer {
  // Postgres quotes the rejected row in `details`; the route must never pass it on.
  return () => jsonResponse({ code, message: `failed: ${ADDRESS_CANARY}`, details: NAME_CANARY, hint: null }, status);
}

describe("POST /api/commute-points: adding a point is one insert", () => {
  it("inserts the trimmed name and address and nothing else, and returns to the section", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    expectSuccess(await submit({ intent: "save", id: "", name: `  ${NAME_CANARY} `, address: ` ${ADDRESS_CANARY}\t` }));

    // Written out by hand: no id, no dates — the database sets them.
    expect(sentRow(network.inserts())).toEqual({ name: NAME_CANARY, address: ADDRESS_CANARY });
    expect(network.updates()).toHaveLength(0);
    expect(network.deletes()).toHaveLength(0);
    expect(network.requests).toHaveLength(1);
    expect(new URL(network.inserts()[0]?.url ?? "").searchParams.get("select")).toBe("id");
    expect(onlyEntry(captured)).toEqual({
      level: "info",
      event: "commute_point",
      outcome: "saved",
      stage: "insert",
      intent: "save",
      user_id: USER_ID,
    });
  });

  it("treats a form without an intent as a save", async () => {
    captureConsole();
    const network = stubNetwork();

    expectSuccess(await submit(NEW_POINT));

    expect(network.inserts()).toHaveLength(1);
    expect(network.requests).toHaveLength(1);
  });
});

describe("POST /api/commute-points: changing a point is one update of that point", () => {
  it("updates the point the form names, with the trimmed fields: one update", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    expectSuccess(await submit({ intent: "save", id: POINT_ID, ...NEW_POINT }));

    expect(sentRow(network.updates())).toEqual({ name: NAME_CANARY, address: ADDRESS_CANARY });
    const params = new URL(network.updates()[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe(`eq.${POINT_ID}`);
    // Without `select`, PostgREST answers 204 and an update of nothing looks like a save.
    expect(params.get("select")).toBe("id");
    expect(network.inserts()).toHaveLength(0);
    expect(network.requests).toHaveLength(1);
    expect(onlyEntry(captured)).toMatchObject({ outcome: "saved", stage: "update", intent: "save" });
  });

  // Beside the update above: the same request after another member deleted the point.
  it("reports an update that reached no row as a point deleted in the meantime: one update", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ update: () => jsonResponse([], 200) });

    const message = pointsError(await submit({ id: POINT_ID, ...NEW_POINT }));

    expect(message).toBe("Ten punkt został w międzyczasie usunięty — zmiany nie zapisano.");
    expect(network.updates()).toHaveLength(1);
    expect(network.requests).toHaveLength(1);
    expect(onlyEntry(captured)).toMatchObject({ outcome: "refused", reason: "point_missing", stage: "update" });
  });
});

describe("POST /api/commute-points: deleting a point is one delete, filtered by its id", () => {
  it("deletes and returns to the section: one delete, nothing else", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    // The form's other fields are not read: a delete sent with the editor's text still deletes.
    expectSuccess(await submit({ intent: "delete", id: POINT_ID, ...NEW_POINT }));

    expect(network.deletes()).toHaveLength(1);
    expect(network.requests).toHaveLength(1);
    const params = new URL(network.deletes()[0]?.url ?? "").searchParams;
    // Written out by hand: a delete without the id filter would reach every point.
    expect([...params.keys()].sort()).toEqual(["id", "select"]);
    expect(params.get("id")).toBe(`eq.${POINT_ID}`);
    expect(params.get("select")).toBe("id");
    expect(network.deletes()[0]?.body).toBeNull();
    expect(onlyEntry(captured)).toEqual({
      level: "info",
      event: "commute_point",
      outcome: "deleted",
      stage: "delete",
      intent: "delete",
      user_id: USER_ID,
    });
  });

  // Beside the delete above: the same request after another member deleted the point.
  it("answers already gone for a delete that reached no row, never a deletion: one delete", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ remove: () => jsonResponse([], 200) });

    const target = location(await submit({ intent: "delete", id: POINT_ID }));

    expect(target.pathname).toBe("/criteria");
    expect(target.search).toBe("?point=gone");
    expect(target.searchParams.has("error")).toBe(false);
    expect(target.hash).toBe("#punkty");
    expect(network.deletes()).toHaveLength(1);
    expect(onlyEntry(captured)).toMatchObject({ outcome: "already_gone", reason: "point_missing" });
  });

  it("reports a delete the database failed as a failed delete: one delete", async () => {
    const captured = captureConsole();
    const network = stubNetwork({ remove: pgError("XX000", 500) });

    expect(pointsError(await submit({ intent: "delete", id: POINT_ID }))).toBe(
      "Nie udało się usunąć punktu dojazdu. Spróbuj ponownie.",
    );
    expect(network.deletes()).toHaveLength(1);
    expect(onlyEntry(captured)).toMatchObject({
      level: "error",
      outcome: "failed",
      reason: "delete_failed",
      db_code: "XX000",
      db_status: 500,
    });
  });
});

describe("POST /api/commute-points: each refusal of the database has its own sentence (one write each)", () => {
  it.each([
    [
      "the cap of six (VP002)",
      "VP002",
      400,
      "Zespół ma już 6 punktów — usuń któryś, żeby dodać nowy.",
      "too_many_points",
    ],
    [
      "a value outside the table's checks (23514)",
      "23514",
      400,
      "Baza odrzuciła ten punkt — sprawdź nazwę i adres i spróbuj ponownie.",
      "point_rejected",
    ],
    [
      "a write RLS refused (42501)",
      "42501",
      403,
      "Nie udało się potwierdzić Twojej sesji — zaloguj się ponownie i spróbuj jeszcze raz.",
      "no_session_in_database",
    ],
    ["any other error", "XX000", 500, "Nie udało się zapisać punktu dojazdu. Spróbuj ponownie.", "save_failed"],
  ])("reports %s on the points form", async (_case, code, status, sentence, reason) => {
    const captured = captureConsole();
    const network = stubNetwork({ insert: pgError(code, status) });

    expect(pointsError(await submit(NEW_POINT))).toBe(sentence);
    expect(network.inserts()).toHaveLength(1);
    expect(network.requests).toHaveLength(1);
    expect(onlyEntry(captured)).toMatchObject({ reason, db_code: code, db_status: status, stage: "insert" });
  });

  it("reports a refusal on a change as well, never as a success", async () => {
    captureConsole();
    stubNetwork({ update: pgError("23514", 400) });

    expect(pointsError(await submit({ id: POINT_ID, ...NEW_POINT }))).toBe(
      "Baza odrzuciła ten punkt — sprawdź nazwę i adres i spróbuj ponownie.",
    );
  });
});

describe("POST /api/commute-points: refusals before any write (no write each)", () => {
  it.each([
    ["a blank name", { name: "   ", address: ADDRESS_CANARY }, "Wpisz nazwę punktu.", "invalid_name"],
    ["a blank address", { name: NAME_CANARY, address: "" }, "Wpisz adres punktu.", "invalid_address"],
    [
      "a name of 61 characters",
      { name: "n".repeat(61), address: ADDRESS_CANARY },
      "Nazwa punktu może mieć najwyżej 60 znaków.",
      "invalid_name",
    ],
    [
      "an address of 201 characters",
      { name: NAME_CANARY, address: "a".repeat(201) },
      "Adres punktu może mieć najwyżej 200 znaków.",
      "invalid_address",
    ],
    [
      "an id that is not a uuid, on a save",
      { id: "not-a-uuid", ...NEW_POINT },
      "Nie znaleziono punktu dojazdu, którego dotyczy formularz.",
      "invalid_point",
    ],
    [
      "a delete without an id",
      { intent: "delete" },
      "Nie znaleziono punktu dojazdu, którego dotyczy formularz.",
      "invalid_point",
    ],
    [
      "an unknown intent",
      { intent: "erase", id: POINT_ID },
      "Nieznana akcja formularza punktu dojazdu. Punkty pozostały bez zmian.",
      "unknown_intent",
    ],
  ])("refuses %s", async (_case, fields: Record<string, string>, sentence, reason) => {
    const captured = captureConsole();
    const network = stubNetwork();

    expect(pointsError(await submit(fields))).toBe(sentence);
    expect(network.requests).toHaveLength(0);
    expect(onlyEntry(captured)).toMatchObject({ level: "info", outcome: "refused", reason });
  });

  it("refuses a body that is not a form", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    const request = new Request("http://localhost/api/commute-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(NEW_POINT),
    });
    expect(pointsError(await POST(contextFor(request)))).toBe("Nie udało się odczytać formularza punktu dojazdu.");
    expect(network.requests).toHaveLength(0);
    expect(onlyEntry(captured)).toMatchObject({ reason: "unreadable_body" });
  });

  it("sends a request without a session to sign-in, and nowhere else", async () => {
    const captured = captureConsole();
    const network = stubNetwork();

    const target = location(await submit(NEW_POINT, false));

    expect(target.pathname).toBe("/auth/signin");
    expect(target.search).toBe("");
    expect(network.requests).toHaveLength(0);
    expect(onlyEntry(captured)).toMatchObject({ outcome: "refused", reason: "signed_out" });
  });
});

describe("POST /api/commute-points: every failure reads its own sentence", () => {
  it("never words two reasons the same way", async () => {
    captureConsole();
    const messages: string[] = [];
    const record = async (network: Network, fields: Record<string, string>) => {
      stubNetwork(network);
      messages.push(pointsError(await submit(fields)));
      restoreFetch();
    };

    await record({}, { intent: "erase" });
    await record({}, { intent: "delete" });
    await record({}, { name: "", address: ADDRESS_CANARY });
    await record({}, { name: NAME_CANARY, address: "" });
    await record({ insert: pgError("VP002", 400) }, NEW_POINT);
    await record({ insert: pgError("23514", 400) }, NEW_POINT);
    await record({ insert: pgError("42501", 403) }, NEW_POINT);
    await record({ insert: pgError("XX000", 500) }, NEW_POINT);
    await record({ update: () => jsonResponse([], 200) }, { id: POINT_ID, ...NEW_POINT });
    await record({ remove: pgError("XX000", 500) }, { intent: "delete", id: POINT_ID });

    expect(new Set(messages).size).toBe(messages.length);
  });
});
