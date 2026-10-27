// The one module that holds the Google Maps server key (`GOOGLE_MAPS_SERVER_KEY`) and talks to the
// Routes API (FR-016): one `computeRoutes` request for one point and one travel mode, turned into
// exactly one result.
//
// Server-only: the key is read from `astro:env/server`, so no island, layout or page render imports
// this module (`paidServiceServerOnlyConfig` in eslint.config.js); a view asks
// `isCommuteAvailable()` in `@/lib/config-status`. A missing key is a supported state — the factory
// answers `null` and nothing is sent (CLAUDE.md, the zero-config rule).
//
// A Routes request is billed, so three things hold here:
// - One `fetch` per call, never a retry. Calculating again is the member's deliberate action.
// - Google's words stay here. Its error's `message` can quote the request, which holds a point's
//   address, so only the HTTP status and the error's `status` enum leave this module.
// - Nothing Google returns is stored: the result lives in the route's answer and the island alone.

import { GOOGLE_MAPS_SERVER_KEY } from "astro:env/server";
import type { CommuteOrigin } from "./origin";

export const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

/**
 * The fields asked for. There is no default list: without a mask Google answers an error. Time,
 * distance and the line for the map — never a description or the steps (EEA SST §20.1).
 */
export const ROUTES_FIELD_MASK = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline";

export type CommuteMode = "TRANSIT" | "DRIVE";

/** The values of `error.status` (google.rpc.Code) — the one part of Google's error that is read. */
export const GOOGLE_STATUSES = [
  "CANCELLED",
  "UNKNOWN",
  "INVALID_ARGUMENT",
  "DEADLINE_EXCEEDED",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "ABORTED",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DATA_LOSS",
] as const;

export type GoogleStatus = (typeof GOOGLE_STATUSES)[number];

export type RouteCallFailure = "denied" | "quota" | "unavailable" | "timeout" | "unreadable";

/** How one call ended: a route, no route, a request Google rejected, or a failure. */
export type RouteCallResult =
  | { kind: "route"; durationSeconds: number; distanceMeters: number; encodedPolyline: string }
  | { kind: "no_route" }
  | { kind: "rejected"; googleStatus: GoogleStatus | null }
  | {
      kind: "failed";
      reason: RouteCallFailure;
      /** The HTTP status of Google's answer; `null` when no answer came. */
      httpStatus: number | null;
      googleStatus: GoogleStatus | null;
    };

export interface RouteCallRequest {
  origin: CommuteOrigin;
  /** A team point's address, as stored. Sent to Google and nowhere else. */
  destinationAddress: string;
  mode: CommuteMode;
  /** RFC 3339; sent for `TRANSIT` only (`nextWorkingDayAt8Warsaw`). */
  departureTime?: string;
  /** Ends the call at the latest; the route passes `AbortSignal.timeout(COMMUTE_CALL_DEADLINE_MS)`. */
  signal: AbortSignal;
}

export interface RoutesClient {
  computeRoute: (request: RouteCallRequest) => Promise<RouteCallResult>;
}

/**
 * The client for one request, or `null` when the application has no key — the zero-config state,
 * in which nothing is sent to Google. The key is read at the call, never kept at module scope.
 */
export function createRoutesClient(): RoutesClient | null {
  const key = GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  return { computeRoute: (request) => computeRoute(key, request) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  // `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError", a manual abort with "AbortError".
  return isRecord(error) && (error.name === "AbortError" || error.name === "TimeoutError");
}

function waypoint(origin: CommuteOrigin): Record<string, unknown> {
  return origin.kind === "coordinates"
    ? { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } }
    : { address: origin.address };
}

/**
 * The request body: no `routingPreference` (allowed only for DRIVE, and `TRAFFIC_AWARE*` would move
 * the request to the Pro SKU), and `departureTime` for public transport only.
 */
export function routesRequestBody(request: Omit<RouteCallRequest, "signal">): Record<string, unknown> {
  return {
    origin: waypoint(request.origin),
    destination: { address: request.destinationAddress },
    travelMode: request.mode,
    regionCode: "pl",
    ...(request.mode === "TRANSIT" && request.departureTime !== undefined
      ? { departureTime: request.departureTime }
      : {}),
  };
}

/** `error.status` of Google's error body when it is one of the known values; its `message` is never read. */
function googleStatusOf(json: unknown): GoogleStatus | null {
  if (!isRecord(json) || !isRecord(json.error)) return null;
  const status = json.error.status;
  return (GOOGLE_STATUSES as readonly unknown[]).includes(status) ? (status as GoogleStatus) : null;
}

/** A protobuf `Duration` as JSON: seconds with an `s`, e.g. `"1234s"` or `"12.5s"`. */
function durationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match === null ? null : Math.round(Number(match[1]));
}

/** The answer to a request Google accepted: the first route, no route, or `unreadable`. */
function readRoutes(json: unknown, httpStatus: number): RouteCallResult {
  const unreadable: RouteCallResult = { kind: "failed", reason: "unreadable", httpStatus, googleStatus: null };
  if (!isRecord(json)) return unreadable;
  // An empty or absent `routes` is "no route could be found": the response has no status field.
  if (json.routes === undefined) return { kind: "no_route" };
  if (!Array.isArray(json.routes)) return unreadable;
  const routes = json.routes as unknown[];
  if (routes.length === 0) return { kind: "no_route" };

  const route = routes[0];
  if (!isRecord(route)) return unreadable;
  const seconds = durationSeconds(route.duration);
  // Proto3 JSON leaves a zero out, so a point at the flat's own spot comes back with no distance.
  const meters = route.distanceMeters === undefined ? 0 : route.distanceMeters;
  const polyline = isRecord(route.polyline) ? route.polyline.encodedPolyline : undefined;
  if (
    seconds === null ||
    typeof meters !== "number" ||
    !Number.isInteger(meters) ||
    meters < 0 ||
    typeof polyline !== "string" ||
    polyline === ""
  ) {
    return unreadable;
  }
  return { kind: "route", durationSeconds: seconds, distanceMeters: meters, encodedPolyline: polyline };
}

function failureOf(httpStatus: number): RouteCallFailure {
  if (httpStatus === 401 || httpStatus === 403) return "denied";
  if (httpStatus === 429) return "quota";
  return "unavailable";
}

async function computeRoute(key: string, request: RouteCallRequest): Promise<RouteCallResult> {
  const { signal } = request;
  const noAnswer = (error: unknown): RouteCallResult => ({
    kind: "failed",
    reason: isAbort(error, signal) ? "timeout" : "unavailable",
    httpStatus: null,
    googleStatus: null,
  });

  // Two narrow `try` blocks, one per I/O step. The thrown value is never kept: its message may
  // quote the request.
  let response: Response;
  try {
    response = await fetch(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK,
      },
      body: JSON.stringify(routesRequestBody(request)),
      signal,
    });
  } catch (error) {
    return noAnswer(error);
  }

  const httpStatus = response.status;
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return isAbort(error, signal)
      ? { kind: "failed", reason: "timeout", httpStatus, googleStatus: null }
      : { kind: "failed", reason: "unavailable", httpStatus, googleStatus: null };
  }

  let json: unknown;
  let parsed = true;
  try {
    json = JSON.parse(text);
  } catch {
    parsed = false;
  }

  if (response.ok) {
    return parsed
      ? readRoutes(json, httpStatus)
      : { kind: "failed", reason: "unreadable", httpStatus, googleStatus: null };
  }
  const googleStatus = parsed ? googleStatusOf(json) : null;
  if (httpStatus === 400) return { kind: "rejected", googleStatus };
  return { kind: "failed", reason: failureOf(httpStatus), httpStatus, googleStatus };
}
