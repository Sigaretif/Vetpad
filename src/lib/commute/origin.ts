// Where a commute starts (FR-016): the offer's coordinates when the listing states both, else its
// location label and street, else nowhere — which the calculation route refuses as `no_origin`.
// Pure: no I/O, only the reading of a row the route fetched with `COMMUTE_OFFER_COLUMNS`.
//
// The row is not trusted — any member can PATCH any column of `public.offers` through the Data API —
// so every column is read by its type, and nothing in it is ever logged: the route logs only which
// kind of start it used.

/** The columns of `public.offers` a calculation reads: nothing else of the listing leaves the database. */
export const COMMUTE_OFFER_COLUMNS = [
  "id",
  "archived_at",
  "latitude",
  "longitude",
  "location_label",
  "street_name",
] as const;

/** The offer as a calculation needs it. */
export interface CommuteOffer {
  id: string;
  archivedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
  streetName: string | null;
}

/** The start of every route of one calculation. */
export type CommuteOrigin =
  { kind: "coordinates"; latitude: number; longitude: number } | { kind: "address"; address: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A `numeric` column: PostgREST may send it as a number or as text. A finite value within the
 * axis' range is a coordinate; anything else — absent, blank, `NaN`, out of range — is unknown.
 * 0 is kept: the mapper (src/lib/otodom/map.ts) already stores otodom's placeholder 0 as `null`.
 */
function coordinate(value: unknown, limit: number): number | null {
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && value.trim() !== "") parsed = Number(value);
  else return null;
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
}

/** A text column as a stated value: trimmed, and `null` when blank or not a string. */
function stated(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The row as a calculation reads it, or `null` when it does not read as an offer: no string `id`,
 * or an `archived_at` that is neither text nor null — whether the offer is archived could not be
 * told. A coordinate or a text column of the wrong type reads as unknown.
 */
export function readCommuteOffer(row: unknown): CommuteOffer | null {
  if (!isRecord(row)) return null;
  const { id, archived_at: archivedAt } = row;
  if (typeof id !== "string" || id === "") return null;
  if (archivedAt !== null && typeof archivedAt !== "string") return null;
  return {
    id,
    archivedAt,
    latitude: coordinate(row.latitude, 90),
    longitude: coordinate(row.longitude, 180),
    locationLabel: stated(row.location_label),
    streetName: stated(row.street_name),
  };
}

/**
 * The start of the offer's routes: both coordinates when stated; else the location label, with the
 * street in front of it when stated — the order of the map link (`mapSearchUrl` in
 * src/lib/map-link.ts), since a street alone names no place; else `null`, the refusal `no_origin`.
 * Either start is an estimate of the neighbourhood, not of the building, and the card says so.
 */
export function commuteOrigin(offer: CommuteOffer): CommuteOrigin | null {
  if (offer.latitude !== null && offer.longitude !== null) {
    return { kind: "coordinates", latitude: offer.latitude, longitude: offer.longitude };
  }
  if (offer.locationLabel === null) return null;
  const address = offer.streetName === null ? offer.locationLabel : `${offer.streetName}, ${offer.locationLabel}`;
  return { kind: "address", address };
}
