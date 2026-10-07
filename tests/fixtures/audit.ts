// A saved offer and the team's criteria as the audit meets them, written by hand. Nothing here
// was recorded from the live portal or from a real team, and nothing may be replaced by a
// recorded row: the repository is public (CLAUDE.md, Testing).
//
// The fixture carries, on purpose, everything that must never reach the model provider — seller
// data in `raw`, members' notes, email addresses, member and offer ids, the source URL, image
// URLs, coordinates — each as a canary a test can search the audit's input and prompt for. A
// test that finds none of them proves the whitelist; a fixture without them would prove nothing.
//
// The advertiser also typed a phone number and a name into the description. Those are the
// listing's own words and stay verbatim (prd.md, Non-Functional Requirements). They are spelled
// differently from the canaries in `raw`, so a test can tell the two apart.

import { CANARY_NAME, CANARY_PHONE } from "./otodom";

/** Typed by the advertiser into the description: must reach the prompt exactly as written. */
export const TYPED_PHONE = CANARY_PHONE;
export const TYPED_NAME = CANARY_NAME;

/** Seller data as the portal's contact fields would carry it — present in `raw` only. */
export const RAW_SELLER_CANARIES = [
  "+48 700 000 002",
  "700000002",
  "Kanarek Surowy",
  "kanarek-seller-0002",
  "kanarek-user-0002",
] as const;

export const OFFER_ID_CANARY = "0b9f0c2e-7d1a-4c55-9a53-0000000a0d17";
export const SOURCE_URL_CANARY = "https://www.otodom.pl/pl/oferta/mieszkanie-kanarek-audytu-IDAUDYT1";
export const OTODOM_ID_CANARY = 65000017;
export const IMAGE_URL_CANARY = "https://images.example.com/kanarek-audytu";

/** Who saved the offer, who wrote notes on it, and who wrote the requirements. */
export const SAVER_ID_CANARY = "7a2b9c1d-3e4f-4a5b-8c6d-0000000005a7";
export const ANNA_ID_CANARY = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000a1";
export const BARTEK_ID_CANARY = "7a2b9c1d-3e4f-4a5b-8c6d-0000000000b2";
export const ANNA_EMAIL_CANARY = "anna.kanarek@example.test";
export const BARTEK_EMAIL_CANARY = "bartek.kanarek@example.test";

/** The three fields of a member's note. Notes are conclusions drawn from the audit, never an input to it. */
export const NOTE_CANARIES = [
  "kanarek-notatka-zalety: jasna kuchnia",
  "kanarek-notatka-wady: głośna ulica",
  "kanarek-notatka-obserwacje: sprzedający się spieszy",
] as const;

/** Coordinates are stored with an offer and are not on the audit's whitelist. */
export const COORDINATE_CANARIES = ["52.2297", "21.0122"] as const;

/** Everything that must be absent from the audit's input and from both parts of the prompt. */
export const FORBIDDEN_IN_AUDIT = [
  ...RAW_SELLER_CANARIES,
  OFFER_ID_CANARY,
  SOURCE_URL_CANARY,
  String(OTODOM_ID_CANARY),
  IMAGE_URL_CANARY,
  SAVER_ID_CANARY,
  ANNA_ID_CANARY,
  BARTEK_ID_CANARY,
  ANNA_EMAIL_CANARY,
  BARTEK_EMAIL_CANARY,
  ...NOTE_CANARIES,
  ...COORDINATE_CANARIES,
  // `raw.description` is the listing's HTML; the audit reads the plain-text column.
  "<p>",
  "kanarek-surowy-opis",
] as const;

export const AUDIT_TITLE = "Mieszkanie 3 pokoje z balkonem, Praga-Południe";

// The description as the mapper stores it: plain text, line breaks kept, a no-break space
// (U+00A0) where the listing's HTML had `&nbsp;` — here between each amount and its unit. One
// sentence runs over a line break, one line holds an emoji, and „Praga-Południe" also stands in
// the title.
export const AUDIT_DESCRIPTION = [
  "Sprzedam mieszkanie 3-pokojowe o powierzchni 54,5 m² na 7. piętrze.",
  "Blok z 1975 roku, Praga-Południe, blisko metra.",
  "Czynsz administracyjny 650 zł miesięcznie, w tym fundusz remontowy.",
  "",
  "Kupujący pokrywa prowizję biura w wysokości 2% ceny.",
  "Mieszkanie z lokatorem, umowa najmu",
  "do końca 2027 roku.",
  "Zapraszam 🏠 na prezentację.",
  `Kontakt: ${TYPED_NAME}, tel. ${TYPED_PHONE}.`,
].join("\n");

/**
 * One `public.offers` row as the Data API answers `select *`, with every fact stated — plus
 * what a careless query could embed beside it (`offer_notes`, `members`). `raw` holds what a
 * writer other than the mapper might have left there: the portal's seller fields, and the
 * placeholder `rent: "0"` the portal sends for a rent the advertiser left blank.
 */
export function auditOfferRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: OFFER_ID_CANARY,
    source_url: SOURCE_URL_CANARY,
    otodom_id: OTODOM_ID_CANARY,
    created_by: SAVER_ID_CANARY,
    created_at: "2026-10-01T09:00:00+00:00",
    fetched_at: "2026-10-01T09:00:00+00:00",
    listed_at: "2026-09-01T10:00:00+00:00",
    listing_modified_at: "2026-09-10T12:30:00+00:00",

    title: AUDIT_TITLE,
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
    latitude: 52.2297,
    longitude: 21.0122,

    features: ["balcony", "lift", "piwnica"],
    images: [{ thumbnail: `${IMAGE_URL_CANARY}/thumbnail.jpg`, large: `${IMAGE_URL_CANARY}/large.jpg` }],
    raw: {
      id: OTODOM_ID_CANARY,
      url: SOURCE_URL_CANARY,
      title: AUDIT_TITLE,
      description: "<p>kanarek-surowy-opis</p><p>Kontakt: Kanarek Surowy, tel. +48 700 000 002.</p>",
      characteristics: [
        { key: "price", value: "599000", localizedValue: "599 000 zł", currency: "PLN" },
        { key: "rent", value: "0", localizedValue: "0 zł", currency: "PLN" },
      ],
      owner: { name: "Kanarek Surowy", phones: ["+48 700 000 002"] },
      contactDetails: { name: "Kanarek Surowy", phones: ["700000002"] },
      target: { OfferType: "sprzedaz", ProperType: "mieszkanie", seller_id: "kanarek-seller-0002" },
      user_id: "kanarek-user-0002",
      images: [{ large: `${IMAGE_URL_CANARY}/raw-large.jpg` }],
    },

    offer_notes: [
      { id: "note-1", author_id: ANNA_ID_CANARY, pros: NOTE_CANARIES[0], cons: NOTE_CANARIES[1], observations: "" },
      { id: "note-2", author_id: BARTEK_ID_CANARY, pros: "", cons: "", observations: NOTE_CANARIES[2] },
    ],
    members: [
      { id: ANNA_ID_CANARY, email: ANNA_EMAIL_CANARY },
      { id: BARTEK_ID_CANARY, email: BARTEK_EMAIL_CANARY },
    ],
    ...overrides,
  };
}

export const ANNA_REQUIREMENTS = "Balkon albo loggia. Najwyżej trzecie piętro bez windy.";
export const BARTEK_REQUIREMENTS = "Miejsce postojowe w garażu podziemnym.";

/**
 * The team's criteria as `loadAuditCriteria` answers them, inside an object that also carries
 * what the criteria page's read attaches — authors with their email addresses and ids. The
 * audit's input is built from `limits` and `requirements` alone.
 */
export function auditCriteria() {
  return {
    state: "ok" as const,
    limits: { city: "Warszawa", priceMin: 500000, priceMax: 650000, areaMin: 45.5 },
    requirements: [ANNA_REQUIREMENTS, BARTEK_REQUIREMENTS],
    revision: 7,
    limitsChangedBy: { kind: "member" as const, email: ANNA_EMAIL_CANARY },
    own: { author: { kind: "self" as const }, authorId: SAVER_ID_CANARY, body: ANNA_REQUIREMENTS },
    others: [{ author: { kind: "member" as const, email: BARTEK_EMAIL_CANARY }, authorId: BARTEK_ID_CANARY, body: "" }],
  };
}
