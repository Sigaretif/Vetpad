import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_EFFORTS,
  AUDIT_EFFORT_LABELS,
  AUDIT_MODELS,
  AUDIT_MODEL_LABELS,
  type AuditSettingsResult,
  DEFAULT_AUDIT_SETTINGS,
  loadAuditSettings,
  parseAuditSettingsForm,
} from "@/lib/audit/settings";
import { createClient } from "@/lib/supabase";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase,
// @/lib/audit/settings and @/lib/members run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from the sources, never copied from what the functions
// return: the contract of the settings module in context/changes/grounded-listing-audit/plan.md
// (Phase 2: no client, a failed query, a missing row or a value outside the list is `error`,
// never the default), the closed lists and the header of
// supabase/migrations/20261007073258_create_audit_settings.sql (what a null `updated_by` means
// with and without a date), and CLAUDE.md, Product invariants (the default model is
// `claude-opus-5-5`; neither the model nor the effort is hard-coded at the call site).
//
// The two states that must never be confused are "the read failed" and "the team runs on the
// defaults": the second would send an audit to a model nobody chose, and a form prefilled from
// it would overwrite the team's choice. Every failure below stands beside the read that succeeds.

afterEach(restoreFetch);

const VIEWER = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const ANNA = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000a1";
const ANNA_EMAIL = "anna@example.test";

const CHANGED_AT = "2026-10-06T18:30:00+00:00";

/** The row as the migration inserts it: the defaults, never changed, so no date and no signature. */
const NEVER_CHANGED_ROW = { model: "claude-opus-5-5", effort: "medium", updated_at: null, updated_by: null };
/** A choice that is not the default in either column, signed by another member. */
const CHOSEN_ROW = { model: "claude-sonnet-5-5", effort: "high", updated_at: CHANGED_AT, updated_by: ANNA };

/** "The team runs on the defaults": a successful read, and what a failed one must never equal. */
const DEFAULTS: AuditSettingsResult = {
  state: "ok",
  model: "claude-opus-5-5",
  effort: "medium",
  changedBy: null,
  changedAt: null,
};

/** The client the way a request builds it, with no session cookie. */
function client(): NonNullable<ReturnType<typeof createClient>> {
  const supabase = createClient(new Headers(), { set: vi.fn() });
  if (supabase === null) throw new Error("expected a configured Supabase client");
  return supabase;
}

interface Answers {
  settings: () => Response;
  members?: () => Response;
}

/**
 * Answers each table's read on its own: `audit_settings` and `members`. A table without an answer
 * is unplanned, and a request to it fails the test.
 */
function stubSettings(answers: Answers) {
  return stubFetch((request) => {
    if (isTableRequest(request, "audit_settings", "GET")) return answers.settings();
    if (isTableRequest(request, "members", "GET")) return answers.members?.();
    return undefined;
  });
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

describe("the closed lists and the defaults (FR-010)", () => {
  // Written out by hand: the two models and the three efforts the table's checks admit.
  it("offers exactly the two models and the three efforts the table admits", () => {
    expect([...AUDIT_MODELS]).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect([...AUDIT_EFFORTS]).toEqual(["low", "medium", "high"]);
  });

  it("defaults to claude-opus-5-5 with medium effort", () => {
    expect(DEFAULT_AUDIT_SETTINGS).toEqual({ model: "claude-opus-5-5", effort: "medium" });
  });

  it("names every option, and no two options of a list alike", () => {
    const models = AUDIT_MODELS.map((model) => AUDIT_MODEL_LABELS[model].name);
    const efforts = AUDIT_EFFORTS.map((effort) => AUDIT_EFFORT_LABELS[effort].name);

    for (const name of [...models, ...efforts]) expect(name.trim()).not.toBe("");
    expect(new Set(models).size).toBe(2);
    expect(new Set(efforts).size).toBe(3);
  });
});

describe("parseAuditSettingsForm: only a value on the list is saved (FR-010)", () => {
  // Every pair the form can hold, written out by hand.
  it.each([
    ["claude-opus-5-5", "low"],
    ["claude-opus-5-5", "medium"],
    ["claude-opus-5-5", "high"],
    ["claude-sonnet-5-5", "low"],
    ["claude-sonnet-5-5", "medium"],
    ["claude-sonnet-5-5", "high"],
  ])("accepts %s with %s, exactly as sent", (model, effort) => {
    expect(parseAuditSettingsForm({ model, effort })).toEqual({ ok: true, settings: { model, effort } });
  });

  // A model the provider offers but the team's list does not, a name that only resembles one on
  // the list, and nothing at all. Each stands beside an effort the list holds.
  it.each([
    ["a model off the list", "claude-haiku-4-5"],
    ["the older Opus", "claude-opus-5"],
    ["a listed model in capitals", "CLAUDE-OPUS-5-5"],
    ["a listed model with a space after it", "claude-opus-5-5 "],
    ["the model's label instead of its id", "Claude Opus 5.5"],
    ["an empty model", ""],
  ])("refuses %s, naming the model", (_case, model) => {
    const parsed = parseAuditSettingsForm({ model, effort: "medium" });

    expect(parsed).toMatchObject({ ok: false, reason: "unknown_model" });
    expect(parsed.ok ? null : parsed.error).toContain("model");
    expect(parsed.ok ? null : parsed.error).not.toContain("rozumowania");
  });

  // `xhigh` and `max` are efforts the provider takes and the team's list leaves out (plan.md,
  // "What We're NOT Doing").
  it.each([
    ["xhigh", "xhigh"],
    ["max", "max"],
    ["a listed effort in capitals", "MEDIUM"],
    ["a listed effort with a space before it", " medium"],
    ["the effort's label instead of its id", "Średni"],
    ["an empty effort", ""],
  ])("refuses %s, naming the effort", (_case, effort) => {
    const parsed = parseAuditSettingsForm({ model: "claude-sonnet-5-5", effort });

    expect(parsed).toMatchObject({ ok: false, reason: "unknown_effort" });
    expect(parsed.ok ? null : parsed.error).toContain("rozumowania");
    expect(parsed.ok ? null : parsed.error).not.toContain("model");
  });

  it("tells the two reasons apart by their messages", () => {
    const model = parseAuditSettingsForm({ model: "", effort: "medium" });
    const effort = parseAuditSettingsForm({ model: "claude-opus-5-5", effort: "" });

    expect(model.ok ? null : model.error).not.toBe(effort.ok ? null : effort.error);
  });
});

describe("loadAuditSettings: a failed read is its own state, never the defaults", () => {
  it("control: answers the defaults, unsigned, for the row the migration inserts", async () => {
    const stub = stubSettings({ settings: rows(NEVER_CHANGED_ROW) });

    expect(await loadAuditSettings(client(), VIEWER)).toEqual({
      state: "ok",
      model: "claude-opus-5-5",
      effort: "medium",
      changedBy: null,
      changedAt: null,
    });

    // Nobody to name, so `members` is not asked: the singleton row, and nothing else.
    expect(stub.requests).toHaveLength(1);
    expect(requestsTo(stub.requests, "audit_settings")).toHaveLength(1);
    expect(new URL(stub.requests[0].url).searchParams.get("id")).toBe("eq.true");
  });

  it("control: answers the team's choice when it is not the default", async () => {
    stubSettings({ settings: rows(CHOSEN_ROW), members: rows({ email: ANNA_EMAIL }) });

    expect(await loadAuditSettings(client(), VIEWER)).toEqual({
      state: "ok",
      model: "claude-sonnet-5-5",
      effort: "high",
      changedBy: { kind: "member", email: "anna@example.test" },
      changedAt: "2026-10-06T18:30:00+00:00",
    });
  });

  it("answers error without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const settings = await loadAuditSettings(null, VIEWER);

    expect(settings).toEqual({ state: "error" });
    expect(settings).not.toEqual(DEFAULTS);
    expect(stub.requests).toHaveLength(0);
  });

  it.each<[string, () => Response]>([
    ["a failed read (500)", failedRead],
    ["a missing singleton row (200 [])", rows()],
    ["two rows (PGRST116)", rows(NEVER_CHANGED_ROW, NEVER_CHANGED_ROW)],
    // A 200 that is not the singleton row.
    ["a body that is an empty object", () => jsonResponse({}, 200)],
    ["a row without the settings columns", rows({})],
    ["a row that is null", rows(null)],
    ["a row that is text", rows("claude-opus-5-5")],
  ])("answers error for %s, and does not throw", async (_case, answer) => {
    const stub = stubSettings({ settings: answer });

    const settings = await loadAuditSettings(client(), VIEWER);

    expect(settings).toEqual({ state: "error" });
    expect(settings).not.toEqual(DEFAULTS);
    // The outcome came from the database's answer — the read did go out, once — and nobody was named.
    expect(requestsTo(stub.requests, "audit_settings")).toHaveLength(1);
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });
});

describe("loadAuditSettings: a value outside the list is a failed read, never the default", () => {
  // One column at a time; the other keeps a listed value, so the outcome is that column's alone.
  // The table's checks admit none of these — only a stub can answer them.
  const OUTSIDE: [string, string, unknown][] = [
    ["model", "a model off the list", "claude-haiku-4-5"],
    ["model", "the older Opus", "claude-opus-5"],
    ["model", "a listed model in capitals", "CLAUDE-OPUS-5-5"],
    ["model", "an empty text", ""],
    ["model", "null", null],
    ["model", "a number", 5],
    ["model", "a list holding a listed model", ["claude-opus-5-5"]],
    ["effort", "xhigh", "xhigh"],
    ["effort", "max", "max"],
    ["effort", "a listed effort in capitals", "MEDIUM"],
    ["effort", "an empty text", ""],
    ["effort", "null", null],
    ["effort", "a boolean", true],
    ["effort", "a list holding a listed effort", ["medium"]],
  ];

  it.each(OUTSIDE)("answers error when %s holds %s", async (column, _what, value) => {
    const stub = stubSettings({ settings: rows({ ...NEVER_CHANGED_ROW, [column]: value }) });

    const settings = await loadAuditSettings(client(), VIEWER);

    expect(settings).toEqual({ state: "error" });
    expect(settings).not.toEqual(DEFAULTS);
    expect(requestsTo(stub.requests, "audit_settings")).toHaveLength(1);
  });

  it.each([
    ["claude-opus-5-5", "low"],
    ["claude-opus-5-5", "high"],
    ["claude-sonnet-5-5", "medium"],
  ])("control: reads %s with %s as stored", async (model, effort) => {
    stubSettings({ settings: rows({ ...NEVER_CHANGED_ROW, model, effort }) });

    expect(await loadAuditSettings(client(), VIEWER)).toEqual({
      state: "ok",
      model,
      effort,
      changedBy: null,
      changedAt: null,
    });
  });
});

describe("loadAuditSettings: who last changed the settings", () => {
  it("answers no signature and no date for settings that were never changed", async () => {
    const stub = stubSettings({ settings: rows(NEVER_CHANGED_ROW) });

    expect(await loadAuditSettings(client(), VIEWER)).toMatchObject({
      state: "ok",
      changedBy: null,
      changedAt: null,
    });
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  // A null `updated_by` with a date is "the account that last changed the settings was deleted",
  // and nothing else — a fact from the row, which needs no read of `members`.
  it("answers a deleted account for a date without a signature", async () => {
    const stub = stubSettings({ settings: rows({ ...CHOSEN_ROW, updated_by: null }) });

    expect(await loadAuditSettings(client(), VIEWER)).toMatchObject({
      state: "ok",
      changedBy: { kind: "deleted" },
      changedAt: "2026-10-06T18:30:00+00:00",
    });
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  it("answers self when the viewer changed them, with no read of members", async () => {
    const stub = stubSettings({ settings: rows({ ...CHOSEN_ROW, updated_by: VIEWER }) });

    expect(await loadAuditSettings(client(), VIEWER)).toMatchObject({
      state: "ok",
      changedBy: { kind: "self" },
      changedAt: "2026-10-06T18:30:00+00:00",
    });
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  it("names another member by the email address, from one read of members", async () => {
    const stub = stubSettings({ settings: rows(CHOSEN_ROW), members: rows({ email: ANNA_EMAIL }) });

    expect(await loadAuditSettings(client(), VIEWER)).toMatchObject({
      state: "ok",
      changedBy: { kind: "member", email: "anna@example.test" },
      changedAt: "2026-10-06T18:30:00+00:00",
    });

    const members = requestsTo(stub.requests, "members");
    expect(members).toHaveLength(1);
    expect(new URL(members[0].url).searchParams.get("id")).toBe(`eq.${ANNA}`);
    expect(stub.requests).toHaveLength(2);
  });

  // The settings were read; only the name was not. `unknown` names nobody and is never shown as a
  // deleted account — and the read is not downgraded to a failed one.
  it.each<[string, () => Response]>([
    ["the read of members fails (500)", failedRead],
    ["members holds no row for that account (200 [])", rows()],
    ["the member's email is null", rows({ email: null })],
  ])("keeps the state ok and the signature unknown — never deleted — when %s", async (_case, members) => {
    const stub = stubSettings({ settings: rows(CHOSEN_ROW), members });

    const settings = await loadAuditSettings(client(), VIEWER);

    expect(settings).toEqual({
      state: "ok",
      model: "claude-sonnet-5-5",
      effort: "high",
      changedBy: { kind: "unknown" },
      changedAt: "2026-10-06T18:30:00+00:00",
    });
    expect(requestsTo(stub.requests, "members")).toHaveLength(1);
  });
});
