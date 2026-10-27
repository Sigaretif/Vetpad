import type { FetchContext, RecordedRequest } from "./http";

// Google Maps, as the commute calculation (FR-016) talks to it — and the only way a test may meet
// it. Nothing here was recorded from the live API, no test holds a real key, and every request goes
// to the `fetch` stub of tests/fixtures/http.ts: a billed Routes request cannot be made from
// `npm test`. The shapes are written by hand from the Routes API reference
// (developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes and
// routes/handle-errors), as context/changes/commute-times/plan.md records them:
//
// - The request: one `POST https://routes.googleapis.com/directions/v2:computeRoutes` with the key
//   in `X-Goog-Api-Key`, the field mask in `X-Goog-FieldMask` and a JSON body.
// - A route: `200` with `{ "routes": [{ "duration": "1234s", "distanceMeters": 5678, "polyline":
//   { "encodedPolyline": "…" } }] }` — only the masked fields.
// - No route: `200` with `{}` — an empty `routes` is left out of the JSON altogether.
// - An error: the status with `{ "error": { "code", "message", "status" } }`. Its `message` can
//   quote the request, which holds an address, so here it carries a canary no result may hold.

/** Test values only — shaped like keys, and worth nothing. */
export const GOOGLE_TEST_SERVER_KEY = "AIzaTEST-kanarek-serwer-0000000000000";
export const GOOGLE_TEST_BROWSER_KEY = "AIzaTEST-kanarek-przegladarka-00000000";

/** A point's address: it may reach Google's request body, and nothing else. */
export const POINT_ADDRESS_CANARY = "ul. Kanarkowa 7c, Warszawa";

/** Sits in every error message the stubbed Google writes. No result or log entry may carry it. */
export const GOOGLE_MESSAGE_CANARY = "kanarek-komunikat-google-5e1b";

const ROUTES_HOST = "routes.googleapis.com";
const ROUTES_PATH = "/directions/v2:computeRoutes";

/** True for the one request a calculation may send: `computeRoutes`. */
export function isRoutesRequest(request: RecordedRequest): boolean {
  const url = new URL(request.url);
  return url.hostname === ROUTES_HOST && url.pathname === ROUTES_PATH && request.method === "POST";
}

/**
 * Every request that reached a Google Maps host, whatever its path: each one may be billed. Counted
 * by host, so a request to the Maps JavaScript API or another Google endpoint counts too.
 */
export function routesCalls(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => {
    const host = new URL(request.url).hostname;
    return host.endsWith(".googleapis.com") || host === "maps.google.com";
  });
}

/** The headers of every Routes request a stub answered, in order: the stub records no headers itself. */
export function recordRoutesHeaders(sink: Headers[]) {
  return (request: RecordedRequest, context: FetchContext): void => {
    if (isRoutesRequest(request)) sink.push(context.headers ?? new Headers());
  };
}

function googleJson(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

/** A route: `seconds` in the `"123s"` form, `meters`, and the line for the map. */
export function routesOk(seconds: number, meters: number, polyline: string): Response {
  return googleJson(
    { routes: [{ duration: `${seconds}s`, distanceMeters: meters, polyline: { encodedPolyline: polyline } }] },
    200,
  );
}

/** No route could be found: `200` with no `routes` at all. */
export function routesEmpty(): Response {
  return googleJson({}, 200);
}

/** An error: `httpStatus` with Google's error body, whose message carries `message` (the canary by default). */
export function routesError(
  httpStatus: number,
  googleStatus: string,
  message = `${GOOGLE_MESSAGE_CANARY}: could not geocode ${POINT_ADDRESS_CANARY}`,
): Response {
  return googleJson({ error: { code: httpStatus, message, status: googleStatus } }, httpStatus);
}

/**
 * A service that never answers: the request stays open until the caller's signal aborts, and is
 * then rejected with the signal's reason, as a real `fetch` rejects an aborted request.
 */
export function routesSilence({ signal }: FetchContext): Promise<Response> {
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
