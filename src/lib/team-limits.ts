// Which of the team's hard limits (FR-002) an offer on the board breaks. Only a fact the listing
// states can break a limit: an unstated price, area or location never does (PRD, Guardrails) —
// the offer is not known to be outside the limits, so it carries no mark.
// Pure on purpose, like offer-board.ts: no runtime imports, only types.

import type { TeamLimits } from "@/lib/criteria";
import type { OfferBoardItem } from "@/lib/offer-board";

export type LimitBreach = "city" | "price_above" | "price_below" | "area_below";

export type LimitedOffer = Pick<OfferBoardItem, "price" | "price_currency" | "area_m2" | "location_label">;

/**
 * A place name as compared with the city limit: lowercase, diacritics removed, hyphens and en
 * dashes read as spaces („Bielsko Biała" matches „Bielsko-Biała"), runs of whitespace collapsed,
 * trimmed. „ł" has no NFD decomposition, so it is mapped to „l" explicitly — otherwise „Łódź" typed
 * as „Lodz" would never match.
 */
export function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/[-\u2010-\u2013]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The limits the offer's stated facts break, always in the order city, price_above, price_below,
 * area_below. The city limit is broken when no comma-separated part of `location_label` („Praga-
 * Południe, Warszawa, mazowieckie") is the city; a missing or blank label breaks nothing. Price
 * is compared only in PLN — another currency or none is unknown here — and both bounds are
 * inclusive.
 */
export function limitBreaches(offer: LimitedOffer, limits: TeamLimits): LimitBreach[] {
  const breaches: LimitBreach[] = [];

  const city = limits.city === null ? "" : normalizePlace(limits.city);
  if (city !== "" && offer.location_label !== null) {
    const parts = offer.location_label
      .split(",")
      .map(normalizePlace)
      .filter((part) => part !== "");
    if (parts.length > 0 && !parts.includes(city)) breaches.push("city");
  }

  if (offer.price !== null && offer.price_currency === "PLN") {
    if (limits.priceMax !== null && offer.price > limits.priceMax) breaches.push("price_above");
    if (limits.priceMin !== null && offer.price < limits.priceMin) breaches.push("price_below");
  }

  if (offer.area_m2 !== null && limits.areaMin !== null && offer.area_m2 < limits.areaMin) {
    breaches.push("area_below");
  }

  return breaches;
}
