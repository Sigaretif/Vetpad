// The one module that reads `GOOGLE_MAPS_BROWSER_KEY`: the Google Maps key for the Maps JavaScript
// API, which draws a calculated commute on a map in the member's browser (FR-016).
//
// The narrow, deliberate exception to "secrets never reach the client" (context/changes/
// commute-times/plan.md, „The browser key”): this key is public by design — Google's script cannot
// load without it in the page — and it is restricted in Cloud Console by referrer and to the Maps
// JavaScript API alone. It is read at run time from `astro:env/server`, never pasted into a bundle
// at build time, and handed to the `CommuteRunner` island as a prop by `src/pages/offers/[id].astro`
// — the only importer, which `paidServiceServerOnlyConfig` in eslint.config.js enforces. No other
// secret may follow this path.

import { GOOGLE_MAPS_BROWSER_KEY } from "astro:env/server";

/** The browser key, or `null` when it is not set (the zero-config state: the table shows without a map). */
export function commuteMapKey(): string | null {
  const key = GOOGLE_MAPS_BROWSER_KEY?.trim() ?? "";
  return key === "" ? null : key;
}
