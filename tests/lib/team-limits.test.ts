import { describe, expect, it } from "vitest";
import type { TeamLimits } from "@/lib/criteria";
import { type LimitBreach, type LimitedOffer, limitBreaches, normalizePlace } from "@/lib/team-limits";

// Expected values are written by hand from the documented rule — prd.md (FR-002, Guardrails),
// CLAUDE.md (## Structure) and the contract in the team-search-criteria plan — never copied from
// what the function returns. Every "breaks nothing" case stands beside one where the same limit
// is broken: alone, it would pass on a function that always answers [].

/** A flat in Warsaw that states every fact the limits look at. */
function offer(overrides: Partial<LimitedOffer> = {}): LimitedOffer {
  return {
    price: 790000,
    price_currency: "PLN",
    area_m2: 64,
    location_label: "Stary Mokotów, Mokotów, Warszawa, mazowieckie",
    ...overrides,
  };
}

/** No limit set, unless a case sets one. */
function limits(overrides: Partial<TeamLimits> = {}): TeamLimits {
  return { city: null, priceMin: null, priceMax: null, areaMin: null, ...overrides };
}

/** Every limit set: Warszawa, 600 000–850 000 zł, from 60 m². */
const EVERY_LIMIT: TeamLimits = { city: "Warszawa", priceMin: 600000, priceMax: 850000, areaMin: 60 };

/** Outside the city, above the price ceiling and below the area floor of EVERY_LIMIT. */
const OUTSIDE_AND_DEAR: LimitedOffer = {
  price: 980000,
  price_currency: "PLN",
  area_m2: 52,
  location_label: "Ząbki, wołomiński, mazowieckie",
};

/** The same flat priced below the floor of EVERY_LIMIT instead of above its ceiling. */
const OUTSIDE_AND_CHEAP: LimitedOffer = { ...OUTSIDE_AND_DEAR, price: 540000 };

describe("limitBreaches: only a stated fact breaks a limit (#1, FR-002)", () => {
  it("marks every limit a stated fact breaks", () => {
    expect(limitBreaches(OUTSIDE_AND_DEAR, EVERY_LIMIT)).toEqual(["city", "price_above", "area_below"]);
    expect(limitBreaches(OUTSIDE_AND_CHEAP, EVERY_LIMIT)).toEqual(["city", "price_below", "area_below"]);
  });

  it.each<[string, Partial<LimitedOffer>, LimitBreach[]]>([
    ["price", { price: null }, ["city", "area_below"]],
    ["area", { area_m2: null }, ["city", "price_above"]],
    ["location", { location_label: null }, ["price_above", "area_below"]],
  ])("gives no mark for an unstated %s, and keeps the marks of the stated facts", (_fact, unstated, expected) => {
    expect(limitBreaches({ ...OUTSIDE_AND_DEAR, ...unstated }, EVERY_LIMIT)).toEqual(expected);
  });

  it("gives no price mark for an unstated price that a floor is set for", () => {
    expect(limitBreaches({ ...OUTSIDE_AND_CHEAP, price: null }, EVERY_LIMIT)).toEqual(["city", "area_below"]);
  });

  it("gives no mark at all to an offer that states nothing", () => {
    const nothingStated: LimitedOffer = { price: null, price_currency: null, area_m2: null, location_label: null };
    expect(limitBreaches(nothingStated, EVERY_LIMIT)).toEqual([]);
  });

  it.each<[string, Partial<TeamLimits>, LimitedOffer, LimitBreach[]]>([
    ["city", { city: null }, OUTSIDE_AND_DEAR, ["price_above", "area_below"]],
    ["price ceiling", { priceMax: null }, OUTSIDE_AND_DEAR, ["city", "area_below"]],
    ["price floor", { priceMin: null }, OUTSIDE_AND_CHEAP, ["city", "area_below"]],
    ["area floor", { areaMin: null }, OUTSIDE_AND_DEAR, ["city", "price_above"]],
  ])("reads an unset %s as no limit, never as zero", (_limit, unset, breaking, expected) => {
    expect(limitBreaches(breaking, { ...EVERY_LIMIT, ...unset })).toEqual(expected);
  });

  it("marks nothing when no limit is set", () => {
    expect(limitBreaches(OUTSIDE_AND_DEAR, limits())).toEqual([]);
    expect(limitBreaches(OUTSIDE_AND_CHEAP, limits())).toEqual([]);
  });
});

describe("limitBreaches: price is compared in PLN only, bounds inclusive (#1, FR-002)", () => {
  const range = limits({ priceMin: 600000, priceMax: 850000 });

  it.each<[number, LimitBreach[]]>([
    [850000, []],
    [850001, ["price_above"]],
    [600000, []],
    [599999, ["price_below"]],
    [790000, []],
  ])("a price of %d PLN against 600 000–850 000 gives %j", (price, expected) => {
    expect(limitBreaches(offer({ price }), range)).toEqual(expected);
  });

  // A price in another currency, or with no currency, is unknown to the mark: the amount cannot
  // be compared with a limit in złoty.
  it.each<[string | null, number]>([
    ["EUR", 980000],
    ["EUR", 540000],
    [null, 980000],
    [null, 540000],
  ])("gives no price mark with currency %j and a price of %d", (price_currency, price) => {
    expect(limitBreaches(offer({ price, price_currency }), range)).toEqual([]);
  });

  it("marks the same amounts once they are stated in PLN", () => {
    expect(limitBreaches(offer({ price: 980000 }), range)).toEqual(["price_above"]);
    expect(limitBreaches(offer({ price: 540000 }), range)).toEqual(["price_below"]);
  });
});

describe("limitBreaches: area below the floor (#1, FR-002)", () => {
  it.each<[number, LimitBreach[]]>([
    [60, []],
    [59.99, ["area_below"]],
    [45.5, ["area_below"]],
    [72.5, []],
  ])("an area of %d m² against a floor of 60 gives %j", (area_m2, expected) => {
    expect(limitBreaches(offer({ area_m2 }), limits({ areaMin: 60 }))).toEqual(expected);
  });
});

describe("limitBreaches: the city is one of the location's comma-separated parts (#1, FR-002)", () => {
  it("marks an offer outside the city and leaves one inside it unmarked", () => {
    const warszawa = limits({ city: "Warszawa" });
    expect(limitBreaches(offer({ location_label: "Ząbki, wołomiński, mazowieckie" }), warszawa)).toEqual(["city"]);
    expect(limitBreaches(offer({ location_label: "Stary Mokotów, Mokotów, Warszawa, mazowieckie" }), warszawa)).toEqual(
      [],
    );
  });

  it.each<[string, string]>([
    ["lodz", "Bałuty, Łódź, łódzkie"],
    ["Łódź", "Bałuty, Lodz, lodzkie"],
    ["ŁÓDŹ", "bałuty, łódź, łódzkie"],
    ["  Łódź  ", "Bałuty,Łódź,łódzkie"],
  ])("reads the limit %j and the location %j as the same city", (city, location_label) => {
    expect(limitBreaches(offer({ location_label }), limits({ city }))).toEqual([]);
  });

  it.each(["lodz", "Łódź"])("marks an offer outside Łódź under the limit %j", (city) => {
    expect(limitBreaches(offer({ location_label: "Ząbki, wołomiński, mazowieckie" }), limits({ city }))).toEqual([
      "city",
    ]);
  });

  // A hyphen and an en dash read as a space, so one town spelled three ways is one town.
  const BIELSKO_SPELLINGS = ["Bielsko Biała", "Bielsko-Biała", "Bielsko–Biała", "BIELSKO-BIAŁA", "  bielsko   biała "];

  it.each(BIELSKO_SPELLINGS.flatMap((city) => BIELSKO_SPELLINGS.map((place) => [city, place] as const)))(
    "reads the limit %j and the location part %j as the same town",
    (city, place) => {
      expect(limitBreaches(offer({ location_label: `${place}, śląskie` }), limits({ city }))).toEqual([]);
    },
  );

  it.each(BIELSKO_SPELLINGS)("marks an offer in another town under the limit %j", (city) => {
    expect(limitBreaches(offer({ location_label: "Katowice, śląskie" }), limits({ city }))).toEqual(["city"]);
  });

  // A label that is empty, or only spaces and commas, states no place (prd.md, FR-002).
  it.each(["", "  ", " , ", ", ,"])("gives no mark for the location %j, which names no place", (location_label) => {
    expect(limitBreaches(offer({ location_label }), limits({ city: "Warszawa" }))).toEqual([]);
  });

  it("marks a location that names one place outside the city", () => {
    expect(limitBreaches(offer({ location_label: "Ząbki" }), limits({ city: "Warszawa" }))).toEqual(["city"]);
  });
});

describe("limitBreaches: the order of the marks (#1)", () => {
  it("answers city, price_above, price_below, area_below, in that order", () => {
    // All four at once need a price range the form refuses: floor above ceiling.
    const inverted: TeamLimits = { city: "Warszawa", priceMin: 900000, priceMax: 800000, areaMin: 60 };
    const between: LimitedOffer = { ...OUTSIDE_AND_DEAR, price: 850000 };
    expect(limitBreaches(between, inverted)).toEqual(["city", "price_above", "price_below", "area_below"]);
  });
});

// Limits neither the form nor the table's checks let through. The function still answers for
// them, by the rules in CLAUDE.md (## Structure).
describe("limitBreaches: limits the form does not allow (#1)", () => {
  it.each<[number, LimitBreach[]]>([
    [850000, ["price_above", "price_below"]],
    [950000, ["price_above"]],
    [750000, ["price_below"]],
  ])("judges each bound of an inverted range on its own: %d PLN gives %j", (price, expected) => {
    expect(limitBreaches(offer({ price }), limits({ priceMin: 900000, priceMax: 800000 }))).toEqual(expected);
  });

  it.each(["", "  "])("reads the city limit %j as no limit", (city) => {
    const outside = offer({ location_label: "Ząbki, wołomiński, mazowieckie" });
    expect(limitBreaches(outside, limits({ city }))).toEqual([]);
    expect(limitBreaches(outside, limits({ city: "Warszawa" }))).toEqual(["city"]);
  });

  it("compares a city limit with a comma as a whole, so it marks every stated location", () => {
    const withComma = limits({ city: "Warszawa, mazowieckie" });
    expect(
      limitBreaches(offer({ location_label: "Stary Mokotów, Mokotów, Warszawa, mazowieckie" }), withComma),
    ).toEqual(["city"]);
    expect(limitBreaches(offer({ location_label: null }), withComma)).toEqual([]);
  });
});

describe("normalizePlace (#1)", () => {
  it.each<[string, string]>([
    ["Warszawa", "warszawa"],
    ["Łódź", "lodz"],
    ["ŁÓDŹ", "lodz"],
    ["Ząbki", "zabki"],
    ["  Stary Mokotów  ", "stary mokotow"],
    ["Bielsko-Biała", "bielsko biala"],
    ["Bielsko–Biała", "bielsko biala"],
    ["Bielsko   Biała", "bielsko biala"],
    ["   ", ""],
    ["", ""],
  ])("reads %j as %j", (value, expected) => {
    expect(normalizePlace(value)).toBe(expected);
  });
});
