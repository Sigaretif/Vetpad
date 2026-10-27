// How the 2N answers of one commute calculation (FR-016) become a result or one failure: the rule
// the user set on 2026-10-26 (context/changes/commute-times/plan.md, „Outcome rule”). Pure: the route
// hands in what each call ended with, and this module decides — in this order:
//
// 1. Any call that failed (401/403/429/5xx, a timeout, no answer, an unreadable body) fails the whole
//    calculation with that call's reason — the first one, by point and then transit before car.
// 2. Every point rejected (`400`) in one mode: `request_rejected`. The fault is in our request.
// 3. A point rejected in exactly one mode: `request_rejected`. Its address is the same in both modes,
//    so the fault again lies in the request.
// 4. A point rejected in both modes: its row reads „Google odrzucił adres tego punktu”.
// 5. An accepted request with no route: „brak trasy” for that point and mode.
// 6. Otherwise: time, distance and the line for the map.
//
// With a single point rejected in both modes, rule 2 fires before rule 4 and the member reads the
// whole-failure sentence. That precedence is deliberate.

import type { CommuteFailureReason } from "./failure";
import type { CommuteMode, GoogleStatus, RouteCallResult } from "./google";

/** One cell of the table: a point in one mode. */
export type CommuteCell =
  | { kind: "route"; durationSeconds: number; distanceMeters: number; encodedPolyline: string }
  | { kind: "no_route" }
  | { kind: "address_rejected" };

/** One point's row: its name heads the row, its address never leaves the server. */
export interface CommuteRow {
  pointId: string;
  name: string;
  transit: CommuteCell;
  drive: CommuteCell;
}

/** What one point's two calls ended with. */
export interface CommuteCalls {
  transit: RouteCallResult;
  drive: RouteCallResult;
}

/** The call a failure is told by, for the route's log entry: never an address. */
export interface CommuteFailedCall {
  pointIndex: number;
  mode: CommuteMode;
  httpStatus: number | null;
  googleStatus: GoogleStatus | null;
}

export type CommuteOutcome =
  | { kind: "result"; rows: CommuteRow[] }
  | {
      kind: "failed";
      reason: Extract<
        CommuteFailureReason,
        "no_points" | "request_rejected" | "denied" | "quota" | "unavailable" | "timeout" | "unreadable"
      >;
      /** The first call the failure rests on; absent for `no_points`. */
      call?: CommuteFailedCall;
    };

function cell(result: Exclude<RouteCallResult, { kind: "failed" } | { kind: "rejected" }>): CommuteCell {
  return result.kind === "route"
    ? {
        kind: "route",
        durationSeconds: result.durationSeconds,
        distanceMeters: result.distanceMeters,
        encodedPolyline: result.encodedPolyline,
      }
    : { kind: "no_route" };
}

/**
 * The outcome of one calculation. `calls[i]` answers `points[i]`; the two lists come from the same
 * read and must be as long as each other — a mismatch is a bug in the caller, and throws. No points
 * is `no_points`, never an empty result.
 */
export function decideCommuteOutcome(
  points: readonly { id: string; name: string }[],
  calls: readonly CommuteCalls[],
): CommuteOutcome {
  if (points.length !== calls.length) throw new Error("decideCommuteOutcome: one pair of calls per point");
  if (points.length === 0) return { kind: "failed", reason: "no_points" };

  // Rule 1.
  for (const [pointIndex, pair] of calls.entries()) {
    for (const [mode, result] of [
      ["TRANSIT", pair.transit],
      ["DRIVE", pair.drive],
    ] as const) {
      if (result.kind === "failed") {
        return {
          kind: "failed",
          reason: result.reason,
          call: { pointIndex, mode, httpStatus: result.httpStatus, googleStatus: result.googleStatus },
        };
      }
    }
  }

  const rejected = (result: RouteCallResult) => result.kind === "rejected";
  const firstRejected = (mode: CommuteMode, pointIndex: number): CommuteOutcome => {
    const pair = calls[pointIndex];
    const result = mode === "TRANSIT" ? pair.transit : pair.drive;
    return {
      kind: "failed",
      reason: "request_rejected",
      call: {
        pointIndex,
        mode,
        httpStatus: 400,
        googleStatus: result.kind === "rejected" ? result.googleStatus : null,
      },
    };
  };

  // Rule 2.
  if (calls.every((pair) => rejected(pair.transit))) return firstRejected("TRANSIT", 0);
  if (calls.every((pair) => rejected(pair.drive))) return firstRejected("DRIVE", 0);

  // Rule 3.
  for (const [pointIndex, pair] of calls.entries()) {
    if (rejected(pair.transit) !== rejected(pair.drive)) {
      return firstRejected(rejected(pair.transit) ? "TRANSIT" : "DRIVE", pointIndex);
    }
  }

  // Rules 4–6.
  const rows = points.map((point, index): CommuteRow => {
    const { transit, drive } = calls[index];
    if (transit.kind === "rejected" || drive.kind === "rejected") {
      return {
        pointId: point.id,
        name: point.name,
        transit: { kind: "address_rejected" },
        drive: { kind: "address_rejected" },
      };
    }
    if (transit.kind === "failed" || drive.kind === "failed")
      throw new Error("unreachable: rule 1 ended every failure");
    return { pointId: point.id, name: point.name, transit: cell(transit), drive: cell(drive) };
  });
  return { kind: "result", rows };
}
