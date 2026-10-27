import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CommutePointsResult,
  commutePointErrors,
  loadCommutePoints,
  normalizeCommutePoint,
} from "@/lib/commute/points";
import { createClient } from "@/lib/supabase";
import { isCommutePointsRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase and
// @/lib/commute/points run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from context/changes/commute-times/plan.md (Phase 1, „Read
// module”: the points ordered by `created_at, id`; no client, a Postgres error, a thrown exception
// and a row that does not read all give `error`) and from the checks of
// supabase/migrations/20261027081815_create_commute_points.sql (a name of 1–60 characters, an
// address of 1–200, both trimmed).
//
// The two states that must never be confused are "the read failed" and "the team has no points":
// on /criteria the second would offer an empty list and an add form to a team that may already
// have six. Every failure below stands beside the read that succeeds and finds none.

afterEach(restoreFetch);

const NONE: CommutePointsResult = { state: "ok", points: [] };
const FAILED: CommutePointsResult = { state: "error" };

const OFFICE = { id: "0b9f0c2e-7d1a-4c55-9a53-0000000000a1", name: "Biuro", address: "ul. A 1" };
const SCHOOL = { id: "0b9f0c2e-7d1a-4c55-9a53-0000000000b2", name: "Szkoła", address: "ul. B 2" };

function client() {
  const supabase = createClient(new Headers(), { set: vi.fn() });
  if (supabase === null) throw new Error("expected a configured client");
  return supabase;
}

/** Answers the one read of the points with `answer`; anything else is unplanned. */
function stubRead(answer: () => Response) {
  return stubFetch((request) => (isCommutePointsRequest(request, "GET") ? answer() : undefined));
}

describe("loadCommutePoints: a successful read (FR-016)", () => {
  it("reads a team without points as ok with an empty list", async () => {
    stubRead(() => jsonResponse([], 200));
    expect(await loadCommutePoints(client())).toEqual(NONE);
  });

  it("reads the points in the order of the answer, with their id, name and address alone", async () => {
    stubRead(() => jsonResponse([OFFICE, SCHOOL], 200));
    expect(await loadCommutePoints(client())).toEqual({
      state: "ok",
      points: [
        { id: OFFICE.id, name: "Biuro", address: "ul. A 1" },
        { id: SCHOOL.id, name: "Szkoła", address: "ul. B 2" },
      ],
    });
  });

  it("asks for the three columns, oldest first and then by id, in one request", async () => {
    const stub = stubRead(() => jsonResponse([], 200));
    await loadCommutePoints(client());

    expect(stub.requests).toHaveLength(1);
    const params = new URL(stub.requests[0]?.url ?? "").searchParams;
    expect(params.get("select")).toBe("id,name,address");
    expect(params.get("order")).toBe("created_at.asc,id.asc");
  });
});

describe("loadCommutePoints: a failed read is never „no points”", () => {
  it("control: an empty table reads as ok", async () => {
    stubRead(() => jsonResponse([], 200));
    expect(await loadCommutePoints(client())).toEqual(NONE);
  });

  it("answers error without a client (the zero-config state), and sends nothing", async () => {
    const stub = stubFetch(() => undefined);
    expect(await loadCommutePoints(null)).toEqual(FAILED);
    expect(stub.requests).toHaveLength(0);
  });

  it("answers error when Postgres answers with an error", async () => {
    stubRead(() => jsonResponse({ code: "XX000", message: "boom", details: null, hint: null }, 500));
    expect(await loadCommutePoints(client())).toEqual(FAILED);
  });

  // A rejected `fetch` is retried for a GET and then ends as a result with `error`, never a throw
  // (tests/fixtures/http.ts); what throws is the client itself, so the test hands over one that does.
  it("answers error when the client throws", async () => {
    const stub = stubFetch(() => undefined);
    const throwing = {
      from: () => {
        throw new TypeError("client broke");
      },
    } as unknown as ReturnType<typeof client>;

    expect(await loadCommutePoints(throwing)).toEqual(FAILED);
    expect(stub.requests).toHaveLength(0);
  });

  it.each([
    ["a name that is not text", [{ ...OFFICE, name: 7 }]],
    ["an address that is null", [{ ...OFFICE, address: null }]],
    ["an id that is missing", [{ name: "Biuro", address: "ul. A 1" }]],
    ["a row that is not an object", ["Biuro"]],
    ["one bad row beside a good one", [OFFICE, { ...SCHOOL, address: 2 }]],
  ])("answers error for %s", async (_case, rows) => {
    stubRead(() => jsonResponse(rows, 200));
    expect(await loadCommutePoints(client())).toEqual(FAILED);
  });

  it("answers error for a body that is not a list", async () => {
    stubRead(() => jsonResponse({ points: [OFFICE] }, 200));
    expect(await loadCommutePoints(client())).toEqual(FAILED);
  });
});

describe("commutePointErrors: the table's checks, before the write", () => {
  it("accepts a name of 60 characters and an address of 200, around whitespace it trims", () => {
    expect(commutePointErrors({ name: ` ${"n".repeat(60)} `, address: `\t${"a".repeat(200)}\n` })).toEqual({});
  });

  it("refuses a blank name and a blank address, each on its own field", () => {
    expect(commutePointErrors({ name: "   ", address: "" })).toEqual({
      name: "Wpisz nazwę punktu.",
      address: "Wpisz adres punktu.",
    });
  });

  it("refuses a name of 61 characters and an address of 201", () => {
    expect(commutePointErrors({ name: "n".repeat(61), address: "a".repeat(201) })).toEqual({
      name: "Nazwa punktu może mieć najwyżej 60 znaków.",
      address: "Adres punktu może mieć najwyżej 200 znaków.",
    });
  });

  it("stores both fields trimmed", () => {
    expect(normalizeCommutePoint({ name: "  Biuro ", address: " ul. A 1  " })).toEqual({
      name: "Biuro",
      address: "ul. A 1",
    });
  });
});
