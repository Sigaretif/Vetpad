import { describe, expect, it } from "vitest";
import type { RouteCallResult } from "@/lib/commute/google";
import { decideCommuteOutcome, type CommuteCalls } from "@/lib/commute/outcome";

// Expected outcomes are written by hand from context/changes/commute-times/plan.md („Outcome rule”,
// the user's decision of 2026-10-26): (1) any failed call fails the whole calculation; (2) every point
// rejected in one mode is `request_rejected`; (3) a point rejected in exactly one mode is
// `request_rejected`; (4) a point rejected in both modes is a row „Google odrzucił adres”; (5) no
// route is „brak trasy”; (6) otherwise the route. With one point rejected in both modes, rule 2
// fires before rule 4. Every case that keeps a result stands beside one that fails.

const A = { id: "p-a", name: "Biuro" };
const B = { id: "p-b", name: "Szkoła" };

const ROUTE_A: RouteCallResult = { kind: "route", durationSeconds: 1500, distanceMeters: 9000, encodedPolyline: "aaa" };
const ROUTE_B: RouteCallResult = { kind: "route", durationSeconds: 900, distanceMeters: 7000, encodedPolyline: "bbb" };
const NO_ROUTE: RouteCallResult = { kind: "no_route" };
const REJECTED: RouteCallResult = { kind: "rejected", googleStatus: "INVALID_ARGUMENT" };

function failed(reason: "denied" | "quota" | "unavailable" | "timeout" | "unreadable", httpStatus: number | null) {
  return { kind: "failed", reason, httpStatus, googleStatus: null } as const satisfies RouteCallResult;
}

const routeCell = (result: RouteCallResult) => {
  if (result.kind !== "route") throw new Error("expected a route");
  return { ...result };
};

function pair(transit: RouteCallResult, drive: RouteCallResult): CommuteCalls {
  return { transit, drive };
}

describe("decideCommuteOutcome: rule 6 — routes", () => {
  it("gives each point both cells, in the points' order, with names and never an address", () => {
    expect(decideCommuteOutcome([A, B], [pair(ROUTE_A, ROUTE_B), pair(ROUTE_B, ROUTE_A)])).toEqual({
      kind: "result",
      rows: [
        { pointId: "p-a", name: "Biuro", transit: routeCell(ROUTE_A), drive: routeCell(ROUTE_B) },
        { pointId: "p-b", name: "Szkoła", transit: routeCell(ROUTE_B), drive: routeCell(ROUTE_A) },
      ],
    });
  });
});

describe("decideCommuteOutcome: rule 1 — a failed call fails the whole calculation", () => {
  it.each([
    ["a denied key", failed("denied", 403)],
    ["a quota", failed("quota", 429)],
    ["an outage", failed("unavailable", 503)],
    ["no answer", failed("unavailable", null)],
    ["a timeout", failed("timeout", null)],
    ["an unreadable body", failed("unreadable", 200)],
  ])("fails on %s in one cell, though every other cell has a route", (_what, failure) => {
    expect(decideCommuteOutcome([A, B], [pair(ROUTE_A, ROUTE_A), pair(ROUTE_B, failure)])).toEqual({
      kind: "failed",
      reason: failure.reason,
      call: { pointIndex: 1, mode: "DRIVE", httpStatus: failure.httpStatus, googleStatus: null },
    });
  });

  it("control: the same calculation without the failure keeps its result", () => {
    expect(decideCommuteOutcome([A, B], [pair(ROUTE_A, ROUTE_A), pair(ROUTE_B, ROUTE_B)]).kind).toBe("result");
  });

  it("reports the first failed call, by point and then transit before car", () => {
    expect(
      decideCommuteOutcome([A, B], [pair(ROUTE_A, failed("quota", 429)), pair(failed("timeout", null), ROUTE_B)]),
    ).toMatchObject({ kind: "failed", reason: "quota", call: { pointIndex: 0, mode: "DRIVE" } });
  });

  it("puts a failure before a rejection", () => {
    expect(
      decideCommuteOutcome([A, B], [pair(REJECTED, REJECTED), pair(ROUTE_B, failed("denied", 401))]),
    ).toMatchObject({
      kind: "failed",
      reason: "denied",
    });
  });
});

describe("decideCommuteOutcome: rule 2 — every point rejected in one mode", () => {
  it("fails when every point's transit request was rejected", () => {
    expect(decideCommuteOutcome([A, B], [pair(REJECTED, ROUTE_A), pair(REJECTED, ROUTE_B)])).toEqual({
      kind: "failed",
      reason: "request_rejected",
      call: { pointIndex: 0, mode: "TRANSIT", httpStatus: 400, googleStatus: "INVALID_ARGUMENT" },
    });
  });

  it("fails when every point's car request was rejected", () => {
    expect(decideCommuteOutcome([A, B], [pair(ROUTE_A, REJECTED), pair(ROUTE_B, REJECTED)])).toMatchObject({
      kind: "failed",
      reason: "request_rejected",
      call: { pointIndex: 0, mode: "DRIVE" },
    });
  });

  it("fails when every point was rejected in both modes", () => {
    expect(decideCommuteOutcome([A, B], [pair(REJECTED, REJECTED), pair(REJECTED, REJECTED)])).toMatchObject({
      kind: "failed",
      reason: "request_rejected",
    });
  });

  it("with a single point rejected in both modes, fires before rule 4: the whole calculation fails", () => {
    expect(decideCommuteOutcome([A], [pair(REJECTED, REJECTED)])).toEqual({
      kind: "failed",
      reason: "request_rejected",
      call: { pointIndex: 0, mode: "TRANSIT", httpStatus: 400, googleStatus: "INVALID_ARGUMENT" },
    });
  });

  it("control: a single point with routes keeps its result", () => {
    expect(decideCommuteOutcome([A], [pair(ROUTE_A, ROUTE_A)]).kind).toBe("result");
  });
});

describe("decideCommuteOutcome: rule 3 — a point rejected in exactly one mode", () => {
  it("fails, though the other point has routes", () => {
    expect(decideCommuteOutcome([A, B], [pair(ROUTE_A, ROUTE_A), pair(ROUTE_B, REJECTED)])).toEqual({
      kind: "failed",
      reason: "request_rejected",
      call: { pointIndex: 1, mode: "DRIVE", httpStatus: 400, googleStatus: "INVALID_ARGUMENT" },
    });
  });

  it("fails when the one rejected mode is transit", () => {
    expect(decideCommuteOutcome([A, B], [pair(REJECTED, ROUTE_A), pair(ROUTE_B, ROUTE_B)])).toMatchObject({
      kind: "failed",
      reason: "request_rejected",
      call: { pointIndex: 0, mode: "TRANSIT" },
    });
  });

  it("control: the same point rejected in both modes keeps the result (rule 4)", () => {
    expect(decideCommuteOutcome([A, B], [pair(ROUTE_A, ROUTE_A), pair(REJECTED, REJECTED)]).kind).toBe("result");
  });
});

describe("decideCommuteOutcome: rule 4 — a point rejected in both modes", () => {
  it("becomes a row of rejected addresses, and the other point keeps its routes", () => {
    expect(decideCommuteOutcome([A, B], [pair(ROUTE_A, ROUTE_B), pair(REJECTED, REJECTED)])).toEqual({
      kind: "result",
      rows: [
        { pointId: "p-a", name: "Biuro", transit: routeCell(ROUTE_A), drive: routeCell(ROUTE_B) },
        { pointId: "p-b", name: "Szkoła", transit: { kind: "address_rejected" }, drive: { kind: "address_rejected" } },
      ],
    });
  });
});

describe("decideCommuteOutcome: rule 5 — no route", () => {
  it("is „brak trasy” for that point and mode, and the rest keeps its routes", () => {
    expect(decideCommuteOutcome([A, B], [pair(NO_ROUTE, ROUTE_A), pair(ROUTE_B, ROUTE_B)])).toEqual({
      kind: "result",
      rows: [
        { pointId: "p-a", name: "Biuro", transit: { kind: "no_route" }, drive: routeCell(ROUTE_A) },
        { pointId: "p-b", name: "Szkoła", transit: routeCell(ROUTE_B), drive: routeCell(ROUTE_B) },
      ],
    });
  });

  it("keeps a result where no point has a route at all — an answer, not a failure", () => {
    expect(decideCommuteOutcome([A], [pair(NO_ROUTE, NO_ROUTE)])).toEqual({
      kind: "result",
      rows: [{ pointId: "p-a", name: "Biuro", transit: { kind: "no_route" }, drive: { kind: "no_route" } }],
    });
  });

  it("control: a failed call beside no route still fails the whole calculation", () => {
    expect(decideCommuteOutcome([A], [pair(NO_ROUTE, failed("unavailable", 500))]).kind).toBe("failed");
  });
});

describe("decideCommuteOutcome: its input", () => {
  it("is `no_points` for a team without points, never an empty result", () => {
    expect(decideCommuteOutcome([], [])).toEqual({ kind: "failed", reason: "no_points" });
  });

  it("throws when the calls do not pair with the points", () => {
    expect(() => decideCommuteOutcome([A, B], [pair(ROUTE_A, ROUTE_A)])).toThrow();
  });
});
