import {
  ANTHROPIC_API_KEY,
  APIFY_TOKEN,
  GOOGLE_MAPS_BROWSER_KEY,
  GOOGLE_MAPS_SERVER_KEY,
  SUPABASE_URL,
  SUPABASE_KEY,
} from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/Sigaretif/Vetpad#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    // The model provider of the AI audit (FR-010). No link: the entry names the variable to set.
    name: "Anthropic",
    configured: Boolean(ANTHROPIC_API_KEY),
    message: "Brak klucza dostawcy modelu (ANTHROPIC_API_KEY) — audyt AI jest wyłączony.",
  },
  {
    // The extraction service behind the fallback fetch of a listing (FR-004, FR-009). Says only
    // whether the token is set, never whether it works.
    name: "Apify",
    configured: Boolean(APIFY_TOKEN),
    message: "Brak tokenu Apify (APIFY_TOKEN) — zapasowe pobieranie ogłoszeń jest wyłączone.",
  },
  {
    // The Routes API behind the commute times on an offer's card (FR-016). Says only whether the
    // key is set, never whether it works.
    name: "Google Maps — trasy",
    configured: Boolean(GOOGLE_MAPS_SERVER_KEY),
    message: "Brak klucza Google Maps do tras (GOOGLE_MAPS_SERVER_KEY) — liczenie dojazdów jest wyłączone.",
  },
  {
    // The Maps JavaScript API that draws the routes after a calculation (FR-016). Without it the
    // commute table still shows, without the map.
    name: "Google Maps — mapa",
    configured: Boolean(GOOGLE_MAPS_BROWSER_KEY),
    message: "Brak klucza Google Maps do mapy (GOOGLE_MAPS_BROWSER_KEY) — dojazdy pokazują się bez mapy.",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);

/**
 * Whether the application holds a model-provider key, so an AI audit can be started (FR-010).
 * The offer card asks here — never by building the provider, whose module carries the SDK and
 * must not load with a card render. Without a key the card still renders: its audit button is
 * disabled and says why (the zero-config state).
 */
export function isAuditAvailable(): boolean {
  return Boolean(ANTHROPIC_API_KEY);
}

/**
 * Whether the application holds an Apify token, so a listing may be fetched through the extraction
 * service when the direct fetch is refused (FR-004, FR-009). A route or a view asks here — never by
 * importing `@/lib/otodom/apify`, the server-only module that holds the token. Like the banner, it
 * says only whether the token is set, never that it works: a revoked or under-scoped token is
 * learned from Apify's answer to a run. Without a token, listings are fetched directly only (the
 * zero-config state).
 */
export function isApifyAvailable(): boolean {
  return Boolean(APIFY_TOKEN);
}

/**
 * Whether the application holds the Google Maps key for the Routes API, so commute times can be
 * calculated (FR-016). A route or a view asks here — never by importing `@/lib/commute/google`,
 * the server-only module that holds the key. Like the banner, it says only whether the key is set,
 * never that it works: a revoked or restricted key is learned from Google's answer. Without it the
 * card still renders its commute section, with no calculation offered (the zero-config state).
 */
export function isCommuteAvailable(): boolean {
  return Boolean(GOOGLE_MAPS_SERVER_KEY);
}

/**
 * Whether the application holds the Google Maps key for the Maps JavaScript API, so a calculated
 * commute can be drawn on a map (FR-016). Without it the table of times still shows.
 */
export function isCommuteMapAvailable(): boolean {
  return Boolean(GOOGLE_MAPS_BROWSER_KEY);
}
