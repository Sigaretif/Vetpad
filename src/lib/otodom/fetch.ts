import type { FetchOfferResult } from "./types";

// Request etiquette: context/foundation/ingestion/otodom_fetching.md, section 10.
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept-Language": "pl-PL,pl;q=0.9",
};

// The one bounded pattern that lifts the embedded JSON out of the page. No DOM, no
// HTML parser: CLAUDE.md, Cloudflare Workers runtime.
const NEXT_DATA = /id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  // `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError", a
  // manual abort with "AbortError".
  return isRecord(error) && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * Fetches one otodom offer page and returns its `props.pageProps.ad` payload.
 * Failure reasons are kept apart so a blocked egress (`http_denied`) can be told from
 * a changed page (`shape_changed`) without guessing.
 */
export async function fetchOfferAd(url: string, signal: AbortSignal): Promise<FetchOfferResult> {
  let html: string;
  try {
    const response = await fetch(url, { headers: REQUEST_HEADERS, redirect: "follow", signal });
    if (response.status === 404 || response.status === 410) {
      return { ok: false, reason: "not_found", status: response.status };
    }
    if (!response.ok) {
      // 403/429 are the egress-blocking signatures; any other non-OK status (5xx) is
      // still the portal refusing to serve the page, and the status says which.
      return { ok: false, reason: "http_denied", status: response.status };
    }
    html = await response.text();
  } catch (error) {
    return { ok: false, reason: isAbort(error, signal) ? "timeout" : "network" };
  }

  const match = NEXT_DATA.exec(html);
  const json = match?.[1];
  if (json === undefined) return { ok: false, reason: "shape_changed" };

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, reason: "shape_changed" };
  }

  const props = isRecord(data) ? data.props : undefined;
  const pageProps = isRecord(props) ? props.pageProps : undefined;
  if (!isRecord(pageProps)) return { ok: false, reason: "shape_changed" };

  const ad = pageProps.ad;
  if (isRecord(ad)) {
    // An expired offer may still ship its payload with the flag set on the ad itself.
    if (ad.shouldShowExpiredAdPage === true) return { ok: false, reason: "expired" };
    return { ok: true, ad };
  }
  if (pageProps.shouldShowExpiredAdPage) return { ok: false, reason: "expired" };
  return { ok: false, reason: "shape_changed" };
}
