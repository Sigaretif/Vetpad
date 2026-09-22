import type { NormalizeUrlResult } from "./types";

const ACCEPTED_HOSTS = new Set(["otodom.pl", "www.otodom.pl"]);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Establishes the offer's identity before anything touches the network (FR-005).
 * Returns the canonical form `https://www.otodom.pl/pl/oferta/<slug>`: `/pl` added
 * when missing, no trailing slash, and no query string or fragment, which is where
 * tracking parameters live.
 */
export function normalizeOfferUrl(input: string): NormalizeUrlResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  let parsed: URL;
  try {
    parsed = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "malformed" };
  }
  if (!ACCEPTED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, reason: "foreign_host" };
  }

  const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
  const offerPath = segments[0] === "pl" ? segments.slice(1) : segments;
  const [section, slug] = offerPath;
  if (offerPath.length !== 2 || section !== "oferta") {
    return { ok: false, reason: "not_an_offer" };
  }

  return { ok: true, url: `https://www.otodom.pl/pl/oferta/${slug}` };
}
