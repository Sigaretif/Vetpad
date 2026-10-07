import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AUDIT_OFFER_COLUMNS,
  type AuditCriteria,
  type AuditOffer,
  DECISION_CRITICAL,
  DECISION_CRITICAL_ATTRIBUTES,
  buildAuditInput,
  criticalParameterLabel,
  listingFingerprint,
  readAuditOffer,
} from "@/lib/audit/input";
import {
  ANNA_REQUIREMENTS,
  AUDIT_DESCRIPTION,
  AUDIT_TITLE,
  BARTEK_REQUIREMENTS,
  FORBIDDEN_IN_AUDIT,
  TYPED_NAME,
  TYPED_PHONE,
  auditCriteria,
  auditOfferRow,
} from "../../fixtures/audit";

// Expected values are written by hand from the sources, never copied from what the functions
// return: the Phase 3 contract in context/changes/grounded-listing-audit/plan.md (the whitelist,
// the nine attributes and their columns, `W1…Wn`, the fingerprint), prd.md (Guardrails: missing
// data reads "unknown", never zero; Non-Functional Requirements: only the listing's text and the
// team's criteria may leave the system, and the listing's own words are never redacted), the
// labels of the offer card (src/components/offers/OfferParameters.astro) and CLAUDE.md, Secrets
// and data access. Amounts carry the no-break spaces (U+00A0) pl-PL formatting puts in them.

function offerFrom(row: unknown): AuditOffer {
  const offer = readAuditOffer(row);
  if (offer === null) throw new Error("expected a readable offer, got a refusal");
  return offer;
}

/** The fixture offer with every fact stated. */
function statedOffer(overrides: Record<string, unknown> = {}): AuditOffer {
  return offerFrom(auditOfferRow(overrides));
}

/** Every fact the listing may omit, omitted. */
const NOTHING_STATED = {
  price: null,
  price_currency: null,
  price_per_m: null,
  area_m2: null,
  rooms: null,
  floors_total: null,
  build_year: null,
  rent: null,
  rent_currency: null,
  floor: null,
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
  features: [],
};

const NO_CRITERIA: AuditCriteria = {
  limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
  requirements: [],
};

describe("readAuditOffer: the audit reads the whitelisted columns and nothing else (#6)", () => {
  it("keeps exactly the listing's words, its stated facts and its amenities", () => {
    expect(readAuditOffer(auditOfferRow())).toEqual({
      title: "Mieszkanie 3 pokoje z balkonem, Praga-Południe",
      description: AUDIT_DESCRIPTION,
      price: 599000,
      price_currency: "PLN",
      price_per_m: 10990.83,
      area_m2: 54.5,
      rooms: 3,
      floors_total: 10,
      build_year: 1975,
      rent: 650,
      rent_currency: "PLN",
      floor: "floor_7",
      market: "secondary",
      building_type: "block",
      construction_status: "ready_to_use",
      building_ownership: "full_ownership",
      heating: "urban",
      windows_type: "plastic",
      building_material: "concrete_plate",
      energy_certificate: "C",
      advert_type: "PRIVATE",
      free_from: "2026-11-01",
      location_label: "Praga-Południe, Warszawa, mazowieckie",
      street_name: "ul. Kanarkowa",
      features: ["balcony", "lift", "piwnica"],
    });
  });

  // Written out by hand: no id, no source_url, no created_by, no images, no raw, no coordinates.
  it("names the whitelist: twenty-five columns, none of them identity, provenance, images or raw", () => {
    expect([...AUDIT_OFFER_COLUMNS]).toEqual([
      "title",
      "description",
      "price",
      "price_currency",
      "price_per_m",
      "area_m2",
      "rooms",
      "floors_total",
      "build_year",
      "rent",
      "rent_currency",
      "floor",
      "market",
      "building_type",
      "construction_status",
      "building_ownership",
      "heating",
      "windows_type",
      "building_material",
      "energy_certificate",
      "advert_type",
      "free_from",
      "location_label",
      "street_name",
      "features",
    ]);
  });

  it("carries nothing of the row's ids, URLs, raw payload, notes or members", () => {
    const serialised = JSON.stringify(readAuditOffer(auditOfferRow()));

    for (const forbidden of FORBIDDEN_IN_AUDIT) expect(serialised).not.toContain(forbidden);
    // The control: the fixture row itself does carry every one of them.
    const row = JSON.stringify(auditOfferRow());
    for (const forbidden of FORBIDDEN_IN_AUDIT) expect(row).toContain(forbidden);
  });

  it("keeps the title and the description exactly as stored, whitespace included", () => {
    const offer = offerFrom(
      auditOfferRow({ title: "  Mieszkanie z widokiem ", description: "Opis.\n\n  Wcięty akapit. " }),
    );

    expect(offer.title).toBe("  Mieszkanie z widokiem ");
    expect(offer.description).toBe("Opis.\n\n  Wcięty akapit. ");
  });
});

describe("readAuditOffer: an unstated fact stays unstated, an unreadable one is a refusal (#1)", () => {
  it("reads null in every column the listing may leave out as not stated", () => {
    expect(readAuditOffer(auditOfferRow(NOTHING_STATED))).toEqual({
      title: "Mieszkanie 3 pokoje z balkonem, Praga-Południe",
      description: AUDIT_DESCRIPTION,
      ...NOTHING_STATED,
    });
  });

  // PostgREST may send a `numeric` as text; that is the number, not a failed read.
  it("reads a number sent as text as that number", () => {
    const offer = offerFrom(
      auditOfferRow({ price: "599000", price_per_m: "10990.83", area_m2: "54.50", rooms: "3", build_year: "1975" }),
    );

    expect(offer.price).toBe(599000);
    expect(offer.price_per_m).toBe(10990.83);
    expect(offer.area_m2).toBe(54.5);
    expect(offer.rooms).toBe(3);
    expect(offer.build_year).toBe(1975);
  });

  // One column at a time; every other column keeps its readable value, so the refusal is that
  // column's alone. Beside each stands the control above: the same row, readable, is an offer.
  const UNREADABLE: [string, string, unknown][] = [
    ["title", "an empty text", ""],
    ["title", "spaces only", "   "],
    ["title", "null", null],
    ["title", "a number", 123],
    ["description", "an empty text", ""],
    ["description", "a line break only", "\n"],
    ["description", "null", null],
    ["description", "a list", ["Opis"]],
    ["price", "non-numeric text", "abc"],
    ["price", "an empty text", ""],
    ["price", "a decimal comma", "599000,50"],
    ["price", "exponent notation", "5e5"],
    ["price", "a number with a space before it", " 599000"],
    ["price", "a grouped number", "599 000"],
    ["price", "a boolean", true],
    ["price", "not-a-number", Number.NaN],
    ["price", "infinity", Number.POSITIVE_INFINITY],
    ["price", "zero", 0],
    ["price", "zero as text", "0"],
    ["price", "a negative number", -1],
    ["price", "a negative number as text", "-599000"],
    ["price_per_m", "zero", 0],
    ["area_m2", "zero", 0],
    ["area_m2", "non-numeric text", "duże"],
    ["rent", "zero", 0],
    ["rent", "zero as text", "0"],
    ["rent", "a list", [650]],
    ["rooms", "a fraction", 2.5],
    ["rooms", "a fraction as text", "2.5"],
    ["rooms", "zero", 0],
    ["floors_total", "a negative number", -3],
    ["floors_total", "a fraction", 10.5],
    ["build_year", "text that is not a year", "19x5"],
    ["build_year", "a fraction", 1975.5],
    ["price_currency", "an empty text", ""],
    ["rent_currency", "a number", 985],
    ["floor", "an empty text", ""],
    ["floor", "a number", 7],
    ["market", "spaces only", "  "],
    ["building_type", "a boolean", false],
    ["construction_status", "an empty text", ""],
    ["building_ownership", "an object", {}],
    ["heating", "an empty text", ""],
    ["heating", "a number", 0],
    ["windows_type", "a list", ["plastic"]],
    ["building_material", "an empty text", ""],
    ["energy_certificate", "a number", 3],
    ["advert_type", "a boolean", true],
    ["free_from", "a number", 20261101],
    ["location_label", "an empty text", ""],
    ["street_name", "spaces only", "   "],
    ["features", "null", null],
    ["features", "a text", "balcony"],
    ["features", "an object", { balcony: true }],
    ["features", "a list holding a number", ["balcony", 5]],
    ["features", "a list holding an empty text", ["balcony", ""]],
    ["features", "a list holding null", [null]],
  ];

  it.each(UNREADABLE)("refuses the offer when %s holds %s", (column, _what, value) => {
    expect(readAuditOffer(auditOfferRow({ [column]: value }))).toBeNull();
  });

  // A column missing from the row is not "the listing did not state it": the row is not the one
  // that was asked for.
  it.each([...AUDIT_OFFER_COLUMNS])("refuses a row without its %s column", (column) => {
    const { [column]: _removed, ...rest } = auditOfferRow();

    expect(readAuditOffer(rest)).toBeNull();
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["a text", "Mieszkanie"],
    ["a number", 5],
    ["an empty list", []],
    ["a list holding the row", [auditOfferRow()]],
  ])("refuses %s, which is not a row", (_what, value) => {
    expect(readAuditOffer(value)).toBeNull();
  });
});

describe("the decision-critical attributes (FR-011)", () => {
  // Written out by hand from the plan: nine attributes, each with the column that states it.
  it("are nine, each tied to its column and named in Polish", () => {
    expect(DECISION_CRITICAL).toEqual({
      price: { column: "price", name: "cena" },
      area: { column: "area_m2", name: "metraż" },
      location: { column: "location_label", name: "lokalizacja" },
      floor: { column: "floor", name: "piętro" },
      heating: { column: "heating", name: "ogrzewanie" },
      ownership: { column: "building_ownership", name: "forma własności" },
      admin_rent: { column: "rent", name: "czynsz administracyjny" },
      build_year: { column: "build_year", name: "rok budowy" },
      finish_state: { column: "construction_status", name: "stan wykończenia" },
    });
    expect(DECISION_CRITICAL_ATTRIBUTES).toEqual([
      "price",
      "area",
      "location",
      "floor",
      "heating",
      "ownership",
      "admin_rent",
      "build_year",
      "finish_state",
    ]);
  });

  it.each([
    ["price", "Cena"],
    ["area", "Powierzchnia"],
    ["location", "Lokalizacja"],
    ["floor", "Piętro"],
    ["heating", "Ogrzewanie"],
    ["ownership", "Forma własności"],
    ["admin_rent", "Czynsz"],
    ["build_year", "Rok budowy"],
    ["finish_state", "Stan wykończenia"],
  ] as const)("%s is shown by the parameter line „%s”", (attribute, label) => {
    expect(criticalParameterLabel(attribute)).toBe(label);
    // And the input really has a line under that label.
    expect(buildAuditInput(statedOffer(), NO_CRITERIA).parameters.map((line) => line.label)).toContain(label);
  });

  // The empty column and the filled one side by side, one attribute at a time.
  it.each([
    ["price", "price"],
    ["area", "area_m2"],
    ["location", "location_label"],
    ["floor", "floor"],
    ["heating", "heating"],
    ["ownership", "building_ownership"],
    ["admin_rent", "rent"],
    ["build_year", "build_year"],
    ["finish_state", "construction_status"],
  ] as const)("%s counts as unstated exactly when its column %s is empty", (attribute, column) => {
    expect(buildAuditInput(statedOffer({ [column]: null }), NO_CRITERIA).unstatedAttributes).toEqual([attribute]);
    expect(buildAuditInput(statedOffer(), NO_CRITERIA).unstatedAttributes).toEqual([]);
  });

  it("lists every attribute, in order, for a listing that states none", () => {
    expect(buildAuditInput(statedOffer(NOTHING_STATED), NO_CRITERIA).unstatedAttributes).toEqual([
      "price",
      "area",
      "location",
      "floor",
      "heating",
      "ownership",
      "admin_rent",
      "build_year",
      "finish_state",
    ]);
  });

  // A parameter that is not one of the nine is never a missing-information attribute.
  it("does not count an unstated parameter outside the nine", () => {
    const input = buildAuditInput(statedOffer({ rooms: null, market: null, windows_type: null }), NO_CRITERIA);

    expect(input.unstatedAttributes).toEqual([]);
  });
});

describe("buildAuditInput: the listing, its parameters and the criteria (FR-010)", () => {
  it("builds the whole input from a fully stated offer and the team's criteria", () => {
    expect(buildAuditInput(statedOffer(), auditCriteria())).toEqual({
      title: "Mieszkanie 3 pokoje z balkonem, Praga-Południe",
      description: AUDIT_DESCRIPTION,
      parameters: [
        { label: "Cena", value: "599 000 zł" },
        { label: "Cena za m²", value: "10 990,83 zł/m²" },
        { label: "Powierzchnia", value: "54,5 m²" },
        { label: "Liczba pokoi", value: "3" },
        { label: "Piętro", value: "7. piętro" },
        { label: "Liczba pięter w budynku", value: "10" },
        { label: "Rok budowy", value: "1975" },
        { label: "Czynsz", value: "650 zł" },
        { label: "Rynek", value: "wtórny" },
        { label: "Rodzaj zabudowy", value: "blok" },
        { label: "Stan wykończenia", value: "do zamieszkania" },
        { label: "Forma własności", value: "pełna własność" },
        { label: "Ogrzewanie", value: "miejskie" },
        { label: "Okna", value: "plastikowe" },
        { label: "Materiał budynku", value: "wielka płyta" },
        { label: "Certyfikat energetyczny", value: "C" },
        { label: "Typ ogłoszeniodawcy", value: "osoba prywatna" },
        { label: "Dostępne od", value: "1 listopada 2026" },
        { label: "Lokalizacja", value: "Praga-Południe, Warszawa, mazowieckie" },
        { label: "Ulica", value: "ul. Kanarkowa" },
      ],
      // Known tokens under their Polish names; a token without one literally.
      features: ["balkon", "winda", "piwnica"],
      limits: [
        { label: "Miasto", value: "Warszawa" },
        { label: "Cena od", value: "500 000 zł" },
        { label: "Cena do", value: "650 000 zł" },
        { label: "Minimalny metraż", value: "45,5 m²" },
      ],
      requirements: [
        { ref: "W1", body: "Balkon albo loggia. Najwyżej trzecie piętro bez windy." },
        { ref: "W2", body: "Miejsce postojowe w garażu podziemnym." },
      ],
      unstatedAttributes: [],
    });
  });

  it("keeps the listing's words exactly as stored", () => {
    const input = buildAuditInput(statedOffer(), NO_CRITERIA);

    expect(input.title).toBe(AUDIT_TITLE);
    expect(input.description).toBe(AUDIT_DESCRIPTION);
  });

  it("numbers the requirements W1…Wn in the order given, and gives none when there are none", () => {
    const three = buildAuditInput(statedOffer(), {
      ...NO_CRITERIA,
      requirements: [BARTEK_REQUIREMENTS, "Cicha okolica.", ANNA_REQUIREMENTS],
    });

    expect(three.requirements).toEqual([
      { ref: "W1", body: "Miejsce postojowe w garażu podziemnym." },
      { ref: "W2", body: "Cicha okolica." },
      { ref: "W3", body: "Balkon albo loggia. Najwyżej trzecie piętro bez windy." },
    ]);
    expect(buildAuditInput(statedOffer(), NO_CRITERIA).requirements).toEqual([]);
  });

  // An unset limit is "no limit" — never zero, never an empty value — beside the set one above.
  it("reads an unset limit as „bez limitu”, each on its own", () => {
    expect(buildAuditInput(statedOffer(), NO_CRITERIA).limits).toEqual([
      { label: "Miasto", value: "bez limitu" },
      { label: "Cena od", value: "bez limitu" },
      { label: "Cena do", value: "bez limitu" },
      { label: "Minimalny metraż", value: "bez limitu" },
    ]);
    expect(
      buildAuditInput(statedOffer(), {
        limits: { city: null, priceMin: null, priceMax: 900000, areaMin: null },
        requirements: [],
      }).limits,
    ).toEqual([
      { label: "Miasto", value: "bez limitu" },
      { label: "Cena od", value: "bez limitu" },
      { label: "Cena do", value: "900 000 zł" },
      { label: "Minimalny metraż", value: "bez limitu" },
    ]);
  });
});

describe("buildAuditInput: an unstated fact reads „nie podano w ogłoszeniu”, never zero (#1)", () => {
  // The portal sends `rent: "0"` for a rent the advertiser left blank; the mapper stores null in
  // the column and the placeholder survives in `raw`. The fixture row holds exactly that pair.
  it('reads the rent as not stated when the column is null and raw still holds the placeholder "0"', () => {
    const row = auditOfferRow({ rent: null, rent_currency: null });
    expect(JSON.stringify(row.raw)).toContain('"key":"rent","value":"0"');

    const input = buildAuditInput(offerFrom(row), NO_CRITERIA);

    expect(input.parameters).toContainEqual({ label: "Czynsz", value: "nie podano w ogłoszeniu" });
    expect(input.parameters.filter((line) => line.label === "Czynsz")).toHaveLength(1);
    expect(input.unstatedAttributes).toEqual(["admin_rent"]);
    // Beside it: the same row with the rent stated reads the amount.
    expect(buildAuditInput(statedOffer(), NO_CRITERIA).parameters).toContainEqual({
      label: "Czynsz",
      value: "650 zł",
    });
  });

  it("gives every parameter its line when the listing states none, each reading not stated", () => {
    const input = buildAuditInput(statedOffer(NOTHING_STATED), NO_CRITERIA);

    expect(input.parameters).toEqual([
      { label: "Cena", value: "nie podano w ogłoszeniu" },
      { label: "Cena za m²", value: "nie podano w ogłoszeniu" },
      { label: "Powierzchnia", value: "nie podano w ogłoszeniu" },
      { label: "Liczba pokoi", value: "nie podano w ogłoszeniu" },
      { label: "Piętro", value: "nie podano w ogłoszeniu" },
      { label: "Liczba pięter w budynku", value: "nie podano w ogłoszeniu" },
      { label: "Rok budowy", value: "nie podano w ogłoszeniu" },
      { label: "Czynsz", value: "nie podano w ogłoszeniu" },
      { label: "Rynek", value: "nie podano w ogłoszeniu" },
      { label: "Rodzaj zabudowy", value: "nie podano w ogłoszeniu" },
      { label: "Stan wykończenia", value: "nie podano w ogłoszeniu" },
      { label: "Forma własności", value: "nie podano w ogłoszeniu" },
      { label: "Ogrzewanie", value: "nie podano w ogłoszeniu" },
      { label: "Okna", value: "nie podano w ogłoszeniu" },
      { label: "Materiał budynku", value: "nie podano w ogłoszeniu" },
      { label: "Certyfikat energetyczny", value: "nie podano w ogłoszeniu" },
      { label: "Typ ogłoszeniodawcy", value: "nie podano w ogłoszeniu" },
      { label: "Dostępne od", value: "nie podano w ogłoszeniu" },
      { label: "Lokalizacja", value: "nie podano w ogłoszeniu" },
      { label: "Ulica", value: "nie podano w ogłoszeniu" },
    ]);
    // No amenities named is an empty list — not a list saying there are none.
    expect(input.features).toEqual([]);
    // No value anywhere holds a digit: nothing reads as a zero amount, a zero count or a year.
    for (const line of input.parameters) expect(line.value).not.toMatch(/\d/);
  });

  // A token the dictionaries do not know is data that cannot be translated yet, not missing data.
  it("passes a token without a Polish label through literally, never as not stated", () => {
    const input = buildAuditInput(statedOffer({ heating: "kominek", floor: "mezzanine" }), NO_CRITERIA);

    expect(input.parameters).toContainEqual({ label: "Ogrzewanie", value: "kominek" });
    expect(input.parameters).toContainEqual({ label: "Piętro", value: "mezzanine" });
    expect(input.unstatedAttributes).toEqual([]);
  });

  it("shows an amount without its currency as the number alone", () => {
    const input = buildAuditInput(statedOffer({ price_currency: null, rent_currency: null }), NO_CRITERIA);

    expect(input.parameters).toContainEqual({ label: "Cena", value: "599 000" });
    expect(input.parameters).toContainEqual({ label: "Czynsz", value: "650" });
  });
});

describe("buildAuditInput: nothing but the listing and the criteria gets in (#6)", () => {
  // The fixture row carries seller data in raw, notes, members' emails and ids, the source URL,
  // image URLs and coordinates; the criteria object carries authors with emails and ids.
  it("holds no seller data from raw, no note, no email address and no id", () => {
    const serialised = JSON.stringify(buildAuditInput(statedOffer(), auditCriteria()));

    for (const forbidden of FORBIDDEN_IN_AUDIT) expect(serialised).not.toContain(forbidden);
    // The control: what it was built from does carry them.
    const sources = JSON.stringify([auditOfferRow(), auditCriteria()]);
    for (const forbidden of FORBIDDEN_IN_AUDIT) expect(sources).toContain(forbidden);
  });

  // prd.md, Non-Functional Requirements: the rule covers the portal's contact fields, not the
  // listing's own words — redacting them would break the verbatim excerpts.
  it("keeps a phone number and a name the advertiser typed into the description, verbatim", () => {
    const input = buildAuditInput(statedOffer(), auditCriteria());

    expect(input.description).toContain("Kontakt: Kanarek Testowy, tel. +48 600 000 001.");
    expect(input.description).toContain(TYPED_PHONE);
    expect(input.description).toContain(TYPED_NAME);
  });

  it("passes on the requirements' texts and nothing about who wrote them", () => {
    const input = buildAuditInput(statedOffer(), auditCriteria());

    expect(Object.keys(input).sort()).toEqual([
      "description",
      "features",
      "limits",
      "parameters",
      "requirements",
      "title",
      "unstatedAttributes",
    ]);
    for (const requirement of input.requirements) expect(Object.keys(requirement).sort()).toEqual(["body", "ref"]);
  });
});

describe("listingFingerprint: what the audit read, from raw column values (FR-009)", () => {
  /** A small offer, so the JSON it is hashed from can be written out by hand below. */
  const SMALL: AuditOffer = {
    title: "Kawalerka przy parku",
    description: "Opis z balkonem.\nDrugi wiersz.",
    price: 300000,
    price_currency: "PLN",
    price_per_m: null,
    area_m2: 27.5,
    rooms: 1,
    floors_total: null,
    build_year: 1998,
    rent: null,
    rent_currency: null,
    floor: "ground_floor",
    market: "secondary",
    building_type: null,
    construction_status: null,
    building_ownership: "limited_ownership",
    heating: "urban",
    windows_type: null,
    building_material: null,
    energy_certificate: null,
    advert_type: "PRIVATE",
    free_from: null,
    location_label: "Bielany, Warszawa, mazowieckie",
    street_name: null,
    features: ["balcony", "lift"],
  };

  // Written by hand: the raw values under their column names, in the whitelist's order. No
  // Polish label („parter", „miejskie", „spółdzielcze własnościowe prawo") appears in it.
  const SMALL_JSON =
    '{"title":"Kawalerka przy parku","description":"Opis z balkonem.\\nDrugi wiersz.","price":300000,' +
    '"price_currency":"PLN","price_per_m":null,"area_m2":27.5,"rooms":1,"floors_total":null,"build_year":1998,' +
    '"rent":null,"rent_currency":null,"floor":"ground_floor","market":"secondary","building_type":null,' +
    '"construction_status":null,"building_ownership":"limited_ownership","heating":"urban","windows_type":null,' +
    '"building_material":null,"energy_certificate":null,"advert_type":"PRIVATE","free_from":null,' +
    '"location_label":"Bielany, Warszawa, mazowieckie","street_name":null,"features":["balcony","lift"]}';

  it("is v1: followed by the SHA-256 of the raw column values under their column names", async () => {
    const expected = `v1:${createHash("sha256").update(SMALL_JSON, "utf8").digest("hex")}`;

    expect(await listingFingerprint(SMALL)).toBe(expected);
  });

  it("starts with v1: and carries sixty-four hex digits", async () => {
    expect(await listingFingerprint(statedOffer())).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it("is the same for the same listing, read twice", async () => {
    expect(await listingFingerprint(statedOffer())).toBe(await listingFingerprint(statedOffer()));
  });

  it.each<[string, Partial<AuditOffer>]>([
    ["the description", { description: "Opis z balkonem.\nDrugi wiersz!" }],
    ["one character of whitespace in the description", { description: "Opis z balkonem.\n\nDrugi wiersz." }],
    ["the title", { title: "Kawalerka przy lesie" }],
    ["a numeric parameter", { area_m2: 27.6 }],
    ["a parameter that was not stated", { rent: 420 }],
    ["a parameter that is no longer stated", { build_year: null }],
    ["a token parameter", { heating: "gas" }],
    ["the location", { location_label: "Bemowo, Warszawa, mazowieckie" }],
    ["an amenity", { features: ["balcony"] }],
  ])("changes when %s changes", async (_what, change) => {
    expect(await listingFingerprint({ ...SMALL, ...change })).not.toBe(await listingFingerprint(SMALL));
  });

  // `limited_ownership` and `co_operative_ownership` share one Polish label (labels.ts): a
  // fingerprint taken from labels would not tell them apart, and one taken from values does.
  it("reads the stored tokens, not their labels", async () => {
    const other = { ...SMALL, building_ownership: "co_operative_ownership" };

    expect(await listingFingerprint(other)).not.toBe(await listingFingerprint(SMALL));
  });

  it("does not depend on the order of the row's keys", async () => {
    const reversed = Object.fromEntries(Object.entries(SMALL).reverse()) as unknown as AuditOffer;
    expect(Object.keys(reversed)[0]).toBe("features");

    expect(await listingFingerprint(reversed)).toBe(await listingFingerprint(SMALL));
  });

  it("does not depend on anything outside the whitelist", async () => {
    const withMore = { ...SMALL, id: "another-id", source_url: "https://example.test/x", raw: { rent: "0" } };

    expect(await listingFingerprint(withMore)).toBe(await listingFingerprint(SMALL));
  });

  // The same listing answered once with numbers and once with numbers as text.
  it("is the same whether the database sent a number or that number as text", async () => {
    const asText = statedOffer({ price: "599000", price_per_m: "10990.83", area_m2: "54.50", rent: "650" });

    expect(await listingFingerprint(asText)).toBe(await listingFingerprint(statedOffer()));
  });
});
