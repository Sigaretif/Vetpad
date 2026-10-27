import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMUTE_DAILY_CALL_LIMIT } from "@/lib/commute/failure";
import { reserveCommuteCalls, type CommuteReservation } from "@/lib/commute/usage";
import { createClient } from "@/lib/supabase";
import { routesCalls } from "../../fixtures/google";
import { isReserveCommuteCallsRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase and
// @/lib/commute/usage run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from context/changes/commute-times/plan.md (Phase 2,
// `usage.ts`: one call, no retry; `VP003` is the limit; any other error, a thrown exception or an
// answer that is not a non-negative integer is a failure — „the counter never lets a call through on
// doubt”) and from supabase/migrations/20261027081817_create_commute_usage.sql. Every failure
// stands beside the reservation that succeeds: confusing the two would send requests to Google past
// the team's daily limit.

afterEach(restoreFetch);

const RESERVED: CommuteReservation = { kind: "reserved", total: 6 };
const ERROR_CANARY = "kanarek-komunikat-bazy-8a2f";

function client() {
  const supabase = createClient(new Headers(), { set: vi.fn() });
  if (supabase === null) throw new Error("expected a configured client");
  return supabase;
}

/** Answers the one reservation with `answer`; anything else is unplanned. */
function stubReservation(answer: () => Response | Promise<Response>) {
  return stubFetch((request) => (isReserveCommuteCallsRequest(request) ? answer() : undefined));
}

function postgresError(code: string, status: number): Response {
  return jsonResponse(
    { code, message: `${ERROR_CANARY} message`, details: `${ERROR_CANARY} details`, hint: null },
    status,
  );
}

describe("reserveCommuteCalls: the request", () => {
  it("calls reserve_commute_calls once, with { n }, and reaches nothing else", async () => {
    const stub = stubReservation(() => jsonResponse(6, 200));
    await reserveCommuteCalls(client(), 6);

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe("POST");
    expect(new URL(stub.requests[0]?.url ?? "").pathname).toBe("/rest/v1/rpc/reserve_commute_calls");
    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ n: 6 });
    expect(routesCalls(stub.requests)).toHaveLength(0);
  });
});

describe("reserveCommuteCalls: the day's new total is a reservation", () => {
  it("reads a total as reserved", async () => {
    stubReservation(() => jsonResponse(6, 200));
    expect(await reserveCommuteCalls(client(), 6)).toEqual(RESERVED);
  });

  it("reads the total that reaches the limit exactly as reserved", async () => {
    stubReservation(() => jsonResponse(300, 200));
    expect(await reserveCommuteCalls(client(), 2)).toEqual({ kind: "reserved", total: 300 });
  });
});

describe("reserveCommuteCalls: VP003 is the limit", () => {
  it("reads VP003 as the limit, once", async () => {
    const stub = stubReservation(() => postgresError("VP003", 400));
    expect(await reserveCommuteCalls(client(), 4)).toEqual({ kind: "limit" });
    expect(stub.requests).toHaveLength(1);
  });

  it("control: the same call answered with a total is reserved", async () => {
    stubReservation(() => jsonResponse(6, 200));
    expect(await reserveCommuteCalls(client(), 6)).toEqual(RESERVED);
  });
});

describe("reserveCommuteCalls: anything else is a failure, never a reservation", () => {
  it.each([
    ["42501 (no session)", "42501", 403],
    ["22023 (n out of range)", "22023", 400],
    ["a 500 with a Postgres code", "XX000", 500],
  ])("reads %s as failed with its code, once", async (_what, code, status) => {
    const stub = stubReservation(() => postgresError(code, status));
    const result = await reserveCommuteCalls(client(), 6);

    expect(result).toEqual({ kind: "failed", dbCode: code });
    expect(JSON.stringify(result)).not.toContain(ERROR_CANARY);
    expect(stub.requests).toHaveLength(1);
  });

  it("reads a network error as failed, with no code, once", async () => {
    const stub = stubReservation(() => Promise.reject(new TypeError(`${ERROR_CANARY}: fetch failed`)));
    const result = await reserveCommuteCalls(client(), 6);

    expect(result).toEqual({ kind: "failed", dbCode: null });
    expect(JSON.stringify(result)).not.toContain(ERROR_CANARY);
    expect(stub.requests).toHaveLength(1);
  });

  it.each([
    ["null", null],
    ["a string", "6"],
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["an object", { reserve_commute_calls: 6 }],
  ])("reads an answer that is %s as failed, with no code", async (_what, value) => {
    stubReservation(() => jsonResponse(value, 200));
    expect(await reserveCommuteCalls(client(), 6)).toEqual({ kind: "failed", dbCode: null });
  });

  it("control: a total of 0 — no row yet is no calls — is a non-negative integer, so it reads", async () => {
    stubReservation(() => jsonResponse(0, 200));
    expect(await reserveCommuteCalls(client(), 6)).toEqual({ kind: "reserved", total: 0 });
  });
});

describe("COMMUTE_DAILY_CALL_LIMIT and the migration change together", () => {
  const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

  it("equals the limit literal in reserve_commute_calls", () => {
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith("_create_commute_usage.sql"));
    expect(files).toHaveLength(1);
    const sql = readFileSync(path.join(MIGRATIONS, files[0] ?? ""), "utf8");

    const limits = [...sql.matchAll(/calls \+ excluded\.calls <= (\d+)/g)].map((match) => Number(match[1]));
    // The control: the conflict branch's limit was found, once.
    expect(limits).toHaveLength(1);
    expect(limits[0]).toBe(COMMUTE_DAILY_CALL_LIMIT);
  });
});
