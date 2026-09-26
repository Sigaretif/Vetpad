// Polish labels for the raw otodom tokens stored in `public.offers`, and pl-PL
// formatting for the numeric facts. Pure on purpose, like map.ts: no runtime imports.
//
// Two rules the offer card relies on:
// - `null` is "the listing did not state it" and is handled by the caller — nothing
//   here turns it into a value, and nothing here turns a value into "not stated".
// - A token missing from a dictionary is returned literally. An unknown code is data
//   we cannot translate yet, not missing data.

type Dictionary = Readonly<Record<string, string>>;

const MARKET: Dictionary = {
  primary: "pierwotny",
  secondary: "wtórny",
};

const BUILDING_TYPE: Dictionary = {
  block: "blok",
  tenement: "kamienica",
  apartment: "apartamentowiec",
  house: "dom",
  detached: "dom wolnostojący",
  ribbon: "szeregowiec",
  semi_detached: "bliźniak",
  infill: "plomba",
  loft: "loft",
  other: "inny",
};

const CONSTRUCTION_STATUS: Dictionary = {
  ready_to_use: "do zamieszkania",
  to_completion: "do wykończenia",
  to_renovation: "do remontu",
};

const BUILDING_OWNERSHIP: Dictionary = {
  full_ownership: "pełna własność",
  limited_ownership: "spółdzielcze własnościowe prawo",
  co_operative_ownership: "spółdzielcze własnościowe prawo",
  co_ownership: "współwłasność",
  share: "udział",
  usufruct: "użytkowanie wieczyste",
  other: "inna",
};

const HEATING: Dictionary = {
  urban: "miejskie",
  gas: "gazowe",
  electrical: "elektryczne",
  boiler_room: "kotłownia",
  tiled_stove: "piece kaflowe",
  heat_pump: "pompa ciepła",
  other: "inne",
};

const WINDOWS_TYPE: Dictionary = {
  plastic: "plastikowe",
  wooden: "drewniane",
  aluminium: "aluminiowe",
};

const BUILDING_MATERIAL: Dictionary = {
  brick: "cegła",
  wood: "drewno",
  breezeblock: "pustak",
  hydroton: "keramzyt",
  concrete: "beton",
  concrete_plate: "wielka płyta",
  reinforced_concrete: "żelbet",
  cellular_concrete: "beton komórkowy",
  silikat: "silikat",
  other: "inny",
};

const ENERGY_CERTIFICATE: Dictionary = {
  exempt: "zwolniony z obowiązku",
  A_plus: "A+",
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  E: "E",
  F: "F",
  G: "G",
};

const ADVERT_TYPE: Dictionary = {
  PRIVATE: "osoba prywatna",
  AGENCY: "biuro nieruchomości",
  DEVELOPER: "deweloper",
};

const FLOOR: Dictionary = {
  cellar: "suterena",
  ground_floor: "parter",
  garret: "poddasze",
  floor_higher_10: "powyżej 10. piętra",
};

const FEATURE: Dictionary = {
  balcony: "balkon",
  terrace: "taras",
  garden: "ogródek",
  basement: "piwnica",
  usable_room: "pomieszczenie użytkowe",
  lift: "winda",
  garage: "garaż / miejsce parkingowe",
  separate_kitchen: "oddzielna kuchnia",
  two_storey: "dwupoziomowe",
  air_conditioning: "klimatyzacja",
  furniture: "meble",
  dishwasher: "zmywarka",
  fridge: "lodówka",
  oven: "piekarnik",
  stove: "kuchenka",
  washing_machine: "pralka",
  tv: "telewizor",
  internet: "internet",
  "cable-television": "telewizja kablowa",
  cable_television: "telewizja kablowa",
  phone: "telefon",
  anti_burglary_door: "drzwi antywłamaniowe",
  "anti-burglary_door": "drzwi antywłamaniowe",
  roller_shutters: "rolety antywłamaniowe",
  entryphone: "domofon / wideofon",
  monitoring: "monitoring / ochrona",
  alarm: "system alarmowy",
  closed_area: "teren zamknięty",
};

function translate(dictionary: Dictionary, token: string): string {
  return Object.hasOwn(dictionary, token) ? dictionary[token] : token;
}

/** `floor_7` → „7. piętro"; named floors from the dictionary; anything else literally. */
export function floorLabel(token: string): string {
  if (Object.hasOwn(FLOOR, token)) return FLOOR[token];
  const numbered = /^floor_(\d+)$/.exec(token);
  if (numbered) {
    const level = Number(numbered[1]);
    return level === 0 ? "parter" : `${level}. piętro`;
  }
  return token;
}

export const marketLabel = (token: string): string => translate(MARKET, token);
export const buildingTypeLabel = (token: string): string => translate(BUILDING_TYPE, token);
export const constructionStatusLabel = (token: string): string => translate(CONSTRUCTION_STATUS, token);
export const buildingOwnershipLabel = (token: string): string => translate(BUILDING_OWNERSHIP, token);
export const heatingLabel = (token: string): string => translate(HEATING, token);
export const windowsTypeLabel = (token: string): string => translate(WINDOWS_TYPE, token);
export const buildingMaterialLabel = (token: string): string => translate(BUILDING_MATERIAL, token);
export const energyCertificateLabel = (token: string): string => translate(ENERGY_CERTIFICATE, token);
export const advertTypeLabel = (token: string): string => translate(ADVERT_TYPE, token);
export const featureLabel = (token: string): string => translate(FEATURE, token);

const NUMBER = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 });
const INTEGER = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0, useGrouping: false });
const DATE = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const TIMESTAMP = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Warsaw",
});

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

/** Counts and years: no thousands separator, so 1998 never reads as „1 998". */
export function formatInteger(value: number): string {
  return INTEGER.format(value);
}

/**
 * An amount in the listing's own currency. A currency code Intl does not accept is
 * shown literally after the number rather than failing the page.
 */
export function formatMoney(value: number, currency: string | null): string {
  if (currency === null) return NUMBER.format(value);
  try {
    return new Intl.NumberFormat("pl-PL", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${NUMBER.format(value)} ${currency}`;
  }
}

export function formatArea(value: number): string {
  return `${NUMBER.format(value)} m²`;
}

/** `YYYY-MM-DD` (a `date` column) → „1 października 2026"; an unparseable value literally. */
export function formatDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : DATE.format(parsed);
}

/**
 * A `timestamptz` column → „20 września 2026", the day as the team sees it in Poland (not in
 * UTC, which would show the previous day for anything saved just after midnight). An
 * unparseable value literally.
 */
export function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : TIMESTAMP.format(parsed);
}
