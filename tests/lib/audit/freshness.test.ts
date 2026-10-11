import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type AuditFreshness,
  type CurrentComparison,
  type StoredComparison,
  auditFreshness,
  currentListingFingerprint,
} from "@/lib/audit/freshness";
import { auditOfferRow } from "../../fixtures/audit";

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
