import { describe, expect, it } from "vitest";
import { COMMUTE_OFFER_COLUMNS, commuteOrigin, readCommuteOffer, type CommuteOffer } from "@/lib/commute/origin";

// Expected values are written by hand from context/changes/commute-times/plan.md („Route start”:
// both coordinates finite → coordinates; else a non-blank label, with the street when stated → an
// address; else none — and `numeric` columns may arrive from PostgREST as text) and from
// src/lib/map-link.ts, whose order — street, then label — the address follows.

const ID = "0b9f0c2e-7d1a-4c55-9a53-0000000000c1";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    archived_at: null,
    latitude: null,
    longitude: null,
    location_label: null,
    street_name: null,
    ...overrides,
  };
}

function originOf(overrides: Record<string, unknown>) {
  const offer = readCommuteOffer(row(overrides));
  if (offer === null) throw new Error("expected the row to read");
  return commuteOrigin(offer);
}

describe("COMMUTE_OFFER_COLUMNS", () => {
  it("names the six columns a calculation reads, and nothing of the listing's text", () => {
    expect(COMMUTE_OFFER_COLUMNS).toEqual([
      "id",
      "archived_at",
      "latitude",
      "longitude",
      "location_label",
      "street_name",
    ]);
  });
});

describe("commuteOrigin (FR-016)", () => {
  it("starts from the coordinates when both are numbers", () => {
    expect(originOf({ latitude: 52.2297, longitude: 21.0122, location_label: "Mokotów, Warszawa" })).toEqual({
      kind: "coordinates",
      latitude: 52.2297,
      longitude: 21.0122,
    });
  });

  it("reads coordinates PostgREST sends as text", () => {
    expect(originOf({ latitude: "52.2297", longitude: "21.0122" })).toEqual({
      kind: "coordinates",
      latitude: 52.2297,
      longitude: 21.0122,
    });
  });

  it("keeps 0 as a coordinate: the mapper already stores otodom's placeholder 0 as null", () => {
    expect(originOf({ latitude: 0, longitude: "0" })).toEqual({ kind: "coordinates", latitude: 0, longitude: 0 });
  });

  it.each([
    ["one coordinate missing", { latitude: 52.2, longitude: null }],
    ["a coordinate that is not a number", { latitude: "abc", longitude: 21 }],
    ["a blank coordinate", { latitude: " ", longitude: 21 }],
    ["`NaN`, which `numeric` can hold", { latitude: "NaN", longitude: 21 }],
    ["a latitude out of range", { latitude: 91, longitude: 21 }],
    ["a longitude out of range", { latitude: 52, longitude: "-181" }],
  ])("falls back to the address with %s", (_what, coordinates) => {
    expect(originOf({ ...coordinates, location_label: "Mokotów, Warszawa" })).toEqual({
      kind: "address",
      address: "Mokotów, Warszawa",
    });
  });

  it("starts from the label alone when no street is stated", () => {
    expect(originOf({ location_label: "  Mokotów, Warszawa " })).toEqual({
      kind: "address",
      address: "Mokotów, Warszawa",
    });
  });

  it("puts the street in front of the label when stated", () => {
    expect(originOf({ location_label: "Mokotów, Warszawa", street_name: "ul. Puławska" })).toEqual({
      kind: "address",
      address: "ul. Puławska, Mokotów, Warszawa",
    });
  });

  it("ignores a blank street", () => {
    expect(originOf({ location_label: "Mokotów, Warszawa", street_name: "   " })).toEqual({
      kind: "address",
      address: "Mokotów, Warszawa",
    });
  });

  it("has no start with a blank label, even with a street: a street alone names no place", () => {
    expect(originOf({ location_label: "  ", street_name: "ul. Puławska" })).toBeNull();
  });

  it("has no start with nothing stated", () => {
    expect(originOf({})).toBeNull();
  });
});

describe("readCommuteOffer", () => {
  it("reads a live offer", () => {
    const expected: CommuteOffer = {
      id: ID,
      archivedAt: null,
      latitude: 52.1,
      longitude: 21.2,
      locationLabel: "Wola, Warszawa",
      streetName: null,
    };
    expect(readCommuteOffer(row({ latitude: 52.1, longitude: "21.2", location_label: "Wola, Warszawa" }))).toEqual(
      expected,
    );
  });

  it("reads an archived offer's date", () => {
    expect(readCommuteOffer(row({ archived_at: "2026-10-20T10:00:00+00:00" }))?.archivedAt).toBe(
      "2026-10-20T10:00:00+00:00",
    );
  });

  it.each([
    ["not an object", null],
    ["an array", [row()]],
    ["no id", row({ id: undefined })],
    ["an id that is not text", row({ id: 7 })],
    ["an `archived_at` that is neither text nor null", row({ archived_at: true })],
  ])("does not read a row that is %s", (_what, value) => {
    expect(readCommuteOffer(value)).toBeNull();
  });
});
