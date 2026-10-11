import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ArchiveResult,
  ARCHIVE_COLUMNS,
  RECENTLY_ARCHIVED_MS,
  archiveOf,
  isRecentlyArchived,
  loadArchive,
} from "@/lib/offer-archive";
import { createClient } from "@/lib/supabase";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../fixtures/http";

// A configured Supabase client (test values, never a real project's): this mock overrides the
// zero-config one in tests/setup.ts. Only the network is stubbed below — @/lib/supabase,
// @/lib/offer-archive and @/lib/members run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes are written by hand from the sources, never copied from what the functions
// return: the contract of the module in context/changes/archive-and-restore/plan.md (Phase 1),
// prd.md (FR-014: „recently” is seven days, the counter covers every archived offer; and
// Non-Functional Requirements, the deleted account) and the `resolveAuthors` contract in
// src/lib/members.ts.
//
// The two states that must never be confused are "the read failed" and "nothing is archived":
// the second, shown for the first, would say that no flat was hidden from the board. Every
// failure below stands beside the read that succeeds and finds nothing.

afterEach(restoreFetch);

const VIEWER = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const ANNA = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000a1";
const BARTEK = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000b2";

const ANNA_EMAIL = "anna@example.test";
const BARTEK_EMAIL = "bartek@example.test";

/** The clock every case reads, passed in by the test. */
const NOW = new Date("2026-10-11T12:00:00.000Z");

describe("isRecentlyArchived: seven days back, the boundary included (FR-014)", () => {
  it("counts seven days as 168 hours", () => {
    expect(RECENTLY_ARCHIVED_MS).toBe(604_800_000);
  });

  // Written out by hand: 2026-10-11T12:00:00Z minus seven days is 2026-10-04T12:00:00Z.
  it.each<[string, string, boolean]>([
    ["exactly seven days ago", "2026-10-04T12:00:00.000Z", true],
    ["one second more than seven days ago", "2026-10-04T11:59:59.000Z", false],
    ["one second less than seven days ago", "2026-10-04T12:00:01.000Z", true],
    ["a moment ago", "2026-10-11T11:59:59.000Z", true],
    ["at the very moment", "2026-10-11T12:00:00.000Z", true],
    ["a month ago", "2026-09-11T12:00:00.000Z", false],
    ["a date in the future", "2026-10-12T12:00:00.000Z", true],
  ])("answers for an offer archived %s", (_case, archivedAt, expected) => {
    expect(isRecentlyArchived(archivedAt, NOW)).toBe(expected);
  });

  // The same moment as the boundary, as Postgres writes a `timestamptz`.
  it("reads the offset the database writes", () => {
    expect(isRecentlyArchived("2026-10-04T12:00:00+00:00", NOW)).toBe(true);
    expect(isRecentlyArchived("2026-10-04T13:59:59+02:00", NOW)).toBe(false);
  });

  it.each(["", "wczoraj", "not-a-date"])("answers not recent for the unparseable date %j", (archivedAt) => {
    expect(isRecentlyArchived(archivedAt, NOW)).toBe(false);
  });
});

describe("archiveOf: the state comes from the row", () => {
  it("answers null for a live offer, whoever is passed as the archiver", () => {
    expect(archiveOf({ archived_at: null }, { kind: "deleted" })).toBeNull();
    expect(archiveOf({ archived_at: null }, { kind: "self" })).toBeNull();
  });

  it("answers the date and the archiver for an archived offer", () => {
    expect(archiveOf({ archived_at: "2026-10-10T09:30:00+00:00" }, { kind: "member", email: ANNA_EMAIL })).toEqual({
      archivedAt: "2026-10-10T09:30:00+00:00",
      archiver: { kind: "member", email: "anna@example.test" },
    });
  });
});

/** The client the way a request builds it, with no session cookie. */
function client(): NonNullable<ReturnType<typeof createClient>> {
  const supabase = createClient(new Headers(), { set: vi.fn() });
  if (supabase === null) throw new Error("expected a configured Supabase client");
  return supabase;
}

/** "Nothing is archived": a successful read. */
const EMPTY_ARCHIVE: ArchiveResult = { ok: true, offers: [], recent: [] };

/** One archived offer as PostgREST answers it, with the archive's columns. */
function archivedRow(id: string, archivedAt: string, archivedBy: string | null) {
  return {
    id,
    title: `Mieszkanie ${id.slice(-1)}`,
    price: 790000,
    price_currency: "PLN",
    area_m2: 64,
    location_label: "Stary Mokotów, Mokotów, Warszawa, mazowieckie",
    street_name: null,
    images: [],
    created_at: "2026-09-20T10:00:00+00:00",
    archived_at: archivedAt,
    archived_by: archivedBy,
  };
}

const FIRST = "00000000-0000-4000-8000-000000000001";
const SECOND = "00000000-0000-4000-8000-000000000002";
const THIRD = "00000000-0000-4000-8000-000000000003";
const FOURTH = "00000000-0000-4000-8000-000000000004";

// In the order the database answers: most recently archived first. Against NOW, the first two
// are recent, the third stands exactly on the boundary and the fourth is a second past it.
const BY_ANNA_YESTERDAY = archivedRow(FIRST, "2026-10-10T09:30:00+00:00", ANNA);
const BY_VIEWER_THREE_DAYS_AGO = archivedRow(SECOND, "2026-10-08T12:00:00+00:00", VIEWER);
const BY_DELETED_ON_THE_BOUNDARY = archivedRow(THIRD, "2026-10-04T12:00:00+00:00", null);
const BY_BARTEK_PAST_THE_BOUNDARY = archivedRow(FOURTH, "2026-10-04T11:59:59+00:00", BARTEK);

interface Answers {
  offers: () => Response;
  members?: () => Response;
}

/** Answers the archive's read of `offers` and the read of `members`; anything else is unplanned. */
function stubArchive(answers: Answers) {
  return stubFetch((request) => {
    if (isTableRequest(request, "offers", "GET")) return answers.offers();
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

describe("loadArchive: a failed read is its own state, never an empty archive (FR-014)", () => {
  it("control: answers an empty archive for a read that finds nothing, and names nobody", async () => {
    const stub = stubArchive({ offers: noRows });

    expect(await loadArchive(client(), VIEWER, NOW)).toEqual({ ok: true, offers: [], recent: [] });

    expect(requestsTo(stub.requests, "offers")).toHaveLength(1);
    expect(stub.requests).toHaveLength(1);
  });

  it("answers not ok without a client, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const archive = await loadArchive(null, VIEWER, NOW);

    expect(archive).toEqual({ ok: false });
    expect(archive).not.toEqual(EMPTY_ARCHIVE);
    expect(stub.requests).toHaveLength(0);
  });

  it.each<[string, () => Response]>([
    ["the database fails the read (500)", failedRead],
    // A 200 the code cannot walk as rows: the exception stays inside the function.
    ["the body is an object", () => jsonResponse({}, 200)],
    ["the body is null", () => jsonResponse(null, 200)],
    // A 200 whose rows do not read as archived offers.
    ["a row is null", rows(null)],
    ["a row is a text", rows("oferta")],
    ["a row has no id", rows({ ...BY_ANNA_YESTERDAY, id: undefined })],
    ["a row's id is a number", rows({ ...BY_ANNA_YESTERDAY, id: 7 })],
    [
      "a row has no archiving date — a live offer among the archived",
      rows({ ...BY_ANNA_YESTERDAY, archived_at: null }),
    ],
    ["a row's archiving date is a number", rows({ ...BY_ANNA_YESTERDAY, archived_at: 1760000000 })],
    ["a row's archiver is a number", rows({ ...BY_ANNA_YESTERDAY, archived_by: 7 })],
    [
      "one row among readable ones has no archiving date",
      rows(BY_ANNA_YESTERDAY, { id: SECOND }, BY_DELETED_ON_THE_BOUNDARY),
    ],
  ])("answers not ok when %s, does not throw and does not ask for members", async (_case, answer) => {
    const stub = stubArchive({ offers: answer });

    const archive = await loadArchive(client(), VIEWER, NOW);

    expect(archive).toEqual({ ok: false });
    expect(archive).not.toEqual(EMPTY_ARCHIVE);
    // The outcome came from the database's answer — the read did go out, once.
    expect(requestsTo(stub.requests, "offers")).toHaveLength(1);
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });
});

describe("loadArchive: every archived offer, and the recent ones among them (FR-014)", () => {
  function annaAndBartek(): Response {
    return jsonResponse(
      [
        { id: BARTEK, email: BARTEK_EMAIL },
        { id: ANNA, email: ANNA_EMAIL },
      ],
      200,
    );
  }

  const ALL = rows(
    BY_ANNA_YESTERDAY,
    BY_VIEWER_THREE_DAYS_AGO,
    BY_DELETED_ON_THE_BOUNDARY,
    BY_BARTEK_PAST_THE_BOUNDARY,
  );

  it("carries each row with its date and its archiver, in the order answered", async () => {
    stubArchive({ offers: ALL, members: annaAndBartek });

    const archive = await loadArchive(client(), VIEWER, NOW);

    expect(archive).toEqual({
      ok: true,
      offers: [
        {
          offer: BY_ANNA_YESTERDAY,
          archivedAt: "2026-10-10T09:30:00+00:00",
          archiver: { kind: "member", email: "anna@example.test" },
        },
        { offer: BY_VIEWER_THREE_DAYS_AGO, archivedAt: "2026-10-08T12:00:00+00:00", archiver: { kind: "self" } },
        { offer: BY_DELETED_ON_THE_BOUNDARY, archivedAt: "2026-10-04T12:00:00+00:00", archiver: { kind: "deleted" } },
        {
          offer: BY_BARTEK_PAST_THE_BOUNDARY,
          archivedAt: "2026-10-04T11:59:59+00:00",
          archiver: { kind: "member", email: "bartek@example.test" },
        },
      ],
      // Written out by hand: everything but the offer archived a second past seven days.
      recent: [
        {
          offer: BY_ANNA_YESTERDAY,
          archivedAt: "2026-10-10T09:30:00+00:00",
          archiver: { kind: "member", email: "anna@example.test" },
        },
        { offer: BY_VIEWER_THREE_DAYS_AGO, archivedAt: "2026-10-08T12:00:00+00:00", archiver: { kind: "self" } },
        { offer: BY_DELETED_ON_THE_BOUNDARY, archivedAt: "2026-10-04T12:00:00+00:00", archiver: { kind: "deleted" } },
      ],
    });
  });

  it("counts every archived offer while listing none as recent, once all are older than seven days", async () => {
    stubArchive({ offers: ALL, members: annaAndBartek });

    const archive = await loadArchive(client(), VIEWER, new Date("2026-11-11T12:00:00.000Z"));

    expect(archive.ok ? archive.offers.map((entry) => entry.offer.id) : null).toEqual([FIRST, SECOND, THIRD, FOURTH]);
    expect(archive.ok ? archive.recent : null).toEqual([]);
  });

  // The clock is the caller's: the same rows a day later lose the one that stood on the boundary.
  it("judges recent against the clock it is given", async () => {
    stubArchive({ offers: ALL, members: annaAndBartek });

    const archive = await loadArchive(client(), VIEWER, new Date("2026-10-12T12:00:00.000Z"));

    expect(archive.ok ? archive.recent.map((entry) => entry.offer.id) : null).toEqual([FIRST, SECOND]);
  });

  // Written by hand from postgrest-js: `select` with its whitespace stripped, `.not(column, "is",
  // null)` as `not.is.null`, and two `order` calls joined with a comma. The order itself is the
  // database's; what the function owns is asking for it.
  it("asks for the archived offers only, most recently archived first, then by id", async () => {
    const stub = stubArchive({ offers: noRows });

    await loadArchive(client(), VIEWER, NOW);

    const [request] = requestsTo(stub.requests, "offers");
    const params = new URL(request.url).searchParams;
    expect(params.get("archived_at")).toBe("not.is.null");
    expect(params.get("order")).toBe("archived_at.desc,id.asc");
    expect(params.get("select")).toBe(
      "id,title,price,price_currency,area_m2,location_label,street_name,images,created_at,archived_at,archived_by",
    );
  });

  it("selects the board's columns and the two of the archive — no description, no raw", () => {
    expect(ARCHIVE_COLUMNS).toBe(
      "id, title, price, price_currency, area_m2, location_label, street_name, images, created_at, archived_at, archived_by",
    );
  });
});

describe("loadArchive: who archived, from one read of members (FR-014)", () => {
  it("names every other archiver in one request — no null, no viewer, no repeat", async () => {
    const stub = stubArchive({
      offers: rows(
        BY_ANNA_YESTERDAY,
        BY_VIEWER_THREE_DAYS_AGO,
        BY_DELETED_ON_THE_BOUNDARY,
        BY_BARTEK_PAST_THE_BOUNDARY,
        archivedRow("00000000-0000-4000-8000-000000000005", "2026-10-01T08:00:00+00:00", ANNA),
      ),
      members: rows({ id: ANNA, email: ANNA_EMAIL }, { id: BARTEK, email: BARTEK_EMAIL }),
    });

    const archive = await loadArchive(client(), VIEWER, NOW);

    expect(archive.ok ? archive.offers.map((entry) => entry.archiver) : null).toEqual([
      { kind: "member", email: "anna@example.test" },
      { kind: "self" },
      { kind: "deleted" },
      { kind: "member", email: "bartek@example.test" },
      { kind: "member", email: "anna@example.test" },
    ]);
    const members = requestsTo(stub.requests, "members");
    expect(members).toHaveLength(1);
    expect(idsAskedFor(members[0])).toEqual([ANNA, BARTEK].sort());
    expect(stub.requests).toHaveLength(2);
  });

  // A null `archived_by` is "the archiving member's account was deleted" — a fact from the row,
  // which needs no read of `members`; neither does the viewer's own archiving.
  it("reads a null archiver as a deleted account and the viewer as self, with no read of members", async () => {
    const stub = stubArchive({ offers: rows(BY_VIEWER_THREE_DAYS_AGO, BY_DELETED_ON_THE_BOUNDARY) });

    const archive = await loadArchive(client(), VIEWER, NOW);

    expect(archive.ok ? archive.offers.map((entry) => entry.archiver) : null).toEqual([
      { kind: "self" },
      { kind: "deleted" },
    ]);
    expect(requestsTo(stub.requests, "members")).toHaveLength(0);
  });

  it("control: names the archivers when the read of members succeeds", async () => {
    stubArchive({
      offers: rows(BY_ANNA_YESTERDAY, BY_DELETED_ON_THE_BOUNDARY),
      members: rows({ id: ANNA, email: ANNA_EMAIL }),
    });

    const archive = await loadArchive(client(), VIEWER, NOW);

    expect(archive.ok ? archive.offers.map((entry) => entry.archiver) : null).toEqual([
      { kind: "member", email: "anna@example.test" },
      { kind: "deleted" },
    ]);
  });

  it.each<[string, () => Response]>([
    ["fails (500)", failedRead],
    ["finds no rows (200 [])", noRows],
    ["answers something that is not a list of rows", () => jsonResponse({}, 200)],
  ])(
    "keeps the archive read when the read of members %s: archivers unknown — never deleted",
    async (_case, members) => {
      const stub = stubArchive({ offers: rows(BY_ANNA_YESTERDAY, BY_DELETED_ON_THE_BOUNDARY), members });

      const archive = await loadArchive(client(), VIEWER, NOW);

      expect(archive).toEqual({
        ok: true,
        offers: [
          { offer: BY_ANNA_YESTERDAY, archivedAt: "2026-10-10T09:30:00+00:00", archiver: { kind: "unknown" } },
          { offer: BY_DELETED_ON_THE_BOUNDARY, archivedAt: "2026-10-04T12:00:00+00:00", archiver: { kind: "deleted" } },
        ],
        recent: [
          { offer: BY_ANNA_YESTERDAY, archivedAt: "2026-10-10T09:30:00+00:00", archiver: { kind: "unknown" } },
          { offer: BY_DELETED_ON_THE_BOUNDARY, archivedAt: "2026-10-04T12:00:00+00:00", archiver: { kind: "deleted" } },
        ],
      });
      expect(requestsTo(stub.requests, "members")).toHaveLength(1);
    },
  );
});
