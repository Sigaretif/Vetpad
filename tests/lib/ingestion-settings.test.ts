import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INGESTION_MODES,
  INGESTION_MODE_LABELS,
  type IngestionSettingsResult,
  type ResolvedIngestionMode,
  loadIngestionSettings,
  resolveIngestionMode,
} from "@/lib/ingestion-settings";
import { createClient } from "@/lib/supabase";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase and
// @/lib/ingestion-settings run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from the sources, never copied from what the functions
// return: the contract of the reader in context/changes/otodom-apify-fallback/plan.md (Phase 1 §2:
// no client, a failed query, a missing row or a value outside the list is a failed read, never the
// seeded default; a failed read or a missing token runs as `direct_only`) and the closed list in
// supabase/migrations/*_create_ingestion_settings.sql.
//
// The two states that must never be confused are "the read failed" and "the row holds the
// default": the second may start a paid Apify run nobody chose. Every failure below stands beside
// the read that succeeds.

afterEach(restoreFetch);

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/** "The row holds the seeded default": a successful read, and what a failed one must never equal. */
const SEEDED: IngestionSettingsResult = { state: "ok", mode: "direct_with_fallback" };

/** The client the way a request builds it, with no session cookie. */
function client(): NonNullable<ReturnType<typeof createClient>> {
  const supabase = createClient(new Headers(), { set: vi.fn() });
  if (supabase === null) throw new Error("expected a configured Supabase client");
  return supabase;
}

/** Answers the read of `ingestion_settings`; a request to any other table is unplanned and fails the test. */
function stubSettings(answer: () => Response) {
  return stubFetch((request) => (isTableRequest(request, "ingestion_settings", "GET") ? answer() : undefined));
}

/** A read the database failed, the way PostgREST reports one. */
function failedRead(): Response {
  return jsonResponse({ code: "XX000", message: "internal error", details: null, hint: null }, 500);
}

function rows(...list: unknown[]): () => Response {
  return () => jsonResponse(list, 200);
}

function requestsTo(requests: RecordedRequest[], table: string): RecordedRequest[] {
  return requests.filter((request) => isTableRequest(request, table, "GET"));
}

describe("the closed list of modes", () => {
  // Written out by hand: the three modes the table's check admits.
  it("offers exactly the three modes", () => {
    expect([...INGESTION_MODES]).toEqual(["direct_with_fallback", "apify_only", "direct_only"]);
  });

  it("stays in step with the migration's check", () => {
    const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith("_create_ingestion_settings.sql"));
    expect(files).toHaveLength(1);
    const sql = readFileSync(path.join(MIGRATIONS, files[0]), "utf8");

    const check = /check \(mode in \(([^)]*)\)\)/.exec(sql);
    expect(check).not.toBeNull();
    const listed = [...(check?.[1] ?? "").matchAll(/'([^']*)'/g)].map((match) => match[1]);

    expect(listed).toEqual([...INGESTION_MODES]);
    // The seeded row holds the first mode of the list.
    expect(sql).toContain("values (true, 'direct_with_fallback')");
  });

  it("names every mode, and no two alike", () => {
    const labels = INGESTION_MODES.map((mode) => INGESTION_MODE_LABELS[mode]);

    for (const label of labels) expect(label.trim()).not.toBe("");
    expect(new Set(labels).size).toBe(3);
  });
});

describe("loadIngestionSettings: a failed read is its own state, never the default", () => {
  it("control: answers the seeded mode for the row the migration inserts", async () => {
    const stub = stubSettings(rows({ mode: "direct_with_fallback" }));

    expect(await loadIngestionSettings(client())).toEqual({ state: "ok", mode: "direct_with_fallback" });

    expect(stub.requests).toHaveLength(1);
    expect(requestsTo(stub.requests, "ingestion_settings")).toHaveLength(1);
    expect(new URL(stub.requests[0].url).searchParams.get("id")).toBe("eq.true");
  });

  it("answers error without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const settings = await loadIngestionSettings(null);

    expect(settings).toEqual({ state: "error", read: "error", failure: { detail: "unconfigured" } });
    expect(settings).not.toEqual(SEEDED);
    expect(stub.requests).toHaveLength(0);
  });

  it.each<[string, () => Response, string]>([
    ["a failed read (500)", failedRead, "error"],
    ["two rows (PGRST116)", rows({ mode: "direct_only" }, { mode: "direct_only" }), "error"],
    ["a missing singleton row (200 [])", rows(), "missing_row"],
    // A 200 that is not the singleton row.
    ["a body that is an empty object", () => jsonResponse({}, 200), "off_list"],
    ["a row without the mode column", rows({}), "off_list"],
    ["a row that is null", rows(null), "missing_row"],
    ["a row that is text", rows("direct_only"), "off_list"],
  ])("answers error for %s, and does not throw", async (_case, answer, read) => {
    const stub = stubSettings(answer);

    const settings = await loadIngestionSettings(client());

    expect(settings).toMatchObject({ state: "error", read });
    expect(settings).not.toEqual(SEEDED);
    // The outcome came from the database's answer — the read did go out, once.
    expect(stub.requests).toHaveLength(1);
  });

  it("names the database's code and status for a failed query", async () => {
    stubSettings(failedRead);

    expect(await loadIngestionSettings(client())).toEqual({
      state: "error",
      read: "error",
      failure: { detail: "query", dbCode: "XX000", dbStatus: 500 },
    });
  });
});

describe("loadIngestionSettings: a value outside the list is a failed read, never the default", () => {
  // The table's check admits none of these — only a stub can answer them.
  it.each<[string, unknown]>([
    ["a mode off the list", "apify_with_fallback"],
    ["a listed mode in capitals", "DIRECT_ONLY"],
    ["a listed mode with a space after it", "direct_only "],
    ["the mode's label instead of its id", "tylko bezpośrednio"],
    ["an empty text", ""],
    ["null", null],
    ["a number", 1],
    ["a boolean", true],
    ["a list holding a listed mode", ["direct_only"]],
  ])("answers off_list when the row holds %s", async (_what, mode) => {
    const stub = stubSettings(rows({ mode }));

    const settings = await loadIngestionSettings(client());

    expect(settings).toEqual({ state: "error", read: "off_list", failure: { detail: "off_list" } });
    expect(requestsTo(stub.requests, "ingestion_settings")).toHaveLength(1);
  });

  it.each([["direct_with_fallback"], ["apify_only"], ["direct_only"]])("control: reads %s as stored", async (mode) => {
    stubSettings(rows({ mode }));

    expect(await loadIngestionSettings(client())).toEqual({ state: "ok", mode });
  });
});

describe("resolveIngestionMode: what runs, and why it differs from what is configured", () => {
  const failed = (read: "error" | "missing_row" | "off_list"): IngestionSettingsResult => ({
    state: "error",
    read,
    failure: { detail: read },
  });
  const ok = (mode: "direct_with_fallback" | "apify_only" | "direct_only"): IngestionSettingsResult => ({
    state: "ok",
    mode,
  });

  // One case per (read state × token × configured mode), every expected value written by hand.
  it.each<[string, IngestionSettingsResult, boolean, ResolvedIngestionMode]>([
    [
      "direct_with_fallback with a token",
      ok("direct_with_fallback"),
      true,
      { configured: "direct_with_fallback", effective: "direct_with_fallback", reason: null, read: "ok" },
    ],
    [
      "apify_only with a token",
      ok("apify_only"),
      true,
      { configured: "apify_only", effective: "apify_only", reason: null, read: "ok" },
    ],
    [
      "direct_only with a token",
      ok("direct_only"),
      true,
      { configured: "direct_only", effective: "direct_only", reason: null, read: "ok" },
    ],
    [
      "direct_with_fallback without a token",
      ok("direct_with_fallback"),
      false,
      { configured: "direct_with_fallback", effective: "direct_only", reason: "apify_unconfigured", read: "ok" },
    ],
    [
      "apify_only without a token",
      ok("apify_only"),
      false,
      { configured: "apify_only", effective: "direct_only", reason: "apify_unconfigured", read: "ok" },
    ],
    [
      "direct_only without a token",
      ok("direct_only"),
      false,
      { configured: "direct_only", effective: "direct_only", reason: null, read: "ok" },
    ],
    [
      "a failed query with a token",
      failed("error"),
      true,
      { configured: null, effective: "direct_only", reason: "mode_read_failed", read: "error" },
    ],
    [
      "a failed query without a token",
      failed("error"),
      false,
      { configured: null, effective: "direct_only", reason: "mode_read_failed", read: "error" },
    ],
    [
      "a missing row with a token",
      failed("missing_row"),
      true,
      { configured: null, effective: "direct_only", reason: "mode_read_failed", read: "missing_row" },
    ],
    [
      "a missing row without a token",
      failed("missing_row"),
      false,
      { configured: null, effective: "direct_only", reason: "mode_read_failed", read: "missing_row" },
    ],
    [
      "a value off the list with a token",
      failed("off_list"),
      true,
      { configured: null, effective: "direct_only", reason: "mode_read_failed", read: "off_list" },
    ],
    [
      "a value off the list without a token",
      failed("off_list"),
      false,
      { configured: null, effective: "direct_only", reason: "mode_read_failed", read: "off_list" },
    ],
  ])("%s", (_case, settings, apifyAvailable, expected) => {
    expect(resolveIngestionMode(settings, apifyAvailable)).toEqual(expected);
  });
});
