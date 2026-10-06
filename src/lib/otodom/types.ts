// Shapes shared by the otodom ingestion modules. Type declarations only: map.ts and
// fetch.ts import from here with `import type`, so Node can load them by type stripping
// (scripts/otodom-inspect.mjs).

export type UrlFailureReason = "empty" | "malformed" | "foreign_host" | "not_an_offer";

export type NormalizeUrlResult = { ok: true; url: string } | { ok: false; reason: UrlFailureReason };

export type FetchFailureReason =
  | "challenged"
  | "http_denied"
  | "upstream_error"
  | "not_found"
  | "unexpected_landing"
  | "expired"
  | "data_missing"
  | "shape_changed"
  | "timeout"
  | "network";

/**
 * What a failed fetch knows about the answer it got, for the log entry. A field is present only
 * when the fetch learned it: nothing about a response before its headers, nothing about a body
 * that was not read. It never holds the page's text, a query string or the path of an offer page —
 * the slug repeats the listing's title, so an offer is named by its `ID…` token alone.
 */
export interface FetchEvidence {
  landedHost?: string;
  /** Path only, and only for a landing that is not an offer page on otodom. */
  landedPath?: string;
  /** The `ID…` token ending the slug, only for a landing that is an offer page on otodom. */
  landedListing?: string;
  contentType?: string;
  bodyLength?: number;
  /** Whether the body carried the `__NEXT_DATA__` script. */
  markerPresent?: boolean;
  cfMitigated?: string;
  retryAfter?: string;
  errorName?: string;
  errorMessage?: string;
  errorCause?: string;
  /** Which call threw: `fetch()` before the headers, or the read of the body after them. */
  phase?: "headers" | "body";
}

export type FetchOfferResult =
  | { ok: true; ad: unknown }
  | { ok: false; reason: FetchFailureReason; status?: number; detail?: string; evidence: FetchEvidence };

export type MapFailureReason = "not_for_sale" | "not_a_flat" | "shape_changed";

export interface OfferImage {
  thumbnail: string;
  large: string;
}

/**
 * One `public.offers` row as the mapper produces it. Column names match
 * supabase/migrations/20260922202756_create_offers.sql.
 *
 * Left out on purpose, because the mapper does not know them: `source_url` and
 * `created_by`, which the saving route adds, and `id`, `created_at`, `fetched_at`,
 * which the database fills from their defaults.
 *
 * Every nullable fact means "the listing did not state it" — never zero, never "no".
 */
export interface OfferInsert {
  otodom_id: number;
  listed_at: string | null;
  listing_modified_at: string | null;

  title: string;
  description: string;

  price: number | null;
  price_currency: string | null;
  price_per_m: number | null;
  area_m2: number | null;
  rooms: number | null;
  floors_total: number | null;
  build_year: number | null;
  rent: number | null;
  rent_currency: string | null;

  floor: string | null;
  market: string | null;
  building_type: string | null;
  construction_status: string | null;
  building_ownership: string | null;
  heating: string | null;
  windows_type: string | null;
  building_material: string | null;
  energy_certificate: string | null;
  advert_type: string | null;
  free_from: string | null;

  location_label: string | null;
  street_name: string | null;
  latitude: number | null;
  longitude: number | null;

  /** An empty list means the listing names no amenities, not that it has none. */
  features: string[];
  images: OfferImage[];
  raw: Record<string, unknown>;
}

/**
 * One `public.offers` row as read back from the database: the mapped fields plus the
 * columns the saving route and the database defaults fill in. The Supabase client is
 * untyped, so the offer card casts its query result to this shape.
 */
export interface OfferRow extends OfferInsert {
  id: string;
  source_url: string;
  /** `null` only when the author's account was deleted — the offer outlives it. */
  created_by: string | null;
  created_at: string;
  fetched_at: string;
}

export type MapOfferResult =
  { ok: true; offer: OfferInsert } | { ok: false; reason: MapFailureReason; detail?: string };
