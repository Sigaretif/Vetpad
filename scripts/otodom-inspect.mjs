// Debugging aid: shows what otodom sent for one offer next to what our mapper made of it,
// so "this field mapped wrong" can be answered from a URL alone.
// Hits the live portal, so it never runs in CI and is not part of the test surface.
// Zero dependencies on purpose: fetch.ts, map.ts and url.ts are loaded directly through
// Node's type stripping (Node 22.18+), so this script cannot drift from the app's code.
//
//   npm run otodom:inspect -- https://www.otodom.pl/pl/oferta/<slug>

/* global AbortSignal */

import { fetchOfferAd } from "../src/lib/otodom/fetch.ts";
import { mapAdToOffer } from "../src/lib/otodom/map.ts";
import { normalizeOfferUrl } from "../src/lib/otodom/url.ts";

const USAGE = `Usage: node scripts/otodom-inspect.mjs <otodom offer URL>
       npm run otodom:inspect -- <otodom offer URL>

Fetches one live otodom.pl offer and prints three sections:
  1. gate inputs  - adCategory, target.OfferType, target.ProperType and the gate result
  2. characteristics - every entry as key / value / localizedValue / currency
  3. mapper output - the mapAdToOffer result, with the columns that came out null

Exit codes: 0 printed all sections (even when the gate rejects the offer),
            1 the URL was rejected or the fetch failed, 2 usage error.
Never run in CI: it hits the live portal.`;

const TIMEOUT_MS = 45_000;
const arg = process.argv[2];

if (arg === undefined || arg === "--help" || arg === "-h") {
  console.log(USAGE);
  process.exit(arg === undefined ? 2 : 0);
}

const normalized = normalizeOfferUrl(arg);
if (!normalized.ok) {
  console.error(`URL rejected: ${normalized.reason}`);
  process.exit(1);
}
console.log(`Fetching ${normalized.url}`);

const fetched = await fetchOfferAd(normalized.url, AbortSignal.timeout(TIMEOUT_MS));
if (!fetched.ok) {
  console.error(`Fetch failed: ${fetched.reason}${fetched.status === undefined ? "" : ` (HTTP ${fetched.status})`}`);
  process.exit(1);
}

const { ad } = fetched;
const mapped = mapAdToOffer(ad);

function heading(title) {
  console.log(`\n=== ${title} ${"=".repeat(Math.max(0, 70 - title.length))}`);
}

heading("1. Gate");
console.log(`adCategory         ${JSON.stringify(ad.adCategory)}`);
console.log(`target.OfferType   ${JSON.stringify(ad.target?.OfferType)}`);
console.log(`target.ProperType  ${JSON.stringify(ad.target?.ProperType)}`);
console.log(
  `gate               ${mapped.ok ? "PASS" : `REJECT ${mapped.reason}${mapped.detail ? ` (${mapped.detail})` : ""}`}`,
);

heading("2. Characteristics (raw)");
const characteristics = Array.isArray(ad.characteristics) ? ad.characteristics : [];
if (characteristics.length === 0) console.log("(none)");
const keyWidth = Math.max(3, ...characteristics.map((c) => String(c.key).length));
console.log(`${"key".padEnd(keyWidth)}  value / localizedValue / currency`);
for (const c of characteristics) {
  console.log(
    `${String(c.key).padEnd(keyWidth)}  ${JSON.stringify(c.value)} / ${JSON.stringify(c.localizedValue)} / ${JSON.stringify(c.currency)}`,
  );
}

heading("3. Mapper output");
if (!mapped.ok) {
  console.log(JSON.stringify(mapped, null, 2));
} else {
  const { raw, description, images, ...columns } = mapped.offer;
  console.log(JSON.stringify(columns, null, 2));
  console.log(`description: ${description.length} chars, first line: ${JSON.stringify(description.split("\n")[0])}`);
  console.log(`images: ${images.length}`);
  console.log(`raw keys: ${Object.keys(raw).join(", ")}`);
  const nulls = Object.entries(mapped.offer)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  console.log(`null (not stated by the listing): ${nulls.length ? nulls.join(", ") : "(none)"}`);
}
