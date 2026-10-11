// Rules of a re-fetch (FR-009): which facts the audit reads would be lost if the fetched listing
// replaced the stored one, and whether the member has agreed to lose them. Pure: no client, no
// network, only the audit's whitelist of columns.
//
// A fact is lost when the stored listing states it and the fetched one does not. Only that stops
// the save. A stated value that changed into another stated value is not a loss — the listing
// simply says something else now, and no rule here judges which value is right.

import { AUDIT_OFFER_COLUMNS, type AuditOffer, type AuditOfferColumn } from "@/lib/audit/input";

/**
 * Whether the offer states the column. A fact is stated when it is not `null`; the title and the
 * description when they hold more than whitespace; the amenities when the list names at least one.
 */
function isStated(offer: AuditOffer, column: AuditOfferColumn): boolean {
  if (column === "title" || column === "description") return offer[column].trim() !== "";
  if (column === "features") return offer.features.length > 0;
  return offer[column] !== null;
}

/**
 * The columns the stored offer states and the fetched one does not, in the order of
 * `AUDIT_OFFER_COLUMNS`. Empty when nothing would be lost.
 */
export function lostFacts(stored: AuditOffer, fetched: AuditOffer): AuditOfferColumn[] {
  return AUDIT_OFFER_COLUMNS.filter((column) => isStated(stored, column) && !isStated(fetched, column));
}

/**
 * The name a member reads for each column, as on the offer card
 * (`src/components/offers/OfferParameters.astro`, and the card's own headings for the listing's
 * words and its amenities). The two currency columns have no row of their own on the card.
 */
export const LOST_FACT_LABELS: Record<AuditOfferColumn, string> = {
  title: "Tytuł",
  description: "Opis",
  price: "Cena",
  price_currency: "Waluta ceny",
  price_per_m: "Cena za m²",
  area_m2: "Powierzchnia",
  rooms: "Liczba pokoi",
  floors_total: "Liczba pięter w budynku",
  build_year: "Rok budowy",
  rent: "Czynsz",
  rent_currency: "Waluta czynszu",
  floor: "Piętro",
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
  features: "Udogodnienia",
};

/**
 * The columns named by a comma-separated list of tokens — a form field or an address parameter,
 * which anyone can type by hand. A token that is not one of `AUDIT_OFFER_COLUMNS`, exactly as
 * written there, is dropped, and so is a repeated one; the answer is in the order of
 * `AUDIT_OFFER_COLUMNS`, whatever the order of the list.
 */
export function readLostTokens(value: string): AuditOfferColumn[] {
  const tokens = new Set(value.split(","));
  return AUDIT_OFFER_COLUMNS.filter((column) => tokens.has(column));
}

/**
 * Whether the member agreed to this loss: every lost column is among the accepted ones. Agreeing
 * to more than is lost is still agreement; a column lost that the member was never shown is not.
 */
export function isLossAccepted(lost: readonly AuditOfferColumn[], accepted: readonly AuditOfferColumn[]): boolean {
  return lost.every((column) => accepted.includes(column));
}
