// Offer rows for the /dev/offer-card kitchen sink: one per named state of the card, so the
// visual gate renders without Supabase (zero-config). The `_` prefix keeps this file out of
// routing. Image URLs are an external https placeholder — never the listing portal's own
// hosts, never `data:` or relative paths — and no row carries a phone number or a person's name.
// Saver fixtures use `example.com` addresses that name a role, never a person.

import type { Saver } from "@/lib/members";
import type { OfferImage, OfferRow } from "@/lib/otodom/types";

/** Saved by another member: the banner and the card name them by email. */
export const memberSaver: Saver = { kind: "member", email: "czlonek-zespolu@example.com" };

/** A very long address with no break points: it must wrap in the banner and the card at 375 px. */
export const longEmailSaver: Saver = {
  kind: "member",
  email: "bardzo-dlugi-adres-konta-testowego-do-sprawdzenia-zawijania-w-waskim-widoku@example.com",
};

/** Saved by the viewing member. */
export const selfSaver: Saver = { kind: "self" };

/** `created_by` is `null`: the author's account was deleted. */
export const deletedSaver: Saver = { kind: "deleted" };

/** The author could not be established (failed read, no `members` row, no email) — never a deleted account. */
export const unknownSaver: Saver = { kind: "unknown" };

function image(seed: string): OfferImage {
  return {
    thumbnail: `https://picsum.photos/seed/${seed}/320/240`,
    large: `https://picsum.photos/seed/${seed}/800/600`,
  };
}

/** Every column stated: all parameters, several amenities, several photos. */
export const fullOffer: OfferRow = {
  id: "00000000-0000-4000-8000-000000000001",
  otodom_id: 1000001,
  source_url: "https://example.com/oferta/pelna",
  created_by: "00000000-0000-4000-8000-0000000000aa",
  created_at: "2026-09-20T10:00:00Z",
  fetched_at: "2026-09-20T10:00:00Z",
  listed_at: "2026-09-18T08:30:00Z",
  listing_modified_at: "2026-09-19T12:00:00Z",

  title: "Mieszkanie 3-pokojowe z balkonem, Stary Mokotów",
  description:
    "Słoneczne mieszkanie na trzecim piętrze w ceglanym bloku z windą.\n\nSalon z wyjściem na balkon, oddzielna kuchnia, dwie sypialnie, łazienka z oknem. Do mieszkania przynależy piwnica.\n\nCzynsz obejmuje ogrzewanie miejskie i wywóz śmieci.",

  price: 890000,
  price_currency: "PLN",
  price_per_m: 15614.04,
  area_m2: 57,
  rooms: 3,
  floors_total: 6,
  build_year: 1998,
  rent: 650,
  rent_currency: "PLN",

  floor: "floor_3",
  market: "secondary",
  building_type: "block",
  construction_status: "ready_to_use",
  building_ownership: "full_ownership",
  heating: "urban",
  windows_type: "plastic",
  building_material: "brick",
  energy_certificate: "C",
  advert_type: "AGENCY",
  free_from: "2026-11-01",

  location_label: "Warszawa, Mokotów, Stary Mokotów",
  street_name: "ul. Przykładowa",
  latitude: 52.2,
  longitude: 21.01,

  features: ["balcony", "basement", "lift", "separate_kitchen", "entryphone"],
  images: [image("vetpad-full-1"), image("vetpad-full-2"), image("vetpad-full-3"), image("vetpad-full-4")],
  raw: {},
};

/** Nothing stated: every nullable column `null`, no amenities, no photos, a non-https source (no link). */
export const unknownOffer: OfferRow = {
  id: "00000000-0000-4000-8000-000000000002",
  otodom_id: 1000002,
  source_url: "http://example.com/oferta/nieznane",
  created_by: null,
  created_at: "2026-09-20T10:00:00Z",
  fetched_at: "2026-09-20T10:00:00Z",
  listed_at: null,
  listing_modified_at: null,

  title: "Mieszkanie bez podanych parametrów",
  description: "Ogłoszenie nie podaje ceny, metrażu ani żadnego innego parametru.",

  price: null,
  price_currency: null,
  price_per_m: null,
  area_m2: null,
  rooms: null,
  floors_total: null,
  build_year: null,
  rent: null,
  rent_currency: null,

  floor: null,
  market: null,
  building_type: null,
  construction_status: null,
  building_ownership: null,
  heating: null,
  windows_type: null,
  building_material: null,
  energy_certificate: null,
  advert_type: null,
  free_from: null,

  location_label: null,
  street_name: null,
  latitude: null,
  longitude: null,

  features: [],
  images: [],
  raw: {},
};

/** A single photo: the gallery switches to its one-column layout. */
export const singleImageOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000003",
  otodom_id: 1000003,
  source_url: "https://example.com/oferta/jedno-zdjecie",
  title: "Kawalerka przy parku, jedno zdjęcie",
  images: [image("vetpad-single")],
};

/** Unsafe photo URLs beside a valid one: only the valid photo may render (`safeHttpsUrl`). */
export const unsafeImagesOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000004",
  otodom_id: 1000004,
  source_url: "https://example.com/oferta/filtr-zdjec",
  title: "Filtr adresów zdjęć: widoczne tylko poprawne zdjęcie",
  images: [
    {
      thumbnail: "http://picsum.photos/seed/vetpad-http/320/240",
      large: "http://picsum.photos/seed/vetpad-http/800/600",
    },
    { thumbnail: "javascript:alert(1)", large: "javascript:alert(1)" },
    image("vetpad-valid"),
  ],
};

/** A very long title with no spaces and a long description: nothing may scroll horizontally. */
export const longTitleOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000005",
  otodom_id: 1000005,
  source_url: "https://example.com/oferta/dlugi-tytul",
  title:
    "Przestronne-czteropokojowe-mieszkanie-z-dwoma-balkonami-i-widokiem-na-park-w-spokojnej-okolicy-blisko-metra-szkoly-i-przedszkola-bez-posrednikow-od-zaraz",
  description: Array.from(
    { length: 6 },
    (_, index) =>
      `Akapit ${index + 1}. Mieszkanie po generalnym remoncie, z nową instalacją elektryczną i wodną, wymienionymi oknami i drzwiami antywłamaniowymi. Budynek ocieplony, klatka schodowa po odświeżeniu, teren wokół zamknięty i monitorowany. W okolicy sklepy, przychodnia, szkoła i przystanki kilku linii tramwajowych.`,
  ).join("\n\n"),
  images: [image("vetpad-long-1"), image("vetpad-long-2")],
};

/** Only the street stated, no location label: the board row shows the street alone. */
export const streetOnlyOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000006",
  otodom_id: 1000006,
  source_url: "https://example.com/oferta/tylko-ulica",
  title: "Dwa pokoje, podana tylko ulica",
  location_label: null,
  street_name: "ul. Przykładowa",
  images: [image("vetpad-street")],
};
