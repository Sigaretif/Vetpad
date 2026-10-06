import type { FetchEvidence, FetchFailureReason, FetchOfferResult } from "./types";

// Request etiquette: context/foundation/ingestion/otodom_fetching.md, section 10.
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept-Language": "pl-PL,pl;q=0.9",
};

// The one bounded pattern that lifts the embedded JSON out of the page. No DOM, no
// HTML parser: CLAUDE.md, Cloudflare Workers runtime.
const NEXT_DATA = /id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

// Where a followed redirect may land. Mirrors ACCEPTED_HOSTS in url.ts — kept local
// because this module may only have type imports (scripts/otodom-inspect.mjs).
const OTODOM_HOSTS = new Set(["otodom.pl", "www.otodom.pl"]);
const OFFER_PATH = /^\/(?:pl\/)?oferta\/[^/]+\/?$/;
// The results page, alone or with further segments: where the portal sends a listing it no
// longer has.
const RESULTS_PATH = /^\/(?:pl\/)?wyniki(?:\/|$)/;
// The `ID…` token that ends an offer's slug. Mirrors `listingToken` in src/pages/api/offers.ts.
const LISTING_TOKEN = /[-/](ID[A-Za-z0-9]+)\/?$/;
// An address quoted in an error message: the slug and the query string must not leave this module.
const QUOTED_URL = /https?:\/\/\S+/g;

type FetchFailure = Extract<FetchOfferResult, { ok: false }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  // `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError", a
  // manual abort with "AbortError".
  return isRecord(error) && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** Drops the keys that hold nothing, so an absent fact is an absent key. */
function stated<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== "")) as T;
}

function withoutUrls(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(QUOTED_URL, "<url>") : undefined;
}

function describeCause(cause: unknown): string | undefined {
  if (!isRecord(cause)) return withoutUrls(cause);
  const message = withoutUrls(cause.message);
  if (message === undefined) return undefined;
  return typeof cause.name === "string" && cause.name !== "" ? `${cause.name}: ${message}` : message;
}

/** What a thrown value says about itself, with every quoted address replaced. */
function errorEvidence(error: unknown, phase: "headers" | "body"): FetchEvidence {
  if (!isRecord(error)) return stated({ errorMessage: withoutUrls(error), phase });
  return stated({
    errorName: typeof error.name === "string" ? error.name : undefined,
    errorMessage: withoutUrls(error.message),
    errorCause: describeCause(error.cause),
    phase,
  });
}

type Landing = "unknown" | "unparseable" | "off_otodom" | "results" | "elsewhere" | "offer";

/**
 * Where the followed redirects ended. An offer page is named by its token alone; any other
 * page by its path, without the query string or the fragment.
 */
function readLanding(url: string): { landing: Landing; evidence: FetchEvidence } {
  // `fetch` always reports an address; only a hand-built `Response` has none.
  if (url === "") return { landing: "unknown", evidence: {} };
  if (!URL.canParse(url)) return { landing: "unparseable", evidence: {} };
  const landed = new URL(url);
  const landedHost = landed.hostname;
  const landedPath = landed.pathname;
  if (!OTODOM_HOSTS.has(landedHost)) return { landing: "off_otodom", evidence: stated({ landedHost, landedPath }) };
  if (OFFER_PATH.test(landedPath)) {
    return { landing: "offer", evidence: stated({ landedHost, landedListing: LISTING_TOKEN.exec(landedPath)?.[1] }) };
  }
  return { landing: RESULTS_PATH.test(landedPath) ? "results" : "elsewhere", evidence: { landedHost, landedPath } };
}

/**
 * Fetches one otodom offer page and returns its `props.pageProps.ad` payload.
 * Failure reasons are kept apart so a recognised block (`challenged`), a refusal
 * (`http_denied`), a page that came without listing data (`data_missing`) and a changed
 * page (`shape_changed`, with `detail`) can be told from each other without guessing. The
 * checks run in the order they are written: the first one that matches names the reason.
 * Every failure carries `evidence` — what the answer said about itself — for the log entry.
 */
export async function fetchOfferAd(url: string, signal: AbortSignal): Promise<FetchOfferResult> {
  // Two narrow `try` blocks, one per I/O call: reading the headers, the status and the
  // landing address stands between them and cannot be mistaken for a network failure.
  let response: Response;
  try {
    response = await fetch(url, { headers: REQUEST_HEADERS, redirect: "follow", signal });
  } catch (error) {
    return {
      ok: false,
      reason: isAbort(error, signal) ? "timeout" : "network",
      evidence: errorEvidence(error, "headers"),
    };
  }

  const status = response.status;
  const { landing, evidence: landed } = readLanding(response.url);
  const cfMitigated = response.headers.get("cf-mitigated") ?? "";
  const answered: FetchEvidence = stated({
    contentType: response.headers.get("content-type") ?? "",
    cfMitigated,
    retryAfter: response.headers.get("retry-after") ?? "",
    ...landed,
  });
  const fail = (reason: FetchFailureReason, more: FetchEvidence = {}, detail?: string): FetchFailure => ({
    ok: false,
    reason,
    ...(detail === undefined ? {} : { detail }),
    status,
    evidence: { ...answered, ...more },
  });

  // Cloudflare marks an answer it served instead of the origin's. Checked before the status:
  // a challenge comes with 403 and with 200 alike. The one block this module recognises —
  // the page's text is never searched for one.
  if (cfMitigated !== "") return fail("challenged");
  if (status === 404 || status === 410) return fail("not_found");
  // The portal failing, not refusing: kept apart from http_denied so an outage is
  // never read as a blocked egress (the Apify fallback trigger).
  if (status >= 500) return fail("upstream_error");
  // 403/429 are the egress-blocking signatures; any other 4xx is still a refusal.
  if (!response.ok) return fail("http_denied");

  // Sent off otodom (a consent or anti-bot page): the portal did not serve the offer.
  if (landing === "off_otodom") return fail("http_denied");
  // Still otodom, on the results page: there is no listing at this address.
  if (landing === "results") return fail("not_found");
  // Anywhere else on otodom, or an address that cannot be read, is a landing nobody has seen.
  if (landing === "elsewhere" || landing === "unparseable") return fail("unexpected_landing");

  let html: string;
  try {
    html = await response.text();
  } catch (error) {
    return fail(isAbort(error, signal) ? "timeout" : "network", errorEvidence(error, "body"));
  }

  const json = NEXT_DATA.exec(html)?.[1];
  const body: FetchEvidence = { bodyLength: html.length, markerPresent: json !== undefined };
  // No marker at all: a changed page and a block served with 200 look the same from here.
  if (json === undefined) return fail("data_missing", body);

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return fail("shape_changed", body, "next_data_unparseable");
  }

  const props = isRecord(data) ? data.props : undefined;
  const pageProps = isRecord(props) ? props.pageProps : undefined;
  if (!isRecord(pageProps)) return fail("shape_changed", body, "page_props_missing");

  const ad = pageProps.ad;
  if (isRecord(ad)) {
    // An expired offer may still ship its payload with the flag set on the ad itself.
    if (ad.shouldShowExpiredAdPage === true) return fail("expired", body);
    return { ok: true, ad };
  }
  if (pageProps.shouldShowExpiredAdPage) return fail("expired", body);
  return fail("shape_changed", body, "ad_missing");
}
