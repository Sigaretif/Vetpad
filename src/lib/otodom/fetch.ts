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
// The `ID…` token that ends an offer's slug, read from the slug's own path segment. Mirrors
// `listingToken` in src/pages/api/offers.ts.
const SLUG_TOKEN = /(?:^|-)(ID[A-Za-z0-9]+)$/;
const OFFER_SEGMENT = "oferta";
// An address quoted in an error message: the slug and the query string must not leave this module.
// The second pattern is an offer's address written without a scheme, or its path alone. Both are
// used with `replace` only — a `g` pattern keeps its position between `test` or `exec` calls.
const QUOTED_URL = /https?:\/\/\S+/gi;
const QUOTED_OFFER = /\S*\/oferta\/\S+/gi;
// A system error's code, such as ECONNREFUSED: short, and never free text.
const ERROR_CODE = /^[A-Za-z0-9_]{1,40}$/;

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
function stated<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== ""),
  ) as Partial<T>;
}

function withoutUrls(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(QUOTED_URL, "<url>").replace(QUOTED_OFFER, "<url>") : undefined;
}

/** A cause as `name code: message`, each part only when the cause has it. */
function describeCause(cause: unknown): string | undefined {
  if (!isRecord(cause)) return withoutUrls(cause);
  const code = typeof cause.code === "string" && ERROR_CODE.test(cause.code) ? cause.code : "";
  const message = withoutUrls(cause.message) ?? "";
  // A name with neither says nothing about what happened.
  if (code === "" && message === "") return undefined;
  const name = typeof cause.name === "string" ? cause.name : "";
  const label = [name, code].filter((part) => part !== "").join(" ");
  return [label, message].filter((part) => part !== "").join(": ");
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

/**
 * A landing path with every slug taken out, and the token of the first one. A slug repeats the
 * listing's title, so a segment is replaced when it stands where a slug does — after `oferta` —
 * when it ends in a token, or when it carries `oferta` inside itself: an address quoted in one
 * encoded segment. What is left says where the redirects ended and nothing about the listing.
 */
function withoutSlugs(pathname: string): Pick<FetchEvidence, "landedPath" | "landedListing"> {
  const segments = pathname.split("/");
  let landedListing: string | undefined;
  for (const [index, segment] of segments.entries()) {
    if (segment === "") continue;
    const token = SLUG_TOKEN.exec(segment)?.[1];
    const name = segment.toLowerCase();
    const afterOffer = index > 0 && segments[index - 1].toLowerCase() === OFFER_SEGMENT;
    if (token === undefined && !afterOffer && (name === OFFER_SEGMENT || !name.includes(OFFER_SEGMENT))) continue;
    landedListing ??= token;
    segments[index] = "<slug>";
  }
  return stated({ landedPath: segments.join("/"), landedListing });
}

type Landing = "unknown" | "unparseable" | "off_otodom" | "results" | "elsewhere" | "offer";

/**
 * Where the followed redirects ended. An offer page is named by its token alone; any other
 * page by its path — without the query string, the fragment or a slug — and by the token of a
 * slug that path held.
 */
function readLanding(url: string): { landing: Landing; evidence: FetchEvidence } {
  // `fetch` always reports an address; only a hand-built `Response` has none.
  if (url === "") return { landing: "unknown", evidence: {} };
  if (!URL.canParse(url)) return { landing: "unparseable", evidence: {} };
  const landed = new URL(url);
  const landedHost = landed.hostname;
  const { landedPath, landedListing } = withoutSlugs(landed.pathname);
  if (!OTODOM_HOSTS.has(landedHost)) {
    return { landing: "off_otodom", evidence: stated({ landedHost, landedPath, landedListing }) };
  }
  if (OFFER_PATH.test(landed.pathname)) return { landing: "offer", evidence: stated({ landedHost, landedListing }) };
  return {
    landing: RESULTS_PATH.test(landed.pathname) ? "results" : "elsewhere",
    evidence: stated({ landedHost, landedPath, landedListing }),
  };
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
  const requested = URL.canParse(url) ? withoutSlugs(new URL(url).pathname).landedListing : undefined;
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
  // Sent off otodom (a consent or anti-bot page): the portal did not serve the offer. Checked
  // before the status, which is that other host's and says nothing about the listing.
  if (landing === "off_otodom") return fail("http_denied");
  if (status === 404 || status === 410) return fail("not_found");
  // The portal failing, not refusing: kept apart from http_denied so an outage is
  // never read as a blocked egress (the Apify fallback trigger).
  if (status >= 500) return fail("upstream_error");
  // 403/429 are the egress-blocking signatures; any other 4xx is still a refusal.
  if (!response.ok) return fail("http_denied");

  // Still otodom, on the results page: there is no listing at this address.
  if (landing === "results") return fail("not_found");
  // Anywhere else on otodom, or an address that cannot be read, is a landing nobody has seen.
  if (landing === "elsewhere" || landing === "unparseable") return fail("unexpected_landing");
  // An offer page, but another offer's: its ad is whole and is not the listing that was asked
  // for. Two tokens are needed to say so; with either missing the page is read.
  if (requested !== undefined && landed.landedListing !== undefined && landed.landedListing !== requested) {
    return fail("unexpected_landing");
  }

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
    // The error is left out on purpose: its message quotes the text it could not parse, and that
    // text is the listing. `detail` and the body's length are the evidence.
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
