import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuditFreshness,
  type BoardFreshness,
  type CurrentComparison,
  type StoredComparison,
  auditFreshness,
  currentListingFingerprint,
  loadBoardFreshness,
} from "@/lib/audit/freshness";
import { AUDIT_OFFER_COLUMNS } from "@/lib/audit/input";
import type { AuditIndex } from "@/lib/audit/store";
import { createClient } from "@/lib/supabase";
import { auditOfferRow } from "../../fixtures/audit";
import { type RecordedRequest, isOffersRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// A configured Supabase client (test values, never a real project's) for `loadBoardFreshness`:
// this mock overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase and @/lib/audit/* run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

afterEach(restoreFetch);

// Expected values are written by hand from the freshness table in
// context/changes/refetch-and-stale-audit/plan.md („Desired End State": nine rows) and the Phase 1
// contract beside it (a fingerprint's version is the text before its first colon; no colon or an
// empty version cannot be compared; the reasons always come as `listing`, `criteria`) — never
// copied from what the function returns. Every answer that is not `fresh` stands beside the
// `fresh` one: alone, it would pass on a function that never answers `fresh`, and the `unknown`
// rows would pass on one that never compares.

/** Two fingerprints of the version the audit writes today, of two different listings. */
const AS_AUDITED = `v1:${"ab".repeat(32)}`;
const CHANGED = `v1:${"cd".repeat(32)}`;
/** A fingerprint of a later version: taken from something else, so it says nothing about a `v1` one. */
const NEXT_VERSION = `v2:${"ab".repeat(32)}`;

/** The audit was made against revision 7 and the listing as `AS_AUDITED`, unless a case says otherwise. */
function stored(overrides: Partial<StoredComparison> = {}): StoredComparison {
  return { criteriaRevision: 7, listingFingerprint: AS_AUDITED, ...overrides };
}

/** Nothing changed since, unless a case says otherwise. */
function current(overrides: Partial<CurrentComparison> = {}): CurrentComparison {
  return { criteriaRevision: 7, listingFingerprint: AS_AUDITED, ...overrides };
}

const FRESH: AuditFreshness = { state: "fresh" };
const UNKNOWN: AuditFreshness = { state: "unknown" };

describe("auditFreshness: the nine rows of the table (FR-003, FR-009)", () => {
  it("row 1: same version and equal, revision equal — fresh", () => {
    expect(auditFreshness(stored(), current())).toEqual({ state: "fresh" });
  });

  it("row 2: same version and different, revision equal — stale, the listing", () => {
    expect(auditFreshness(stored(), current({ listingFingerprint: CHANGED }))).toEqual({
      state: "stale",
      reasons: ["listing"],
    });
  });

  it("row 3: same version and equal, revision different — stale, the criteria", () => {
    expect(auditFreshness(stored(), current({ criteriaRevision: 8 }))).toEqual({
      state: "stale",
      reasons: ["criteria"],
    });
  });

  it("row 4: same version and different, revision different — stale, the listing and the criteria", () => {
    expect(auditFreshness(stored(), current({ listingFingerprint: CHANGED, criteriaRevision: 8 }))).toEqual({
      state: "stale",
      reasons: ["listing", "criteria"],
    });
  });

  it.each<[string, Partial<StoredComparison>, Partial<CurrentComparison>]>([
    ["the stored fingerprint is of another version", { listingFingerprint: NEXT_VERSION }, {}],
    ["the current fingerprint is of another version", {}, { listingFingerprint: NEXT_VERSION }],
    ["the stored fingerprint does not read", { listingFingerprint: null }, {}],
    ["the current fingerprint does not read", {}, { listingFingerprint: null }],
  ])("row 5: %s, revision different — stale, the criteria alone", (_case, was, now) => {
    expect(auditFreshness(stored(was), current({ ...now, criteriaRevision: 8 }))).toEqual({
      state: "stale",
      reasons: ["criteria"],
    });
  });

  it.each<[string, Partial<StoredComparison>, Partial<CurrentComparison>]>([
    ["the stored revision does not read", { criteriaRevision: null }, {}],
    ["the current revision could not be read", {}, { criteriaRevision: null }],
    ["neither revision reads", { criteriaRevision: null }, { criteriaRevision: null }],
  ])("row 6: same version and different, %s — stale, the listing alone", (_case, was, now) => {
    expect(auditFreshness(stored(was), current({ ...now, listingFingerprint: CHANGED }))).toEqual({
      state: "stale",
      reasons: ["listing"],
    });
  });

  it.each<[string, Partial<StoredComparison>, Partial<CurrentComparison>]>([
    ["the stored fingerprint is of another version", { listingFingerprint: NEXT_VERSION }, {}],
    ["the current fingerprint is of another version", {}, { listingFingerprint: NEXT_VERSION }],
    ["the stored fingerprint does not read", { listingFingerprint: null }, {}],
    ["the current fingerprint does not read", {}, { listingFingerprint: null }],
    ["neither fingerprint reads", { listingFingerprint: null }, { listingFingerprint: null }],
  ])("row 7: %s, revision equal — unknown, never fresh", (_case, was, now) => {
    const freshness = auditFreshness(stored(was), current(now));

    expect(freshness).toEqual({ state: "unknown" });
    expect(freshness).not.toEqual(FRESH);
  });

  it.each<[string, Partial<StoredComparison>, Partial<CurrentComparison>]>([
    ["the stored revision does not read", { criteriaRevision: null }, {}],
    ["the current revision could not be read", {}, { criteriaRevision: null }],
    // Two values that do not read are not two equal values.
    ["neither revision reads", { criteriaRevision: null }, { criteriaRevision: null }],
  ])("row 8: same version and equal, %s — unknown, never fresh", (_case, was, now) => {
    const freshness = auditFreshness(stored(was), current(now));

    expect(freshness).toEqual({ state: "unknown" });
    expect(freshness).not.toEqual(FRESH);
  });

  it.each<[string, StoredComparison, CurrentComparison]>([
    [
      "another version and a stored revision that does not read",
      stored({ listingFingerprint: NEXT_VERSION, criteriaRevision: null }),
      current(),
    ],
    [
      "a current fingerprint that does not read and a failed read of the revision",
      stored(),
      current({ listingFingerprint: null, criteriaRevision: null }),
    ],
    [
      "nothing that reads on either side",
      { criteriaRevision: null, listingFingerprint: null },
      { criteriaRevision: null, listingFingerprint: null },
    ],
  ])("row 9: %s — unknown", (_case, was, now) => {
    expect(auditFreshness(was, now)).toEqual({ state: "unknown" });
  });
});

describe("auditFreshness: the criteria revision is compared as a number (FR-003)", () => {
  // Revision 0 is the counter's start, a value like any other — never "no revision".
  it("reads revision 0 on both sides as equal", () => {
    expect(auditFreshness(stored({ criteriaRevision: 0 }), current({ criteriaRevision: 0 }))).toEqual({
      state: "fresh",
    });
  });

  it.each<[number, number]>([
    [0, 1],
    [1, 0],
    [7, 6],
    [7, 70],
  ])("reads a stored revision %d against a current %d as changed criteria", (was, now) => {
    expect(auditFreshness(stored({ criteriaRevision: was }), current({ criteriaRevision: now }))).toEqual({
      state: "stale",
      reasons: ["criteria"],
    });
  });

  it("reads revision 0 against a failed read as unknown, never as equal", () => {
    expect(auditFreshness(stored({ criteriaRevision: 0 }), current({ criteriaRevision: null }))).toEqual(UNKNOWN);
    expect(auditFreshness(stored({ criteriaRevision: null }), current({ criteriaRevision: 0 }))).toEqual(UNKNOWN);
  });
});

describe("auditFreshness: a fingerprint's version is the text before its first colon (FR-009)", () => {
  // No colon, or nothing before it: no version, so nothing to compare — even with itself.
  it.each<[string, string]>([
    ["has no colon", "ab".repeat(32)],
    ["starts with its colon", `:${"ab".repeat(32)}`],
    ["is a colon alone", ":"],
    ["is a version without its colon", "v1"],
  ])("answers unknown when the same fingerprint on both sides %s", (_case, fingerprint) => {
    const freshness = auditFreshness(
      stored({ listingFingerprint: fingerprint }),
      current({ listingFingerprint: fingerprint }),
    );

    expect(freshness).toEqual({ state: "unknown" });
    expect(freshness).not.toEqual(FRESH);
  });

  it.each<[string, string]>([
    ["has no colon", "cd".repeat(32)],
    ["starts with its colon", `:${"cd".repeat(32)}`],
    ["is a version without its colon", "v1"],
  ])("gives no listing reason when the current fingerprint %s", (_case, fingerprint) => {
    expect(auditFreshness(stored(), current({ listingFingerprint: fingerprint }))).toEqual({ state: "unknown" });
    expect(auditFreshness(stored(), current({ listingFingerprint: fingerprint, criteriaRevision: 8 }))).toEqual({
      state: "stale",
      reasons: ["criteria"],
    });
  });

  it.each<[string, string]>([
    ["has no colon", "cd".repeat(32)],
    ["starts with its colon", `:${"cd".repeat(32)}`],
  ])("gives no listing reason when the stored fingerprint %s", (_case, fingerprint) => {
    expect(auditFreshness(stored({ listingFingerprint: fingerprint }), current())).toEqual({ state: "unknown" });
  });

  it("control: the same two digests under one version are a changed listing", () => {
    expect(auditFreshness(stored(), current({ listingFingerprint: `v1:${"cd".repeat(32)}` }))).toEqual({
      state: "stale",
      reasons: ["listing"],
    });
  });

  // The same digest under two versions is not "equal": the versions hash different things.
  it("does not compare the digests of two versions, equal or not", () => {
    expect(auditFreshness(stored(), current({ listingFingerprint: `v2:${"ab".repeat(32)}` }))).toEqual(UNKNOWN);
    expect(auditFreshness(stored(), current({ listingFingerprint: `v2:${"cd".repeat(32)}` }))).toEqual(UNKNOWN);
  });

  // The version ends at the first colon, not the last: `v1:a:b` and `v1:c` share the version `v1`.
  it("reads the version up to the first colon when the rest holds another", () => {
    expect(auditFreshness(stored({ listingFingerprint: "v1:a:b" }), current({ listingFingerprint: "v1:c" }))).toEqual({
      state: "stale",
      reasons: ["listing"],
    });
    expect(auditFreshness(stored({ listingFingerprint: "v1:a:b" }), current({ listingFingerprint: "v1:a:b" }))).toEqual(
      { state: "fresh" },
    );
  });

  // A version is the whole text before the colon: `v1` is not `v10`, and not `V1`.
  it.each<[string, string]>([
    ["v1:abc", "v10:abc"],
    ["v10:abc", "v1:abc"],
    ["v1:abc", "V1:abc"],
  ])("reads %j and %j as two versions", (was, now) => {
    expect(auditFreshness(stored({ listingFingerprint: was }), current({ listingFingerprint: now }))).toEqual(UNKNOWN);
  });
});

describe("auditFreshness: the team's audit settings are not an input (FR-010)", () => {
  // Written out by hand: the two things an audit is compared by, and nothing about the model or
  // the effort. A change of the settings therefore has no way to make an audit stale.
  it("takes the criteria revision and the listing fingerprint, and nothing else", () => {
    expect(Object.keys(stored()).sort()).toEqual(["criteriaRevision", "listingFingerprint"]);
    expect(Object.keys(current()).sort()).toEqual(["criteriaRevision", "listingFingerprint"]);
  });

  it("answers the same for an audit whose record carries another model and effort", () => {
    const withSettings = { ...stored(), model: "claude-sonnet-5-5", effort: "low" };
    const nowWithSettings = { ...current(), model: "claude-opus-5-5", effort: "high" };

    expect(auditFreshness(withSettings, nowWithSettings)).toEqual({ state: "fresh" });
    expect(auditFreshness(withSettings, { ...nowWithSettings, criteriaRevision: 8 })).toEqual({
      state: "stale",
      reasons: ["criteria"],
    });
  });
});

describe("currentListingFingerprint: the fingerprint of an offer's row as it stands (FR-009)", () => {
  /** A row small enough for the JSON it is hashed from to be written out by hand. */
  const SMALL_ROW = {
    id: "0b9f0c2e-7d1a-4c55-9a53-0000000000f1",
    source_url: "https://www.otodom.pl/pl/oferta/kawalerka-ID1",
    title: "Kawalerka przy parku",
    description: "Opis z balkonem.",
    price: "300000",
    price_currency: "PLN",
    price_per_m: null,
    area_m2: 27.5,
    rooms: 1,
    floors_total: null,
    build_year: null,
    rent: null,
    rent_currency: null,
    floor: "ground_floor",
    market: null,
    building_type: null,
    construction_status: null,
    building_ownership: null,
    heating: null,
    windows_type: null,
    building_material: null,
    energy_certificate: null,
    advert_type: null,
    free_from: null,
    location_label: null,
    street_name: null,
    features: ["balcony"],
  };

  // The whitelisted columns in the whitelist's order, the price as the number its text reads as.
  const SMALL_JSON =
    '{"title":"Kawalerka przy parku","description":"Opis z balkonem.","price":300000,"price_currency":"PLN",' +
    '"price_per_m":null,"area_m2":27.5,"rooms":1,"floors_total":null,"build_year":null,"rent":null,' +
    '"rent_currency":null,"floor":"ground_floor","market":null,"building_type":null,"construction_status":null,' +
    '"building_ownership":null,"heating":null,"windows_type":null,"building_material":null,' +
    '"energy_certificate":null,"advert_type":null,"free_from":null,"location_label":null,"street_name":null,' +
    '"features":["balcony"]}';

  it("is v1: and the SHA-256 of the row's whitelisted columns, as the audit route takes it", async () => {
    const expected = `v1:${createHash("sha256").update(SMALL_JSON, "utf8").digest("hex")}`;

    expect(await currentListingFingerprint(SMALL_ROW)).toBe(expected);
  });

  it("changes with the listing's words and not with what the audit never reads", async () => {
    const fingerprint = await currentListingFingerprint(auditOfferRow());

    expect(fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(await currentListingFingerprint(auditOfferRow({ title: "Inny tytuł" }))).not.toBe(fingerprint);
    expect(
      await currentListingFingerprint(auditOfferRow({ images: [], fetched_at: "2026-10-10T08:00:00+00:00" })),
    ).toBe(fingerprint);
  });

  // A row that does not read has no fingerprint — never the fingerprint of an empty listing.
  it.each<[string, unknown]>([
    ["null", null],
    ["a text", "v1:abc"],
    ["an empty object", {}],
    ["a row with a blank title", auditOfferRow({ title: "  " })],
    ["a row without its description", auditOfferRow({ description: null })],
    ["a row whose price is zero", auditOfferRow({ price: 0 })],
    ["a row whose amenities are not a list", auditOfferRow({ features: null })],
  ])("answers null for %s", async (_case, row) => {
    expect(await currentListingFingerprint(row)).toBeNull();
  });

  it("control: answers a fingerprint for the same row once it reads", async () => {
    expect(await currentListingFingerprint(auditOfferRow({ price: 599000 }))).not.toBeNull();
  });
});

// The board's read (context/changes/refetch-and-stale-audit/plan.md, Phase 4): one query for the
// audit's columns of the offers the index holds, the fingerprint of each, and the rule above with
// the revision the page passes. What it must never be confused with is "every audit is up to
// date": a failed read is its own answer, and every failure below stands beside the read that
// succeeds. Expected values are written by hand from that contract and the nine-row table.
describe("loadBoardFreshness: the freshness of every audited offer, from one read (FR-003, FR-009)", () => {
  const FIRST = "0b9f0c2e-7d1a-4c55-9a53-0000000000f1";
  const SECOND = "0b9f0c2e-7d1a-4c55-9a53-0000000000f2";
  const THIRD = "0b9f0c2e-7d1a-4c55-9a53-0000000000f3";
  const NOT_AUDITED = "0b9f0c2e-7d1a-4c55-9a53-0000000000f9";

  /** Three offers' rows as the database answers them now. The second differs from the first in its title. */
  const FIRST_ROW = auditOfferRow({ id: FIRST });
  const SECOND_ROW = auditOfferRow({ id: SECOND, title: "Kawalerka przy parku" });
  const THIRD_ROW = auditOfferRow({ id: THIRD, price: 610000 });

  /** The client the way a request builds it, with no session cookie. */
  function client(): NonNullable<ReturnType<typeof createClient>> {
    const supabase = createClient(new Headers(), { set: vi.fn() });
    if (supabase === null) throw new Error("expected a configured Supabase client");
    return supabase;
  }

  /** Answers the one read of `offers`; any other request is unplanned and fails the test. */
  function stubOffers(answer: () => Response) {
    return stubFetch((request) => (isOffersRequest(request, "GET") ? answer() : undefined));
  }

  function rows(...list: unknown[]): () => Response {
    return () => jsonResponse(list, 200);
  }

  function failedRead(): Response {
    return jsonResponse({ code: "XX000", message: "internal error", details: null, hint: null }, 500);
  }

  /** The fingerprint of a row as it stands, taken the way the audit route takes it. */
  async function fingerprintOf(row: unknown): Promise<string> {
    const fingerprint = await currentListingFingerprint(row);
    if (fingerprint === null) throw new Error("expected a row that reads");
    return fingerprint;
  }

  /** An index in which each offer was audited under revision 7 against the given row. */
  async function indexOf(entries: [string, unknown][]): Promise<AuditIndex> {
    const audited = new Map<string, { criteriaRevision: number | null; listingFingerprint: string | null }>();
    for (const [id, row] of entries) {
      audited.set(id, { criteriaRevision: 7, listingFingerprint: await fingerprintOf(row) });
    }
    return { ok: true, audited };
  }

  /** The ids the read filters by, from `id=in.(a,b,…)`, sorted. */
  function idsAskedFor(request: RecordedRequest): string[] {
    const filter = new URL(request.url).searchParams.get("id") ?? "";
    const list = /^in\.\((.*)\)$/.exec(filter)?.[1];
    if (list === undefined) throw new Error(`expected an in.(…) filter on id, got "${filter}"`);
    return list.split(",").sort();
  }

  function entries(freshness: BoardFreshness): [string, AuditFreshness][] {
    if (!freshness.ok) throw new Error("expected a read that succeeded");
    return [...freshness.byOffer.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  /** "Every audited offer is up to date": the answer a failed read must never be taken for. */
  const ALL_FRESH: BoardFreshness = { ok: true, byOffer: new Map([[FIRST, { state: "fresh" }]]) };

  it("control: answers fresh for an offer whose row and revision stand as audited, with one read", async () => {
    const stub = stubOffers(rows(FIRST_ROW));

    const freshness = await loadBoardFreshness(client(), await indexOf([[FIRST, FIRST_ROW]]), 7);

    expect(freshness).toEqual({ ok: true, byOffer: new Map([[FIRST, { state: "fresh" }]]) });
    expect(stub.requests).toHaveLength(1);
  });

  it("answers each offer by its own row: fresh, a changed listing, and both changed", async () => {
    // Audited against the rows as they were; the second and the third have changed since.
    const index = await indexOf([
      [FIRST, FIRST_ROW],
      [SECOND, auditOfferRow({ id: SECOND })],
      [THIRD, auditOfferRow({ id: THIRD })],
    ]);
    if (!index.ok) throw new Error("expected an index");
    // The third was audited under an earlier revision as well.
    const audited = new Map(index.audited);
    audited.set(THIRD, { criteriaRevision: 6, listingFingerprint: await fingerprintOf(auditOfferRow({ id: THIRD })) });
    // The answer comes in an order of its own.
    const stub = stubOffers(rows(THIRD_ROW, FIRST_ROW, SECOND_ROW));

    const freshness = await loadBoardFreshness(client(), { ok: true, audited }, 7);

    expect(entries(freshness)).toEqual([
      [FIRST, { state: "fresh" }],
      [SECOND, { state: "stale", reasons: ["listing"] }],
      [THIRD, { state: "stale", reasons: ["listing", "criteria"] }],
    ]);
    expect(stub.requests).toHaveLength(1);
  });

  it("answers stale by the criteria when the revision the page passed has moved", async () => {
    stubOffers(rows(FIRST_ROW));

    expect(await loadBoardFreshness(client(), await indexOf([[FIRST, FIRST_ROW]]), 8)).toEqual({
      ok: true,
      byOffer: new Map([[FIRST, { state: "stale", reasons: ["criteria"] }]]),
    });
  });

  // A failed read of the revision goes in as null: the rule decides, and never reads it as unchanged.
  it("answers unknown for an unchanged listing when the revision could not be read, and stale for a changed one", async () => {
    stubOffers(rows(FIRST_ROW, SECOND_ROW));
    const index = await indexOf([
      [FIRST, FIRST_ROW],
      [SECOND, auditOfferRow({ id: SECOND })],
    ]);

    const freshness = await loadBoardFreshness(client(), index, null);

    expect(entries(freshness)).toEqual([
      [FIRST, { state: "unknown" }],
      [SECOND, { state: "stale", reasons: ["listing"] }],
    ]);
  });

  // The offer's row is there and does not read: its listing cannot be compared, the read still succeeded.
  it("answers unknown for an offer whose row does not read, and fails nothing beside it", async () => {
    stubOffers(rows(FIRST_ROW, auditOfferRow({ id: SECOND, price: 0 })));
    const index = await indexOf([
      [FIRST, FIRST_ROW],
      [SECOND, auditOfferRow({ id: SECOND })],
    ]);

    expect(entries(await loadBoardFreshness(client(), index, 7))).toEqual([
      [FIRST, { state: "fresh" }],
      [SECOND, { state: "unknown" }],
    ]);
    // With a moved revision the same row is stale by the criteria alone.
    stubOffers(rows(FIRST_ROW, auditOfferRow({ id: SECOND, price: 0 })));
    expect(entries(await loadBoardFreshness(client(), index, 8))).toEqual([
      [FIRST, { state: "stale", reasons: ["criteria"] }],
      [SECOND, { state: "stale", reasons: ["criteria"] }],
    ]);
  });

  it("answers unknown for an offer whose stored comparison values did not read", async () => {
    stubOffers(rows(FIRST_ROW));
    const index: AuditIndex = {
      ok: true,
      audited: new Map([[FIRST, { criteriaRevision: null, listingFingerprint: null }]]),
    };

    expect(await loadBoardFreshness(client(), index, 7)).toEqual({
      ok: true,
      byOffer: new Map([[FIRST, { state: "unknown" }]]),
    });
  });

  it("gives no entry to an audited offer the answer does not hold, nor to a row nobody asked for", async () => {
    stubOffers(rows(FIRST_ROW, auditOfferRow({ id: NOT_AUDITED })));
    const index = await indexOf([
      [FIRST, FIRST_ROW],
      [SECOND, SECOND_ROW],
    ]);

    expect(entries(await loadBoardFreshness(client(), index, 7))).toEqual([[FIRST, { state: "fresh" }]]);
  });

  // Written by hand from postgrest-js: `select` with its whitespace stripped, and `in` as a list.
  it("asks once for the id and the audit's columns of the offers in the index, and for nothing else", async () => {
    const stub = stubOffers(rows(FIRST_ROW, SECOND_ROW));

    await loadBoardFreshness(
      client(),
      await indexOf([
        [FIRST, FIRST_ROW],
        [SECOND, SECOND_ROW],
      ]),
      7,
    );

    expect(stub.requests).toHaveLength(1);
    const params = new URL(stub.requests[0].url).searchParams;
    expect(params.get("select")).toBe(
      "id,title,description,price,price_currency,price_per_m,area_m2,rooms,floors_total,build_year,rent," +
        "rent_currency,floor,market,building_type,construction_status,building_ownership,heating,windows_type," +
        "building_material,energy_certificate,advert_type,free_from,location_label,street_name,features",
    );
    // Control: that list is the audit's whitelist behind the key — no `raw`, no `images`, no `source_url`.
    expect(params.get("select")).toBe(["id", ...AUDIT_OFFER_COLUMNS].join(","));
    expect(idsAskedFor(stub.requests[0])).toEqual([FIRST, SECOND]);
  });

  it("sends no request for an index that holds no offer, and answers an empty map", async () => {
    const stub = stubFetch(() => undefined);

    const freshness = await loadBoardFreshness(client(), { ok: true, audited: new Map() }, 7);

    expect(freshness).toEqual({ ok: true, byOffer: new Map() });
    expect(stub.requests).toHaveLength(0);
  });

  it("sends no request for an index that could not be read, and answers not ok", async () => {
    const stub = stubFetch(() => undefined);

    const freshness = await loadBoardFreshness(client(), { ok: false }, 7);

    expect(freshness).toEqual({ ok: false });
    expect(stub.requests).toHaveLength(0);
  });

  it("answers not ok without a client for an index that holds an offer, and asks the database nothing", async () => {
    const stub = stubFetch(() => undefined);

    const freshness = await loadBoardFreshness(null, await indexOf([[FIRST, FIRST_ROW]]), 7);

    expect(freshness).toEqual({ ok: false });
    expect(freshness).not.toEqual(ALL_FRESH);
    expect(stub.requests).toHaveLength(0);
  });

  it.each<[string, () => Response]>([
    ["the database fails the read (500)", failedRead],
    ["the body is an object", () => jsonResponse({}, 200)],
    ["the body is null", () => jsonResponse(null, 200)],
    ["the list holds something that is not a row", rows(FIRST_ROW, null)],
    ["the list holds a text", rows(FIRST_ROW, FIRST)],
    ["a row has no id", rows(FIRST_ROW, auditOfferRow({ id: undefined }))],
    ["a row's id is a number", rows(FIRST_ROW, auditOfferRow({ id: 7 }))],
    ["a row's id is empty", rows(FIRST_ROW, auditOfferRow({ id: "" }))],
  ])("answers not ok when %s, and does not throw", async (_case, answer) => {
    const stub = stubOffers(answer);

    const freshness = await loadBoardFreshness(client(), await indexOf([[FIRST, FIRST_ROW]]), 7);

    expect(freshness).toEqual({ ok: false });
    expect(freshness).not.toEqual(ALL_FRESH);
    // The outcome came from the database's answer — the read did go out, once, and is not repeated.
    expect(stub.requests).toHaveLength(1);
  });
});
