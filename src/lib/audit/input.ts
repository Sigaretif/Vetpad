// What an AI audit is given (FR-010): the listing's own words, its stated parameters and the
// team's criteria — and nothing else. Three rules live here and nowhere else:
//
// - The input is built from a whitelist. `AUDIT_OFFER_COLUMNS` names every `public.offers` column
//   the audit may read, and no code below touches a row by any other key. `raw` (which still
//   holds the portal's placeholders such as `rent: "0"`), `images`, `source_url`, `id` and
//   `created_by` are not on it, so they cannot reach the model provider. Members' notes have no
//   way in at all: nothing here takes them, and `eslint.config.js` forbids this directory from
//   importing `@/lib/notes` (PRD, Non-Functional Requirements).
// - An unstated fact stays unstated. A `null` column reads „nie podano w ogłoszeniu", never zero
//   and never "no" (PRD, Guardrails). A value that does not read as what its column holds is a
//   refusal — never downgraded to "not stated", which would invent a fact about the listing.
// - The listing's text is never altered. A phone number or a name the advertiser typed into the
//   title or the description stays as written: redacting it would break the verbatim excerpts
//   the audit has to quote (FR-011).
//
// `@/lib/criteria` enters only through `import type`: its runtime half reads members.

import type { AuditCriteriaResult } from "@/lib/criteria";
import {
  advertTypeLabel,
  buildingMaterialLabel,
  buildingOwnershipLabel,
  buildingTypeLabel,
  constructionStatusLabel,
  energyCertificateLabel,
  featureLabel,
  floorLabel,
  formatArea,
  formatDate,
  formatInteger,
  formatMoney,
  heatingLabel,
  marketLabel,
  windowsTypeLabel,
} from "@/lib/otodom/labels";
import type { OfferInsert } from "@/lib/otodom/types";

/**
 * The audit's whitelist of `public.offers` columns, in a fixed order: the listing's words, the
 * facts it states and its amenities. The order is also the order of `listingFingerprint`, so
 * changing it — like adding or removing a column — changes the fingerprint of every offer and
 * needs a new fingerprint version.
 */
export const AUDIT_OFFER_COLUMNS = [
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
] as const;

export type AuditOfferColumn = (typeof AUDIT_OFFER_COLUMNS)[number];

/** The whitelisted columns of one offer, each read and found to hold what its column holds. */
export type AuditOffer = Pick<OfferInsert, AuditOfferColumn>;

/** How an unstated fact reads, on the card and in the audit alike (PRD, Open Questions, resolved block). */
export const UNSTATED = "nie podano w ogłoszeniu";

/** How an unset limit reads, as on /criteria. */
export const NO_LIMIT = "bez limitu";

/**
 * The decision-critical attributes (FR-011): the only ones a missing-information finding may be
 * about, each with the column that states it and the name the instruction gives it. The keys are
 * the tokens of the model's answer (`AUDIT_OUTPUT_SCHEMA`); the schema's enum, the instruction
 * and the grounding all read this one list.
 */
export const DECISION_CRITICAL = {
  price: { column: "price", name: "cena" },
  area: { column: "area_m2", name: "metraż" },
  location: { column: "location_label", name: "lokalizacja" },
  floor: { column: "floor", name: "piętro" },
  heating: { column: "heating", name: "ogrzewanie" },
  ownership: { column: "building_ownership", name: "forma własności" },
  admin_rent: { column: "rent", name: "czynsz administracyjny" },
  build_year: { column: "build_year", name: "rok budowy" },
  finish_state: { column: "construction_status", name: "stan wykończenia" },
} as const satisfies Record<string, { column: AuditOfferColumn; name: string }>;

export type DecisionCriticalAttribute = keyof typeof DECISION_CRITICAL;

export const DECISION_CRITICAL_ATTRIBUTES = Object.keys(DECISION_CRITICAL) as DecisionCriticalAttribute[];

/** One labelled line of the input: a parameter of the listing, or one of the team's limits. */
export interface AuditLine {
  label: string;
  value: string;
}

/** One member's requirements under the number the model refers to them by. Never their author. */
export interface AuditRequirement {
  ref: string;
  body: string;
}

export interface AuditInput {
  /** The listing's words, exactly as stored: the only text an excerpt may come from. */
  title: string;
  description: string;
  /** Every parameter always has its line; an unstated one reads `UNSTATED`. */
  parameters: AuditLine[];
  /** Amenities under their Polish names. Empty means the listing names none, not that it has none. */
  features: string[];
  /** Every limit always has its line; an unset one reads `NO_LIMIT`. */
  limits: AuditLine[];
  requirements: AuditRequirement[];
  /** The decision-critical attributes whose column is empty — the only ones a missing-information finding may name. */
  unstatedAttributes: DecisionCriticalAttribute[];
}

/** The part of a successful `loadAuditCriteria` the input is built from. */
export type AuditCriteria = Pick<Extract<AuditCriteriaResult, { state: "ok" }>, "limits" | "requirements">;

// Reading a row. Each reader answers the value, `null` for "the listing did not state it", or
// `undefined` for a value that does not read as what the column holds.

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The title and the description: there is no listing without them. Kept exactly as stored. */
function requiredText(value: unknown): string | undefined {
  return isText(value) ? value : undefined;
}

/** A text fact. A blank text is neither a fact nor "not stated": the mapper never stores one. */
function statedText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isText(value) ? value : undefined;
}

/** Plain decimal notation, as Postgres writes a `numeric`: nothing here is read by interpretation. */
const DECIMAL = /^\d+(?:\.\d+)?$/;

/**
 * A numeric fact as PostgREST sends it — a JSON number, or a string for a `numeric`. Zero and a
 * negative number are unreadable, not "not stated": the table's checks admit neither
 * (20260926155042_offers_numeric_facts_positive.sql), so a row holding one is not a row to
 * build facts from, and reading it as "not stated" would be this code deciding what the listing
 * says.
 */
function statedNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  const decimal = typeof value === "string" && DECIMAL.test(value);
  const parsed = typeof value === "number" ? value : decimal ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** `statedNumber` for the integer columns: a fractional count is not a count. */
function statedInteger(value: unknown): number | null | undefined {
  const parsed = statedNumber(value);
  return typeof parsed === "number" && !Number.isInteger(parsed) ? undefined : parsed;
}

/** The amenity tokens. Anything but a list of non-blank texts is unreadable. */
function featureList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const features = value as unknown[];
  return features.every(isText) ? [...features] : undefined;
}

const COLUMN_READERS: { [Column in AuditOfferColumn]: (value: unknown) => AuditOffer[Column] | undefined } = {
  title: requiredText,
  description: requiredText,
  price: statedNumber,
  price_currency: statedText,
  price_per_m: statedNumber,
  area_m2: statedNumber,
  rooms: statedInteger,
  floors_total: statedInteger,
  build_year: statedInteger,
  rent: statedNumber,
  rent_currency: statedText,
  floor: statedText,
  market: statedText,
  building_type: statedText,
  construction_status: statedText,
  building_ownership: statedText,
  heating: statedText,
  windows_type: statedText,
  building_material: statedText,
  energy_certificate: statedText,
  advert_type: statedText,
  free_from: statedText,
  location_label: statedText,
  street_name: statedText,
  features: featureList,
};

/**
 * The offer as the audit may see it, from a `public.offers` row as the database answered it — or
 * `null` when the row cannot be audited: it is not a row, the title or the description is
 * missing or blank, or a whitelisted column holds a value that does not read (a column missing
 * from the row included). A number sent as text reads as that number.
 *
 * Only the whitelisted keys of `row` are read; whatever else it carries is never looked at.
 */
export function readAuditOffer(row: unknown): AuditOffer | null {
  // Anything that is not an object has none of the columns; a list has none either, and is
  // refused at its first missing column like any other row without them.
  if (typeof row !== "object" || row === null) return null;
  const columns = row as Record<string, unknown>;
  const offer: Partial<Record<AuditOfferColumn, unknown>> = {};
  for (const column of AUDIT_OFFER_COLUMNS) {
    const value = COLUMN_READERS[column](columns[column]);
    if (value === undefined) return null;
    offer[column] = value;
  }
  // Every column went through its own reader, which the mapped type above ties to the column.
  return offer as AuditOffer;
}

/**
 * The parameters' labels, as on the offer card (`src/components/offers/OfferParameters.astro`),
 * so the model reads what the member reads. Keyed by the column that decides whether the
 * parameter is stated.
 */
const PARAMETER_LABELS = {
  price: "Cena",
  price_per_m: "Cena za m²",
  area_m2: "Powierzchnia",
  rooms: "Liczba pokoi",
  floor: "Piętro",
  floors_total: "Liczba pięter w budynku",
  build_year: "Rok budowy",
  rent: "Czynsz",
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
} as const satisfies Partial<Record<AuditOfferColumn, string>>;

type ParameterColumn = keyof typeof PARAMETER_LABELS;

/** `null` is "the listing did not state it"; a value is always formatted. */
function show<T>(value: T | null, format: (value: T) => string): string | null {
  return value === null ? null : format(value);
}

/**
 * The parameter lines in the card's order: each column with the stated value as the card shows
 * it, or `null` when the listing did not state it.
 */
const PARAMETER_ROWS: readonly [column: ParameterColumn, value: (offer: AuditOffer) => string | null][] = [
  ["price", (o) => show(o.price, (v) => formatMoney(v, o.price_currency))],
  ["price_per_m", (o) => show(o.price_per_m, (v) => `${formatMoney(v, o.price_currency)}/m²`)],
  ["area_m2", (o) => show(o.area_m2, formatArea)],
  ["rooms", (o) => show(o.rooms, formatInteger)],
  ["floor", (o) => show(o.floor, floorLabel)],
  ["floors_total", (o) => show(o.floors_total, formatInteger)],
  ["build_year", (o) => show(o.build_year, formatInteger)],
  ["rent", (o) => show(o.rent, (v) => formatMoney(v, o.rent_currency))],
  ["market", (o) => show(o.market, marketLabel)],
  ["building_type", (o) => show(o.building_type, buildingTypeLabel)],
  ["construction_status", (o) => show(o.construction_status, constructionStatusLabel)],
  ["building_ownership", (o) => show(o.building_ownership, buildingOwnershipLabel)],
  ["heating", (o) => show(o.heating, heatingLabel)],
  ["windows_type", (o) => show(o.windows_type, windowsTypeLabel)],
  ["building_material", (o) => show(o.building_material, buildingMaterialLabel)],
  ["energy_certificate", (o) => show(o.energy_certificate, energyCertificateLabel)],
  ["advert_type", (o) => show(o.advert_type, advertTypeLabel)],
  ["free_from", (o) => show(o.free_from, formatDate)],
  ["location_label", (o) => o.location_label],
  ["street_name", (o) => o.street_name],
];

/** The label of the parameter line that shows a decision-critical attribute, for the instruction. */
export function criticalParameterLabel(attribute: DecisionCriticalAttribute): string {
  return PARAMETER_LABELS[DECISION_CRITICAL[attribute].column];
}

/**
 * The audit's input: the listing's words, every parameter under its Polish label, the amenities,
 * the team's limits and the members' requirements numbered `W1…Wn` in the order given.
 *
 * Takes the offer `readAuditOffer` produced and the criteria `loadAuditCriteria` read, and reads
 * nothing but the fields named here — an object carrying more (an author, an email address, a
 * note) passes none of it on.
 */
export function buildAuditInput(offer: AuditOffer, criteria: AuditCriteria): AuditInput {
  const { city, priceMin, priceMax, areaMin } = criteria.limits;
  return {
    title: offer.title,
    description: offer.description,
    parameters: PARAMETER_ROWS.map(([column, value]) => ({
      label: PARAMETER_LABELS[column],
      value: value(offer) ?? UNSTATED,
    })),
    features: offer.features.map(featureLabel),
    limits: [
      { label: "Miasto", value: city ?? NO_LIMIT },
      { label: "Cena od", value: show(priceMin, (v) => formatMoney(v, "PLN")) ?? NO_LIMIT },
      { label: "Cena do", value: show(priceMax, (v) => formatMoney(v, "PLN")) ?? NO_LIMIT },
      { label: "Minimalny metraż", value: show(areaMin, formatArea) ?? NO_LIMIT },
    ],
    requirements: criteria.requirements.map((body, index) => ({ ref: `W${index + 1}`, body })),
    unstatedAttributes: DECISION_CRITICAL_ATTRIBUTES.filter(
      (attribute) => offer[DECISION_CRITICAL[attribute].column] === null,
    ),
  };
}

/** The fingerprint's format. A fingerprint of another version says nothing about whether the listing changed. */
const FINGERPRINT_VERSION = "v1";

/**
 * What the audit read of the listing, as `v1:` + SHA-256 (hex) — stored with the audit so that
 * S-09 can tell whether the listing changed since. It is taken from the raw values of the
 * whitelisted columns, under their column names, in the order of `AUDIT_OFFER_COLUMNS`: not from
 * the labels of `@/lib/otodom/labels`, not from the prompt, and not from the key order of the
 * row. Rewording an instruction or a label therefore changes no offer's fingerprint.
 *
 * `crypto.subtle` is Web Crypto, present in workerd and in Node alike — never `node:crypto`.
 */
export async function listingFingerprint(offer: AuditOffer): Promise<string> {
  const values: Partial<Record<AuditOfferColumn, unknown>> = {};
  for (const column of AUDIT_OFFER_COLUMNS) values[column] = offer[column];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(values)));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${FINGERPRINT_VERSION}:${hex}`;
}
