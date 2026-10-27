import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoutesClient,
  type RouteCallRequest,
  type RouteCallResult,
  type RoutesClient,
} from "@/lib/commute/google";
import {
  GOOGLE_MESSAGE_CANARY,
  GOOGLE_TEST_SERVER_KEY,
  POINT_ADDRESS_CANARY,
  isRoutesRequest,
  recordRoutesHeaders,
  routesCalls,
  routesEmpty,
  routesError,
  routesOk,
  routesSilence,
} from "../../fixtures/google";
import {
  responseAt,
  restoreFetch,
  stubFetch,
  unreadableResponse,
  type FetchContext,
  type RecordedRequest,
} from "../../fixtures/http";

// The key is switched per test: on by default here, off where the zero-config state is the claim.
const env = vi.hoisted(() => ({ key: true }));

vi.mock("astro:env/server", async () => {
  const { GOOGLE_TEST_SERVER_KEY: key } = await import("../../fixtures/google");
  return {
    SUPABASE_URL: undefined,
    SUPABASE_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    APIFY_TOKEN: undefined,
    get GOOGLE_MAPS_SERVER_KEY() {
      return env.key ? key : undefined;
    },
    GOOGLE_MAPS_BROWSER_KEY: undefined,
    getSecret: () => undefined,
  };
});

// Expected results are written by hand from context/changes/commute-times/plan.md (Phase 2 §2: one
// POST per call with the key and the field mask in headers; `departureTime` for TRANSIT only; no
// `routingPreference`; every answer classified into exactly one result, Google's `error.message`
// never read) and the Routes API reference it cites. The network is stubbed at the HTTP edge:
// nothing here reaches Google, and every case states how many requests reached it — one, never a
// retry.

beforeEach(() => {
  env.key = true;
});

afterEach(restoreFetch);

/** Answers every Routes request with `answer`, and records the headers each was sent with. */
function serve(answer: (request: RecordedRequest, context: FetchContext) => Response | Promise<Response>) {
  const headers: Headers[] = [];
  const record = recordRoutesHeaders(headers);
  const stub = stubFetch((request, context) => {
    if (!isRoutesRequest(request)) return undefined;
    record(request, context);
    return answer(request, context);
  });
  return { stub, headers };
}

function client(): RoutesClient {
  const built = createRoutesClient();
  if (built === null) throw new Error("expected a client: the key is on");
  return built;
}

const BY_ADDRESS: Omit<RouteCallRequest, "signal"> = {
  origin: { kind: "address", address: "ul. Puławska 1, Mokotów, Warszawa" },
  destinationAddress: POINT_ADDRESS_CANARY,
  mode: "DRIVE",
};

async function compute(
  overrides: Partial<RouteCallRequest> = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<RouteCallResult> {
  return client().computeRoute({ ...BY_ADDRESS, signal, ...overrides });
}

function body(request: RecordedRequest | undefined): Record<string, unknown> {
  return JSON.parse(request?.body ?? "null") as Record<string, unknown>;
}

describe("createRoutesClient: the zero-config state", () => {
  it("gives no client without the key, and nothing is sent", () => {
    env.key = false;
    const stub = stubFetch(() => undefined);

    expect(createRoutesClient()).toBeNull();
    expect(routesCalls(stub.requests)).toHaveLength(0);
  });

  it("control: gives a client with the key — and building it sends nothing", () => {
    const stub = stubFetch(() => undefined);

    expect(createRoutesClient()).not.toBeNull();
    expect(routesCalls(stub.requests)).toHaveLength(0);
  });
});

describe("computeRoute: the request", () => {
  it("POSTs once to computeRoutes with the key and the field mask in headers", async () => {
    const { stub, headers } = serve(() => routesOk(600, 4000, "abc"));
    await compute();

    expect(routesCalls(stub.requests)).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(headers[0]?.get("X-Goog-Api-Key")).toBe(GOOGLE_TEST_SERVER_KEY);
    expect(headers[0]?.get("X-Goog-FieldMask")).toBe(
      "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    );
    expect(headers[0]?.get("Content-Type")).toBe("application/json");
  });

  it("sends an address start as `address`, the point as the destination, and Poland as the region", async () => {
    const { stub } = serve(() => routesOk(600, 4000, "abc"));
    await compute();

    expect(body(stub.requests[0])).toEqual({
      origin: { address: "ul. Puławska 1, Mokotów, Warszawa" },
      destination: { address: POINT_ADDRESS_CANARY },
      travelMode: "DRIVE",
      regionCode: "pl",
    });
  });

  it("sends a coordinates start as `location.latLng`", async () => {
    const { stub } = serve(() => routesOk(600, 4000, "abc"));
    await compute({ origin: { kind: "coordinates", latitude: 52.2, longitude: 21.01 } });

    expect(body(stub.requests[0]).origin).toEqual({ location: { latLng: { latitude: 52.2, longitude: 21.01 } } });
  });

  it("sends `departureTime` for public transport", async () => {
    const { stub } = serve(() => routesOk(600, 4000, "abc"));
    await compute({ mode: "TRANSIT", departureTime: "2026-10-28T08:00:00+01:00" });

    const sent = body(stub.requests[0]);
    expect(sent.travelMode).toBe("TRANSIT");
    expect(sent.departureTime).toBe("2026-10-28T08:00:00+01:00");
    expect(sent).not.toHaveProperty("routingPreference");
  });

  it("leaves `departureTime` out for a car, even when one is passed, and sends no `routingPreference`", async () => {
    const { stub } = serve(() => routesOk(600, 4000, "abc"));
    await compute({ mode: "DRIVE", departureTime: "2026-10-28T08:00:00+01:00" });

    const sent = body(stub.requests[0]);
    expect(sent.travelMode).toBe("DRIVE");
    expect(sent).not.toHaveProperty("departureTime");
    expect(sent).not.toHaveProperty("routingPreference");
  });
});

describe("computeRoute: an accepted request", () => {
  it('reads a route: seconds from the `"123s"` form, meters and the line', async () => {
    const { stub } = serve(() => routesOk(1234, 5678, "_p~iF~ps|U_ulLnnqC"));

    expect(await compute()).toEqual({
      kind: "route",
      durationSeconds: 1234,
      distanceMeters: 5678,
      encodedPolyline: "_p~iF~ps|U_ulLnnqC",
    });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it("reads a route with no `distanceMeters` as 0 m: proto3 JSON leaves a zero out", async () => {
    const { stub } = serve(() =>
      responseAt(JSON.stringify({ routes: [{ duration: "60s", polyline: { encodedPolyline: "_p~iF~ps|U" } }] })),
    );

    expect(await compute()).toEqual({
      kind: "route",
      durationSeconds: 60,
      distanceMeters: 0,
      encodedPolyline: "_p~iF~ps|U",
    });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it("reads `200` with no `routes` as no route", async () => {
    const { stub } = serve(() => routesEmpty());

    expect(await compute()).toEqual({ kind: "no_route" });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it("reads `200` with an empty `routes` as no route", async () => {
    const { stub } = serve(() => responseAt(JSON.stringify({ routes: [] })));

    expect(await compute()).toEqual({ kind: "no_route" });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it.each([
    ["a duration without its unit", { duration: "1234", distanceMeters: 1, polyline: { encodedPolyline: "a" } }],
    ["a numeric duration", { duration: 1234, distanceMeters: 1, polyline: { encodedPolyline: "a" } }],
    ["a null distance", { duration: "1s", distanceMeters: null, polyline: { encodedPolyline: "a" } }],
    ["a negative distance", { duration: "1s", distanceMeters: -1, polyline: { encodedPolyline: "a" } }],
    ["a distance as text", { duration: "1s", distanceMeters: "1", polyline: { encodedPolyline: "a" } }],
    ["no line", { duration: "1s", distanceMeters: 1 }],
    ["an empty line", { duration: "1s", distanceMeters: 1, polyline: { encodedPolyline: "" } }],
  ])("reads a route with %s as unreadable", async (_name, route) => {
    const { stub } = serve(() => responseAt(JSON.stringify({ routes: [route] })));

    expect(await compute()).toEqual({ kind: "failed", reason: "unreadable", httpStatus: 200, googleStatus: null });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it.each([
    ["a body that is not JSON", "<html>oops</html>"],
    ["JSON that is not an object", "[1, 2]"],
    ["`routes` that is not an array", JSON.stringify({ routes: { duration: "1s" } })],
  ])("reads %s as unreadable", async (_name, text) => {
    const { stub } = serve(() => responseAt(text));

    expect(await compute()).toEqual({ kind: "failed", reason: "unreadable", httpStatus: 200, googleStatus: null });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });
});

describe("computeRoute: a request Google refused", () => {
  it("reads `400` as rejected, with `error.status`", async () => {
    const { stub } = serve(() => routesError(400, "INVALID_ARGUMENT"));

    expect(await compute()).toEqual({ kind: "rejected", googleStatus: "INVALID_ARGUMENT" });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it("reads `400` with an unknown or absent status as rejected, with no status", async () => {
    const first = serve(() => routesError(400, "SOMETHING_NEW"));
    expect(await compute()).toEqual({ kind: "rejected", googleStatus: null });
    expect(routesCalls(first.stub.requests)).toHaveLength(1);

    restoreFetch();
    const { stub } = serve(() => responseAt("not json", { status: 400 }));
    expect(await compute()).toEqual({ kind: "rejected", googleStatus: null });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it.each([
    [401, "UNAUTHENTICATED", "denied"],
    [403, "PERMISSION_DENIED", "denied"],
    [429, "RESOURCE_EXHAUSTED", "quota"],
    [500, "INTERNAL", "unavailable"],
    [503, "UNAVAILABLE", "unavailable"],
    [404, "NOT_FOUND", "unavailable"],
  ] as const)("reads %i as %s → %s, once", async (httpStatus, googleStatus, reason) => {
    const { stub } = serve(() => routesError(httpStatus, googleStatus));

    expect(await compute()).toEqual({ kind: "failed", reason, httpStatus, googleStatus });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it("never carries Google's error message or the address into a result", async () => {
    for (const status of [400, 403, 429, 500]) {
      const { stub } = serve(() => routesError(status, "INVALID_ARGUMENT"));
      const text = JSON.stringify(await compute());
      expect(routesCalls(stub.requests)).toHaveLength(1);
      restoreFetch();

      expect(text).not.toContain(GOOGLE_MESSAGE_CANARY);
      expect(text).not.toContain(POINT_ADDRESS_CANARY);
    }
  });

  it("control: the stubbed error body does carry the canaries", async () => {
    const text = await routesError(400, "INVALID_ARGUMENT").text();

    expect(text).toContain(GOOGLE_MESSAGE_CANARY);
    expect(text).toContain(POINT_ADDRESS_CANARY);
  });
});

describe("computeRoute: no answer", () => {
  it("reads a silence ended by the caller's deadline as a timeout", async () => {
    const { stub } = serve((_request, context) => routesSilence(context));

    expect(await compute({}, AbortSignal.timeout(20))).toEqual({
      kind: "failed",
      reason: "timeout",
      httpStatus: null,
      googleStatus: null,
    });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it("reads a rejected fetch as unavailable, with no status", async () => {
    const { stub } = serve(() => Promise.reject(new TypeError(`${GOOGLE_MESSAGE_CANARY}: fetch failed`)));

    const result = await compute();
    expect(result).toEqual({ kind: "failed", reason: "unavailable", httpStatus: null, googleStatus: null });
    expect(JSON.stringify(result)).not.toContain(GOOGLE_MESSAGE_CANARY);
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });

  it("reads a body cut after the status line as unavailable, with the status", async () => {
    const { stub } = serve(() => unreadableResponse(new TypeError("terminated"), { status: 200 }));

    expect(await compute()).toEqual({ kind: "failed", reason: "unavailable", httpStatus: 200, googleStatus: null });
    expect(routesCalls(stub.requests)).toHaveLength(1);
  });
});
