import { describe, expect, it } from "vitest";
import { mapAdToOffer } from "@/lib/otodom/map";
import type { MapFailureReason, OfferInsert } from "@/lib/otodom/types";
import {
  type Ad,
  CANARY_NAME,
  CANARY_PHONE,
  CANARY_STREET,
  FLAT_SALE_DESCRIPTION_HTML,
  SELLER_CANARIES,
  categoryTrap,
  flatSaleAd,
  omitKeys,
  rentalFlat,
  rentalHouse,
  saleHouse,
  typeDisagreement,
  withCharacteristic,
} from "../../fixtures/otodom";

// Expected values are written by hand from the fixture input and the documented rule —
// prd.md (Guardrails, FR-005, Non-Functional Requirements) and otodom_fetching.md section 7 —
// never copied from what the mapper returns.

function mapped(ad: unknown): OfferInsert {
  const result = mapAdToOffer(ad);
  if (!result.ok) throw new Error(`expected an offer, got a refusal: ${result.reason}`);
  return result.offer;
}

function refused(ad: unknown): { reason: MapFailureReason; detail?: string } {
  const result = mapAdToOffer(ad);
  // A refusal carries no offer at all — nothing that could be saved by mistake.
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("offer");
  if (result.ok) throw new Error("expected a refusal, got an offer");
  return result;
}

describe("mapAdToOffer: an unstated number is unknown, never zero (#1)", () => {
  const NUMERIC_COLUMNS = [
    ["price", "price"],
    ["price_per_m", "price_per_m"],
    ["m", "area_m2"],
    ["rooms_num", "rooms"],
    ["building_floors_num", "floors_total"],
    ["build_year", "build_year"],
    ["rent", "rent"],
  ] as const;
  const INTEGER_COLUMNS = [
    ["rooms_num", "rooms"],
    ["building_floors_num", "floors_total"],
    ["build_year", "build_year"],
  ] as const;

  // Empty, not a number, zero or below, and anything only an interpretation could read as a
  // number: a fact never comes from interpretation (prd.md, Guardrails).
  const UNSTATED_VALUES: unknown[] = [
    "",
    " ",
    "abc",
    "0",
    "-5",
    "1e3",
    "0x10",
    "Infinity",
    "+5",
    "12,5",
    "1 200",
    null,
    true,
    0,
    -5,
  ];

  it.each(NUMERIC_COLUMNS)("reads %s as unknown when the key is absent", (key, column) => {
    expect(mapped(withCharacteristic(flatSaleAd(), key, null))[column]).toBeNull();
  });

  it.each(NUMERIC_COLUMNS.flatMap(([key, column]) => UNSTATED_VALUES.map((value) => [key, value, column] as const)))(
    "reads %s = %j as unknown in %s",
    (key, value, column) => {
      expect(mapped(withCharacteristic(flatSaleAd(), key, { value }))[column]).toBeNull();
    },
  );

  it.each(INTEGER_COLUMNS)(
    "reads a fractional %s as unknown in %s: a fractional count is not a count",
    (key, column) => {
      expect(mapped(withCharacteristic(flatSaleAd(), key, { value: "2.5" }))[column]).toBeNull();
    },
  );

  it("keeps every stated number exactly as the listing gives it", () => {
    const offer = mapped(flatSaleAd());
    expect(offer.price).toBe(599000);
    expect(offer.price_per_m).toBe(10990.83);
    expect(offer.area_m2).toBe(54.5);
    expect(offer.rooms).toBe(3);
    expect(offer.floors_total).toBe(10);
    expect(offer.build_year).toBe(1975);
    expect(offer.rent).toBe(650);
  });

  it("reads a decimal string with surrounding whitespace, and a positive number as given", () => {
    expect(mapped(withCharacteristic(flatSaleAd(), "m", { value: " 54.5 " })).area_m2).toBe(54.5);
    expect(mapped(withCharacteristic(flatSaleAd(), "price", { value: 599000 })).price).toBe(599000);
  });

  it("keeps a currency only beside a stated amount", () => {
    const offer = mapped(flatSaleAd());
    expect(offer.price_currency).toBe("PLN");
    expect(offer.rent_currency).toBe("PLN");
  });

  it('drops the rent\'s currency with a rent of "0" (ID4CZQU)', () => {
    const offer = mapped(withCharacteristic(flatSaleAd(), "rent", { value: "0", currency: "PLN" }));
    expect(offer.rent).toBeNull();
    expect(offer.rent_currency).toBeNull();
  });

  it("gives no sale currency when neither the price nor the price per m² is stated", () => {
    const ad = withCharacteristic(
      withCharacteristic(flatSaleAd(), "price", { value: "0", currency: "PLN" }),
      "price_per_m",
      { value: "", currency: "PLN" },
    );
    const offer = mapped(ad);
    expect(offer.price).toBeNull();
    expect(offer.price_per_m).toBeNull();
    expect(offer.price_currency).toBeNull();
  });

  it("takes the sale currency from the price per m² when only that is stated", () => {
    const ad = withCharacteristic(flatSaleAd(), "price", { value: "0", currency: "EUR" });
    const offer = mapped(ad);
    expect(offer.price).toBeNull();
    expect(offer.price_per_m).toBe(10990.83);
    expect(offer.price_currency).toBe("PLN");
  });
});

describe("mapAdToOffer: only a sale of a flat passes (#1, FR-005)", () => {
  it("passes a flat for sale", () => {
    expect(mapAdToOffer(flatSaleAd()).ok).toBe(true);
  });

  it('refuses a flat for rent as not for sale, even with a rent of "1" (ID4DapL)', () => {
    expect(refused(rentalFlat()).reason).toBe("not_for_sale");
  });

  it("refuses a house for sale as not a flat, naming the property type (ID4wZN2)", () => {
    const refusal = refused(saleHouse());
    expect(refusal.reason).toBe("not_a_flat");
    expect(refusal.detail).toBe("dom");
  });

  it("refuses a house for rent on the transaction, which is checked first", () => {
    expect(refused(rentalHouse()).reason).toBe("not_for_sale");
  });

  it("reports an adCategory that disagrees with target.OfferType as a changed shape, not as a rental or a flat", () => {
    expect(refused(typeDisagreement()).reason).toBe("shape_changed");
  });

  it("gates on adCategory, not on a category that claims a flat sale", () => {
    expect(refused(categoryTrap()).reason).toBe("not_a_flat");
  });

  it.each(["adCategory", "target"])("reports a listing without %s as a changed shape", (key) => {
    expect(refused(omitKeys(flatSaleAd(), key)).reason).toBe("shape_changed");
  });

  it.each([null, "ad", [], 42])("reports %j instead of an ad object as a changed shape", (ad) => {
    expect(refused(ad).reason).toBe("shape_changed");
  });

  it("reads an enum's token from value, where localizedValue is empty", () => {
    const offer = mapped(flatSaleAd());
    expect(offer.heating).toBe("urban");
    expect(offer.floor).toBe("floor_7");
    expect(offer.market).toBe("secondary");
    expect(offer.building_type).toBe("block");
    expect(offer.construction_status).toBe("ready_to_use");
    expect(offer.building_ownership).toBe("full_ownership");
    expect(offer.windows_type).toBe("plastic");
    expect(offer.building_material).toBe("concrete_plate");
    expect(offer.energy_certificate).toBe("c");
  });
});

describe("mapAdToOffer: no blank row (#1, prd.md Non-Functional Requirements)", () => {
  const BLANK: [string, Ad][] = [
    ["a blank title", flatSaleAd({ title: "   " })],
    ["an empty-paragraph description", flatSaleAd({ description: "<p></p>" })],
    ["a description of only a non-breaking space", flatSaleAd({ description: "<p>&nbsp;</p>" })],
    ["no title", omitKeys(flatSaleAd(), "title")],
    ["no description", omitKeys(flatSaleAd(), "description")],
    ["no id", omitKeys(flatSaleAd(), "id")],
    ["a non-numeric id", flatSaleAd({ id: "abc" })],
    ["no url", omitKeys(flatSaleAd(), "url")],
    ["characteristics that are not a list", flatSaleAd({ characteristics: {} })],
    ["no characteristics", omitKeys(flatSaleAd(), "characteristics")],
  ];

  it.each(BLANK)("refuses %s as a changed shape", (_label, ad) => {
    expect(refused(ad).reason).toBe("shape_changed");
  });
});

describe("mapAdToOffer: seller data stays out, the advertiser's words stay in (#6)", () => {
  // The whitelist of top-level `ad` keys that may reach `raw` (otodom_fetching.md 7.4: built
  // from a whitelist, `location` and `target` narrowed). Written out here on purpose — a wider
  // whitelist has to change this test, not only the constant in map.ts.
  const ALLOWED_RAW_KEYS = [
    "id",
    "url",
    "title",
    "description",
    "characteristics",
    "features",
    "adCategory",
    "images",
    "createdAt",
    "modifiedAt",
    "target",
    "location",
  ];

  const LISTINGS: [string, Ad][] = [
    ["an agency listing", flatSaleAd()],
    ["a private listing with agency: null", flatSaleAd({ agency: null })],
  ];

  it.each(LISTINGS)("keeps no seller phone, name or account id outside the listing's text (%s)", (_label, ad) => {
    const { description: _description, raw, ...columns } = mapped(ad);
    const { description: _rawDescription, ...rawRest } = raw;
    const serialised = JSON.stringify({ ...columns, raw: rawRest });
    for (const canary of SELLER_CANARIES) {
      expect(serialised).not.toContain(canary);
    }
  });

  it("builds raw from the whitelist only", () => {
    const { raw } = mapped(flatSaleAd());
    for (const key of Object.keys(raw)) {
      expect(ALLOWED_RAW_KEYS).toContain(key);
    }
  });

  it("narrows raw.target to OfferType and ProperType", () => {
    const { raw } = mapped(flatSaleAd());
    expect(raw.target).toEqual({ OfferType: "sprzedaz", ProperType: "mieszkanie" });
  });

  it("leaves the street address out of raw.location", () => {
    const { raw } = mapped(flatSaleAd());
    expect(raw.location).toBeTypeOf("object");
    expect(raw.location).not.toHaveProperty("address");
  });

  it("keeps a phone and a name the advertiser typed into the description, verbatim", () => {
    const offer = mapped(flatSaleAd());
    expect(offer.description).toContain(CANARY_PHONE);
    expect(offer.description).toContain(CANARY_NAME);
    expect(offer.raw.description).toBe(FLAT_SALE_DESCRIPTION_HTML);
    expect(offer.raw.description).toContain(CANARY_PHONE);
    expect(offer.raw.description).toContain(CANARY_NAME);
  });

  it("keeps the street name, which the PRD does not forbid", () => {
    expect(mapped(flatSaleAd()).street_name).toBe(CANARY_STREET);
  });
});
