// The browser's side of `POST /api/commute` (FR-016): reading the NDJSON body line by line. Pure
// functions, so the card's island (`src/components/offers/CommuteRunner.tsx`) holds no parsing of
// its own and these rules are tested without a browser (tests/lib/commute/stream.test.ts).
//
// What kind of answer came back is told by `classifyAuditAnswer` in `@/lib/audit/stream` — the
// same rule, never a second copy: a redirect is a sign-out, `200` with NDJSON is a stream, anything
// else is unreadable. Everything else here is the commute's own.
//
// The island ships this module to the browser: the route enters through `import type` only, and
// the runtime imports — `@/lib/commute/failure` and `@/lib/commute/points` — reach no server code
// (`points` takes `@/lib/supabase` through `import type` alone).

import { isCommuteFailureReason } from "@/lib/commute/failure";
import type { CommuteCell, CommuteRow } from "@/lib/commute/outcome";
import { COMMUTE_POINTS_MAX } from "@/lib/commute/points";
import type { CommuteResult, CommuteStreamLine } from "@/pages/api/commute";

export { classifyAuditAnswer as classifyCommuteAnswer } from "@/lib/audit/stream";

/**
 * What the island says when the body ended without its last line: the calculation may or may not
 * have reached Google, so no retry is offered — the member reloads the page.
 */
export const COMMUTE_CUT_OFF = "Nie wiadomo, jak skończyło się liczenie — odśwież stronę.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A count Google gives: a finite number, never negative. */
function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** One cell, rebuilt from its known fields only — nothing else the line carried is kept. */
function readCell(value: unknown): CommuteCell | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "route": {
      const { durationSeconds, distanceMeters, encodedPolyline } = value;
      if (!isAmount(durationSeconds) || !isAmount(distanceMeters)) return null;
      if (typeof encodedPolyline !== "string" || encodedPolyline === "") return null;
      return { kind: "route", durationSeconds, distanceMeters, encodedPolyline };
    }
    case "no_route":
      return { kind: "no_route" };
    case "address_rejected":
      return { kind: "address_rejected" };
    default:
      return null;
  }
}

function readRow(value: unknown): CommuteRow | null {
  if (!isRecord(value)) return null;
  const { pointId, name } = value;
  if (typeof pointId !== "string" || pointId === "" || typeof name !== "string") return null;
  const transit = readCell(value.transit);
  const drive = readCell(value.drive);
  if (transit === null || drive === null) return null;
  return { pointId, name, transit, drive };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `done` line's result, every field checked, or `null` when any one is off-shape: a departure
 * that is not a date at 08:00, an unknown start, no rows or more than the team may keep, a row
 * without a name, a cell of an unknown kind or a route without its time, distance and line.
 */
export function readCommuteResult(value: unknown): CommuteResult | null {
  if (!isRecord(value)) return null;
  const { departure, origin, rows } = value;
  if (!isRecord(departure)) return null;
  if (typeof departure.date !== "string" || !DATE.test(departure.date) || departure.time !== "08:00") return null;
  if (origin !== "coordinates" && origin !== "address") return null;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > COMMUTE_POINTS_MAX) return null;
  const read: CommuteRow[] = [];
  for (const row of rows as unknown[]) {
    const parsed = readRow(row);
    if (parsed === null) return null;
    read.push(parsed);
  }
  return { departure: { date: departure.date, time: "08:00" }, origin, rows: read };
}

/**
 * One line of the body as the route types it, or `null` for a line that is not one: empty, not
 * JSON, of a type this version does not know, a stage off the list, a failure without a known
 * reason and a sentence, or a result that does not read in full. A line that does not read is
 * skipped, never guessed at.
 */
export function readCommuteStreamLine(text: string): CommuteStreamLine | null {
  if (text.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "stage":
      return value.stage === "routing" ? { type: "stage", stage: "routing" } : null;
    case "done": {
      const result = readCommuteResult(value.result);
      return result === null ? null : { type: "done", result };
    }
    case "failed": {
      const { reason, message } = value;
      if (!isCommuteFailureReason(reason) || typeof message !== "string" || message.trim() === "") return null;
      return { type: "failed", reason, message };
    }
    default:
      return null;
  }
}

/** The line that ends a calculation's stream: how it ended. */
export type CommuteFinalLine = Extract<CommuteStreamLine, { type: "done" | "failed" }>;

/**
 * Reads the body to its final line and answers it, calling `onStage` when the calls to Google are
 * on their way. Lines arrive cut anywhere, so the text is put together across chunks before it is
 * split — the reading of `followAuditStream`.
 *
 * `null` is a body that gave no final line: there was none, it ended early, or reading it failed.
 * That says nothing about how the calculation ended, so the caller tells the member
 * `COMMUTE_CUT_OFF` and offers no retry. Never throws.
 */
export async function followCommuteStream(
  body: ReadableStream<Uint8Array> | null,
  onStage: () => void = () => undefined,
): Promise<CommuteFinalLine | null> {
  if (body === null) return null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const parts = pending.split("\n");
      pending = done ? "" : (parts.pop() ?? "");
      for (const part of parts) {
        const line = readCommuteStreamLine(part);
        if (line === null) continue;
        if (line.type === "stage") onStage();
        else return line;
      }
      if (done) return null;
    }
  } catch {
    return null;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
