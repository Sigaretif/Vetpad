import { afterEach, describe, expect, it, vi } from "vitest";
import { type CriteriaResult, type TeamLimitsResult, loadCriteria, loadTeamLimits } from "@/lib/criteria";
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
// that does not read as a limit).
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
