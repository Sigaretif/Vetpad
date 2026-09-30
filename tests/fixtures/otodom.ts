// Synthetic otodom `pageProps.ad` payloads, written by hand from the shapes documented in
// context/foundation/ingestion/otodom_fetching.md, section 7 (7.1 traps, 7.3 field map, 7.4 gate
// table). Nothing here was recorded from the live portal, and nothing may be replaced by a
// recorded payload: the repository is public, and a live listing carries a real advertiser's
// phone number and name. The oracle is the document, not a page.
//
// Every variant carries the same seller canaries in the places the portal puts seller data
// (`owner`, `contactDetails`, `agency`, `target.seller_id`/`user_id`), so a test can search a
// mapped row for them. The advertiser also typed the canary phone and name into `description`,
// which the product keeps verbatim (prd.md, Non-Functional Requirements).

export const CANARY_PHONE = "+48 600 000 001";
/** Every spelling of the canary phone a leak could take; a test searches for each. */
export const CANARY_PHONE_SPELLINGS = [CANARY_PHONE, "600000001", "600 000 001"] as const;
export const CANARY_NAME = "Kanarek Testowy";
export const CANARY_SELLER_ID = "kanarek-seller-0001";
export const CANARY_USER_ID = "kanarek-user-0001";
export const CANARY_STREET = "ul. Kanarkowa";

/** Every seller canary that must never reach a stored row outside the listing's own words. */
export const SELLER_CANARIES = [...CANARY_PHONE_SPELLINGS, CANARY_NAME, CANARY_SELLER_ID, CANARY_USER_ID] as const;

export type Ad = Record<string, unknown>;

/** One `characteristics[]` entry, as section 7.3 lists it. */
export interface Characteristic {
  key: string;
  value: unknown;
  localizedValue: string;
  currency?: string;
}

export const FLAT_SALE_URL = "https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1";

export const FLAT_SALE_DESCRIPTION_HTML =
  "<p>Sprzedam mieszkanie 3-pokojowe, 54,5 m², 7. piętro w bloku z 1975 roku.</p>" +
  `<p>Kontakt: ${CANARY_NAME}, tel. ${CANARY_PHONE}.</p>`;

function characteristics(): Characteristic[] {
  return [
    // Numeric and monetary entries have a filled `localizedValue` (section 7.1).
    { key: "price", value: "599000", localizedValue: "599 000 zł", currency: "PLN" },
    { key: "price_per_m", value: "10990.83", localizedValue: "10 991 zł/m²", currency: "PLN" },
    { key: "m", value: "54.5", localizedValue: "54,5 m²" },
    { key: "rooms_num", value: "3", localizedValue: "3" },
    { key: "building_floors_num", value: "10", localizedValue: "10" },
    { key: "build_year", value: "1975", localizedValue: "1975" },
    { key: "rent", value: "650", localizedValue: "650 zł", currency: "PLN" },
    { key: "free_from", value: "2026-11-01", localizedValue: "01.11.2026" },
    // Enum entries: `localizedValue` is an empty string, the token sits in `value` (section 7.1).
    { key: "floor_no", value: "floor_7", localizedValue: "" },
    { key: "market", value: "secondary", localizedValue: "" },
    { key: "building_type", value: "block", localizedValue: "" },
    { key: "construction_status", value: "ready_to_use", localizedValue: "" },
    { key: "building_ownership", value: "full_ownership", localizedValue: "" },
    { key: "heating", value: "urban", localizedValue: "" },
    { key: "windows_type", value: "plastic", localizedValue: "" },
    { key: "building_material", value: "concrete_plate", localizedValue: "" },
    { key: "energy_certificate", value: "c", localizedValue: "" },
  ];
}

/** `target` repeats the seller's account id (section 7.3); every variant keeps the canaries. */
function target(offerType: string, properType: string): Ad {
  return {
    OfferType: offerType,
    ProperType: properType,
    MarketType: "secondary",
    City: "warszawa",
    seller_id: CANARY_SELLER_ID,
    user_id: CANARY_USER_ID,
    user_type: "private",
  };
}

/** A sale of a flat that passes the gate. `overrides` replace top-level `ad` keys. */
export function flatSaleAd(overrides: Ad = {}): Ad {
  return {
    id: 65000001,
    slug: "mieszkanie-54-m-warszawa-IDKANAR1",
    url: FLAT_SALE_URL,
    title: "Mieszkanie 3 pokoje, 54,5 m², Praga-Południe",
    description: FLAT_SALE_DESCRIPTION_HTML,
    createdAt: "2026-09-01T10:00:00Z",
    modifiedAt: "2026-09-10T12:30:00Z",
    status: "active",
    market: "SECONDARY",
    advertType: "PRIVATE",
    adCategory: { id: 101, name: "FLAT", type: "SELL" },
    // Section 7.3: a different field whose `name` is an empty array — never the gate.
    category: { id: 101, name: [] },
    target: target("sprzedaz", "mieszkanie"),
    characteristics: characteristics(),
    features: ["balkon", "winda"],
    location: {
      coordinates: { latitude: 52.2297, longitude: 21.0122 },
      reverseGeocoding: {
        locations: [
          { fullName: "Warszawa, mazowieckie", fullNameItems: ["Warszawa", "mazowieckie"] },
          {
            fullName: "Praga-Południe, Warszawa, mazowieckie",
            fullNameItems: ["Praga-Południe", "Warszawa", "mazowieckie"],
          },
        ],
      },
      // Section 7.3: `city`, `district`, `province` observed as null; only `street.name` filled.
      address: { street: { name: CANARY_STREET }, city: null, district: null, province: null },
    },
    images: [
      {
        thumbnail: "https://images.example.com/kanarek-1/thumbnail.jpg",
        small: "https://images.example.com/kanarek-1/small.jpg",
        medium: "https://images.example.com/kanarek-1/medium.jpg",
        large: "https://images.example.com/kanarek-1/large.jpg",
        isExterior: false,
      },
      {
        thumbnail: "https://images.example.com/kanarek-2/thumbnail.jpg",
        small: "https://images.example.com/kanarek-2/small.jpg",
        medium: "https://images.example.com/kanarek-2/medium.jpg",
        large: "https://images.example.com/kanarek-2/large.jpg",
        isExterior: true,
      },
    ],
    // Seller data (sections 1 and 7.1): the fields the mapper must never carry into a row.
    owner: {
      name: CANARY_NAME,
      phones: [CANARY_PHONE],
      contacts: [{ name: CANARY_NAME, phone: CANARY_PHONE }],
    },
    contactDetails: { name: CANARY_NAME, phones: ["600000001"] },
    agency: { name: CANARY_NAME },
    ...overrides,
  };
}

/**
 * A copy of `ad` with the `characteristics` entry `key` merged with `patch`, added when it is
 * missing, or removed when `patch` is `null`.
 */
export function withCharacteristic(ad: Ad, key: string, patch: Partial<Characteristic> | null): Ad {
  const entries = (ad.characteristics as Characteristic[]).filter((entry) => entry.key !== key);
  if (patch !== null) {
    const current = (ad.characteristics as Characteristic[]).find((entry) => entry.key === key);
    entries.push({ key, value: undefined, localizedValue: "", ...current, ...patch });
  }
  return { ...ad, characteristics: entries };
}

/** A copy of `ad` without the given top-level keys (absent, not `undefined`). */
export function omitKeys(ad: Ad, ...keys: string[]): Ad {
  return Object.fromEntries(Object.entries(ad).filter(([key]) => !keys.includes(key)));
}

// Variants from section 7.4. Each keeps the seller canaries.

/** Flat for rent (`…ID4DapL`): `market` reads `ALL` and `rent` arrives as "1" (section 7.1). */
export function rentalFlat(): Ad {
  const ad = flatSaleAd({
    market: "ALL",
    adCategory: { id: 102, name: "FLAT", type: "RENT" },
    target: target("wynajem", "mieszkanie"),
  });
  return withCharacteristic(ad, "rent", { value: "1", localizedValue: "1 zł" });
}

/** House for sale (`…ID4wZN2`): no `rent` key at all (section 7.1). */
export function saleHouse(): Ad {
  const ad = flatSaleAd({
    adCategory: { id: 201, name: "HOUSE", type: "SELL" },
    target: target("sprzedaz", "dom"),
  });
  return withCharacteristic(ad, "rent", null);
}

/** House for rent: fails both gates. Its `adCategory.id` is not documented, so it is left out. */
export function rentalHouse(): Ad {
  const ad = flatSaleAd({
    market: "ALL",
    adCategory: { name: "HOUSE", type: "RENT" },
    target: target("wynajem", "dom"),
  });
  return withCharacteristic(ad, "rent", null);
}

/** `adCategory` says rent while `target.OfferType` says sale: the shape is not what section 7.4 describes. */
export function typeDisagreement(): Ad {
  return flatSaleAd({
    adCategory: { id: 102, name: "FLAT", type: "RENT" },
    target: target("sprzedaz", "mieszkanie"),
  });
}

/** `category` claims a flat sale while `adCategory` says house: only a gate on `category` passes it. */
export function categoryTrap(): Ad {
  return flatSaleAd({
    adCategory: { id: 201, name: "HOUSE", type: "SELL" },
    category: { id: 101, name: "FLAT", type: "SELL" },
    target: target("sprzedaz", "dom"),
  });
}
