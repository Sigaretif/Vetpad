// What the Worker sends to the extraction service (Apify) for one otodom.pl listing, and how its
// answer is read — the one definition, shared by the token-holding leg (`./apify.ts`) and by the
// live verification script, which loads this file under Node's type stripping. So its only value
// import is the import-free `./deadlines.ts`, through a `.ts` specifier: never `astro:*`, `@/…` or a
// package, and nothing here holds the token.
//
// The actor is `apify/cheerio-scraper`, run with our own `pageFunction` through the `RESIDENTIAL`
// proxy group in `PL` (context/changes/otodom-apify-fallback/spike-apify.md). The page is read
// inside Apify; the Worker parses no HTML (CLAUDE.md, Cloudflare Workers runtime). What comes back
// is otodom's own `pageProps.ad`, narrowed to the whitelist below inside Apify, so the Worker runs
// the same classifier and the same mapper on it as on a direct fetch.

import { APIFY_RUN_TIMEOUT_S } from "./deadlines.ts";

/** `apify/cheerio-scraper`, by its technical id: the token's Run permission is granted on this id. */
export const APIFY_ACTOR_ID = "YrQuEkowkNCLdk4j2";

/** One synchronous run whose answer is the run's dataset. The token travels in a header, never here. */
export const APIFY_ENDPOINT = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`;

/**
 * The run's own limits: what it may cost at most, how long it may take (Apify ends it then, and
 * answers), and its memory.
 */
export const APIFY_RUN_PARAMS = {
  maxTotalChargeUsd: "0.05",
  timeout: String(APIFY_RUN_TIMEOUT_S),
  memory: "1024",
} as const;

/**
 * The top-level keys of otodom's `ad` the `pageFunction` copies, and nothing else: the spike's
 * `KEEP`. The advertiser's data — `owner`, `contactDetails`, `agency` — is not among them, so it
 * never leaves Apify (CLAUDE.md, Secrets and data access).
 */
export const APIFY_AD_KEYS = [
  "id",
  "url",
  "title",
  "description",
  "characteristics",
  "features",
  "adCategory",
  "images",
  "createdAt",
  "modifiedAt",
  "advertType",
  "shouldShowExpiredAdPage",
] as const;

/** From `ad.location`, only these keys are copied. */
export const APIFY_LOCATION_KEYS = ["coordinates", "reverseGeocoding", "address"] as const;

/** From `ad.target`, only these keys: the rest of it repeats the seller's account id. */
export const APIFY_TARGET_KEYS = ["OfferType", "ProperType"] as const;

/**
 * The code Apify runs on the fetched page, with the run's full account permissions — so it is one
 * fixed string, reviewed like code, and nothing from a request is ever put into it. It is
 * assembled once, here, from the three lists above, so there is one whitelist and not a second
 * copy inside a string. It reads the status as `response.status` and returns, besides the narrowed
 * `ad`, whether `pageProps` was there at all, so a missing `pageProps` is told from a missing ad.
 */
export const APIFY_PAGE_FUNCTION = `async function pageFunction(context) {
  const { $, request, response } = context;
  const AD_KEYS = ${JSON.stringify(APIFY_AD_KEYS)};
  const LOCATION_KEYS = ${JSON.stringify(APIFY_LOCATION_KEYS)};
  const TARGET_KEYS = ${JSON.stringify(APIFY_TARGET_KEYS)};
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const pick = (source, keys) => {
    const picked = {};
    for (const key of keys) if (key in source) picked[key] = source[key];
    return picked;
  };
  const text = $("script#__NEXT_DATA__").first().text();
  let ad = null;
  let pagePropsPresent = false;
  let pagePropsExpired = null;
  let parseError = false;
  if (text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      parseError = true;
    }
    const pageProps = parseError ? undefined : data?.props?.pageProps;
    if (isObject(pageProps)) {
      pagePropsPresent = true;
      const expired = pageProps.shouldShowExpiredAdPage;
      pagePropsExpired = expired === undefined || expired === null ? null : Boolean(expired);
      const source = pageProps.ad;
      if (isObject(source)) {
        ad = pick(source, AD_KEYS);
        if (isObject(source.location)) ad.location = pick(source.location, LOCATION_KEYS);
        if (isObject(source.target)) ad.target = pick(source.target, TARGET_KEYS);
      }
    }
  }
  return {
    requestedUrl: request.url,
    loadedUrl: request.loadedUrl ?? null,
    status: response?.status ?? null,
    markerPresent: Boolean(text),
    parseError,
    pagePropsPresent,
    pagePropsExpired,
    ad,
  };
}`;

/** The body of one run: one start address, our `pageFunction`, the residential proxy, one request. */
export interface ApifyRequestBody {
  startUrls: { url: string }[];
  pageFunction: string;
  proxyConfiguration: { useApifyProxy: true; apifyProxyGroups: string[]; apifyProxyCountry: string };
  maxRequestsPerCrawl: number;
  maxRequestRetries: number;
  maxConcurrency: number;
}

/**
 * The run for one listing. `normalizedUrl` is always the output of `normalizeOfferUrl` — the only
 * part of the request that varies. The address carries the run's parameters and never the token.
 */
export function buildApifyRequest(normalizedUrl: string): { url: string; body: ApifyRequestBody } {
  return {
    url: `${APIFY_ENDPOINT}?${new URLSearchParams(APIFY_RUN_PARAMS).toString()}`,
    body: {
      startUrls: [{ url: normalizedUrl }],
      pageFunction: APIFY_PAGE_FUNCTION,
      // Datacenter proxies get 403 from otodom (spike-apify.md), and a refused datacenter egress is
      // exactly what the fallback answers.
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "PL" },
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 1,
      maxConcurrency: 1,
    },
  };
}

/** One dataset item as the `pageFunction` returns it, every field checked. */
export interface ApifyItem {
  requestedUrl: string;
  /** Where the page's redirects ended; `""` when the item does not say. */
  loadedUrl: string;
  /** The HTTP status otodom answered Apify's request with. */
  status: number;
  markerPresent: boolean;
  parseError: boolean;
  pagePropsPresent: boolean;
  pagePropsExpired: boolean | null;
  /** Otodom's `ad`, narrowed inside Apify; `null` when the page held none. */
  ad: Record<string, unknown> | null;
}

/**
 * Why an Apify answer holds no item to classify:
 * - `http` — Apify refused or failed the request (any status outside 2xx);
 * - `empty_dataset` — the run ended with no item;
 * - `malformed_item` — an answer or an item that is not what the `pageFunction` returns, or an item
 *   about another address than the one sent;
 * - `run_error` — the run's own error item (`#error`): Apify reached otodom and could not read the
 *   page, as when otodom refused the proxy.
 */
export type ApifyAnswerFailure = "http" | "empty_dataset" | "malformed_item" | "run_error";

export type ApifyAnswer =
  | { ok: true; item: ApifyItem; apifyStatus: number }
  | { ok: false; apifyFailure: ApifyAnswerFailure; apifyStatus: number; apifyErrorType?: string };

/** Apify's name for an error is a short token; anything else is free text and is not kept. */
const ERROR_TYPE = /^[A-Za-z0-9_.-]{1,80}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `error.type` of Apify's error body, when it is a token. `error.message` is never read. */
function errorType(json: unknown): string | undefined {
  if (!isRecord(json) || !isRecord(json.error)) return undefined;
  const type = json.error.type;
  return typeof type === "string" && ERROR_TYPE.test(type) ? type : undefined;
}

/** The item with every field checked, or `null` when any field is not what the `pageFunction` returns. */
function readItem(value: Record<string, unknown>): ApifyItem | null {
  const { requestedUrl, loadedUrl, status, markerPresent, parseError, pagePropsPresent, pagePropsExpired, ad } = value;
  if (typeof requestedUrl !== "string") return null;
  if (loadedUrl !== undefined && loadedUrl !== null && typeof loadedUrl !== "string") return null;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) return null;
  if (typeof markerPresent !== "boolean" || typeof parseError !== "boolean") return null;
  if (typeof pagePropsPresent !== "boolean") return null;
  if (pagePropsExpired !== null && typeof pagePropsExpired !== "boolean") return null;
  if (ad !== null && !isRecord(ad)) return null;
  return {
    requestedUrl,
    loadedUrl: loadedUrl ?? "",
    status,
    markerPresent,
    parseError,
    pagePropsPresent,
    pagePropsExpired,
    ad,
  };
}

/**
 * Apify's answer to one run, read without trusting it. `json` is the parsed body, or `undefined`
 * when the body was not JSON. Pure: no text of Apify's — an error's `message`, the run's `#debug`
 * — is ever copied into the result, only the status, the error's `type` token and our own reason.
 */
export function readApifyAnswer(httpStatus: number, json: unknown, requestedUrl: string): ApifyAnswer {
  const failure = (apifyFailure: ApifyAnswerFailure, apifyErrorType?: string): ApifyAnswer => ({
    ok: false,
    apifyFailure,
    apifyStatus: httpStatus,
    ...(apifyErrorType === undefined ? {} : { apifyErrorType }),
  });

  if (httpStatus < 200 || httpStatus > 299) return failure("http", errorType(json));
  if (!Array.isArray(json)) return failure("malformed_item");
  if (json.length === 0) return failure("empty_dataset");
  // One start address and one request per run: a second item is not an answer this run gives.
  if (json.length > 1) return failure("malformed_item");

  const [value] = json as unknown[];
  if (!isRecord(value)) return failure("malformed_item");
  // The run's own error comes as an item with `#error` and the crawler's `#debug` (stack traces
  // among it), and no data: a page Apify could not read, never data.
  if (value["#error"] === true) return failure("run_error");

  const item = readItem(value);
  if (item === null) return failure("malformed_item");
  // An item about another address is not this listing's.
  if (item.requestedUrl !== requestedUrl) return failure("malformed_item");
  return { ok: true, item, apifyStatus: httpStatus };
}
