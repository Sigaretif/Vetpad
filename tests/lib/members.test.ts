import type { AstroCookies } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Saver, authorName, resolveAuthors, resolveSaver, saverName } from "@/lib/members";
import { createClient } from "@/lib/supabase";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase and
// @/lib/members run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from the sources, never copied from what the functions
// return: the contracts of `resolveSaver` (context/archive/2026-09-26-duplicate-listing-notice/
// plan.md, „Nieustalony ≠ usunięty” and „Wyznaczanie autora”) and of `resolveAuthors` and
// `authorName` (context/archive/2026-09-26-member-notes/plan.md), CLAUDE.md (## Structure, the
// `public.members` bullet) and prd.md (Non-Functional Requirements, the deleted account).
//
// `deleted` is a fact read from the row; `unknown` is everything that could not be established.
// Every failure below stands beside a read that succeeds and names the member: alone, it would
// pass on a function that always answers `unknown`.

afterEach(restoreFetch);

const VIEWER = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const ANNA = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000a1";
const BARTEK = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000b2";
/** A member's id that `public.members` holds no row for. */
const NO_ROW = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000c3";

const ANNA_EMAIL = "anna@example.test";
const BARTEK_EMAIL = "bartek@example.test";

const DELETED: Saver = { kind: "deleted" };
const SELF: Saver = { kind: "self" };
const UNKNOWN: Saver = { kind: "unknown" };

/** The client the way a request builds it, with no session cookie. */
function client(): NonNullable<ReturnType<typeof createClient>> {
  const supabase = createClient(new Headers(), { set: vi.fn() } as unknown as AstroCookies);
  if (supabase === null) throw new Error("expected a configured Supabase client");
  return supabase;
}

/** Answers every read of `public.members` with `answer`; any other request is unplanned. */
function stubMembers(answer: () => Response) {
  return stubFetch((request) => (isTableRequest(request, "members", "GET") ? answer() : undefined));
}

/** A read the database failed, the way PostgREST reports one. */
function failedRead(): Response {
  return jsonResponse({ code: "XX000", message: "internal error", details: null, hint: null }, 500);
}

function params(request: RecordedRequest | undefined): URLSearchParams {
  if (request === undefined) throw new Error("expected a recorded request");
  return new URL(request.url).searchParams;
}

/** The ids a `members` read filters by, from `id=in.(a,b,…)`, sorted. */
function idsAskedFor(request: RecordedRequest | undefined): string[] {
  const filter = params(request).get("id") ?? "";
  const list = /^in\.\((.*)\)$/.exec(filter)?.[1];
  if (list === undefined) throw new Error(`expected an in.(…) filter on id, got "${filter}"`);
  return list.split(",").sort();
}

describe("resolveSaver: a null author column is a deleted account, with no read (#1)", () => {
  it.each<[string, string | undefined]>([
    ["a signed-in viewer", VIEWER],
    ["no viewer", undefined],
  ])("answers deleted for %s, with a client, and asks the database nothing", async (_who, viewerId) => {
    const stub = stubFetch(() => undefined);
    expect(await resolveSaver(client(), null, viewerId)).toEqual(DELETED);
    expect(stub.requests).toHaveLength(0);
  });

  // A fact from the row needs no read, so it holds without a client too.
  it.each<[string, string | undefined]>([
    ["a signed-in viewer", VIEWER],
    ["no viewer", undefined],
  ])("answers deleted for %s without a client", async (_who, viewerId) => {
    expect(await resolveSaver(null, null, viewerId)).toEqual(DELETED);
  });
});

describe("resolveSaver: the viewer's own offer needs no read (#1)", () => {
  it("answers self with a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);
    expect(await resolveSaver(client(), VIEWER, VIEWER)).toEqual(SELF);
    expect(stub.requests).toHaveLength(0);
  });

  it("answers self without a client", async () => {
    expect(await resolveSaver(null, VIEWER, VIEWER)).toEqual(SELF);
  });
});

describe("resolveSaver: another member is named by the email in public.members (#1)", () => {
  it("answers member with the row's email, from exactly one read of that member", async () => {
    const stub = stubMembers(() => jsonResponse([{ email: ANNA_EMAIL }], 200));

    expect(await resolveSaver(client(), ANNA, VIEWER)).toEqual({ kind: "member", email: ANNA_EMAIL });

    expect(stub.requests).toHaveLength(1);
    expect(isTableRequest(stub.requests[0], "members", "GET")).toBe(true);
    expect(params(stub.requests[0]).get("id")).toBe(`eq.${ANNA}`);
    expect(params(stub.requests[0]).get("select")).toBe("email");
  });

  it("names the member for a visitor with no id of their own", async () => {
    stubMembers(() => jsonResponse([{ email: ANNA_EMAIL }], 200));
    expect(await resolveSaver(client(), ANNA, undefined)).toEqual({ kind: "member", email: ANNA_EMAIL });
  });
});

describe("resolveSaver: what could not be established is unknown, never deleted (#1)", () => {
  it("answers unknown for another member's id without a client", async () => {
    expect(await resolveSaver(null, ANNA, VIEWER)).toEqual(UNKNOWN);
  });

  it.each<[string, () => Response]>([
    ["a failed read (500)", failedRead],
    ["no members row (200 [])", () => jsonResponse([], 200)],
    ["two rows for one id (PGRST116)", () => jsonResponse([{ email: ANNA_EMAIL }, { email: BARTEK_EMAIL }], 200)],
    ["a null email", () => jsonResponse([{ email: null }], 200)],
    ["an empty email", () => jsonResponse([{ email: "" }], 200)],
    ["an email of spaces only", () => jsonResponse([{ email: "   " }], 200)],
    ["a row without an email", () => jsonResponse([{}], 200)],
  ])("answers unknown for %s, and does not throw", async (_case, answer) => {
    const stub = stubMembers(answer);

    const saver = await resolveSaver(client(), ANNA, VIEWER);

    expect(saver).toEqual(UNKNOWN);
    expect(saver).not.toEqual(DELETED);
    // The outcome came from the database's answer — the read did go out, once.
    expect(stub.requests).toHaveLength(1);
  });
});

describe("resolveAuthors: one outcome per author, in the order asked (#1)", () => {
  /** Mixes a deleted account, the viewer, known members, a member without a row and repeats. */
  const AUTHORS = [null, VIEWER, ANNA, NO_ROW, ANNA, BARTEK, null, VIEWER];

  /** The rows of the two known members, in an order unlike the one they are asked in. */
  function knownMembers(): Response {
    return jsonResponse(
      [
        { id: BARTEK, email: BARTEK_EMAIL },
        { id: ANNA, email: ANNA_EMAIL },
      ],
      200,
    );
  }

  it("answers as many outcomes as authors, each at its author's position", async () => {
    stubMembers(knownMembers);

    expect(await resolveAuthors(client(), AUTHORS, VIEWER)).toEqual([
      DELETED,
      SELF,
      { kind: "member", email: ANNA_EMAIL },
      UNKNOWN,
      { kind: "member", email: ANNA_EMAIL },
      { kind: "member", email: BARTEK_EMAIL },
      DELETED,
      SELF,
    ]);
  });

  it("reads every distinct other member in one request — no null, no viewer, no repeat", async () => {
    const stub = stubMembers(knownMembers);

    await resolveAuthors(client(), AUTHORS, VIEWER);

    expect(stub.requests).toHaveLength(1);
    expect(isTableRequest(stub.requests[0], "members", "GET")).toBe(true);
    // Written out by hand: the three other members, each once.
    expect(idsAskedFor(stub.requests[0])).toEqual([ANNA, BARTEK, NO_ROW].sort());
    expect(params(stub.requests[0]).get("select")).toBe("id,email");
  });

  it("names a member for a visitor with no id of their own", async () => {
    stubMembers(knownMembers);
    expect(await resolveAuthors(client(), [ANNA, null], undefined)).toEqual([
      { kind: "member", email: ANNA_EMAIL },
      DELETED,
    ]);
  });

  it.each<[string, (string | null)[], Saver[]]>([
    ["no authors", [], []],
    ["deleted accounts only", [null, null], [DELETED, DELETED]],
    ["the viewer only", [VIEWER], [SELF]],
    ["deleted accounts and the viewer", [null, VIEWER, VIEWER], [DELETED, SELF, SELF]],
  ])("asks the database nothing for %s", async (_case, authors, expected) => {
    const stub = stubFetch(() => undefined);
    expect(await resolveAuthors(client(), authors, VIEWER)).toEqual(expected);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("resolveAuthors: what could not be established is unknown, never deleted (#1)", () => {
  const AUTHORS = [null, VIEWER, ANNA, BARTEK];

  it("control: names both members when the read succeeds", async () => {
    stubMembers(() =>
      jsonResponse(
        [
          { id: ANNA, email: ANNA_EMAIL },
          { id: BARTEK, email: BARTEK_EMAIL },
        ],
        200,
      ),
    );
    expect(await resolveAuthors(client(), AUTHORS, VIEWER)).toEqual([
      DELETED,
      SELF,
      { kind: "member", email: ANNA_EMAIL },
      { kind: "member", email: BARTEK_EMAIL },
    ]);
  });

  it.each<[string, () => Response]>([
    ["a failed read (500)", failedRead],
    ["no members rows (200 [])", () => jsonResponse([], 200)],
    // A 200 the code cannot walk as rows: the exception stays inside the function.
    ["an answer that is not a list of rows", () => jsonResponse({}, 200)],
  ])("answers unknown for every other member on %s; null stays deleted, the viewer self", async (_case, answer) => {
    const stub = stubMembers(answer);

    expect(await resolveAuthors(client(), AUTHORS, VIEWER)).toEqual([DELETED, SELF, UNKNOWN, UNKNOWN]);
    expect(stub.requests).toHaveLength(1);
  });

  it("answers unknown for every other member without a client; null stays deleted, the viewer self", async () => {
    expect(await resolveAuthors(null, AUTHORS, VIEWER)).toEqual([DELETED, SELF, UNKNOWN, UNKNOWN]);
  });

  it.each<[string, unknown]>([
    ["a null email", null],
    ["an empty email", ""],
    ["an email of spaces only", "   "],
  ])("answers unknown for the member whose row has %s, and still names the other", async (_case, email) => {
    stubMembers(() =>
      jsonResponse(
        [
          { id: ANNA, email },
          { id: BARTEK, email: BARTEK_EMAIL },
        ],
        200,
      ),
    );

    expect(await resolveAuthors(client(), AUTHORS, VIEWER)).toEqual([
      DELETED,
      SELF,
      UNKNOWN,
      { kind: "member", email: BARTEK_EMAIL },
    ]);
  });
});

describe("saverName and authorName: what the viewer reads (#1)", () => {
  const MEMBER: Saver = { kind: "member", email: ANNA_EMAIL };

  it("name nobody when the author is unknown", () => {
    expect(saverName(UNKNOWN)).toBeNull();
    expect(authorName(UNKNOWN)).toBeNull();
  });

  // prd.md, Non-Functional Requirements: „osoba z usuniętym kontem”, declined after „przez”, and
  // in the nominative of a note's heading.
  it("sign a deleted account the way the PRD words it", () => {
    expect(saverName(DELETED)).toBe("osobę z usuniętym kontem");
    expect(authorName(DELETED)).toBe("Osoba z usuniętym kontem");
  });

  it("name a member by the email address, unchanged", () => {
    expect(saverName(MEMBER)).toBe("anna@example.test");
    expect(authorName(MEMBER)).toBe("anna@example.test");
  });

  // „Ciebie” and „Ty” are interface copy from the member-notes plan, not a rule of the PRD: these
  // assertions go red when the copy changes, and that is their whole job.
  it("address the viewer directly", () => {
    expect(saverName(SELF)).toBe("Ciebie");
    expect(authorName(SELF)).toBe("Ty");
  });
});
