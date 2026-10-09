import { describe, expect, it } from "vitest";
import { classifyAuditAnswer, followAuditStream, readAuditStreamLine } from "@/lib/audit/stream";

// The browser's reading of `POST /api/audits`, as pure functions. Expected outcomes are written by
// hand from the contract of the route (src/pages/api/audits.ts: no session redirects, every other
// answer is `200` NDJSON whose last line is `done` or `failed`) and of the island in
// context/changes/grounded-listing-audit/plan.md (Phase 5, and plan-review findings F3 and F4):
// only a redirected answer means "signed out"; an answer that is not the stream is neither a
// sign-out nor a failed audit; and a body that ends without its final line says nothing about how
// the audit ended, so it is never a failure to retry.

const NDJSON = "application/x-ndjson; charset=utf-8";
const BUSY = "Audyt tej oferty już trwa. Drugi nie został uruchomiony — poczekaj na wynik i odśwież kartę.";

describe("classifyAuditAnswer: only a redirected answer is a sign-out (F4)", () => {
  it("reads 200 with the NDJSON type as the audit's stream", () => {
    expect(classifyAuditAnswer({ redirected: false, status: 200, contentType: NDJSON })).toBe("stream");
  });

  it.each(["application/x-ndjson", "Application/X-NDJSON; charset=utf-8", " application/x-ndjson ;charset=utf-8"])(
    "reads the content type %j as the stream's",
    (contentType) => {
      expect(classifyAuditAnswer({ redirected: false, status: 200, contentType })).toBe("stream");
    },
  );

  it("reads a redirected answer as signed out, whatever it landed on", () => {
    // `fetch` follows the redirect: what it reports is the sign-in page, 200 and HTML.
    expect(classifyAuditAnswer({ redirected: true, status: 200, contentType: "text/html; charset=utf-8" })).toBe(
      "signed_out",
    );
    expect(classifyAuditAnswer({ redirected: true, status: 200, contentType: NDJSON })).toBe("signed_out");
  });

  it.each<[string, number, string | null]>([
    ["the 503 page of an Auth outage", 503, "text/html; charset=utf-8"],
    ["a 500 page", 500, "text/html; charset=utf-8"],
    ["a 200 that is HTML", 200, "text/html; charset=utf-8"],
    ["a 200 that is JSON", 200, "application/json"],
    ["a 200 with no content type", 200, null],
    ["an NDJSON body under another status", 503, NDJSON],
    ["a type that only starts like NDJSON", 200, "application/x-ndjson-seq"],
  ])("reads %s as unreadable: not a sign-out, and not a stream", (_case, status, contentType) => {
    expect(classifyAuditAnswer({ redirected: false, status, contentType })).toBe("unreadable");
  });
});

describe("readAuditStreamLine: a line is read as the route types it, or not at all", () => {
  it.each<[string, unknown]>([
    ['{"type":"stage","stage":"reading"}', { type: "stage", stage: "reading" }],
    ['{"type":"stage","stage":"model"}', { type: "stage", stage: "model" }],
    ['{"type":"stage","stage":"saving"}', { type: "stage", stage: "saving" }],
    ['{"type":"alive"}', { type: "alive" }],
    ['{"type":"done"}', { type: "done" }],
    [
      JSON.stringify({ type: "failed", reason: "busy", message: BUSY }),
      { type: "failed", reason: "busy", message: BUSY },
    ],
  ])("reads %s", (text, expected) => {
    expect(readAuditStreamLine(text)).toEqual(expected);
  });

  it("keeps only the fields the line's type has", () => {
    expect(readAuditStreamLine('{"type":"done","findings":"<script>"}')).toEqual({ type: "done" });
  });

  it.each([
    "",
    "   ",
    "not json",
    '{"type":"stage","stage":"mode',
    "null",
    "[]",
    '"done"',
    '{"type":"finished"}',
    '{"type":"stage"}',
    '{"type":"stage","stage":"thinking"}',
    '{"type":"failed","reason":"busy"}',
    '{"type":"failed","reason":"busy","message":" "}',
    '{"type":"failed","reason":"busy","message":7}',
    '{"type":"failed","reason":"made_up","message":"x"}',
    '{"type":"failed","message":"x"}',
  ])("answers null for %j", (text) => {
    expect(readAuditStreamLine(text)).toBeNull();
  });
});

/** A body that delivers `chunks` one read at a time and then ends — or fails with `error`. */
function bodyOf(chunks: (string | Uint8Array)[], error?: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => (typeof chunk === "string" ? encoder.encode(chunk) : chunk));
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) controller.enqueue(next);
      else if (error) controller.error(error);
      else controller.close();
    },
  });
}

async function follow(body: ReadableStream<Uint8Array> | null) {
  const stages: string[] = [];
  const final = await followAuditStream(body, (stage) => stages.push(stage));
  return { final, stages };
}

const STAGE_READING = '{"type":"stage","stage":"reading"}\n';
const STAGE_MODEL = '{"type":"stage","stage":"model"}\n';
const STAGE_SAVING = '{"type":"stage","stage":"saving"}\n';
const ALIVE = '{"type":"alive"}\n';
const DONE = '{"type":"done"}\n';
const FAILED = `${JSON.stringify({ type: "failed", reason: "busy", message: BUSY })}\n`;

describe("followAuditStream: the body is read to its final line", () => {
  it("answers done and reports each stage in order", async () => {
    const result = await follow(bodyOf([STAGE_READING, STAGE_MODEL, ALIVE, ALIVE, STAGE_SAVING, DONE]));

    expect(result).toEqual({ final: { type: "done" }, stages: ["reading", "model", "saving"] });
  });

  it("answers the failure with its reason and sentence", async () => {
    const result = await follow(bodyOf([STAGE_READING, FAILED]));

    expect(result).toEqual({ final: { type: "failed", reason: "busy", message: BUSY }, stages: ["reading"] });
  });

  it("reads several lines that arrive in one chunk", async () => {
    const result = await follow(bodyOf([STAGE_READING + STAGE_MODEL + ALIVE + STAGE_SAVING + DONE]));

    expect(result).toEqual({ final: { type: "done" }, stages: ["reading", "model", "saving"] });
  });

  it("puts a line together when it is cut between chunks", async () => {
    const result = await follow(
      bodyOf([
        '{"type":"sta',
        'ge","stage":"rea',
        'ding"}\n{"type":"stage",',
        '"stage":"model"}',
        '\n{"type":"do',
        'ne"}\n',
      ]),
    );

    expect(result).toEqual({ final: { type: "done" }, stages: ["reading", "model"] });
  });

  it("puts a character together when it is cut between chunks", async () => {
    // „ł" is two bytes in UTF-8: the cut falls between them.
    const bytes = new TextEncoder().encode(FAILED);
    const cut = bytes.indexOf(0xc5) + 1;
    expect(cut).toBeGreaterThan(0);

    const result = await follow(bodyOf([bytes.slice(0, cut), bytes.slice(cut)]));

    expect(result.final).toEqual({ type: "failed", reason: "busy", message: BUSY });
  });

  it("reads a final line that is not followed by a line break", async () => {
    expect((await follow(bodyOf([STAGE_READING, '{"type":"done"}']))).final).toEqual({ type: "done" });
  });

  it("skips a line it cannot read and goes on to the next", async () => {
    const result = await follow(bodyOf(["not json\n", '{"type":"later"}\n', "\n", STAGE_MODEL, DONE]));

    expect(result).toEqual({ final: { type: "done" }, stages: ["model"] });
  });

  it("stops at the final line: nothing after it is read", async () => {
    const result = await follow(bodyOf([DONE + STAGE_SAVING + FAILED]));

    expect(result).toEqual({ final: { type: "done" }, stages: [] });
  });
});

describe("followAuditStream: a body without its final line says nothing about the audit (F3)", () => {
  it("control: answers the final line when the body has one", async () => {
    expect((await follow(bodyOf([STAGE_MODEL, DONE]))).final).toEqual({ type: "done" });
  });

  it.each<[string, (string | Uint8Array)[]]>([
    ["ends after a stage", [STAGE_READING, STAGE_MODEL]],
    ["ends after a sign of life", [STAGE_MODEL, ALIVE]],
    ["is empty", []],
    ["ends in the middle of its final line", [STAGE_MODEL, '{"type":"do']],
    ["ends with a failure it cannot read", [STAGE_MODEL, '{"type":"failed","reason":"made_up","message":"x"}\n']],
  ])("answers null for a body that %s", async (_case, chunks) => {
    expect((await follow(bodyOf(chunks))).final).toBeNull();
  });

  it("answers null when reading the body fails, and does not throw", async () => {
    const result = await follow(bodyOf([STAGE_READING, STAGE_MODEL], new TypeError("network error")));

    expect(result).toEqual({ final: null, stages: ["reading", "model"] });
  });

  it("answers null when the request is aborted while the body is being read", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");

    expect((await follow(bodyOf([STAGE_MODEL], abort))).final).toBeNull();
  });

  it("answers null for an answer with no body", async () => {
    expect(await follow(null)).toEqual({ final: null, stages: [] });
  });
});
