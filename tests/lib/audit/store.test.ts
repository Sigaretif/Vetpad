import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuditIndex, type OfferAudit, auditDataState, loadAuditIndex, loadOfferAudit } from "@/lib/audit/store";
import { createClient } from "@/lib/supabase";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase,
// @/lib/audit/store and @/lib/members run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return {
    SUPABASE_URL: SUPABASE_TEST_URL,
    SUPABASE_KEY: SUPABASE_TEST_KEY,
    ANTHROPIC_API_KEY: undefined,
    getSecret: () => undefined,
  };
});

// Expected outcomes are written by hand from the sources, never copied from what the functions
// return: the contracts of `loadOfferAudit` and `loadAuditIndex` in
// context/changes/grounded-listing-audit/plan.md (Phase 5: a failed read is its own state, never
// "not audited"; an attempt running longer than the threshold reads as interrupted; a row whose
// findings do not read is an error), the header of
// supabase/migrations/20261007073300_create_offer_audits.sql (the attempt and the result share a
// row; a failed re-run leaves the result alone; a null person column is a deleted account) and
// the 175 seconds that migration and `AUDIT_STALE_ATTEMPT_MS` both state.
//
// The two states that must never be confused are "the read failed" and "nobody audited this
// offer": the card would offer a paid audit of an offer that has one, and the board would say
// „Nie audytowano" about findings the team has already read. Every failure below stands beside
// the read that succeeds and finds nothing.

afterEach(restoreFetch);

const OFFER = "0b9f0c2e-7d1a-4c55-9a53-0000000000f1";
const OTHER_OFFER = "0b9f0c2e-7d1a-4c55-9a53-0000000000f2";

const VIEWER = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const ANNA = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000a1";
const BARTEK = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000b2";

const ANNA_EMAIL = "anna@example.test";
const BARTEK_EMAIL = "bartek@example.test";

/** The moment of the view. Every attempt below is dated against it. */
const NOW = new Date("2026-10-09T12:00:00.000Z");
/** 175 seconds, written out: the threshold the migration and `AUDIT_STALE_ATTEMPT_MS` share. */
const THRESHOLD_MS = 175_000;

function startedAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

/** "Nobody audited this offer, and nobody tried": a successful read that finds no row. */
const NEVER_AUDITED: OfferAudit = { state: "ok", attempt: { kind: "none" }, result: null };
const FAILED: OfferAudit = { state: "error" };

const FINDINGS = {
  version: 1,
  missing: [{ attribute: "heating", requirement: null, question: "Jakie jest ogrzewanie mieszkania?" }],
  conditions: [],
  costs: [{ label: "Prowizja biura", excerpt: "prowizję biura w wysokości 2% ceny", source: "description" }],
  red_flags: [],
};

/** The result columns of a row never audited: every one empty. */
const NO_RESULT = {
  findings: null,
  rejected_count: null,
  audited_at: null,
  audited_by: null,
  model: null,
  effort: null,
  had_limits: null,
  requirements_count: null,
};

/** The result columns of an audited row, as PostgREST answers them. */
const RESULT = {
  findings: FINDINGS,
  rejected_count: 2,
  audited_at: "2026-10-08T10:15:00+00:00",
  audited_by: ANNA,
  model: "claude-opus-5-5",
  effort: "medium",
  had_limits: true,
  requirements_count: 3,
};

/** The same result as `loadOfferAudit` hands it to the card, audited by Anna as another member sees her. */
const RESULT_VIEW = {
  findings: FINDINGS,
  rejectedCount: 2,
  auditedAt: "2026-10-08T10:15:00+00:00",
  auditedBy: { kind: "member", email: "anna@example.test" },
  model: "claude-opus-5-5",
  effort: "medium",
  hadLimits: true,
  requirementsCount: 3,
};

/** A row whose last attempt completed and is its result. */
const COMPLETED_ROW = {
  run_state: "completed",
  run_started_at: "2026-10-08T10:14:40+00:00",
  run_started_by: ANNA,
  run_failure: null,
  ...RESULT,
};

/** A first attempt in progress, started two minutes before the view: no result yet. */
const RUNNING_ROW = {
  run_state: "running",
  run_started_at: startedAgo(120_000),
  run_started_by: ANNA,
  run_failure: null,
  ...NO_RESULT,
};

/** The client the way a request builds it, with no session cookie. */
function client(): NonNullable<ReturnType<typeof createClient>> {
  const supabase = createClient(new Headers(), { set: vi.fn() });
  if (supabase === null) throw new Error("expected a configured Supabase client");
  return supabase;
}

/**
 * Answers the read of `public.offer_audits` with `audits` and the read of `public.members` with
 * `members`. Without `members`, a request to that table is unplanned and fails the test.
 */
function stubAudits(audits: () => Response, members?: () => Response) {
  return stubFetch((request) => {
    if (isTableRequest(request, "offer_audits", "GET")) return audits();
    if (isTableRequest(request, "members", "GET")) return members?.();
    return undefined;
  });
}

function rows(...list: unknown[]): () => Response {
  return () => jsonResponse(list, 200);
}

/** A read the database failed, the way PostgREST reports one. */
function failedRead(): Response {
  return jsonResponse({ code: "XX000", message: "internal error", details: null, hint: null }, 500);
}

function bothMembers(): Response {
  return jsonResponse(
    [
      { id: BARTEK, email: BARTEK_EMAIL },
      { id: ANNA, email: ANNA_EMAIL },
    ],
    200,
  );
}

function requestsTo(requests: RecordedRequest[], table: string): RecordedRequest[] {
  return requests.filter((request) => isTableRequest(request, table, "GET"));
}

/** The ids a `members` read filters by, from `id=in.(a,b,…)`, sorted. */
function idsAskedFor(request: RecordedRequest | undefined): string[] {
  if (request === undefined) throw new Error("expected a recorded request");
  const filter = new URL(request.url).searchParams.get("id") ?? "";
  const list = /^in\.\((.*)\)$/.exec(filter)?.[1];
  if (list === undefined) throw new Error(`expected an in.(…) filter on id, got "${filter}"`);
  return list.split(",").sort();
}

describe("loadOfferAudit: a failed read is its own state, never an offer nobody audited (#3)", () => {
  it("control: answers no attempt and no result for a read that succeeds and finds no row", async () => {
    const stub = stubAudits(rows());

    expect(await loadOfferAudit(client(), OFFER, VIEWER, NOW)).toEqual({
      state: "ok",
      attempt: { kind: "none" },
      result: null,
    });

    // Nobody to name, so `members` is not asked.
    expect(stub.requests).toHaveLength(1);
    expect(isTableRequest(stub.requests[0], "offer_audits", "GET")).toBe(true);
  });

  it("answers error without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const audit = await loadOfferAudit(null, OFFER, VIEWER, NOW);

    expect(audit).toEqual({ state: "error" });
    expect(audit).not.toEqual(NEVER_AUDITED);
    expect(stub.requests).toHaveLength(0);
  });

  it("answers error when the database fails the read (500), and does not ask for members", async () => {
    const stub = stubAudits(failedRead);

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toEqual({ state: "error" });
    expect(audit).not.toEqual(NEVER_AUDITED);
    expect(requestsTo(stub.requests, "offer_audits")).toHaveLength(1);
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  // A 200 that is not the offer's one row. None of these may read as "no row".
  it.each<[string, unknown]>([
    ["an object", {}],
    ["null", null],
    ["a list holding something that is not a row", [null]],
    ["two rows", [COMPLETED_ROW, COMPLETED_ROW]],
  ])("answers error for a 200 whose body is %s, and does not throw", async (_case, body) => {
    const stub = stubAudits(() => jsonResponse(body, 200));

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toEqual({ state: "error" });
    expect(audit).not.toEqual(NEVER_AUDITED);
    // The outcome came from the database's answer — the read did go out.
    expect(requestsTo(stub.requests, "offer_audits")).toHaveLength(1);
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  it("asks for the row of this offer, with the attempt and the result columns the card shows", async () => {
    const stub = stubAudits(rows());

    await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    const params = new URL(stub.requests[0].url).searchParams;
    expect(params.get("offer_id")).toBe("eq.0b9f0c2e-7d1a-4c55-9a53-0000000000f1");
    expect(params.get("select")).toBe(
      "run_state,run_started_at,run_started_by,run_failure,findings,rejected_count,audited_at,audited_by,model,effort,had_limits,requirements_count",
    );
  });
});

describe("loadOfferAudit: a row that does not read is an error, never an offer nobody audited (#3)", () => {
  it.each<[string, Record<string, unknown>]>([
    ["an unknown run_state", { ...COMPLETED_ROW, run_state: "paused" }],
    ["no run_state", { ...COMPLETED_ROW, run_state: null }],
    ["a start that is not a date", { ...RUNNING_ROW, run_started_at: "wczoraj" }],
    ["no start", { ...RUNNING_ROW, run_started_at: null }],
    ["a starter that is not an id", { ...RUNNING_ROW, run_started_by: 7 }],
  ])("answers error for a row with %s", async (_case, row) => {
    const stub = stubAudits(rows(row));

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toEqual({ state: "error" });
    expect(audit).not.toEqual(NEVER_AUDITED);
    // Nobody is named for a row that does not read.
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });
});

// The row was read and its attempt reads; only the result does not. That is not a failed read: the
// card must be able to offer the run that replaces the result, since nothing else removes it.
describe("loadOfferAudit: a result that does not read is broken, never an error and never no result (#3)", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["an auditor that is not an id", { ...COMPLETED_ROW, audited_by: 7 }, "none"],
    ["findings of another version", { ...COMPLETED_ROW, findings: { ...FINDINGS, version: 2 } }, "none"],
    ["findings without one of the four lists", { ...COMPLETED_ROW, findings: { version: 1, missing: [] } }, "none"],
    [
      "a finding without its question",
      { ...COMPLETED_ROW, findings: { ...FINDINGS, missing: [{ attribute: "heating", requirement: null }] } },
      "none",
    ],
    [
      "a finding whose excerpt is blank",
      {
        ...COMPLETED_ROW,
        findings: { ...FINDINGS, costs: [{ label: "Prowizja", excerpt: " ", source: "description" }] },
      },
      "none",
    ],
    ["findings that are a text", { ...COMPLETED_ROW, findings: "[]" }, "none"],
    // Beside a later attempt the row is not `completed`, so only the findings say the result is
    // broken: read as "no result", it would show a failed or running audit of an offer never audited.
    [
      "findings of another version beside a failed re-run",
      { ...COMPLETED_ROW, run_state: "failed", run_failure: "provider_timeout", findings: { ...FINDINGS, version: 2 } },
      "failed",
    ],
    ["findings that are a text beside a running re-run", { ...RUNNING_ROW, ...RESULT, findings: "[]" }, "running"],
    ["a result without its findings", { ...COMPLETED_ROW, findings: null }, "none"],
    ["findings without the rest of the result", { ...COMPLETED_ROW, ...NO_RESULT, findings: FINDINGS }, "none"],
    ["an auditor beside no result", { ...RUNNING_ROW, audited_by: ANNA }, "running"],
    ["a completed attempt with no result", { ...COMPLETED_ROW, ...NO_RESULT }, "none"],
    ["a negative count of rejected findings", { ...COMPLETED_ROW, rejected_count: -1 }, "none"],
    ["a fractional count of rejected findings", { ...COMPLETED_ROW, rejected_count: 1.5 }, "none"],
    ["a count of rejected findings sent as text", { ...COMPLETED_ROW, rejected_count: "2" }, "none"],
    ["a negative count of requirements", { ...COMPLETED_ROW, requirements_count: -1 }, "none"],
    ["an audit date that is not a date", { ...COMPLETED_ROW, audited_at: "niedawno" }, "none"],
    ["limits recorded as a text", { ...COMPLETED_ROW, had_limits: "true" }, "none"],
    ["a blank model", { ...COMPLETED_ROW, model: " " }, "none"],
    ["no effort", { ...COMPLETED_ROW, effort: null }, "none"],
  ])("answers broken for a row with %s", async (_case, row, attempt) => {
    stubAudits(rows(row), bothMembers);

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toMatchObject({ state: "broken", attempt: { kind: attempt } });
    expect(audit).not.toHaveProperty("result");
    expect(audit).not.toEqual(NEVER_AUDITED);
    expect(audit).not.toEqual(FAILED);
  });

  it("names nobody as the auditor of a result that does not read", async () => {
    const stub = stubAudits(rows({ ...COMPLETED_ROW, findings: { ...FINDINGS, version: 2 } }));

    expect(await loadOfferAudit(client(), OFFER, VIEWER, NOW)).toEqual({ state: "broken", attempt: { kind: "none" } });
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  it("control: reads a failed re-run beside a result whose findings do read", async () => {
    stubAudits(rows({ ...COMPLETED_ROW, run_state: "failed", run_failure: "provider_timeout" }), bothMembers);

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toMatchObject({ state: "ok", attempt: { kind: "failed" }, result: RESULT_VIEW });
  });

  it("control: reads the same row once nothing in it is broken", async () => {
    stubAudits(rows(COMPLETED_ROW), bothMembers);

    expect(await loadOfferAudit(client(), OFFER, VIEWER, NOW)).toEqual({
      state: "ok",
      attempt: { kind: "none" },
      result: RESULT_VIEW,
    });
  });
});

describe("loadOfferAudit: an attempt running for 175 seconds or longer reads as interrupted (#3)", () => {
  it("reads an attempt one millisecond younger than the threshold as running, with its start and starter", async () => {
    const startedAt = startedAgo(THRESHOLD_MS - 1);
    stubAudits(rows({ ...RUNNING_ROW, run_started_at: startedAt }), bothMembers);

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toEqual({
      state: "ok",
      attempt: { kind: "running", startedAt, startedBy: { kind: "member", email: "anna@example.test" } },
      result: null,
    });
  });

  it.each<[string, number]>([
    ["exactly at the threshold", THRESHOLD_MS],
    ["one millisecond past the threshold", THRESHOLD_MS + 1],
    ["an hour old", 3_600_000],
  ])("reads an attempt %s as interrupted, and names nobody", async (_case, age) => {
    const stub = stubAudits(rows({ ...RUNNING_ROW, run_started_at: startedAgo(age) }));

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toEqual({ state: "ok", attempt: { kind: "interrupted" }, result: null });
    // An interrupted attempt is shown without its starter, so `members` is not asked.
    expect(stub.requests).toHaveLength(1);
  });

  it("takes the moment from its argument: the same row is running earlier and interrupted later", async () => {
    const row = { ...RUNNING_ROW, run_started_at: "2026-10-09T11:58:00.000Z" };
    stubAudits(rows(row), bothMembers);

    const early = await loadOfferAudit(client(), OFFER, VIEWER, new Date("2026-10-09T12:00:54.999Z"));
    const late = await loadOfferAudit(client(), OFFER, VIEWER, new Date("2026-10-09T12:00:55.000Z"));

    expect(early).toMatchObject({ state: "ok", attempt: { kind: "running" } });
    expect(late).toMatchObject({ state: "ok", attempt: { kind: "interrupted" } });
  });

  it("reads an attempt dated after the moment of the view as running", async () => {
    // The database's clock and the Worker's are two clocks: a start a second ahead is not an old one.
    stubAudits(rows({ ...RUNNING_ROW, run_started_at: startedAgo(-1_000) }), bothMembers);

    expect(await loadOfferAudit(client(), OFFER, VIEWER, NOW)).toMatchObject({
      state: "ok",
      attempt: { kind: "running" },
    });
  });
});

describe("loadOfferAudit: the attempt and the result are read independently (#3)", () => {
  const FAILED_ATTEMPT = {
    run_state: "failed",
    run_started_at: "2026-10-09T11:00:00+00:00",
    run_started_by: BARTEK,
    run_failure: "provider_timeout",
  };

  it("names why an attempt failed, in the sentence the route gives that reason", async () => {
    const stub = stubAudits(rows({ ...FAILED_ATTEMPT, ...NO_RESULT }));

    expect(await loadOfferAudit(client(), OFFER, VIEWER, NOW)).toEqual({
      state: "ok",
      attempt: {
        kind: "failed",
        reason: "provider_timeout",
        message: "Model nie odpowiedział w ciągu 165 sekund. Audyt został przerwany — spróbuj ponownie.",
      },
      result: null,
    });
    // A failed attempt is shown without its starter.
    expect(stub.requests).toHaveLength(1);
  });

  it("invents no cause for a failure whose stored reason it does not know", async () => {
    stubAudits(rows({ ...FAILED_ATTEMPT, ...NO_RESULT, run_failure: "smoke" }));

    expect(await loadOfferAudit(client(), OFFER, VIEWER, NOW)).toEqual({
      state: "ok",
      attempt: {
        kind: "failed",
        reason: null,
        message: "Ostatnia próba audytu nie powiodła się, a aplikacja nie rozpoznaje zapisanej przyczyny.",
      },
      result: null,
    });
  });

  it("keeps the earlier result beside a re-run that failed", async () => {
    stubAudits(rows({ ...FAILED_ATTEMPT, ...RESULT }), bothMembers);

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toMatchObject({ state: "ok", attempt: { kind: "failed", reason: "provider_timeout" } });
    expect(audit).toMatchObject({ result: RESULT_VIEW });
  });

  it("keeps the earlier result beside a re-run that was interrupted", async () => {
    stubAudits(rows({ ...RUNNING_ROW, run_started_at: startedAgo(THRESHOLD_MS), ...RESULT }), bothMembers);

    expect(await loadOfferAudit(client(), OFFER, VIEWER, NOW)).toEqual({
      state: "ok",
      attempt: { kind: "interrupted" },
      result: RESULT_VIEW,
    });
  });

  it("reads a model the lists do not hold as stored, rather than hiding the findings", async () => {
    stubAudits(rows({ ...COMPLETED_ROW, model: "claude-opus-4-1", effort: "max" }), bothMembers);

    expect(await loadOfferAudit(client(), OFFER, VIEWER, NOW)).toMatchObject({
      state: "ok",
      result: { model: "claude-opus-4-1", effort: "max", findings: FINDINGS },
    });
  });

  it("reads an audit that found nothing as a result with four empty lists, never as no result", async () => {
    const nothingFound = { version: 1, missing: [], conditions: [], costs: [], red_flags: [] };
    stubAudits(rows({ ...COMPLETED_ROW, findings: nothingFound, rejected_count: 0 }), bothMembers);

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toMatchObject({ state: "ok", result: { findings: nothingFound, rejectedCount: 0 } });
    expect(audit).not.toEqual(NEVER_AUDITED);
  });
});

describe("loadOfferAudit: the people of the row are named with one read (#3)", () => {
  it("names the starter of a running attempt and the auditor of the result it stands beside, each as their own", async () => {
    const stub = stubAudits(rows({ ...RUNNING_ROW, run_started_by: BARTEK, ...RESULT }), bothMembers);

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toMatchObject({
      state: "ok",
      attempt: { kind: "running", startedBy: { kind: "member", email: "bartek@example.test" } },
      result: { auditedBy: { kind: "member", email: "anna@example.test" } },
    });
    const members = requestsTo(stub.requests, "members");
    expect(members).toHaveLength(1);
    expect(idsAskedFor(members[0])).toEqual([ANNA, BARTEK].sort());
    expect(stub.requests).toHaveLength(2);
  });

  it("asks only for the auditor when the attempt names nobody", async () => {
    const row = { ...COMPLETED_ROW, run_state: "failed", run_failure: "busy", run_started_by: BARTEK };
    const stub = stubAudits(rows(row), bothMembers);

    await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(idsAskedFor(requestsTo(stub.requests, "members")[0])).toEqual([ANNA]);
  });

  it("reads the viewer as self and asks for nobody", async () => {
    const stub = stubAudits(rows({ ...RUNNING_ROW, run_started_by: VIEWER, ...RESULT, audited_by: VIEWER }));

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toMatchObject({
      attempt: { kind: "running", startedBy: { kind: "self" } },
      result: { auditedBy: { kind: "self" } },
    });
    expect(stub.requests).toHaveLength(1);
  });

  it("reads a null person column as a deleted account, and asks for nobody", async () => {
    const stub = stubAudits(rows({ ...RUNNING_ROW, run_started_by: null, ...RESULT, audited_by: null }));

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toMatchObject({
      state: "ok",
      attempt: { kind: "running", startedBy: { kind: "deleted" } },
      result: { auditedBy: { kind: "deleted" }, findings: FINDINGS },
    });
    expect(stub.requests).toHaveLength(1);
  });

  it("keeps the audit readable when the names cannot be read: unknown, never a deleted account", async () => {
    const stub = stubAudits(rows({ ...RUNNING_ROW, run_started_by: BARTEK, ...RESULT }), failedRead);

    const audit = await loadOfferAudit(client(), OFFER, VIEWER, NOW);

    expect(audit).toMatchObject({
      state: "ok",
      attempt: { kind: "running", startedBy: { kind: "unknown" } },
      result: { auditedBy: { kind: "unknown" }, findings: FINDINGS },
    });
    expect(audit).not.toEqual(FAILED);
    expect(requestsTo(stub.requests, "members")).toHaveLength(1);
  });
});

describe("auditDataState: one word for the card's data-audit-state (#3)", () => {
  const result = RESULT_VIEW as Extract<OfferAudit, { state: "ok" }>["result"];
  const running = { kind: "running", startedAt: "2026-10-09T11:58:00.000Z", startedBy: { kind: "self" } } as const;
  const failed = { kind: "failed", reason: "busy", message: "…" } as const;

  it.each<[string, OfferAudit, string]>([
    ["a failed read", { state: "error" }, "error"],
    ["no attempt and no result", { state: "ok", attempt: { kind: "none" }, result: null }, "none"],
    ["a result and no attempt after it", { state: "ok", attempt: { kind: "none" }, result }, "done"],
    ["a first attempt in progress", { state: "ok", attempt: running, result: null }, "running"],
    ["a re-run in progress beside a result", { state: "ok", attempt: running, result }, "running"],
    ["a failed attempt with no result", { state: "ok", attempt: failed, result: null }, "failed"],
    ["a failed re-run beside a kept result", { state: "ok", attempt: failed, result }, "failed"],
    [
      "an interrupted attempt with no result",
      { state: "ok", attempt: { kind: "interrupted" }, result: null },
      "failed",
    ],
    ["an interrupted re-run beside a kept result", { state: "ok", attempt: { kind: "interrupted" }, result }, "failed"],
    ["a result that does not read and no attempt after it", { state: "broken", attempt: { kind: "none" } }, "broken"],
    ["a re-run in progress beside a result that does not read", { state: "broken", attempt: running }, "running"],
    ["a failed re-run beside a result that does not read", { state: "broken", attempt: failed }, "failed"],
  ])("says %s is %j", (_case, audit, expected) => {
    expect(auditDataState(audit)).toBe(expected);
  });
});

describe("loadAuditIndex: a failed read is its own state, never a board where nothing is audited (#3)", () => {
  /** "No offer has a stored result": a successful read that finds none. */
  const NOTHING_AUDITED: AuditIndex = { ok: true, audited: new Set() };

  it("control: answers an empty set for a read that succeeds and finds no audited offer", async () => {
    const stub = stubAudits(rows());

    expect(await loadAuditIndex(client())).toEqual({ ok: true, audited: new Set() });
    expect(stub.requests).toHaveLength(1);
  });

  it("answers the offers that have a stored result", async () => {
    stubAudits(rows({ offer_id: OFFER }, { offer_id: OTHER_OFFER }));

    const index = await loadAuditIndex(client());

    expect(index).toEqual({
      ok: true,
      audited: new Set(["0b9f0c2e-7d1a-4c55-9a53-0000000000f1", "0b9f0c2e-7d1a-4c55-9a53-0000000000f2"]),
    });
    expect(index).not.toEqual(NOTHING_AUDITED);
  });

  it("asks only for rows that hold findings, so an attempt alone audits nothing", async () => {
    const stub = stubAudits(rows());

    await loadAuditIndex(client());

    const params = new URL(stub.requests[0].url).searchParams;
    expect(params.get("select")).toBe("offer_id");
    expect(params.get("findings")).toBe("not.is.null");
  });

  it("answers not ok without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const index = await loadAuditIndex(null);

    expect(index).toEqual({ ok: false });
    expect(index).not.toEqual(NOTHING_AUDITED);
    expect(stub.requests).toHaveLength(0);
  });

  it("answers not ok when the database fails the read (500)", async () => {
    const stub = stubAudits(failedRead);

    const index = await loadAuditIndex(client());

    expect(index).toEqual({ ok: false });
    expect(index).not.toEqual(NOTHING_AUDITED);
    expect(stub.requests).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ["an object", {}],
    ["null", null],
    ["a list holding something that is not a row", [null]],
    ["a row without an offer id", [{ offer_id: OFFER }, {}]],
    ["a row whose offer id is not a text", [{ offer_id: 5 }]],
  ])("answers not ok for a 200 whose body is %s, and does not throw", async (_case, body) => {
    const stub = stubAudits(() => jsonResponse(body, 200));

    const index = await loadAuditIndex(client());

    expect(index).toEqual({ ok: false });
    expect(index).not.toEqual(NOTHING_AUDITED);
    expect(stub.requests).toHaveLength(1);
  });
});
