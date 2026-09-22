// Shapes shared by the otodom ingestion modules. Type declarations only: map.ts and
// fetch.ts import from here with `import type`, so Node can load them by type stripping
// (scripts/otodom-inspect.mjs).

export type UrlFailureReason = "empty" | "malformed" | "foreign_host" | "not_an_offer";

export type NormalizeUrlResult = { ok: true; url: string } | { ok: false; reason: UrlFailureReason };

export type FetchFailureReason = "http_denied" | "not_found" | "expired" | "shape_changed" | "timeout" | "network";

export type FetchOfferResult = { ok: true; ad: unknown } | { ok: false; reason: FetchFailureReason; status?: number };

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

export type MapOfferResult =
  { ok: true; offer: OfferInsert } | { ok: false; reason: MapFailureReason; detail?: string };
