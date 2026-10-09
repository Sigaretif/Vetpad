// Offer rows for the /dev/offer-card kitchen sink: one per named state of the card, so the
// visual gate renders without Supabase (zero-config). The `_` prefix keeps this file out of
// routing. Image URLs are an external https placeholder — never the listing portal's own
// hosts, never `data:` or relative paths — and no row carries a phone number or a person's name.
// Saver fixtures use `example.com` addresses that name a role, never a person. Note fixtures talk
// about the flat only: no people, no phone numbers, no company names. Audit fixtures are written
// by hand as well — no finding here was produced by a model or taken from a real listing.

import { auditFailureMessage } from "@/lib/audit/failure";
import type { StoredFindings } from "@/lib/audit/schema";
import type { AuditIndex, OfferAudit, StoredAudit } from "@/lib/audit/store";
import type { TeamLimitsResult } from "@/lib/criteria";
import type { Saver } from "@/lib/members";
import type { NoteView, OfferNotes } from "@/lib/notes";
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
    "Słoneczne mieszkanie na trzecim piętrze w ceglanym bloku z windą.\n\nSalon z wyjściem na balkon, oddzielna kuchnia, dwie sypialnie, łazienka z oknem. Do mieszkania przynależy piwnica.\n\nCzynsz obejmuje ogrzewanie miejskie i wywóz śmieci.\n\nKupujący pokrywa prowizję biura w wysokości 2% ceny oraz koszty notarialne. Warunkiem rezerwacji jest wpłata zadatku w wysokości 10% ceny przy umowie przedwstępnej.\n\nMieszkanie jest obecnie wynajmowane, umowa najmu obowiązuje do końca 2027 roku.",

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

/**
 * Photo entries that are not photos, as a member can PATCH them into the column: `null`, a number,
 * an object with no URLs, and a valid thumbnail whose large photo is unsafe. None may render, and
 * the card must not fail on them: the gallery shows „Ogłoszenie nie zawiera zdjęć.".
 */
export const malformedImagesOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000013",
  otodom_id: 1000013,
  source_url: "https://example.com/oferta/uszkodzone-zdjecia",
  title: "Uszkodzone wpisy zdjęć: galeria bez zdjęć",
  // A deliberately broken row: the cast lets it through the type the mapper writes, because the
  // stored column holds whatever a member PATCHed into it.
  images: [
    null,
    42,
    {},
    { thumbnail: "https://picsum.photos/seed/vetpad-malformed/320/240", large: "javascript:alert(1)" },
  ] as unknown as OfferImage[],
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

// Team limits for the /dev/board kitchen sink, and offers that break them one way each. Against
// `boardLimits` (Warszawa, 600 000–850 000 zł, from 60 m²) `fullOffer` breaks two limits at once.

/** No limit set: the board compares nothing and no row carries a mark (the existing sections). */
export const noLimits: TeamLimitsResult = {
  ok: true,
  limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
};

/** Every limit set. */
export const boardLimits: TeamLimitsResult = {
  ok: true,
  limits: { city: "Warszawa", priceMin: 600000, priceMax: 850000, areaMin: 60 },
};

/** The city typed without diacritics, the price and area at the limits: nothing is broken (bounds are inclusive). */
export const lodzLimits: TeamLimitsResult = {
  ok: true,
  limits: { city: "lodz", priceMin: 600000, priceMax: 850000, areaMin: 60 },
};

/** A city name of 100 characters with no break points: the badge must wrap at 375 px. */
export const longCityLimits: TeamLimitsResult = {
  ok: true,
  limits: {
    city: "Bardzo-długa-nazwa-miejscowości-wpisana-przez-członka-zespołu-do-sprawdzenia-zawijania-odznak-wiersz",
    priceMin: null,
    priceMax: null,
    areaMin: null,
  },
};

/** A failed limits read: the board says so above the list and no row carries a mark. */
export const failedLimits: TeamLimitsResult = { ok: false };

/** Inside every `boardLimits` limit except the city. */
export const outsideCityOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000007",
  otodom_id: 1000007,
  source_url: "https://example.com/oferta/inne-miasto",
  title: "Trzy pokoje z ogródkiem pod Warszawą",
  price: 790000,
  area_m2: 64,
  location_label: "Ząbki, wołomiński, mazowieckie",
  street_name: null,
  images: [image("vetpad-city")],
};

/** Above `boardLimits.priceMax` only. */
export const priceAboveOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000008",
  otodom_id: 1000008,
  source_url: "https://example.com/oferta/cena-powyzej",
  title: "Apartament z tarasem na Powiślu",
  price: 1150000,
  area_m2: 72.5,
  location_label: "Warszawa, Śródmieście, Powiśle",
  images: [image("vetpad-price-above")],
};

/** Below `boardLimits.priceMin` only. */
export const priceBelowOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000009",
  otodom_id: 1000009,
  source_url: "https://example.com/oferta/cena-ponizej",
  title: "Trzy pokoje do remontu na Pradze",
  price: 540000,
  area_m2: 61,
  location_label: "Warszawa, Praga-Północ",
  images: [image("vetpad-price-below")],
};

/** Below `boardLimits.areaMin` only. */
export const areaBelowOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000010",
  otodom_id: 1000010,
  source_url: "https://example.com/oferta/metraz-ponizej",
  title: "Dwa pokoje przy metrze Wilanowska",
  price: 720000,
  area_m2: 45.5,
  location_label: "Warszawa, Mokotów, Służew",
  images: [image("vetpad-area-below")],
};

/** Outside the city, above the price and below the area of `boardLimits` at once. */
export const manyBreachesOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000011",
  otodom_id: 1000011,
  source_url: "https://example.com/oferta/wiele-limitow",
  title: "Dwupoziomowe mieszkanie w Józefowie",
  price: 980000,
  area_m2: 52,
  location_label: "Józefów, otwocki, mazowieckie",
  street_name: null,
  images: [image("vetpad-many")],
};

/** In Łódź, at `lodzLimits`' price ceiling and area floor: within every limit. */
export const withinLimitsOffer: OfferRow = {
  ...fullOffer,
  id: "00000000-0000-4000-8000-000000000012",
  otodom_id: 1000012,
  source_url: "https://example.com/oferta/w-limitach",
  title: "Loft w dawnej fabryce na Bałutach",
  price: 850000,
  area_m2: 60,
  location_label: "Bałuty, Łódź, łódzkie",
  street_name: null,
  images: [image("vetpad-within")],
};

// Notes for the /dev/offer-card kitchen sink: one set per named state of the team column.

/** The viewing member's own note, shown in preview (or in the editor when a state asks for it). */
export const ownNote: NoteView = {
  id: "00000000-0000-4000-8000-000000000101",
  author: selfSaver,
  pros: "Jasny salon z wyjściem na balkon.\nOddzielna kuchnia z oknem.",
  cons: "Łazienka do remontu, stare płytki i wanna.",
  observations: "Warto zapytać o koszt wymiany pionów i o fundusz remontowy wspólnoty.",
  updatedAt: "2026-09-24T18:30:00Z",
};

/** Another member's note, signed with their email. */
export const memberNote: NoteView = {
  id: "00000000-0000-4000-8000-000000000102",
  author: memberSaver,
  pros: "Cicha ulica, okna sypialni od podwórza.",
  cons: "Brak miejsca parkingowego w cenie.",
  observations: "Piwnica sucha, ale mała.",
  updatedAt: "2026-09-23T09:15:00Z",
};

/** A note whose author's account was deleted: „Osoba z usuniętym kontem". */
export const deletedNote: NoteView = {
  id: "00000000-0000-4000-8000-000000000103",
  author: deletedSaver,
  pros: "Dobra komunikacja, tramwaj pod blokiem.",
  cons: "",
  observations: "Czynsz wydaje się wysoki jak na ten metraż.",
  updatedAt: "2026-09-21T20:00:00Z",
};

/** A note whose author could not be established: it names nobody and is never a deleted account. */
export const unknownNote: NoteView = {
  id: "00000000-0000-4000-8000-000000000104",
  author: unknownSaver,
  pros: "Kawalerka z widokiem na park.",
  cons: "Czwarte piętro bez windy.",
  observations: "Kuchnia w aneksie, bez okna.",
  updatedAt: "2026-09-22T12:00:00Z",
};

/** A very long author address and an empty field („nie wpisano"). */
export const longEmailNote: NoteView = {
  id: "00000000-0000-4000-8000-000000000105",
  author: longEmailSaver,
  pros: "",
  cons: "Okna wymagają regulacji, w sypialni czuć przeciąg.",
  observations: "Do obejrzenia jeszcze raz w dzień, przy świetle dziennym.",
  updatedAt: "2026-09-25T07:45:00Z",
};

/** A word with no break points and several paragraphs: nothing may scroll horizontally. */
export const longWordNote: NoteView = {
  id: "00000000-0000-4000-8000-000000000106",
  author: memberSaver,
  pros: "Bardzo-długie-słowo-bez-spacji-do-sprawdzenia-zawijania-w-wąskiej-kolumnie-notatek-na-telefonie-i-na-komputerze",
  cons: Array.from(
    { length: 3 },
    (_, index) =>
      `Akapit ${index + 1}. Instalacja elektryczna w starym standardzie, gniazdka bez uziemienia, tablica z bezpiecznikami topikowymi. Do wymiany przed wprowadzeniem się.`,
  ).join("\n\n"),
  observations: "Pierwsza linia.\nDruga linia.\n\nTrzecia linia po pustej.",
  updatedAt: "2026-09-26T08:00:00Z",
};

/** Own note in preview, plus a member's and a deleted account's note. */
export const fullNotes: OfferNotes = { state: "ok", own: ownNote, others: [memberNote, deletedNote] };

/** No notes at all: an empty form and „Pozostali członkowie nie napisali jeszcze notatek.". */
export const noNotes: OfferNotes = { state: "ok", own: null, others: [] };

/** No own note; an unnamed author and a long address, one of them with an empty field. */
export const othersOnlyNotes: OfferNotes = { state: "ok", own: null, others: [unknownNote, longEmailNote] };

/** A failed read: the column renders no editor. */
export const failedNotes: OfferNotes = { state: "error" };

/** Own note (opened in the editor with a server error) and a note with a long word and paragraphs. */
export const longNotes: OfferNotes = { state: "ok", own: ownNote, others: [longWordNote] };

// AI audits for the /dev/offer-card kitchen sink: one per named state of the card's audit section.
// The excerpts of `fullFindings` are cut from `fullOffer`'s title and description, so each can be
// found on the card beside it, as on a real card.

/** All four categories filled: a requirement the listing is silent on, a condition, two costs and a red flag. */
const fullFindings: StoredFindings = {
  version: 1,
  missing: [
    {
      attribute: "requirement",
      requirement: "Miejsce postojowe w garażu podziemnym albo na zamkniętym parkingu.",
      question: "Czy do mieszkania przynależy miejsce postojowe, a jeśli tak, to czy jest wliczone w cenę?",
    },
  ],
  conditions: [
    {
      label: "Zadatek przy umowie przedwstępnej",
      excerpt: "Warunkiem rezerwacji jest wpłata zadatku w wysokości 10% ceny przy umowie przedwstępnej.",
      source: "description",
    },
  ],
  costs: [
    {
      label: "Prowizja biura po stronie kupującego",
      excerpt: "Kupujący pokrywa prowizję biura w wysokości 2% ceny",
      source: "description",
    },
    { label: "Koszty notarialne", excerpt: "oraz koszty notarialne", source: "description" },
  ],
  red_flags: [
    {
      label: "Mieszkanie z najemcą",
      excerpt: "Mieszkanie jest obecnie wynajmowane, umowa najmu obowiązuje do końca 2027 roku.",
      source: "description",
      requirement: "Mieszkanie wolne najpóźniej trzy miesiące po zakupie.",
    },
  ],
};

/** A result with every category filled, made against limits and three requirements, with two findings left out. */
const fullAuditResult: StoredAudit = {
  findings: fullFindings,
  rejectedCount: 2,
  auditedAt: "2026-10-08T12:32:00Z",
  auditedBy: memberSaver,
  model: "claude-opus-5-5",
  effort: "medium",
  hadLimits: true,
  requirementsCount: 3,
};

/**
 * Only missing information, about three of the nine attributes; the other three categories are
 * empty and each says so. Made with no limits and no requirements, by a member whose account is gone.
 */
const missingOnlyAuditResult: StoredAudit = {
  findings: {
    version: 1,
    missing: [
      {
        attribute: "floor",
        requirement: null,
        question: "Na którym piętrze jest mieszkanie i czy w budynku jest winda?",
      },
      {
        attribute: "heating",
        requirement: null,
        question: "Jakie jest ogrzewanie mieszkania i jak jest rozliczane?",
      },
      {
        attribute: "ownership",
        requirement: null,
        question: "Jaka jest forma własności i czy mieszkanie ma założoną księgę wieczystą?",
      },
    ],
    conditions: [],
    costs: [],
    red_flags: [],
  },
  rejectedCount: 0,
  auditedAt: "2026-10-07T07:05:00Z",
  auditedBy: deletedSaver,
  model: "claude-sonnet-5-5",
  effort: "low",
  hadLimits: false,
  requirementsCount: 0,
};

/**
 * Long content for the narrow column: a label and a requirement with no break points, an excerpt
 * of two paragraphs, a long question, a long address of the auditor, and counts that take the
 * other plural forms (22 wymagania, 5 znalezisk).
 */
const longAuditResult: StoredAudit = {
  findings: {
    version: 1,
    missing: [
      {
        attribute: "requirement",
        requirement:
          "Mieszkanie-musi-mieć-osobne-pomieszczenie-do-pracy-zdalnej-z-oknem-i-drzwiami-oraz-szybki-internet-światłowodowy",
        question:
          "Czy w mieszkaniu da się wydzielić osobne, zamykane pomieszczenie do pracy z oknem, a jeśli nie, to czy układ ścian pozwala na taką przebudowę bez zgody wspólnoty i bez naruszania ścian nośnych?",
      },
    ],
    conditions: [
      {
        label:
          "Bardzo-długa-etykieta-warunku-bez-spacji-do-sprawdzenia-zawijania-w-wąskiej-kolumnie-audytu-na-telefonie-i-na-komputerze",
        excerpt: "teren wokół zamknięty i monitorowany",
        source: "description",
      },
    ],
    costs: [],
    red_flags: [
      {
        label: "Generalny remont i wymiana instalacji bez podanego zakresu i daty",
        excerpt:
          "Akapit 1. Mieszkanie po generalnym remoncie, z nową instalacją elektryczną i wodną, wymienionymi oknami i drzwiami antywłamaniowymi. Budynek ocieplony, klatka schodowa po odświeżeniu, teren wokół zamknięty i monitorowany. W okolicy sklepy, przychodnia, szkoła i przystanki kilku linii tramwajowych.\n\nAkapit 2. Mieszkanie po generalnym remoncie, z nową instalacją elektryczną i wodną, wymienionymi oknami i drzwiami antywłamaniowymi.",
        source: "description",
        requirement: "Instalacje wymienione nie dawniej niż dziesięć lat temu, z dokumentami odbioru.",
      },
      {
        label: "",
        excerpt:
          "Przestronne-czteropokojowe-mieszkanie-z-dwoma-balkonami-i-widokiem-na-park-w-spokojnej-okolicy-blisko-metra-szkoly-i-przedszkola-bez-posrednikow-od-zaraz",
        source: "title",
        requirement: null,
      },
    ],
  },
  rejectedCount: 5,
  auditedAt: "2026-10-09T21:47:00Z",
  auditedBy: longEmailSaver,
  model: "claude-opus-5-5",
  effort: "high",
  hadLimits: true,
  requirementsCount: 22,
};

/** Never audited and never tried: no row. */
export const auditNone: OfferAudit = { state: "ok", attempt: { kind: "none" }, result: null };

/** A stored result and no attempt after it — the default state. */
export const auditDone: OfferAudit = { state: "ok", attempt: { kind: "none" }, result: fullAuditResult };

/** A stored result in which three of the four categories are empty. */
export const auditEmptyCategories: OfferAudit = {
  state: "ok",
  attempt: { kind: "none" },
  result: missingOnlyAuditResult,
};

/** A stored result with long content. */
export const auditLong: OfferAudit = { state: "ok", attempt: { kind: "none" }, result: longAuditResult };

/** A first attempt in progress, started by another member: seen by somebody who opened the card meanwhile. */
export const auditRunning: OfferAudit = {
  state: "ok",
  attempt: { kind: "running", startedAt: "2026-10-09T12:31:00Z", startedBy: memberSaver },
  result: null,
};

/** A re-run in progress beside the result it has not replaced yet, started by a member who cannot be named. */
export const auditRerunning: OfferAudit = {
  state: "ok",
  attempt: { kind: "running", startedAt: "2026-10-09T12:31:00Z", startedBy: unknownSaver },
  result: fullAuditResult,
};

/** A re-run that failed on the provider's billing state; the earlier result stays. */
export const auditFailedKept: OfferAudit = {
  state: "ok",
  attempt: { kind: "failed", reason: "provider_credit", message: auditFailureMessage("provider_credit") },
  result: fullAuditResult,
};

/** A first attempt that failed: there is no result to show. */
export const auditFailedNoResult: OfferAudit = {
  state: "ok",
  attempt: { kind: "failed", reason: "provider_timeout", message: auditFailureMessage("provider_timeout") },
  result: null,
};

/** An attempt left `running` past the threshold: its request is gone. */
export const auditInterrupted: OfferAudit = { state: "ok", attempt: { kind: "interrupted" }, result: null };

/** A failed read of the audit: the section renders no button. */
export const auditReadFailed: OfferAudit = { state: "error" };

// The audit index for the /dev/board kitchen sink.

/** No offer has a stored result: every row reads „Nie audytowano" (the existing sections). */
export const noAudits: AuditIndex = { ok: true, audited: new Set() };

/** `fullOffer` has a stored result; every other offer has none. */
export const someAudits: AuditIndex = { ok: true, audited: new Set([fullOffer.id]) };

/** A failed read of the audits: every row says its status could not be checked. */
export const failedAudits: AuditIndex = { ok: false };
