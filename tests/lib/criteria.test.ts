import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuditCriteriaResult,
  type CriteriaResult,
  type TeamLimitsResult,
  loadAuditCriteria,
  loadCriteria,
  loadTeamLimits,
} from "@/lib/criteria";
import { createClient } from "@/lib/supabase";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase,
// @/lib/criteria and @/lib/members run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from the sources, never copied from what the functions
// return: the contracts of `loadCriteria` and `loadTeamLimits` and „Desired End State” in
// context/archive/2026-09-27-team-search-criteria/plan.md (an unset limit reads "no limit", never
// 0; a failed read renders no forms; a failed read of the limits on the board is never "no
// marks"), the header of supabase/migrations/20260927144141_create_team_criteria.sql (what a null
// `updated_by` means with and without a date), the `resolveAuthors` contract in
// context/archive/2026-09-26-member-notes/plan.md, and CLAUDE.md (## Structure, the
// `team_criteria` bullet: a failed read is its own state, never "no limits", and so is a value
// that does not read as a limit). For `loadAuditCriteria`: its contract in
// context/changes/grounded-listing-audit/plan.md (Phase 3: the limits, the requirements' texts
// alone in a fixed order, and the revision read before and after them — one difference repeats
// the read, a second is an error) and the `criteria_revision` section of the same migration.
//
// The two states that must never be confused are "the read failed" and "the team has set no
// limits": on the board the second would hide every breach, and on /criteria a form prefilled
// from it would overwrite the team's row with blanks. Every failure below stands beside the read
// that succeeds and finds no limits.

afterEach(restoreFetch);

const VIEWER = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const ANNA = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000a1";
const BARTEK = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000b2";
/** A member who has changed the limits and written no requirements. */
const CELINA = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000c3";

const ANNA_EMAIL = "anna@example.test";
const BARTEK_EMAIL = "bartek@example.test";
const CELINA_EMAIL = "celina@example.test";

const CHANGED_AT = "2026-09-28T18:30:00+00:00";

/** "The team has set no limits, and nobody has written requirements": a successful read. */
const NOTHING_SET: CriteriaResult = {
  state: "ok",
  limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
  limitsChangedBy: null,
  limitsChangedAt: null,
  own: null,
  others: [],
};
const FAILED: CriteriaResult = { state: "error" };

/** "No limits" as the board reads it: a successful read. */
const NO_LIMITS: TeamLimitsResult = {
  ok: true,
  limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
};

// The singleton row as PostgREST answers it. The limit columns are what `loadTeamLimits` asks
// for; `loadCriteria` asks for the signature beside them.
const UNSET_LIMITS = { city: null, price_min: null, price_max: null, area_min: null };
const SET_LIMITS = { city: "Warszawa", price_min: 800000, price_max: 900000, area_min: 45.5 };
/** The same limits with every number sent as text, as PostgREST may send a `numeric`. */
const SET_LIMITS_AS_TEXT = { city: "Warszawa", price_min: "800000", price_max: "900000", area_min: "45.5" };
/** Never changed by anybody: no date, no signature (the migration's "never set"). */
const NEVER_SIGNED = { updated_at: null, updated_by: null };

// Requirements rows as PostgREST answers them, in the order of the answer.
const ANNA_ROW = {
  author_id: ANNA,
  body: "Balkon albo loggia",
  created_at: "2026-09-20T08:00:00+00:00",
  updated_at: "2026-09-29T10:00:00+00:00",
};
const VIEWER_ROW = {
  author_id: VIEWER,
  body: "Najwyżej trzecie piętro bez windy",
  created_at: "2026-09-21T09:00:00+00:00",
  updated_at: "2026-09-27T09:15:00+00:00",
};
const BARTEK_ROW = {
  author_id: BARTEK,
  body: "Miejsce postojowe",
  created_at: "2026-09-22T07:00:00+00:00",
  updated_at: "2026-09-26T07:00:00+00:00",
};

/** The client the way a request builds it, with no session cookie. */
function client(): NonNullable<ReturnType<typeof createClient>> {
  const supabase = createClient(new Headers(), { set: vi.fn() });
  if (supabase === null) throw new Error("expected a configured Supabase client");
  return supabase;
}

interface Answers {
  criteria: () => Response;
  requirements?: () => Response;
  members?: () => Response;
}

/**
 * Answers each table's read on its own: `team_criteria`, `member_requirements` and `members`.
 * `loadCriteria` sends the first two in parallel, so the handler tells them apart by table. A
 * table without an answer is unplanned, and a request to it fails the test.
 */
function stubCriteria(answers: Answers) {
  return stubFetch((request) => {
    if (isTableRequest(request, "team_criteria", "GET")) return answers.criteria();
    if (isTableRequest(request, "member_requirements", "GET")) return answers.requirements?.();
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

const noRows = rows();

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

/**
 * A value the row could hold that does not read as a limit, one column at a time; the other
 * three columns keep readable limits, so the outcome is that column's alone. The table's checks
 * admit none of these — only a stub can answer them.
 */
const UNREADABLE: [string, string, unknown][] = [
  ["price_min", "zero", 0],
  ["price_min", "a negative number", -1],
  ["price_min", "non-numeric text", "abc"],
  ["price_min", "an empty text", ""],
  ["price_min", "a boolean", true],
  ["price_max", "zero", 0],
  ["price_max", "a negative number", -1],
  ["price_max", "non-numeric text", "abc"],
  ["price_max", "an empty text", ""],
  ["price_max", "a boolean", true],
  ["area_min", "zero", 0],
  ["area_min", "a negative number", -1],
  ["area_min", "non-numeric text", "abc"],
  ["area_min", "an empty text", ""],
  ["area_min", "a boolean", true],
  ["city", "an empty text", ""],
  ["city", "spaces only", "   "],
  ["city", "a number", 123],
  ["city", "a boolean", true],
];

describe("loadCriteria: a failed read is its own state, never a team without limits (#1)", () => {
  it("control: answers four unset limits, no signature and no requirements for a read that finds none", async () => {
    const stub = stubCriteria({ criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }), requirements: noRows });

    // An unset limit is null — never 0, never "".
    expect(await loadCriteria(client(), VIEWER)).toEqual({
      state: "ok",
      limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
      limitsChangedBy: null,
      limitsChangedAt: null,
      own: null,
      others: [],
    });

    // Nobody to name, so `members` is not asked.
    expect(requestsTo(stub.requests, "team_criteria")).toHaveLength(1);
    expect(requestsTo(stub.requests, "member_requirements")).toHaveLength(1);
    expect(stub.requests).toHaveLength(2);
  });

  it("answers error without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const criteria = await loadCriteria(null, VIEWER);

    expect(criteria).toEqual({ state: "error" });
    expect(criteria).not.toEqual(NOTHING_SET);
    expect(stub.requests).toHaveLength(0);
  });

  it.each<[string, Answers]>([
    ["the database fails the limits read (500)", { criteria: failedRead, requirements: noRows }],
    ["the singleton row is missing (200 [])", { criteria: noRows, requirements: noRows }],
    [
      "the limits read answers two rows (PGRST116)",
      {
        criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }, { ...UNSET_LIMITS, ...NEVER_SIGNED }),
        requirements: noRows,
      },
    ],
    [
      "the database fails the requirements read (500), the limits read succeeding",
      { criteria: rows({ ...SET_LIMITS, ...NEVER_SIGNED }), requirements: failedRead },
    ],
  ])("answers error when %s, and does not ask for members", async (_case, answers) => {
    const stub = stubCriteria(answers);

    const criteria = await loadCriteria(client(), VIEWER);

    expect(criteria).toEqual({ state: "error" });
    expect(criteria).not.toEqual(NOTHING_SET);
    // The outcome came from the database's answers — both reads did go out, once each.
    expect(requestsTo(stub.requests, "team_criteria")).toHaveLength(1);
    expect(requestsTo(stub.requests, "member_requirements")).toHaveLength(1);
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  // A 200 the code cannot read: a limits answer that is not the singleton row, or a requirements
  // answer it cannot walk as rows — there the exception stays inside the function.
  it.each<[string, Answers]>([
    ["a limits body that is an empty object", { criteria: () => jsonResponse({}, 200), requirements: noRows }],
    ["a limits row without the limit columns", { criteria: rows({}), requirements: noRows }],
    ["a limits row that is null", { criteria: rows(null), requirements: noRows }],
    [
      "a requirements body that is an object",
      { criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }), requirements: () => jsonResponse({}, 200) },
    ],
    [
      "a requirements body that is null",
      { criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }), requirements: () => jsonResponse(null, 200) },
    ],
    [
      "a requirements list holding something that is not a row",
      { criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }), requirements: rows(null) },
    ],
  ])("answers error for a 200 with %s, and does not throw", async (_case, answers) => {
    const stub = stubCriteria(answers);

    const criteria = await loadCriteria(client(), VIEWER);

    expect(criteria).toEqual({ state: "error" });
    expect(criteria).not.toEqual(NOTHING_SET);
    expect(requestsTo(stub.requests, "team_criteria")).toHaveLength(1);
    expect(requestsTo(stub.requests, "member_requirements")).toHaveLength(1);
  });
});

describe("loadCriteria: a value that does not read as a limit is a failed read, never no limit (#1)", () => {
  it("control: answers the limits when every column reads as one", async () => {
    stubCriteria({ criteria: rows({ ...SET_LIMITS, ...NEVER_SIGNED }), requirements: noRows });

    expect(await loadCriteria(client(), VIEWER)).toMatchObject({
      state: "ok",
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
    });
  });

  it.each(UNREADABLE)("answers error when %s holds %s", async (column, _what, value) => {
    const stub = stubCriteria({
      criteria: rows({ ...SET_LIMITS, ...NEVER_SIGNED, [column]: value }),
      requirements: noRows,
    });

    const criteria = await loadCriteria(client(), VIEWER);

    expect(criteria).toEqual({ state: "error" });
    expect(criteria).not.toEqual(NOTHING_SET);
    expect(requestsTo(stub.requests, "team_criteria")).toHaveLength(1);
  });
});

describe("loadCriteria: a successful read gives the limits and splits the requirements (#1)", () => {
  function annaAndBartek(): Response {
    return jsonResponse(
      [
        { id: BARTEK, email: BARTEK_EMAIL },
        { id: ANNA, email: ANNA_EMAIL },
      ],
      200,
    );
  }

  it("carries the row's limits, the city unchanged and the numbers as numbers", async () => {
    stubCriteria({ criteria: rows({ ...SET_LIMITS, ...NEVER_SIGNED }), requirements: noRows });

    const criteria = await loadCriteria(client(), VIEWER);

    expect(criteria).toEqual({
      state: "ok",
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
      limitsChangedBy: null,
      limitsChangedAt: null,
      own: null,
      others: [],
    });
  });

  // CLAUDE.md (## Structure): a number sent as text reads as that number, never as a failed read.
  it("reads a limit sent as numeric text as that number", async () => {
    stubCriteria({ criteria: rows({ ...SET_LIMITS_AS_TEXT, ...NEVER_SIGNED }), requirements: noRows });

    expect(await loadCriteria(client(), VIEWER)).toMatchObject({
      state: "ok",
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
    });
  });

  it("keeps a limit that is set beside the ones that are not", async () => {
    stubCriteria({
      criteria: rows({ city: null, price_min: null, price_max: 900000, area_min: null, ...NEVER_SIGNED }),
      requirements: noRows,
    });

    expect(await loadCriteria(client(), VIEWER)).toMatchObject({
      state: "ok",
      limits: { city: null, priceMin: null, priceMax: 900000, areaMin: null },
    });
  });

  it("puts the viewer's requirements in own, signed self, and the rest in others in the order answered", async () => {
    const stub = stubCriteria({
      criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }),
      requirements: rows(ANNA_ROW, VIEWER_ROW, BARTEK_ROW),
      members: annaAndBartek,
    });

    expect(await loadCriteria(client(), VIEWER)).toEqual({
      state: "ok",
      limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
      limitsChangedBy: null,
      limitsChangedAt: null,
      own: {
        author: { kind: "self" },
        body: "Najwyżej trzecie piętro bez windy",
        createdAt: "2026-09-21T09:00:00+00:00",
        updatedAt: "2026-09-27T09:15:00+00:00",
      },
      others: [
        {
          author: { kind: "member", email: "anna@example.test" },
          body: "Balkon albo loggia",
          createdAt: "2026-09-20T08:00:00+00:00",
          updatedAt: "2026-09-29T10:00:00+00:00",
        },
        {
          author: { kind: "member", email: "bartek@example.test" },
          body: "Miejsce postojowe",
          createdAt: "2026-09-22T07:00:00+00:00",
          updatedAt: "2026-09-26T07:00:00+00:00",
        },
      ],
    });

    expect(requestsTo(stub.requests, "members")).toHaveLength(1);
    expect(stub.requests).toHaveLength(3);
  });

  it("leaves own empty when the viewer has written no requirements", async () => {
    stubCriteria({
      criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }),
      requirements: rows(BARTEK_ROW, ANNA_ROW),
      members: annaAndBartek,
    });

    const criteria = await loadCriteria(client(), VIEWER);

    expect(criteria).toMatchObject({ state: "ok", own: null });
    expect(criteria.state === "ok" ? criteria.others.map((requirements) => requirements.body) : null).toEqual([
      "Miejsce postojowe",
      "Balkon albo loggia",
    ]);
  });

  // The singleton's only possible key is `true` (the creating migration).
  it("asks for the singleton row of the limits", async () => {
    const stub = stubCriteria({ criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }), requirements: noRows });

    await loadCriteria(client(), VIEWER);

    const [request] = requestsTo(stub.requests, "team_criteria");
    expect(new URL(request.url).searchParams.get("id")).toBe("eq.true");
  });

  // CLAUDE.md (## Structure): members' requirements come most recently edited first. The order
  // itself is the database's; what the function owns is asking for it.
  it("asks for the requirements most recently edited first", async () => {
    const stub = stubCriteria({ criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }), requirements: noRows });

    await loadCriteria(client(), VIEWER);

    const [request] = requestsTo(stub.requests, "member_requirements");
    expect(new URL(request.url).searchParams.get("order")).toBe("updated_at.desc");
  });
});

describe("loadCriteria: who last changed the limits (#1)", () => {
  it("answers no signature and no date for limits that were never set", async () => {
    const stub = stubCriteria({ criteria: rows({ ...UNSET_LIMITS, ...NEVER_SIGNED }), requirements: noRows });

    expect(await loadCriteria(client(), VIEWER)).toMatchObject({
      state: "ok",
      limitsChangedBy: null,
      limitsChangedAt: null,
    });
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  // A null `updated_by` with a date is "the account that last changed the limits was deleted",
  // and nothing else — a fact from the row, which needs no read of `members`.
  it("answers a deleted account for a date without a signature", async () => {
    const stub = stubCriteria({
      criteria: rows({ ...SET_LIMITS, updated_at: CHANGED_AT, updated_by: null }),
      requirements: noRows,
    });

    expect(await loadCriteria(client(), VIEWER)).toMatchObject({
      state: "ok",
      limitsChangedBy: { kind: "deleted" },
      limitsChangedAt: "2026-09-28T18:30:00+00:00",
    });
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  it("answers self when the viewer changed them, with no read of members", async () => {
    const stub = stubCriteria({
      criteria: rows({ ...SET_LIMITS, updated_at: CHANGED_AT, updated_by: VIEWER }),
      requirements: noRows,
    });

    expect(await loadCriteria(client(), VIEWER)).toMatchObject({
      state: "ok",
      limitsChangedBy: { kind: "self" },
      limitsChangedAt: "2026-09-28T18:30:00+00:00",
    });
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  it("names another member by the email address", async () => {
    stubCriteria({
      criteria: rows({ ...SET_LIMITS, updated_at: CHANGED_AT, updated_by: CELINA }),
      requirements: noRows,
      members: rows({ id: CELINA, email: CELINA_EMAIL }),
    });

    expect(await loadCriteria(client(), VIEWER)).toMatchObject({
      state: "ok",
      limitsChangedBy: { kind: "member", email: "celina@example.test" },
      limitsChangedAt: "2026-09-28T18:30:00+00:00",
    });
  });

  // The signature must not be taken from a requirements author's position, nor the other way.
  it("names the member who changed the limits beside the authors of the requirements", async () => {
    stubCriteria({
      criteria: rows({ ...SET_LIMITS, updated_at: CHANGED_AT, updated_by: BARTEK }),
      requirements: rows(ANNA_ROW, VIEWER_ROW),
      members: rows({ id: ANNA, email: ANNA_EMAIL }, { id: BARTEK, email: BARTEK_EMAIL }),
    });

    const criteria = await loadCriteria(client(), VIEWER);

    expect(criteria).toMatchObject({
      state: "ok",
      limitsChangedBy: { kind: "member", email: "bartek@example.test" },
      own: { author: { kind: "self" }, body: "Najwyżej trzecie piętro bez windy" },
      others: [{ author: { kind: "member", email: "anna@example.test" }, body: "Balkon albo loggia" }],
    });
  });
});

describe("loadCriteria: every name comes from one read of members (#1)", () => {
  const SIGNED_BY_CELINA = { ...SET_LIMITS, updated_at: CHANGED_AT, updated_by: CELINA };

  it("reads the requirements' authors and the limits' signature in one request", async () => {
    const stub = stubCriteria({
      criteria: rows(SIGNED_BY_CELINA),
      requirements: rows(ANNA_ROW, VIEWER_ROW, BARTEK_ROW),
      members: rows(
        { id: CELINA, email: CELINA_EMAIL },
        { id: BARTEK, email: BARTEK_EMAIL },
        { id: ANNA, email: ANNA_EMAIL },
      ),
    });

    const criteria = await loadCriteria(client(), VIEWER);

    expect(criteria).toMatchObject({
      state: "ok",
      limitsChangedBy: { kind: "member", email: "celina@example.test" },
      own: { author: { kind: "self" } },
      others: [
        { author: { kind: "member", email: "anna@example.test" } },
        { author: { kind: "member", email: "bartek@example.test" } },
      ],
    });

    const members = requestsTo(stub.requests, "members");
    expect(members).toHaveLength(1);
    // Written out by hand: the two other authors and the member who changed the limits.
    expect(idsAskedFor(members[0])).toEqual([ANNA, BARTEK, CELINA].sort());
    expect(stub.requests).toHaveLength(3);
  });

  it("keeps the state ok when that read fails: authors and signature unknown — never deleted", async () => {
    const stub = stubCriteria({
      criteria: rows(SIGNED_BY_CELINA),
      requirements: rows(ANNA_ROW, VIEWER_ROW),
      members: failedRead,
    });

    const criteria = await loadCriteria(client(), VIEWER);

    expect(criteria).toEqual({
      state: "ok",
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
      limitsChangedBy: { kind: "unknown" },
      limitsChangedAt: "2026-09-28T18:30:00+00:00",
      own: {
        author: { kind: "self" },
        body: "Najwyżej trzecie piętro bez windy",
        createdAt: "2026-09-21T09:00:00+00:00",
        updatedAt: "2026-09-27T09:15:00+00:00",
      },
      others: [
        {
          author: { kind: "unknown" },
          body: "Balkon albo loggia",
          createdAt: "2026-09-20T08:00:00+00:00",
          updatedAt: "2026-09-29T10:00:00+00:00",
        },
      ],
    });
    expect(criteria).not.toEqual(FAILED);
    expect(requestsTo(stub.requests, "members")).toHaveLength(1);
  });
});

describe("loadTeamLimits: a failed read is never a team without limits (#1)", () => {
  it("control: answers four unset limits for a row that sets none", async () => {
    const stub = stubCriteria({ criteria: rows(UNSET_LIMITS) });

    // An unset limit is null — never 0, never "".
    expect(await loadTeamLimits(client())).toEqual({
      ok: true,
      limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
    });

    // The board's light read: the singleton row of the limits, and nothing else.
    expect(stub.requests).toHaveLength(1);
    expect(isTableRequest(stub.requests[0], "team_criteria", "GET")).toBe(true);
    expect(new URL(stub.requests[0].url).searchParams.get("id")).toBe("eq.true");
  });

  it("control: answers the row's limits, the city unchanged and the numbers as numbers", async () => {
    stubCriteria({ criteria: rows(SET_LIMITS) });

    expect(await loadTeamLimits(client())).toEqual({
      ok: true,
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
    });
  });

  it("reads a limit sent as numeric text as that number", async () => {
    stubCriteria({ criteria: rows(SET_LIMITS_AS_TEXT) });

    expect(await loadTeamLimits(client())).toEqual({
      ok: true,
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
    });
  });

  it("answers not ok without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const limits = await loadTeamLimits(null);

    expect(limits).toEqual({ ok: false });
    expect(limits).not.toEqual(NO_LIMITS);
    expect(stub.requests).toHaveLength(0);
  });

  it.each<[string, () => Response]>([
    ["a failed read (500)", failedRead],
    ["a missing singleton row (200 [])", noRows],
    ["two rows (PGRST116)", rows(UNSET_LIMITS, UNSET_LIMITS)],
    // A 200 that is not the singleton row.
    ["a body that is an empty object", () => jsonResponse({}, 200)],
    ["a row without the limit columns", rows({})],
    ["a row that is null", rows(null)],
    ["a row that is text", rows("Warszawa")],
  ])("answers not ok for %s, and does not throw", async (_case, answer) => {
    const stub = stubCriteria({ criteria: answer });

    const limits = await loadTeamLimits(client());

    expect(limits).toEqual({ ok: false });
    expect(limits).not.toEqual(NO_LIMITS);
    // The outcome came from the database's answer — the read did go out, once.
    expect(stub.requests).toHaveLength(1);
  });

  it.each(UNREADABLE)("answers not ok when %s holds %s", async (column, _what, value) => {
    const stub = stubCriteria({ criteria: rows({ ...SET_LIMITS, [column]: value }) });

    const limits = await loadTeamLimits(client());

    expect(limits).toEqual({ ok: false });
    expect(limits).not.toEqual(NO_LIMITS);
    expect(stub.requests).toHaveLength(1);
  });
});

// The audit's read. What it must never be confused with is "the team has no criteria": an audit
// is allowed without any, so a failed read answered as none would be stored as an audit made
// against no limits and no requirements, under a revision nobody read.

/** "No limits, no requirements, never revised": a successful read. */
const NO_AUDIT_CRITERIA: AuditCriteriaResult = {
  state: "ok",
  limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
  requirements: [],
  revision: 0,
};

function revision(value: unknown): () => Response {
  return rows({ revision: value });
}

/** Answers in turn, one per request; a request past the last answer is unplanned. */
function inTurn(...answers: (() => Response)[]): () => Response | undefined {
  let next = 0;
  return () => {
    const answer = answers.at(next);
    next += 1;
    return answer?.();
  };
}

interface AuditAnswers {
  /** One answer per read of `criteria_revision`, in the order the reads are made. */
  revisions: (() => Response)[];
  /** One answer per read of `team_criteria`; a single one serves a read that is not repeated. */
  criteria?: (() => Response)[];
  requirements?: (() => Response)[];
}

/**
 * Answers the three tables `loadAuditCriteria` reads, each from its own list in turn. `members`
 * and `offer_notes` have no answer: the audit's criteria name nobody and never touch a note, so
 * a request to either fails the test.
 */
function stubAuditCriteria({ revisions, criteria = [], requirements = [] }: AuditAnswers) {
  const nextRevision = inTurn(...revisions);
  const nextCriteria = inTurn(...criteria);
  const nextRequirements = inTurn(...requirements);
  return stubFetch((request) => {
    if (isTableRequest(request, "criteria_revision", "GET")) return nextRevision();
    if (isTableRequest(request, "team_criteria", "GET")) return nextCriteria();
    if (isTableRequest(request, "member_requirements", "GET")) return nextRequirements();
    return undefined;
  });
}

/** The tables asked, in the order of the requests. */
function tablesAsked(requests: RecordedRequest[]): string[] {
  return requests.map((request) => new URL(request.url).pathname.replace("/rest/v1/", ""));
}

describe("loadAuditCriteria: a failed read is its own state, never an audit without criteria (#1)", () => {
  it("control: answers no limits, no requirements and revision 0 for a team that has set nothing", async () => {
    const stub = stubAuditCriteria({
      revisions: [revision(0), revision(0)],
      criteria: [rows(UNSET_LIMITS)],
      requirements: [noRows],
    });

    // An unset limit is null — never 0, never "" — and the counter starts at 0.
    expect(await loadAuditCriteria(client())).toEqual({
      state: "ok",
      limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
      requirements: [],
      revision: 0,
    });

    // The revision, the criteria, the revision again — and nothing else.
    expect(requestsTo(stub.requests, "criteria_revision")).toHaveLength(2);
    expect(requestsTo(stub.requests, "team_criteria")).toHaveLength(1);
    expect(requestsTo(stub.requests, "member_requirements")).toHaveLength(1);
    expect(stub.requests).toHaveLength(4);
  });

  it("answers error without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const criteria = await loadAuditCriteria(null);

    expect(criteria).toMatchObject({ state: "error" });
    expect(criteria).not.toEqual(NO_AUDIT_CRITERIA);
    expect(stub.requests).toHaveLength(0);
  });

  // The first read of the revision decides before anything else is asked.
  it.each<[string, () => Response]>([
    ["the database fails the read (500)", failedRead],
    ["the singleton row is missing (200 [])", noRows],
    ["the read answers two rows (PGRST116)", rows({ revision: 0 }, { revision: 0 })],
    ["the row has no revision column", rows({})],
    ["the row is null", rows(null)],
    ["the body is an empty object", () => jsonResponse({}, 200)],
  ])("answers error when %s for the first read of the revision, and reads no criteria", async (_case, answer) => {
    const stub = stubAuditCriteria({ revisions: [answer] });

    const criteria = await loadAuditCriteria(client());

    expect(criteria).toMatchObject({ state: "error" });
    expect(criteria).not.toEqual(NO_AUDIT_CRITERIA);
    expect(tablesAsked(stub.requests)).toEqual(["criteria_revision"]);
  });

  // The criteria were read, and what they were read under could not be confirmed.
  it.each<[string, () => Response]>([
    ["the database fails the read (500)", failedRead],
    ["the singleton row is missing (200 [])", noRows],
    ["the row has no revision column", rows({})],
  ])("answers error when %s for the second read of the revision", async (_case, answer) => {
    const stub = stubAuditCriteria({
      revisions: [revision(0), answer],
      criteria: [rows(UNSET_LIMITS)],
      requirements: [noRows],
    });

    const criteria = await loadAuditCriteria(client());

    expect(criteria).toMatchObject({ state: "error" });
    expect(criteria).not.toEqual(NO_AUDIT_CRITERIA);
    expect(stub.requests).toHaveLength(4);
  });

  it.each<[string, () => Response, () => Response]>([
    ["the database fails the limits read (500)", failedRead, noRows],
    ["the limits' singleton row is missing (200 [])", noRows, noRows],
    ["the limits read answers two rows (PGRST116)", rows(UNSET_LIMITS, UNSET_LIMITS), noRows],
    ["the limits body is an empty object", () => jsonResponse({}, 200), noRows],
    ["the limits row has no limit columns", rows({}), noRows],
    ["the limits row is null", rows(null), noRows],
    ["the database fails the requirements read (500)", rows(UNSET_LIMITS), failedRead],
    ["the requirements body is an object", rows(UNSET_LIMITS), () => jsonResponse({}, 200)],
    ["the requirements body is null", rows(UNSET_LIMITS), () => jsonResponse(null, 200)],
    ["the requirements list holds something that is not a row", rows(UNSET_LIMITS), rows(null)],
    ["the requirements list holds a text", rows(UNSET_LIMITS), rows("Balkon albo loggia")],
    ["a requirements row has no body", rows(UNSET_LIMITS), rows({ author_id: ANNA })],
    ["a requirements row has a null body", rows(UNSET_LIMITS), rows({ body: null })],
    ["a requirements row has a number for a body", rows(UNSET_LIMITS), rows({ body: 5 })],
    ["a requirements row has an empty body", rows(UNSET_LIMITS), rows({ body: "" })],
    ["a requirements row has a blank body", rows(UNSET_LIMITS), rows({ body: " \n " })],
    ["one requirements row among readable ones has no body", rows(UNSET_LIMITS), rows(ANNA_ROW, {}, BARTEK_ROW)],
  ])("answers error when %s, and does not throw", async (_case, limits, requirements) => {
    const stub = stubAuditCriteria({
      revisions: [revision(0), revision(0)],
      criteria: [limits],
      requirements: [requirements],
    });

    const criteria = await loadAuditCriteria(client());

    expect(criteria).toMatchObject({ state: "error" });
    expect(criteria).not.toEqual(NO_AUDIT_CRITERIA);
    // The outcome came from the database's answers — both reads did go out, once each — and a
    // failed read is not read again.
    expect(requestsTo(stub.requests, "team_criteria")).toHaveLength(1);
    expect(requestsTo(stub.requests, "member_requirements")).toHaveLength(1);
  });

  // The same rule as on /criteria and on the board, through the same `readLimits`.
  it.each(UNREADABLE)("answers error when %s holds %s — never no limit", async (column, _what, value) => {
    stubAuditCriteria({
      revisions: [revision(0), revision(0)],
      criteria: [rows({ ...SET_LIMITS, [column]: value })],
      requirements: [noRows],
    });

    const criteria = await loadAuditCriteria(client());

    expect(criteria).toMatchObject({ state: "error" });
    expect(criteria).not.toEqual(NO_AUDIT_CRITERIA);
  });

  // A revision that is not a whole number cannot be stored with an audit or compared later.
  it.each<[string, unknown]>([
    ["null", null],
    ["non-numeric text", "abc"],
    ["an empty text", ""],
    ["a negative number", -1],
    ["a negative number as text", "-1"],
    ["a fraction", 7.5],
    ["a fraction as text", "7.0"],
    ["exponent notation as text", "1e3"],
    ["a boolean", true],
    ["a list", [7]],
    ["a number past the safe integers", 2 ** 53],
  ])("answers error when the revision is %s", async (_what, value) => {
    stubAuditCriteria({ revisions: [revision(value)] });

    const criteria = await loadAuditCriteria(client());

    expect(criteria).toMatchObject({ state: "error" });
    expect(criteria).not.toEqual(NO_AUDIT_CRITERIA);
  });
});

describe("loadAuditCriteria: a failed read says which step failed, for the audit route's log (impl review, F7)", () => {
  it("names no client", async () => {
    expect(await loadAuditCriteria(null)).toEqual({ state: "error", failure: { detail: "unconfigured" } });
  });

  it.each<[string, Parameters<typeof stubAuditCriteria>[0], Record<string, unknown>]>([
    [
      "the revision's failed query, with the database's code and status",
      { revisions: [failedRead], criteria: [], requirements: [] },
      { detail: "revision_query", dbCode: "XX000", dbStatus: 500 },
    ],
    [
      "a missing revision row",
      { revisions: [noRows], criteria: [], requirements: [] },
      { detail: "revision_missing", dbStatus: 200 },
    ],
    [
      "a revision that is not a number",
      { revisions: [rows({ revision: "abc" })], criteria: [], requirements: [] },
      { detail: "revision_unreadable" },
    ],
    [
      "the limits' failed query",
      { revisions: [revision(7)], criteria: [failedRead], requirements: [noRows] },
      { detail: "limits_query", dbCode: "XX000", dbStatus: 500 },
    ],
    [
      "the requirements' failed query",
      { revisions: [revision(7)], criteria: [rows(UNSET_LIMITS)], requirements: [failedRead] },
      { detail: "requirements_query", dbCode: "XX000", dbStatus: 500 },
    ],
    [
      "a requirements row without a text",
      { revisions: [revision(7)], criteria: [rows(UNSET_LIMITS)], requirements: [rows({ body: null })] },
      { detail: "requirements_unreadable" },
    ],
    [
      "a revision that moved twice",
      {
        revisions: [revision(7), revision(8), revision(8), revision(9)],
        criteria: [rows(UNSET_LIMITS), rows(UNSET_LIMITS)],
        requirements: [noRows, noRows],
      },
      { detail: "revision_moved" },
    ],
  ])("names %s", async (_case, network, failure) => {
    stubAuditCriteria(network);

    expect(await loadAuditCriteria(client())).toEqual({ state: "error", failure });
  });
});

describe("loadAuditCriteria: the limits, the requirements' texts and the revision (FR-010)", () => {
  it("carries the limits, the texts in the order answered, and the revision", async () => {
    stubAuditCriteria({
      revisions: [revision(7), revision(7)],
      criteria: [rows(SET_LIMITS)],
      requirements: [rows({ body: "Balkon albo loggia" }, { body: "Najwyżej trzecie piętro bez windy" })],
    });

    expect(await loadAuditCriteria(client())).toEqual({
      state: "ok",
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
      requirements: ["Balkon albo loggia", "Najwyżej trzecie piętro bez windy"],
      revision: 7,
    });
  });

  it("reads a limit and a revision sent as numeric text as those numbers", async () => {
    stubAuditCriteria({
      revisions: [revision("12"), revision("12")],
      criteria: [rows(SET_LIMITS_AS_TEXT)],
      requirements: [noRows],
    });

    expect(await loadAuditCriteria(client())).toEqual({
      state: "ok",
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
      requirements: [],
      revision: 12,
    });
  });

  it("keeps a limit that is set beside the ones that are not", async () => {
    stubAuditCriteria({
      revisions: [revision(3), revision(3)],
      criteria: [rows({ city: null, price_min: null, price_max: 900000, area_min: null })],
      requirements: [noRows],
    });

    expect(await loadAuditCriteria(client())).toMatchObject({
      state: "ok",
      limits: { city: null, priceMin: null, priceMax: 900000, areaMin: null },
    });
  });

  it("keeps a requirement's text exactly as written, line breaks included", async () => {
    stubAuditCriteria({
      revisions: [revision(1), revision(1)],
      criteria: [rows(UNSET_LIMITS)],
      requirements: [rows({ body: "  Balkon.\nNajwyżej trzecie piętro. " })],
    });

    expect(await loadAuditCriteria(client())).toMatchObject({
      state: "ok",
      requirements: ["  Balkon.\nNajwyżej trzecie piętro. "],
    });
  });

  // Written by hand from postgrest-js: `select` as sent, the singleton's key, and two `order`
  // calls joined with a comma. A fixed order numbers the same criteria the same way every time.
  it("asks for the singleton rows, and for the requirements oldest first, then by author", async () => {
    const stub = stubAuditCriteria({
      revisions: [revision(0), revision(0)],
      criteria: [rows(UNSET_LIMITS)],
      requirements: [noRows],
    });

    await loadAuditCriteria(client());

    const [revisionRead] = requestsTo(stub.requests, "criteria_revision");
    expect(new URL(revisionRead.url).searchParams.get("select")).toBe("revision");
    expect(new URL(revisionRead.url).searchParams.get("id")).toBe("eq.true");
    const [limitsRead] = requestsTo(stub.requests, "team_criteria");
    expect(new URL(limitsRead.url).searchParams.get("select")).toBe("city,price_min,price_max,area_min");
    expect(new URL(limitsRead.url).searchParams.get("id")).toBe("eq.true");
    const [requirementsRead] = requestsTo(stub.requests, "member_requirements");
    expect(new URL(requirementsRead.url).searchParams.get("order")).toBe("created_at.asc,author_id.asc");
  });

  it("reads the revision before the criteria and again after them", async () => {
    const stub = stubAuditCriteria({
      revisions: [revision(0), revision(0)],
      criteria: [rows(UNSET_LIMITS)],
      requirements: [noRows],
    });

    await loadAuditCriteria(client());

    const asked = tablesAsked(stub.requests);
    expect(asked[0]).toBe("criteria_revision");
    expect(asked[3]).toBe("criteria_revision");
    // The two reads between them go out together, in either order.
    expect(asked.slice(1, 3).sort()).toEqual(["member_requirements", "team_criteria"]);
  });
});

describe("loadAuditCriteria: only the criteria themselves leave the database (#6)", () => {
  it("asks for the requirements' texts alone — no author, no dates", async () => {
    const stub = stubAuditCriteria({
      revisions: [revision(0), revision(0)],
      criteria: [rows(UNSET_LIMITS)],
      requirements: [noRows],
    });

    await loadAuditCriteria(client());

    const [requirementsRead] = requestsTo(stub.requests, "member_requirements");
    expect(new URL(requirementsRead.url).searchParams.get("select")).toBe("body");
    // And the limits without their signature.
    const [limitsRead] = requestsTo(stub.requests, "team_criteria");
    expect(new URL(limitsRead.url).searchParams.get("select")).not.toContain("updated_by");
  });

  // Even from a database that answers more than it was asked for.
  it("passes on no author and no email address, whatever the rows carry", async () => {
    const stub = stubAuditCriteria({
      revisions: [revision(4), revision(4)],
      criteria: [rows({ ...SET_LIMITS, updated_at: CHANGED_AT, updated_by: CELINA, email: CELINA_EMAIL })],
      requirements: [rows({ ...ANNA_ROW, email: ANNA_EMAIL }, { ...BARTEK_ROW, email: BARTEK_EMAIL })],
    });

    const criteria = await loadAuditCriteria(client());

    expect(criteria).toEqual({
      state: "ok",
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
      requirements: ["Balkon albo loggia", "Miejsce postojowe"],
      revision: 4,
    });
    const serialised = JSON.stringify(criteria);
    for (const personal of [ANNA, BARTEK, CELINA, ANNA_EMAIL, BARTEK_EMAIL, CELINA_EMAIL, CHANGED_AT]) {
      expect(serialised).not.toContain(personal);
    }
    // Nobody is named, so `members` is never asked.
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
    expect(stub.requests).toHaveLength(4);
  });
});

describe("loadAuditCriteria: the criteria and their revision come from one moment (FR-003)", () => {
  // A member saved new limits and requirements while the first read was under way.
  it("reads everything again when the revision moved, and answers the second read", async () => {
    const stub = stubAuditCriteria({
      revisions: [revision(7), revision(8), revision(8), revision(8)],
      criteria: [rows(UNSET_LIMITS), rows(SET_LIMITS)],
      requirements: [rows({ body: "Balkon albo loggia" }), rows({ body: "Balkon albo loggia" }, { body: "Garaż" })],
    });

    expect(await loadAuditCriteria(client())).toEqual({
      state: "ok",
      limits: { city: "Warszawa", priceMin: 800000, priceMax: 900000, areaMin: 45.5 },
      requirements: ["Balkon albo loggia", "Garaż"],
      revision: 8,
    });

    // Two whole reads: the revision twice in each, the criteria once in each.
    expect(tablesAsked(stub.requests).filter((table) => table === "criteria_revision")).toHaveLength(4);
    expect(requestsTo(stub.requests, "team_criteria")).toHaveLength(2);
    expect(requestsTo(stub.requests, "member_requirements")).toHaveLength(2);
    expect(stub.requests).toHaveLength(8);
  });

  // Beside it: an unchanged revision is one read, not two.
  it("reads once when the revision did not move", async () => {
    const stub = stubAuditCriteria({
      revisions: [revision(7), revision(7)],
      criteria: [rows(SET_LIMITS)],
      requirements: [noRows],
    });

    expect(await loadAuditCriteria(client())).toMatchObject({ state: "ok", revision: 7 });
    expect(stub.requests).toHaveLength(4);
  });

  it.each<[string, number[]]>([
    ["moved during both reads", [7, 8, 8, 9]],
    ["moved between every read of it", [7, 8, 9, 10]],
    ["moved back to where it started", [7, 8, 7, 8]],
  ])("answers error when the revision %s, and does not read a third time", async (_case, values) => {
    const stub = stubAuditCriteria({
      revisions: values.map((value) => revision(value)),
      criteria: [rows(SET_LIMITS), rows(SET_LIMITS)],
      requirements: [noRows, noRows],
    });

    const criteria = await loadAuditCriteria(client());

    expect(criteria).toMatchObject({ state: "error" });
    expect(criteria).not.toEqual(NO_AUDIT_CRITERIA);
    // Two whole reads and no more: a third would be unplanned and fail the test in `restoreFetch`.
    expect(stub.requests).toHaveLength(8);
  });

  it("answers error when the repeated read fails, rather than the first read's criteria", async () => {
    const stub = stubAuditCriteria({
      revisions: [revision(7), revision(8), revision(8), revision(8)],
      criteria: [rows(UNSET_LIMITS), failedRead],
      requirements: [noRows, noRows],
    });

    const criteria = await loadAuditCriteria(client());

    expect(criteria).toMatchObject({ state: "error" });
    expect(criteria).not.toEqual({ ...NO_AUDIT_CRITERIA, revision: 8 });
    // The repeated read stopped at its failed criteria read: no fourth read of the revision.
    expect(tablesAsked(stub.requests).filter((table) => table === "criteria_revision")).toHaveLength(3);
  });
});
