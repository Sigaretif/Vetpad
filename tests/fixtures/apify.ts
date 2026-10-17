import type { FetchContext, RecordedRequest } from "./http";
import { FLAT_SALE_URL, flatSaleAd, rentalFlat, type Ad } from "./otodom";

// The extraction service (Apify), as the fallback fetch talks to it — and the only way a test may
// meet it. Nothing here was recorded from the live API, no test holds a real token, and every
// request goes to the `fetch` stub of tests/fixtures/http.ts: a paid run cannot be started from
// `npm test`. The shapes are written by hand from context/changes/otodom-apify-fallback/
// spike-apify.md and the plan of that change (Phase 2 §4):
//
// - The request: one `POST https://api.apify.com/v2/acts/YrQuEkowkNCLdk4j2/run-sync-get-dataset-items`
//   with the run's parameters in the query string, `Authorization: Bearer <token>` and a JSON body
//   holding the start address, our `pageFunction` and the proxy.
// - A finished run: `201` with the dataset — an array of the items the `pageFunction` returned,
//   here one. Its `ad` is otodom's `pageProps.ad`, narrowed inside Apify.
// - A run that could not read the page: still `201`, with one item `{ "#error": true, "#debug":
//   { errorMessages, retryCount, … } }` and no data. `#debug` holds stack traces.
// - A refused request: the status with `{ "error": { "type", "message" } }`. The types of 401 and
//   403 are the ones the spike met; those of 402, 408 and 429 are plausible names, not verified —
//   the reader keeps whatever token comes and never the message.

/** A test value only — shaped like a token, and worth nothing. */
export const APIFY_TEST_TOKEN = "apify_api_test_kanarek_0000";

/** Sits in every error message and every `#debug` the stubbed service writes. No result may carry it. */
export const APIFY_MESSAGE_CANARY = "kanarek-komunikat-apify-3c9d";

const APIFY_HOST = "api.apify.com";
const RUN_PATH = "/v2/acts/YrQuEkowkNCLdk4j2/run-sync-get-dataset-items";

/** True for the one request a fallback may send: a synchronous run of cheerio-scraper. */
export function isApifyRequest(request: RecordedRequest): boolean {
  const url = new URL(request.url);
  return url.hostname === APIFY_HOST && url.pathname === RUN_PATH && request.method === "POST";
}

/** Every request that reached Apify's host, whatever its path: each one is a run that may be billed. */
export function apifyCalls(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => new URL(request.url).hostname === APIFY_HOST);
}

/** The headers of every Apify request a stub answered, in order: the stub records no headers itself. */
export function recordApifyHeaders(sink: Headers[]) {
  return (request: RecordedRequest, context: FetchContext): void => {
    if (isApifyRequest(request)) sink.push(context.headers ?? new Headers());
  };
}

export type ApifyItemFixture = Record<string, unknown>;

/**
 * One item as our `pageFunction` returns it for `FLAT_SALE_URL`. Its `ad` is `flatSaleAd()` as the
 * portal serves it, seller data and all — `owner`, `contactDetails`, `agency`, `target.seller_id` —
 * as if the whitelist inside Apify had let it through: what keeps it out of a row is then the
 * Worker's own mapper, which is what a canary test proves. `overrides` replace item fields.
 */
export function apifyItem(ad: Ad | null = flatSaleAd(), overrides: ApifyItemFixture = {}): ApifyItemFixture {
  return {
    requestedUrl: FLAT_SALE_URL,
    loadedUrl: FLAT_SALE_URL,
    status: 200,
    markerPresent: true,
    parseError: false,
    pagePropsPresent: true,
    pagePropsExpired: null,
    ad,
    ...overrides,
  };
}

/** The run's own error item: no data, and a `#debug` whose text no result may carry. */
export function apifyRunError(): ApifyItemFixture {
  return {
    "#error": true,
    "#debug": {
      requestId: "kanarek-request-0001",
      url: FLAT_SALE_URL,
      method: "GET",
      retryCount: 1,
      errorMessages: [
        `${APIFY_MESSAGE_CANARY}: Request blocked - received 403 status code.\n    at CheerioCrawler._handleNavigation (/home/myuser/node_modules/kanarek.js:1:1)`,
      ],
    },
  };
}

// Item variants: what a page the `pageFunction` read said about itself.

/** A flat for rent, read whole: Apify passes it on, and the mapper's gate refuses it. */
export function apifyRentalItem(): ApifyItemFixture {
  return apifyItem(rentalFlat());
}

/** A listing otodom answers with `410`, as the spike saw an expired offer through the residential proxy. */
export function apifyGoneItem(): ApifyItemFixture {
  return apifyItem(flatSaleAd({ description: "***" }), { status: 410 });
}

/** A redirect to the results page, where the portal sends a listing it no longer has. */
export const RESULTS_LANDING = "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/warszawa";

export function apifyResultsItem(): ApifyItemFixture {
  return apifyItem(flatSaleAd(), { loadedUrl: RESULTS_LANDING });
}

/** An ad that ships with its expired flag set. */
export function apifyExpiredItem(): ApifyItemFixture {
  return apifyItem(flatSaleAd({ shouldShowExpiredAdPage: true }));
}

/** A page without the `__NEXT_DATA__` script. */
export function apifyNoMarkerItem(): ApifyItemFixture {
  return apifyItem(null, { markerPresent: false, pagePropsPresent: false });
}

/** A `__NEXT_DATA__` script whose text did not parse. */
export function apifyParseErrorItem(): ApifyItemFixture {
  return apifyItem(null, { parseError: true, pagePropsPresent: false });
}

/** Data without `props.pageProps`. */
export function apifyNoPagePropsItem(): ApifyItemFixture {
  return apifyItem(null, { pagePropsPresent: false });
}

/** A JSON answer the way Apify sends one. */
function apifyJson(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

/** A finished run: `201` with its dataset. */
export function apifyDataset(items: unknown[], status = 201): Response {
  return apifyJson(items, status);
}

/** A finished run whose dataset is empty. */
export function apifyEmpty(): Response {
  return apifyDataset([]);
}

/** A refused request: `status` with Apify's error body, whose message carries the canary. */
export function apifyError(status: number, type: string, messageCanary: string = APIFY_MESSAGE_CANARY): Response {
  return apifyJson({ error: { type, message: `${messageCanary}: ${type} for ${FLAT_SALE_URL}` } }, status);
}

/**
 * A run that exceeded its `timeout=`: `run-sync-get-dataset-items` answers 400 `run-failed`, observed
 * live on 2026-10-17 (Console status TIMED-OUT, no dataset, $0.000) — `live-verification.md`.
 */
export function apifyRunTimeout(messageCanary: string = APIFY_MESSAGE_CANARY): Response {
  return apifyError(400, "run-failed", messageCanary);
}

/**
 * A service that never answers: the request stays open until the caller's signal aborts, and is
 * then rejected with the signal's reason, as a real `fetch` rejects an aborted request.
 */
export function apifySilence({ signal }: FetchContext): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}
