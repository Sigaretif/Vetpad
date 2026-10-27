import { describe, expect, it } from "vitest";
import { classifyAuditAnswer } from "@/lib/audit/stream";
import { commuteFailureMessage } from "@/lib/commute/failure";
import {
  COMMUTE_CUT_OFF,
  classifyCommuteAnswer,
  followCommuteStream,
  readCommuteResult,
  readCommuteStreamLine,
} from "@/lib/commute/stream";

// The browser's reading of `POST /api/commute` (FR-016), as pure functions. Expected outcomes are
// written by hand from the route's contract (src/pages/api/commute.ts: every answer but the
// sign-in redirect is `200` NDJSON whose last line is `done` with the result or `failed` with a
// known reason and its sentence) and from context/changes/commute-times/plan.md (Phase 4, „Stream
// reading”): every field of a result is checked, an off-shape line is skipped, and a body without
// its last line says nothing about how the calculation ended.

const ROUTE = { kind: "route", durationSeconds: 1500, distanceMeters: 4200, encodedPolyline: "_p~iF~ps|U" };
const ROW = { pointId: "p-1", name: "Biuro", transit: ROUTE, drive: { kind: "no_route" } };
const RESULT = { departure: { date: "2026-10-28", time: "08:00" }, origin: "coordinates", rows: [ROW] };
const LIMIT = commuteFailureMessage("daily_limit");

function done(result: unknown): string {
  return JSON.stringify({ type: "done", result });
}

describe("classifyCommuteAnswer: the audit's rule, not a second copy", () => {
  it("is the very function the audit island uses", () => {
    expect(classifyCommuteAnswer).toBe(classifyAuditAnswer);
  });

  it("reads a redirect as signed out, 200 NDJSON as the stream and anything else as unreadable", () => {
    const ndjson = "application/x-ndjson; charset=utf-8";
    expect(classifyCommuteAnswer({ redirected: true, status: 200, contentType: "text/html" })).toBe("signed_out");
    expect(classifyCommuteAnswer({ redirected: false, status: 200, contentType: ndjson })).toBe("stream");
    expect(classifyCommuteAnswer({ redirected: false, status: 503, contentType: "text/html" })).toBe("unreadable");
  });
});

describe("readCommuteStreamLine: a line is read as the route types it, or not at all", () => {
  it.each<[string, unknown]>([
    ['{"type":"stage","stage":"routing"}', { type: "stage", stage: "routing" }],
    [done(RESULT), { type: "done", result: RESULT }],
    [
      JSON.stringify({ type: "failed", reason: "daily_limit", message: LIMIT }),
      { type: "failed", reason: "daily_limit", message: LIMIT },
    ],
  ])("reads %s", (text, line) => {
    expect(readCommuteStreamLine(text)).toEqual(line);
  });

  it.each<[string, string]>([
    ["an empty line", ""],
    ["a line that is not JSON", "{type:"],
    ["JSON that is not an object", "[1,2]"],
    ["an unknown type", '{"type":"alive"}'],
    ["a stage off the list", '{"type":"stage","stage":"reading"}'],
    ["a failure with an unknown reason", JSON.stringify({ type: "failed", reason: "busy", message: LIMIT })],
    ["a failure without a sentence", JSON.stringify({ type: "failed", reason: "daily_limit", message: " " })],
    ["a done line without a result", '{"type":"done"}'],
    ["a done line with an off-shape result", done({ ...RESULT, origin: "gps" })],
  ])("skips %s", (_case, text) => {
    expect(readCommuteStreamLine(text)).toBeNull();
  });
});

describe("readCommuteResult: every field of the result is checked", () => {
  it("keeps a result that reads in full, and rebuilds it from its known fields", () => {
    const withExtra = {
      ...RESULT,
      address: "ul. Kanarkowa 1",
      rows: [{ ...ROW, address: "ul. Kanarkowa 1", transit: { ...ROUTE, steps: ["w lewo"] } }],
    };

    expect(readCommuteResult(RESULT)).toEqual(RESULT);
    expect(JSON.stringify(readCommuteResult(withExtra))).not.toContain("Kanarkowa");
    expect(JSON.stringify(readCommuteResult(withExtra))).not.toContain("w lewo");
  });

  it("keeps each kind of cell, the start by address and six rows", () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      ...ROW,
      pointId: `p-${index}`,
      transit: { kind: "address_rejected" },
      drive: { kind: "address_rejected" },
    }));
    expect(readCommuteResult({ ...RESULT, origin: "address", rows })).toEqual({ ...RESULT, origin: "address", rows });
  });

  it.each<[string, unknown]>([
    ["not an object", "result"],
    ["no departure", { ...RESULT, departure: null }],
    ["a departure that is not a date", { ...RESULT, departure: { date: "28.10.2026", time: "08:00" } }],
    ["a departure at another hour", { ...RESULT, departure: { date: "2026-10-28", time: "09:00" } }],
    ["an unknown start", { ...RESULT, origin: "building" }],
    ["no rows", { ...RESULT, rows: [] }],
    ["rows that are not a list", { ...RESULT, rows: { 0: ROW } }],
    ["more rows than a team may keep", { ...RESULT, rows: Array.from({ length: 7 }, () => ROW) }],
    ["a row without a name", { ...RESULT, rows: [{ ...ROW, name: 7 }] }],
    ["a row without an id", { ...RESULT, rows: [{ ...ROW, pointId: "" }] }],
    ["a cell of an unknown kind", { ...RESULT, rows: [{ ...ROW, drive: { kind: "steps" } }] }],
    ["a missing cell", { ...RESULT, rows: [{ ...ROW, drive: undefined }] }],
    ["a route without a time", { ...RESULT, rows: [{ ...ROW, transit: { ...ROUTE, durationSeconds: "25 min" } }] }],
    ["a negative distance", { ...RESULT, rows: [{ ...ROW, transit: { ...ROUTE, distanceMeters: -1 } }] }],
    ["an infinite time", { ...RESULT, rows: [{ ...ROW, transit: { ...ROUTE, durationSeconds: Infinity } }] }],
    ["a route without its line", { ...RESULT, rows: [{ ...ROW, transit: { ...ROUTE, encodedPolyline: "" } }] }],
  ])("refuses a result with %s", (_case, value) => {
    expect(readCommuteResult(value)).toBeNull();
  });
});

/** A body that arrives in the given chunks, each cut wherever the test cut it. */
function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("followCommuteStream: the body to its last line, or nothing", () => {
  it("answers the done line and reports the stage on the way, across lines cut anywhere", async () => {
    const text = `{"type":"stage","stage":"routing"}\n${done(RESULT)}\n`;
    const stages: number[] = [];

    const final = await followCommuteStream(body([text.slice(0, 7), text.slice(7, 50), text.slice(50)]), () => {
      stages.push(1);
    });

    expect(final).toEqual({ type: "done", result: RESULT });
    expect(stages).toHaveLength(1);
  });

  it("answers a failed line", async () => {
    const line = JSON.stringify({ type: "failed", reason: "daily_limit", message: LIMIT });
    expect(await followCommuteStream(body([`${line}\n`]))).toEqual({
      type: "failed",
      reason: "daily_limit",
      message: LIMIT,
    });
  });

  it("reads a last line that ends without a line break", async () => {
    expect(await followCommuteStream(body([done(RESULT)]))).toEqual({ type: "done", result: RESULT });
  });

  it.each<[string, string[]]>([
    ["a body that ends after the stage", ['{"type":"stage","stage":"routing"}\n']],
    ["an empty body", []],
    ["a body cut inside its last line", [done(RESULT).slice(0, 40)]],
    ["a body whose last line does not read", [`${done({ ...RESULT, rows: [] })}\n`]],
  ])("answers null for %s — not known how the calculation ended", async (_case, chunks) => {
    expect(await followCommuteStream(body(chunks))).toBeNull();
  });

  it("answers null for no body and for a body whose reading fails", async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection dropped"));
      },
    });

    expect(await followCommuteStream(null)).toBeNull();
    expect(await followCommuteStream(failing)).toBeNull();
  });

  it("tells the member a cut-off body in a sentence that offers no retry", () => {
    expect(COMMUTE_CUT_OFF).toBe("Nie wiadomo, jak skończyło się liczenie — odśwież stronę.");
  });
});
