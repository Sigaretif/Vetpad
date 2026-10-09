// Whether an offer gets a link to a map, and what that link's address is. The one place that
// builds it, so a view never assembles an address from a row's data on its own.
// Pure on purpose, like team-limits.ts: no runtime imports beyond safe-url, only types.

import type { OfferRow } from "@/lib/otodom/types";
import { safeHttpsUrl } from "@/lib/safe-url";

const MAPS_SEARCH = "https://www.google.com/maps/search/?api=1&query=";

/** A column's value as text worth searching for: trimmed, and `null` when it is blank or not a string. */
function stated(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The Google Maps search address for an offer, or `null` when the offer states no location: a
 * street alone names no place, so without `location_label` there is no link. The query is the
 * street, when stated, then the label, joined with ", ".
 *
 * The row is not trusted — any member can PATCH it through the Data API — so its content is
 * encoded once, as a whole, and lands only in the value of `query`: never in the host, the path
 * or another parameter. The result still goes through `safeHttpsUrl`.
 */
export function mapSearchUrl(offer: Pick<OfferRow, "location_label" | "street_name">): string | null {
  const label = stated(offer.location_label);
  if (label === null) return null;

  const street = stated(offer.street_name);
  const query = street === null ? label : `${street}, ${label}`;

  return safeHttpsUrl(MAPS_SEARCH + encodeURIComponent(query));
}
