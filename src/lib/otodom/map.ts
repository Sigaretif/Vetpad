import type { MapOfferResult, OfferImage, OfferInsert } from "./types";

// Turns otodom's `pageProps.ad` into one `public.offers` row. Three guardrails live
// here and nowhere else: only a flat for sale passes, an unstated fact is `null`
// (never zero), and only the whitelisted listing fields below are ever read.
// Field map and traps: context/foundation/ingestion/otodom_fetching.md, section 7.1.

type Characteristic = Record<string, unknown>;

/** The top-level `ad` keys copied into `raw`. Anything else otodom sends is dropped. */
const RAW_AD_KEYS = [
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
] as const;

/** From `ad.location`, only these reach `raw` — the street address stays out. */
const RAW_LOCATION_KEYS = ["coordinates", "reverseGeocoding"] as const;

/**
 * From `ad.target`, only the gate's cross-check fields reach `raw`. `target` is
 * otodom's analytics bag and also repeats the seller's account id — it is never
 * copied whole.
 */
const RAW_TARGET_KEYS = ["OfferType", "ProperType"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * An absolute `https:` URL, or `null`. Mirrors `safeHttpsUrl` in `@/lib/safe-url` — kept local
 * because this module may only have type imports (scripts/otodom-inspect.mjs loads it in Node).
 */
function httpsUrl(value: unknown): string | null {
  const url = nonEmptyString(value);
  if (url === null) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The single path for every numeric fact. Absent, empty, unparseable and any value
 * `<= 0` all mean "not stated": otodom sends `rent` as "0" when the advertiser left
 * it blank, so a zero cannot be told apart from an omission.
 */
export function numericOrUnknown(raw: unknown): number | null {
  let parsed: number;
  if (typeof raw === "number") {
    parsed = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    parsed = Number(trimmed);
  } else {
    return null;
  }
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** `numericOrUnknown` narrowed for integer columns: a fractional count is not a count. */
function integerOrUnknown(raw: unknown): number | null {
  const value = numericOrUnknown(raw);
  return value !== null && Number.isInteger(value) ? value : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bdquo: "„",
  rdquo: "”",
  ldquo: "“",
  laquo: "«",
  raquo: "»",
  sup2: "²",
  deg: "°",
};

function decodeEntity(entity: string, body: string): string {
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
}

/**
 * Listing HTML to plain text: paragraph, line-break and list-item ends become line
 * breaks, every other tag disappears, entities are decoded in a single pass, and runs
 * of blank lines collapse into one. The result carries no `<` or `>`.
 */
export function htmlToPlainText(html: string): string {
  return (
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n\n")
      .replace(/<\/li\s*>/gi, "\n")
      // [^<>], not [^>]: a run of "<" with no ">" would otherwise backtrack quadratically.
      .replace(/<[^<>]*>/g, "")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, decodeEntity)
      .replace(/[<>]/g, "")
      .replace(/\r\n?/g, "\n")
      // Per-line trimEnd, not /[ \t\u00a0]+\n/: that regex backtracks quadratically on a long
      // run of spaces the advertiser controls (50k spaces ≈ 1.5 s CPU against the Free plan's 10 ms).
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function pickKeys(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

function buildRaw(ad: Record<string, unknown>): Record<string, unknown> {
  const raw = pickKeys(ad, RAW_AD_KEYS);
  if (isRecord(ad.target)) raw.target = pickKeys(ad.target, RAW_TARGET_KEYS);
  if (isRecord(ad.location)) raw.location = pickKeys(ad.location, RAW_LOCATION_KEYS);
  return raw;
}

function locationLabel(location: Record<string, unknown>): string | null {
  const reverse = location.reverseGeocoding;
  const entries = isRecord(reverse) && Array.isArray(reverse.locations) ? (reverse.locations as unknown[]) : [];
  let best: { label: string; depth: number } | null = null;
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.fullNameItems)) continue;
    const label = nonEmptyString(entry.fullName);
    const depth = entry.fullNameItems.length;
    if (label !== null && (best === null || depth > best.depth)) best = { label, depth };
  }
  return best?.label ?? null;
}

function streetName(location: Record<string, unknown>): string | null {
  const address = location.address;
  const street = isRecord(address) ? address.street : undefined;
  return isRecord(street) ? nonEmptyString(street.name) : null;
}

function coordinate(location: Record<string, unknown>, axis: "latitude" | "longitude"): number | null {
  const coordinates = location.coordinates;
  const value = isRecord(coordinates) ? coordinates[axis] : undefined;
  const limit = axis === "latitude" ? 90 : 180;
  // 0 is a placeholder, not a place; out of range is corrupt. Either is "not stated".
  return typeof value === "number" && Number.isFinite(value) && value !== 0 && Math.abs(value) <= limit ? value : null;
}

function mapImages(images: unknown): OfferImage[] {
  if (!Array.isArray(images)) return [];
  const mapped: OfferImage[] = [];
  for (const image of images as unknown[]) {
    if (!isRecord(image)) continue;
    const thumbnail = httpsUrl(image.thumbnail);
    const large = httpsUrl(image.large);
    if (thumbnail !== null && large !== null) mapped.push({ thumbnail, large });
  }
  return mapped;
}

function mapFeatures(features: unknown): string[] {
  if (!Array.isArray(features)) return [];
  return (features as unknown[]).filter((feature): feature is string => typeof feature === "string");
}

function timestampOrUnknown(value: unknown): string | null {
  const text = nonEmptyString(value);
  return text !== null && !Number.isNaN(Date.parse(text)) ? text : null;
}

export function mapAdToOffer(ad: unknown): MapOfferResult {
  if (!isRecord(ad)) return { ok: false, reason: "shape_changed" };

  // Gate: `adCategory`, not `category` — `category.name` is an empty array, and
  // comparing against it would silently disable the gate.
  const adCategory = ad.adCategory;
  const target = ad.target;
  if (!isRecord(adCategory) || !isRecord(target)) return { ok: false, reason: "shape_changed" };

  const isSale = adCategory.type === "SELL";
  if (isSale !== (target.OfferType === "sprzedaz")) {
    return { ok: false, reason: "shape_changed", detail: "adCategory.type and target.OfferType disagree" };
  }
  if (!isSale) return { ok: false, reason: "not_for_sale" };
  if (adCategory.name !== "FLAT") {
    const properType = nonEmptyString(target.ProperType);
    return properType === null
      ? { ok: false, reason: "not_a_flat" }
      : { ok: false, reason: "not_a_flat", detail: properType };
  }

  // Identity and text: without these there is no row worth saving.
  const otodomId = integerOrUnknown(ad.id);
  const title = nonEmptyString(ad.title);
  const url = nonEmptyString(ad.url);
  const description = typeof ad.description === "string" ? htmlToPlainText(ad.description) : "";
  if (otodomId === null || title === null || url === null || description === "") {
    return { ok: false, reason: "shape_changed", detail: "id, title, url or description missing" };
  }
  if (!Array.isArray(ad.characteristics)) {
    return { ok: false, reason: "shape_changed", detail: "characteristics missing" };
  }

  const characteristics = new Map<string, Characteristic>();
  for (const entry of ad.characteristics as unknown[]) {
    if (isRecord(entry) && typeof entry.key === "string") characteristics.set(entry.key, entry);
  }
  // Enums and numbers alike are read from `value`; `localizedValue` is an empty
  // string for every enum and would turn a stated fact into "not stated".
  const value = (key: string): unknown => characteristics.get(key)?.value;
  const token = (key: string): string | null => nonEmptyString(value(key));
  const amountWithCurrency = (key: string): [number | null, string | null] => {
    const amount = numericOrUnknown(value(key));
    return [amount, amount === null ? null : nonEmptyString(characteristics.get(key)?.currency)];
  };

  const [price, priceCurrency] = amountWithCurrency("price");
  const [pricePerM, pricePerMCurrency] = amountWithCurrency("price_per_m");
  const [rent, rentCurrency] = amountWithCurrency("rent");
  const freeFrom = token("free_from");
  const location = isRecord(ad.location) ? ad.location : {};

  const offer: OfferInsert = {
    otodom_id: otodomId,
    listed_at: timestampOrUnknown(ad.createdAt),
    listing_modified_at: timestampOrUnknown(ad.modifiedAt),

    title,
    description,

    price,
    // The currency of the sale amounts: with the price unstated but the price per m² stated,
    // it comes from that entry, so "12 345/m²" never renders without a currency.
    price_currency: priceCurrency ?? pricePerMCurrency,
    price_per_m: pricePerM,
    area_m2: numericOrUnknown(value("m")),
    rooms: integerOrUnknown(value("rooms_num")),
    floors_total: integerOrUnknown(value("building_floors_num")),
    build_year: integerOrUnknown(value("build_year")),
    rent,
    rent_currency: rentCurrency,

    floor: token("floor_no"),
    market: token("market"),
    building_type: token("building_type"),
    construction_status: token("construction_status"),
    building_ownership: token("building_ownership"),
    heating: token("heating"),
    windows_type: token("windows_type"),
    building_material: token("building_material"),
    energy_certificate: token("energy_certificate"),
    advert_type: nonEmptyString(ad.advertType),
    free_from: freeFrom !== null && ISO_DATE.test(freeFrom) ? freeFrom : null,

    location_label: locationLabel(location),
    street_name: streetName(location),
    latitude: coordinate(location, "latitude"),
    longitude: coordinate(location, "longitude"),

    features: mapFeatures(ad.features),
    images: mapImages(ad.images),
    raw: buildRaw(ad),
  };
  return { ok: true, offer };
}
