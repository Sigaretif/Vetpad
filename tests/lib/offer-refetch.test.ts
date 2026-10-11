import { describe, expect, it } from "vitest";
import { AUDIT_OFFER_COLUMNS, type AuditOffer, type AuditOfferColumn } from "@/lib/audit/input";
import { LOST_FACT_LABELS, isLossAccepted, lostFacts, readLostTokens } from "@/lib/offer-refetch";

// Expected values are written by hand from the Phase 1 contract in
// context/changes/refetch-and-stale-audit/plan.md (a fact is stated when it is not `null`; the
// title and the description when non-blank after trimming; the amenities when the list is not
// empty; a fact is lost when it was stated and is not; one stated value changed into another is
// no loss; the answer is in the order of `AUDIT_OFFER_COLUMNS`), the labels of the offer card
// (src/components/offers/OfferParameters.astro) and the whitelist as
// tests/lib/audit/input.test.ts writes it out — never copied from what the functions return.
// Every "nothing lost" case stands beside one where the same column is lost: alone, it would pass
// on a function that always answers [].

/** A listing that states every fact the audit reads. */
function offer(overrides: Partial<AuditOffer> = {}): AuditOffer {
  return {
    title: "Mieszkanie 3 pokoje z balkonem",
    description: "Słoneczne mieszkanie na siódmym piętrze.",
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
    features: ["balcony", "lift"],
    ...overrides,
  };
}

/** Every column as a listing that no longer states it carries it. */
const UNSTATED: { [Column in AuditOfferColumn]: AuditOffer[Column] } = {
  title: "",
  description: "",
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

/** The whitelist, written out: the order every answer below is expected in. */
const COLUMNS_IN_ORDER: AuditOfferColumn[] = [
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
];

describe("lostFacts: a fact the stored listing states and the fetched one does not (FR-009)", () => {
  it("answers nothing for the same listing fetched again", () => {
    expect(lostFacts(offer(), offer())).toEqual([]);
  });

  // One column at a time: the stored listing states it, the fetched one does not.
  it.each(COLUMNS_IN_ORDER)("names %s when only it stopped being stated", (column) => {
    expect(lostFacts(offer(), offer({ [column]: UNSTATED[column] }))).toEqual([column]);
  });

  it("names every column, in the whitelist's order, when the fetched listing states nothing", () => {
    expect(lostFacts(offer(), UNSTATED)).toEqual([
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

  it("answers in the whitelist's order, whatever the order of the fetched listing's keys", () => {
    const unstated = offer({ features: [], street_name: null, rent: null, price: null });
    const reversed = Object.fromEntries(Object.entries(unstated).reverse()) as unknown as AuditOffer;
    expect(Object.keys(reversed)[0]).toBe("features");

    expect(lostFacts(offer(), reversed)).toEqual(["price", "rent", "street_name", "features"]);
  });
});

describe("lostFacts: a fact that was never stated cannot be lost (FR-009)", () => {
  // The same column unstated on both sides — and, beside it, lost once the stored side states it.
  it.each(COLUMNS_IN_ORDER)("gives no mark for %s when neither listing states it", (column) => {
    const unstated = { [column]: UNSTATED[column] };

    expect(lostFacts(offer(unstated), offer(unstated))).toEqual([]);
    expect(lostFacts(offer(), offer(unstated))).toEqual([column]);
  });

  // The fetched listing states more than the stored one: a gain, never a loss.
  it.each(COLUMNS_IN_ORDER)("gives no mark for %s when only the fetched listing states it", (column) => {
    expect(lostFacts(offer({ [column]: UNSTATED[column] }), offer())).toEqual([]);
  });

  it("answers nothing when the stored listing states nothing", () => {
    expect(lostFacts(UNSTATED, UNSTATED)).toEqual([]);
    expect(lostFacts(UNSTATED, offer())).toEqual([]);
  });
});

describe("lostFacts: a stated value that changed into another is not a loss (FR-009)", () => {
  it.each<[string, Partial<AuditOffer>]>([
    ["a number", { price: 549000 }],
    ["a number that fell to a fraction of itself", { area_m2: 5.45 }],
    ["a count", { rooms: 2 }],
    ["a token", { heating: "gas" }],
    ["a currency", { price_currency: "EUR" }],
    ["a date", { free_from: "2027-01-15" }],
    ["the title", { title: "Inny tytuł" }],
    ["the description", { description: "Zupełnie inny opis." }],
    ["the description, shortened to one character", { description: "." }],
    ["the amenities, with one fewer", { features: ["balcony"] }],
    ["the amenities, with others", { features: ["garage"] }],
    ["the location", { location_label: "Ząbki, wołomiński, mazowieckie" }],
  ])("gives no mark for %s that changed", (_what, change) => {
    expect(lostFacts(offer(), offer(change))).toEqual([]);
  });

  it("names only what stopped being stated among values that changed", () => {
    const fetched = offer({ price: 549000, heating: "gas", build_year: null, features: ["balcony"] });

    expect(lostFacts(offer(), fetched)).toEqual(["build_year"]);
  });
});

describe("lostFacts: what counts as stated, by the kind of column (FR-009)", () => {
  // The listing's words: blank after trimming is not stated.
  it.each<["title" | "description", string]>([
    ["title", ""],
    ["title", "   "],
    ["title", "\n\t "],
    ["description", ""],
    ["description", "   "],
    ["description", " \n \n "],
  ])("reads the %s %j as not stated", (column, blank) => {
    expect(lostFacts(offer(), offer({ [column]: blank }))).toEqual([column]);
    expect(lostFacts(offer({ [column]: blank }), offer({ [column]: "" }))).toEqual([]);
  });

  it.each<["title" | "description", string]>([
    ["title", " x "],
    ["description", "\n.\n"],
  ])("reads the %s %j as stated", (column, text) => {
    expect(lostFacts(offer(), offer({ [column]: text }))).toEqual([]);
    expect(lostFacts(offer({ [column]: text }), offer({ [column]: " " }))).toEqual([column]);
  });

  // Every other text is stated when it is not null — trimming is the title's and the description's rule.
  it("reads a text fact as stated whenever it is not null", () => {
    expect(lostFacts(offer(), offer({ floor: "" }))).toEqual([]);
    expect(lostFacts(offer({ floor: "" }), offer({ floor: null }))).toEqual(["floor"]);
  });

  it("reads an amenity list as stated when it names at least one", () => {
    expect(lostFacts(offer({ features: ["balcony"] }), offer({ features: [] }))).toEqual(["features"]);
    expect(lostFacts(offer({ features: ["balcony"] }), offer({ features: ["lift"] }))).toEqual([]);
    expect(lostFacts(offer({ features: [] }), offer({ features: [] }))).toEqual([]);
  });
});

describe("LOST_FACT_LABELS: the name a member reads for each column (FR-009)", () => {
  // Written by hand from the offer card: the parameter rows of OfferParameters.astro, its
  // „Udogodnienia" heading and the „Opis" heading of OfferDescription.astro.
  it("names every whitelisted column as the offer card does", () => {
    expect(LOST_FACT_LABELS).toEqual({
      title: "Tytuł",
      description: "Opis",
      price: "Cena",
      price_currency: "Waluta ceny",
      price_per_m: "Cena za m²",
      area_m2: "Powierzchnia",
      rooms: "Liczba pokoi",
      floors_total: "Liczba pięter w budynku",
      build_year: "Rok budowy",
      rent: "Czynsz",
      rent_currency: "Waluta czynszu",
      floor: "Piętro",
      market: "Rynek",
      building_type: "Rodzaj zabudowy",
      construction_status: "Stan wykończenia",
      building_ownership: "Forma własności",
      heating: "Ogrzewanie",
      windows_type: "Okna",
      building_material: "Materiał budynku",
      energy_certificate: "Certyfikat energetyczny",
      advert_type: "Typ ogłoszeniodawcy",
      free_from: "Dostępne od",
      location_label: "Lokalizacja",
      street_name: "Ulica",
      features: "Udogodnienia",
    });
  });

  it("has a name for every column of the whitelist, and for nothing else", () => {
    expect(Object.keys(LOST_FACT_LABELS).sort()).toEqual([...AUDIT_OFFER_COLUMNS].sort());
    expect(new Set(Object.values(LOST_FACT_LABELS)).size).toBe(25);
  });
});

describe("readLostTokens: the columns a comma-separated list names (FR-009)", () => {
  it("reads one column and several", () => {
    expect(readLostTokens("rent")).toEqual(["rent"]);
    expect(readLostTokens("price,rent,features")).toEqual(["price", "rent", "features"]);
  });

  it("answers in the whitelist's order, whatever the order of the list", () => {
    expect(readLostTokens("features,rent,title,price")).toEqual(["title", "price", "rent", "features"]);
  });

  it("reads every column of the whitelist", () => {
    expect(readLostTokens([...COLUMNS_IN_ORDER].reverse().join(","))).toEqual(COLUMNS_IN_ORDER);
  });

  it("drops a repeated token", () => {
    expect(readLostTokens("rent,rent,price,rent")).toEqual(["price", "rent"]);
  });

  it.each<[string, string]>([
    ["an empty value", ""],
    ["commas alone", ",,,"],
    ["a column outside the whitelist", "raw"],
    ["the columns the audit never reads", "id,source_url,created_by,images,latitude,otodom_id"],
    ["a column in another case", "RENT"],
    ["a column with spaces around it", " rent "],
    ["a column inside a longer word", "rent_currency_x,xrent"],
    ["two columns joined by another separator", "price;rent"],
    ["a markup tag", "<script>alert(1)</script>"],
    ["a property of every object", "constructor,__proto__,toString,hasOwnProperty"],
    ["a list index and a length", "0,length"],
    ["an address fragment", "../../dashboard?error=x"],
  ])("answers nothing for %s", (_case, value) => {
    expect(readLostTokens(value)).toEqual([]);
  });

  it("keeps the columns it knows among tokens it does not", () => {
    expect(readLostTokens("<b>,rent,raw, price,__proto__,features,,RENT")).toEqual(["rent", "features"]);
  });

  // `rent` is a prefix of `rent_currency`: each is its own token.
  it("tells a column from another that starts with its name", () => {
    expect(readLostTokens("rent_currency")).toEqual(["rent_currency"]);
    expect(readLostTokens("rent")).toEqual(["rent"]);
    expect(readLostTokens("price_per_m")).toEqual(["price_per_m"]);
  });
});

describe("isLossAccepted: every lost column is one the member agreed to lose (FR-009)", () => {
  it("accepts the same columns", () => {
    expect(isLossAccepted(["rent", "features"], ["rent", "features"])).toBe(true);
  });

  it("accepts them in another order", () => {
    expect(isLossAccepted(["rent", "features"], ["features", "rent"])).toBe(true);
  });

  // The second fetch lost less than the member was shown: still what they agreed to.
  it("accepts a loss that is a part of what was agreed to", () => {
    expect(isLossAccepted(["rent"], ["price", "rent", "features"])).toBe(true);
  });

  // The second fetch lost a column the member never saw.
  it("refuses a loss that holds a column outside what was agreed to", () => {
    expect(isLossAccepted(["price", "rent", "features"], ["rent"])).toBe(false);
    expect(isLossAccepted(["rent", "features"], ["rent"])).toBe(false);
    expect(isLossAccepted(["rent", "features"], ["features"])).toBe(false);
  });

  it("refuses a loss of other columns altogether", () => {
    expect(isLossAccepted(["rent"], ["price"])).toBe(false);
  });

  it("refuses any loss when nothing was agreed to", () => {
    expect(isLossAccepted(["rent"], [])).toBe(false);
  });

  it("accepts when nothing is lost, with or without an agreement", () => {
    expect(isLossAccepted([], [])).toBe(true);
    expect(isLossAccepted([], ["rent"])).toBe(true);
  });

  it("joins the two rules: an agreement read from tokens covers the loss it was shown", () => {
    const lost = lostFacts(offer(), offer({ rent: null, features: [] }));

    expect(lost).toEqual(["rent", "features"]);
    expect(isLossAccepted(lost, readLostTokens("features,rent"))).toBe(true);
    expect(isLossAccepted(lost, readLostTokens("rent"))).toBe(false);
    expect(isLossAccepted(lost, readLostTokens("rent,raw"))).toBe(false);
  });
});
