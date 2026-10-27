import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/commute";
import { type ConsoleCapture, type ConsoleEntry, captureConsole, restoreConsole } from "../../fixtures/console";
import {
  GOOGLE_MESSAGE_CANARY,
  POINT_ADDRESS_CANARY,
  isRoutesRequest,
  routesCalls,
  routesEmpty,
  routesError,
  routesOk,
  routesSilence,
} from "../../fixtures/google";
import {
  type FetchContext,
  type FetchStub,
  type RecordedRequest,
  isCommutePointsRequest,
  isReserveCommuteCallsRequest,
  isTableRequest,
  jsonResponse,
  restoreFetch,
  stubFetch,
} from "../../fixtures/http";

// The route with a configured Supabase client and a Google server key (test values, never real
// ones): this mock overrides the zero-config one in tests/setup.ts. Only the network is stubbed
// below — at the HTTP edge, for the database and for Google alike. @/lib/supabase and every module
// under @/lib/commute run as they do in production.
//
// `googleKey` switches the key off for the scenario that compares a missing offer with and without
// a key. The exit that needs every free check to pass and no key is in commute.unconfigured.test.ts.
const env = vi.hoisted(() => ({ googleKey: true }));
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  const { GOOGLE_TEST_SERVER_KEY } = await import("../../fixtures/google");
  return {
    SUPABASE_URL: SUPABASE_TEST_URL,
    SUPABASE_KEY: SUPABASE_TEST_KEY,
    get GOOGLE_MAPS_SERVER_KEY() {
      return env.googleKey ? GOOGLE_TEST_SERVER_KEY : undefined;
    },
    GOOGLE_MAPS_BROWSER_KEY: undefined,
    getSecret: () => undefined,
  };
});

// Expected outcomes come from context/changes/commute-times/plan.md: Phase 3 (the order of the
// exits, the NDJSON lines, one `offer_commute` entry per way out and `started` before the calls,
// no retry, the reservation as the one write), the Implementation Approach's outcome rule and
// departure time, and the Critical Implementation Details (the counter never lets a call through on
// doubt). Every scenario states how many requests reached Google and how many reservations reached
// Supabase, and that nothing else was written.
//
// Timers are fake for the whole file, the clock included: the calls' deadline is a timer, the
// departure day comes from the clock, and a duration in a log entry is exact — 0 unless a test
// moves the clock. 2026-10-27 is a Tuesday: the departure is Wednesday 2026-10-28, 08:00 CET.

beforeEach(() => {
  env.googleKey = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-27T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});
afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
/** The member's address is on `locals.user` in production too; no log entry may carry it. */
const USER_EMAIL = "czlonek.kanarek@vetpad.local";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000c0a17";

const DEPARTURE = "2026-10-28T08:00:00+01:00";

// The offer's start, each part a canary: none may reach a log entry or the answer.
const LATITUDE = 52.123457;
const LONGITUDE = 21.654321;
const OFFER_LABEL_CANARY = "Kanarkowo, Mokotów, Warszawa";
const OFFER_STREET_CANARY = "ul. Kanarkowa-Ulica";

/** Sits in the notes table's stub. The route never reads it, and no Google request may carry it. */
const NOTE_CANARY = "kanarek-notatka-dojazd-41ac";

const SECOND_ADDRESS = "pl. Drugi 2, Kraków";

interface Point {
  id: string;
  name: string;
  address: string;
}
const P1: Point = { id: "8f1e2d3c-0000-4a00-8000-000000000001", name: "Biuro Ani", address: POINT_ADDRESS_CANARY };
const P2: Point = { id: "8f1e2d3c-0000-4a00-8000-000000000002", name: "Szkoła", address: SECOND_ADDRESS };
const P3: Point = { id: "8f1e2d3c-0000-4a00-8000-000000000003", name: "Rodzice", address: "ul. Trzecia 3, Łódź" };

function point(index: number): Point {
  return {
    id: `8f1e2d3c-0000-4a00-8000-${String(index).padStart(12, "0")}`,
    name: `Punkt ${index}`,
    address: `ul. Punktowa ${index}, Warszawa`,
  };
}

function offerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: OFFER_ID,
    archived_at: null,
    latitude: LATITUDE,
    longitude: LONGITUDE,
    location_label: OFFER_LABEL_CANARY,
    street_name: OFFER_STREET_CANARY,
    ...overrides,
  };
}

type Answer = () => Response | Promise<Response>;
type Mode = "TRANSIT" | "DRIVE";
type GoogleAnswer = (call: { address: string; mode: Mode }, context: FetchContext) => Response | Promise<Response>;

const rows =
  (...list: unknown[]): Answer =>
  () =>
    jsonResponse(list, 200);
const dbError =
  (status: number, code: string): Answer =>
  () =>
    jsonResponse(
      { code, message: "kanarek-komunikat-bazy", details: `KANAREK-DETAILS ${POINT_ADDRESS_CANARY}`, hint: null },
      status,
    );

/** The time, distance and line Google gives a point in a mode, distinct for each. */
function routeOf(address: string, mode: Mode): { seconds: number; meters: number; polyline: string } {
  const index = [P1, P2, P3].findIndex((p) => p.address === address) + 1;
  return mode === "TRANSIT"
    ? { seconds: 1800 + index, meters: 9000 + index, polyline: `transit-line-${index}` }
    : { seconds: 900 + index, meters: 8500 + index, polyline: `drive-line-${index}` };
}

const everyRoute: GoogleAnswer = ({ address, mode }) => {
  const { seconds, meters, polyline } = routeOf(address, mode);
  return routesOk(seconds, meters, polyline);
};

/** Every call routes, except the ones `special` answers. */
function except(
  special: (call: { address: string; mode: Mode }, context: FetchContext) => Response | Promise<Response> | undefined,
): GoogleAnswer {
  return (call, context) => special(call, context) ?? everyRoute(call, context);
}

interface Network {
  offer?: Answer;
  points?: Answer;
  reserve?: Answer;
  google?: GoogleAnswer;
}

/**
 * Answers every request the route may make. Left alone, the database holds the offer with
 * coordinates and two points, the reservation gives the day's total of 4, and Google routes every
 * call. `offer_notes` answers with a canary row: a read of it is counted and fails the test.
 */
function stubNetwork({
  offer = rows(offerRow()),
  points = rows(P1, P2),
  reserve = () => jsonResponse(4, 200),
  google = everyRoute,
}: Network = {}): FetchStub {
  return stubFetch((request, context) => {
    if (isRoutesRequest(request)) {
      const body = JSON.parse(request.body ?? "{}") as { destination: { address: string }; travelMode: Mode };
      return google({ address: body.destination.address, mode: body.travelMode }, context);
    }
    if (isTableRequest(request, "offers", "GET")) return offer();
    if (isCommutePointsRequest(request, "GET")) return points();
    if (isReserveCommuteCallsRequest(request)) return reserve();
    if (isTableRequest(request, "offer_notes", "GET")) return jsonResponse([{ body: NOTE_CANARY }], 200);
    return undefined;
  });
}

interface Posted {
  user?: { id: string; email: string } | null;
  fields?: Record<string, string>;
}

function post({ user = { id: USER_ID, email: USER_EMAIL }, fields = { offer_id: OFFER_ID } }: Posted = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const request = new Request("http://localhost/api/commute", { method: "POST", body: form });
  const context = {
    request,
    locals: { user },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return { request, answer: POST(context) };
}

type Line = Record<string, unknown>;

function parseLines(text: string): Line[] {
  if (text !== "" && !text.endsWith("\n")) throw new Error("expected the body to end with a line feed");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Line);
}

interface Calculated {
  response: Response;
  lines: Line[];
  text: string;
  stub: FetchStub;
  captured: ConsoleCapture;
}

async function calculate(network: Network = {}, posted: Posted = {}): Promise<Calculated> {
  const captured = captureConsole();
  const stub = stubNetwork(network);
  const response = await post(posted).answer;
  const text = await response.text();
  return { response, lines: parseLines(text), text, stub, captured };
}

function reservations(stub: FetchStub): RecordedRequest[] {
  return stub.requests.filter(isReserveCommuteCallsRequest);
}

/**
 * The traffic of one calculation: how many requests reached Google and how many reservations
 * reached Supabase. The reservation is the only write — no other `POST`, `PATCH` or `DELETE` — it
 * stands before the first request to Google, the notes table is never read, and a point's address
 * travels in a Google request's body and nowhere else.
 */
function expectTraffic(stub: FetchStub, { google, reserved }: { google: number; reserved: number }): void {
  expect(routesCalls(stub.requests)).toHaveLength(google);
  expect(reservations(stub)).toHaveLength(reserved);
  const writes = stub.requests.filter(
    (request) => request.method !== "GET" && !isRoutesRequest(request) && !isReserveCommuteCallsRequest(request),
  );
  expect(writes).toStrictEqual([]);
  expect(stub.requests.filter((request) => isTableRequest(request, "offer_notes", "GET"))).toHaveLength(0);
  const firstGoogle = stub.requests.findIndex(isRoutesRequest);
  if (firstGoogle !== -1) {
    const reservation = stub.requests.findIndex(isReserveCommuteCallsRequest);
    expect(reservation).toBeGreaterThanOrEqual(0);
    expect(reservation).toBeLessThan(firstGoogle);
  }
  for (const request of stub.requests) {
    if (isRoutesRequest(request)) {
      expect(request.body ?? "").not.toContain(NOTE_CANARY);
    } else {
      expect(`${request.url} ${request.body ?? ""}`).not.toContain(POINT_ADDRESS_CANARY);
    }
  }
}

/** No entry carries a place, a member's address or Google's words. */
function expectCleanLog(captured: ConsoleCapture): void {
  const text = captured.text();
  for (const canary of [
    POINT_ADDRESS_CANARY,
    SECOND_ADDRESS,
    P1.name,
    OFFER_LABEL_CANARY,
    OFFER_STREET_CANARY,
    String(LATITUDE),
    String(LONGITUDE),
    GOOGLE_MESSAGE_CANARY,
    "transit-line",
    "drive-line",
    "KANAREK-DETAILS",
    "kanarek-komunikat-bazy",
    USER_EMAIL,
    NOTE_CANARY,
  ]) {
    expect(text).not.toContain(canary);
  }
}

/** The answer never holds a point's address or the offer's start: the island gets names and lines only. */
function expectCleanAnswer(text: string): void {
  for (const canary of [
    POINT_ADDRESS_CANARY,
    SECOND_ADDRESS,
    OFFER_LABEL_CANARY,
    OFFER_STREET_CANARY,
    GOOGLE_MESSAGE_CANARY,
  ]) {
    expect(text).not.toContain(canary);
  }
}

/** The one line of an action that ended before Google, or the last line of one that reached it. */
function failure(lines: Line[]): { reason: unknown; message: unknown } {
  const last = lines.at(-1);
  expect(last?.type).toBe("failed");
  expect(Object.keys(last ?? {}).sort()).toEqual(["message", "reason", "type"]);
  return { reason: last?.reason, message: last?.message };
}

function entry(level: "info" | "error", fields: Record<string, string | number>): ConsoleEntry {
  return { method: level, args: [{ level, event: "offer_commute", ...fields }] };
}

const KNOWN = { user_id: USER_ID, offer_id: OFFER_ID };
const RESERVED = {
  ...KNOWN,
  commute_origin: "coordinates",
  commute_points: 2,
  commute_calls_reserved: 4,
  commute_usage_total: 4,
};
const STARTED = entry("info", { outcome: "started", stage: "routing", ...RESERVED });

/** The row of a point that got a route in both modes. */
function routedRow(p: Point): Record<string, unknown> {
  const transit = routeOf(p.address, "TRANSIT");
  const drive = routeOf(p.address, "DRIVE");
  return {
    pointId: p.id,
    name: p.name,
    transit: {
      kind: "route",
      durationSeconds: transit.seconds,
      distanceMeters: transit.meters,
      encodedPolyline: transit.polyline,
    },
    drive: {
      kind: "route",
      durationSeconds: drive.seconds,
      distanceMeters: drive.meters,
      encodedPolyline: drive.polyline,
    },
  };
}

/** Waits, in real turns of the event loop, until `count` requests reached Google. */
async function googleCalled(stub: FetchStub, count: number): Promise<void> {
  for (let turn = 0; turn < 500 && routesCalls(stub.requests).length < count; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(routesCalls(stub.requests)).toHaveLength(count);
}

describe("POST /api/commute: no session never reaches the database or Google", () => {
  it("redirects to /auth/signin before anything else: Google 0, reservations 0, the body unread", async () => {
    const captured = captureConsole();
    const stub = stubNetwork();

    const { request, answer } = post({ user: null });
    const response = await answer;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/signin");
    expect(request.bodyUsed).toBe(false);
    expect(stub.requests).toHaveLength(0);
    expectTraffic(stub, { google: 0, reserved: 0 });
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "auth", reason: "signed_out" }),
    ]);
  });

  it("control: the same request with a session does reach Google", async () => {
    const { stub } = await calculate();
    expectTraffic(stub, { google: 4, reserved: 1 });
  });
});

describe("POST /api/commute: a calculation with every route", () => {
  it("answers 200 with never-cached NDJSON: the routing stage, then done with the result", async () => {
    const { response, lines, text, stub, captured } = await calculate();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(lines).toStrictEqual([
      { type: "stage", stage: "routing" },
      {
        type: "done",
        result: {
          departure: { date: "2026-10-28", time: "08:00" },
          origin: "coordinates",
          rows: [routedRow(P1), routedRow(P2)],
        },
      },
    ]);
    expectTraffic(stub, { google: 4, reserved: 1 });
    expectCleanAnswer(text);
    expectCleanLog(captured);
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("info", {
        outcome: "completed",
        stage: "routing",
        ...RESERVED,
        commute_duration_ms: 0,
        commute_routes: 4,
        commute_no_route: 0,
        commute_address_rejected: 0,
      }),
    ]);
  });

  it("asks for 2N calls: three points reserve n = 6 and make six requests", async () => {
    const { stub, captured } = await calculate({ points: rows(P1, P2, P3), reserve: () => jsonResponse(6, 200) });

    expect(JSON.parse(reservations(stub)[0]?.body ?? "null")).toStrictEqual({ n: 6 });
    expectTraffic(stub, { google: 6, reserved: 1 });
    expect(captured.entries()[0]).toStrictEqual(
      entry("info", {
        outcome: "started",
        stage: "routing",
        ...KNOWN,
        commute_origin: "coordinates",
        commute_points: 3,
        commute_calls_reserved: 6,
        commute_usage_total: 6,
      }),
    );
  });

  it("starts from the offer's coordinates, and sends the departure with public transport only", async () => {
    const { stub } = await calculate();

    const bodies = routesCalls(stub.requests).map(
      (request) => JSON.parse(request.body ?? "{}") as Record<string, unknown>,
    );
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect(body.origin).toStrictEqual({ location: { latLng: { latitude: LATITUDE, longitude: LONGITUDE } } });
      expect(body).not.toHaveProperty("routingPreference");
      if (body.travelMode === "TRANSIT") expect(body.departureTime).toBe(DEPARTURE);
      else expect(body).not.toHaveProperty("departureTime");
    }
    expect(
      bodies.map((body) => `${String(body.travelMode)} ${(body.destination as { address: string }).address}`).sort(),
    ).toStrictEqual(
      [`DRIVE ${P1.address}`, `DRIVE ${P2.address}`, `TRANSIT ${P1.address}`, `TRANSIT ${P2.address}`].sort(),
    );
  });

  it("starts from the label and the street when the offer states no coordinates, and says so", async () => {
    const { stub, lines, captured } = await calculate({ offer: rows(offerRow({ latitude: null, longitude: null })) });

    for (const request of routesCalls(stub.requests)) {
      const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
      expect(body.origin).toStrictEqual({ address: `${OFFER_STREET_CANARY}, ${OFFER_LABEL_CANARY}` });
    }
    expect((lines.at(-1)?.result as { origin: unknown }).origin).toBe("address");
    expectTraffic(stub, { google: 4, reserved: 1 });
    expect(captured.entries()[0]).toStrictEqual(
      entry("info", { outcome: "started", stage: "routing", ...RESERVED, commute_origin: "address" }),
    );
    expectCleanLog(captured);
  });

  it("reads a TRANSIT answer with no routes as no route for that point, and shows the rest", async () => {
    const { lines, stub, captured } = await calculate({
      google: except(({ address, mode }) =>
        address === SECOND_ADDRESS && mode === "TRANSIT" ? routesEmpty() : undefined,
      ),
    });

    const result = lines.at(-1)?.result as { rows: unknown[] };
    expect(result.rows).toStrictEqual([routedRow(P1), { ...routedRow(P2), transit: { kind: "no_route" } }]);
    expectTraffic(stub, { google: 4, reserved: 1 });
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("info", {
        outcome: "completed",
        stage: "routing",
        ...RESERVED,
        commute_duration_ms: 0,
        commute_routes: 3,
        commute_no_route: 1,
        commute_address_rejected: 0,
      }),
    );
  });

  it("reads a point Google rejects in both modes as a rejected address, and shows the other row", async () => {
    const { lines, text, stub, captured } = await calculate({
      google: except(({ address }) =>
        address === POINT_ADDRESS_CANARY ? routesError(400, "INVALID_ARGUMENT") : undefined,
      ),
    });

    const result = lines.at(-1)?.result as { rows: unknown[] };
    expect(lines.at(-1)?.type).toBe("done");
    expect(result.rows).toStrictEqual([
      { pointId: P1.id, name: P1.name, transit: { kind: "address_rejected" }, drive: { kind: "address_rejected" } },
      routedRow(P2),
    ]);
    expectTraffic(stub, { google: 4, reserved: 1 });
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("info", {
        outcome: "completed",
        stage: "routing",
        ...RESERVED,
        commute_duration_ms: 0,
        commute_routes: 2,
        commute_no_route: 0,
        commute_address_rejected: 2,
      }),
    );
    expectCleanAnswer(text);
    expectCleanLog(captured);
  });
});

describe("POST /api/commute: a call Google did not answer with a route fails the whole calculation", () => {
  async function failedWith(google: GoogleAnswer) {
    const calculated = await calculate({ google });
    expect(calculated.lines[0]).toStrictEqual({ type: "stage", stage: "routing" });
    expect(calculated.lines).toHaveLength(2);
    expectTraffic(calculated.stub, { google: 4, reserved: 1 });
    expectCleanAnswer(calculated.text);
    expectCleanLog(calculated.captured);
    return { ...calculated, ...failure(calculated.lines) };
  }

  it("a point rejected in one mode only is request_rejected: its address is the same in both", async () => {
    const { reason, message, captured } = await failedWith(
      except(({ address, mode }) =>
        address === POINT_ADDRESS_CANARY && mode === "TRANSIT" ? routesError(400, "INVALID_ARGUMENT") : undefined,
      ),
    );

    expect(reason).toBe("request_rejected");
    expect(message).toBe(
      "Google odrzucił zapytanie o trasy jako niepoprawne. Jeśli zespół ma jeden punkt, sprawdź jego adres w kryteriach; w przeciwnym razie to wymaga poprawki w aplikacji.",
    );
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("error", {
        outcome: "failed",
        stage: "routing",
        reason: "request_rejected",
        ...RESERVED,
        commute_duration_ms: 0,
        point_index: 0,
        commute_mode: "TRANSIT",
        google_http_status: 400,
        google_status: "INVALID_ARGUMENT",
      }),
    ]);
  });

  it("every point rejected in public transport is request_rejected: the fault is in the request", async () => {
    const { reason, captured } = await failedWith(
      except(({ mode }) => (mode === "TRANSIT" ? routesError(400, "INVALID_ARGUMENT") : undefined)),
    );

    expect(reason).toBe("request_rejected");
    expect(captured.entries().at(-1)?.args[0]).toMatchObject({
      point_index: 0,
      commute_mode: "TRANSIT",
      google_http_status: 400,
    });
  });

  it("a 403 is denied, told by the call it came from", async () => {
    const { reason, captured } = await failedWith(
      except(({ address, mode }) =>
        address === SECOND_ADDRESS && mode === "DRIVE" ? routesError(403, "PERMISSION_DENIED") : undefined,
      ),
    );

    expect(reason).toBe("denied");
    expect(captured.entries().at(-1)).toStrictEqual(
      entry("error", {
        outcome: "failed",
        stage: "routing",
        reason: "denied",
        ...RESERVED,
        commute_duration_ms: 0,
        point_index: 1,
        commute_mode: "DRIVE",
        google_http_status: 403,
        google_status: "PERMISSION_DENIED",
      }),
    );
  });

  it("a 429 is quota", async () => {
    const { reason, captured } = await failedWith(
      except(({ address, mode }) =>
        address === POINT_ADDRESS_CANARY && mode === "DRIVE" ? routesError(429, "RESOURCE_EXHAUSTED") : undefined,
      ),
    );

    expect(reason).toBe("quota");
    expect(captured.entries().at(-1)?.args[0]).toMatchObject({
      point_index: 0,
      commute_mode: "DRIVE",
      google_http_status: 429,
      google_status: "RESOURCE_EXHAUSTED",
    });
  });

  it("a 500 is unavailable", async () => {
    const { reason, captured } = await failedWith(
      except(({ address, mode }) =>
        address === SECOND_ADDRESS && mode === "TRANSIT" ? routesError(500, "INTERNAL") : undefined,
      ),
    );

    expect(reason).toBe("unavailable");
    expect(captured.entries().at(-1)?.args[0]).toMatchObject({
      point_index: 1,
      commute_mode: "TRANSIT",
      google_http_status: 500,
      google_status: "INTERNAL",
    });
  });

  it("a call Google never answers is abandoned at the deadline: timeout, and the other calls' answers are not shown", async () => {
    const captured = captureConsole();
    const stub = stubNetwork({
      google: except(({ address, mode }, context) =>
        address === SECOND_ADDRESS && mode === "DRIVE" ? routesSilence(context) : undefined,
      ),
    });
    const response = await post().answer;
    const reading = response.text();

    await googleCalled(stub, 4);
    await vi.advanceTimersByTimeAsync(10_000);
    const text = await reading;
    const lines = parseLines(text);

    expect(lines).toHaveLength(2);
    expect(failure(lines).reason).toBe("timeout");
    expectTraffic(stub, { google: 4, reserved: 1 });
    expect(captured.entries()).toStrictEqual([
      STARTED,
      entry("error", {
        outcome: "failed",
        stage: "routing",
        reason: "timeout",
        ...RESERVED,
        commute_duration_ms: 10_000,
        point_index: 1,
        commute_mode: "DRIVE",
      }),
    ]);
    expectCleanAnswer(text);
    expectCleanLog(captured);
  });
});

describe("POST /api/commute: the free refusals end before the key, the counter and Google", () => {
  async function refused(network: Network, posted: Posted = {}) {
    const calculated = await calculate(network, posted);
    expect(calculated.response.status).toBe(200);
    expect(calculated.lines).toHaveLength(1);
    expectTraffic(calculated.stub, { google: 0, reserved: 0 });
    expectCleanLog(calculated.captured);
    return { ...calculated, ...failure(calculated.lines) };
  }

  it("an id that is not a uuid is offer_not_found, before any read", async () => {
    const { reason, message, stub, captured } = await refused({}, { fields: { offer_id: "not-a-uuid" } });

    expect(reason).toBe("offer_not_found");
    expect(message).toBe("Ta oferta już nie istnieje — mogła zostać usunięta. Dojazdy nie zostały policzone.");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "offer_id", reason: "offer_not_found", user_id: USER_ID }),
    ]);
  });

  it("an offer that does not exist is offer_not_found", async () => {
    const { reason, captured } = await refused({ offer: rows() });

    expect(reason).toBe("offer_not_found");
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "offer", reason: "offer_not_found", ...KNOWN }),
    ]);
  });

  it("a missing offer reads the same with and without a key", async () => {
    const withKey = await refused({ offer: rows() });
    restoreFetch();
    env.googleKey = false;
    const withoutKey = await refused({ offer: rows() });

    expect(withoutKey.lines).toStrictEqual(withKey.lines);
  });

  it("an offer that cannot be read is offer_unreadable, never not found, and logged as a failure with its code", async () => {
    const { reason, captured } = await refused({ offer: dbError(500, "XX000") });

    expect(reason).toBe("offer_unreadable");
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "offer",
        detail: "query_failed",
        db_code: "XX000",
        db_status: 500,
        reason: "offer_unreadable",
        ...KNOWN,
      }),
    ]);
  });

  it("an offer row that does not read is offer_unreadable, never not found", async () => {
    const { reason, captured } = await refused({ offer: rows(offerRow({ id: 42 })) });

    expect(reason).toBe("offer_unreadable");
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "offer",
        detail: "row_unreadable",
        reason: "offer_unreadable",
        ...KNOWN,
      }),
    ]);
  });

  it("an archived offer is offer_archived", async () => {
    const { reason, captured } = await refused({ offer: rows(offerRow({ archived_at: "2026-10-20T09:00:00+00:00" })) });

    expect(reason).toBe("offer_archived");
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "offer", reason: "offer_archived", ...KNOWN }),
    ]);
  });

  it("an offer with no coordinates and no label is no_origin", async () => {
    const { reason } = await refused({
      offer: rows(offerRow({ latitude: null, longitude: null, location_label: null })),
    });
    expect(reason).toBe("no_origin");
  });

  it("points that cannot be read are points_unreadable, a failure", async () => {
    const { reason, captured } = await refused({ points: dbError(500, "XX000") });

    expect(reason).toBe("points_unreadable");
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "points",
        reason: "points_unreadable",
        ...KNOWN,
        commute_origin: "coordinates",
      }),
    ]);
  });

  it("no points is no_points", async () => {
    const { reason } = await refused({ points: rows() });
    expect(reason).toBe("no_points");
  });

  it("seven points are too_many_points: none is sent", async () => {
    const seven = [1, 2, 3, 4, 5, 6, 7].map(point);
    const { reason, captured } = await refused({ points: rows(...seven) });

    expect(reason).toBe("too_many_points");
    expect(captured.entries()).toStrictEqual([
      entry("info", {
        outcome: "refused",
        stage: "points",
        reason: "too_many_points",
        ...KNOWN,
        commute_origin: "coordinates",
        commute_points: 7,
      }),
    ]);
  });

  it("control: six points pass and make twelve requests", async () => {
    const six = [1, 2, 3, 4, 5, 6].map(point);
    const { stub, lines } = await calculate({ points: rows(...six), reserve: () => jsonResponse(12, 200) });

    expect(lines.at(-1)?.type).toBe("done");
    expectTraffic(stub, { google: 12, reserved: 1 });
  });
});

describe("POST /api/commute: the counter never lets a call through on doubt", () => {
  async function stopped(reserve: Answer) {
    const calculated = await calculate({ reserve });
    expect(calculated.lines).toHaveLength(1);
    expectTraffic(calculated.stub, { google: 0, reserved: 1 });
    expect(JSON.parse(reservations(calculated.stub)[0]?.body ?? "null")).toStrictEqual({ n: 4 });
    expectCleanLog(calculated.captured);
    return { ...calculated, ...failure(calculated.lines) };
  }

  const RESERVING = { ...KNOWN, commute_origin: "coordinates", commute_points: 2, commute_calls_reserved: 4 };

  it("VP003 is daily_limit, a refusal the product expects", async () => {
    const { reason, message, captured } = await stopped(dbError(400, "VP003"));

    expect(reason).toBe("daily_limit");
    expect(message).toBe("Dzienny limit liczenia dojazdów zespołu został wyczerpany — spróbuj jutro.");
    expect(captured.entries()).toStrictEqual([
      entry("info", { outcome: "refused", stage: "usage", reason: "daily_limit", ...RESERVING }),
    ]);
  });

  it("another Postgres error is usage_unavailable, logged with its code", async () => {
    const { reason, message, captured } = await stopped(dbError(403, "42501"));

    expect(reason).toBe("usage_unavailable");
    expect(message).toBe(
      "Nie udało się sprawdzić, czy liczenie mieści się w dziennym limicie zespołu, więc nic nie zostało wysłane do Google. Spróbuj ponownie za chwilę.",
    );
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "usage",
        reason: "usage_unavailable",
        db_code: "42501",
        ...RESERVING,
      }),
    ]);
  });

  it("a 500 is usage_unavailable, logged with its code", async () => {
    const { reason, captured } = await stopped(dbError(500, "XX000"));

    expect(reason).toBe("usage_unavailable");
    expect(captured.entries()).toStrictEqual([
      entry("error", {
        outcome: "failed",
        stage: "usage",
        reason: "usage_unavailable",
        db_code: "XX000",
        ...RESERVING,
      }),
    ]);
  });

  it("a network error is usage_unavailable", async () => {
    const { reason, captured } = await stopped(() => Promise.reject(new TypeError("fetch failed")));

    expect(reason).toBe("usage_unavailable");
    expect(captured.entries()).toStrictEqual([
      entry("error", { outcome: "failed", stage: "usage", reason: "usage_unavailable", ...RESERVING }),
    ]);
  });

  it("an answer that is not a total is usage_unavailable", async () => {
    const { reason, captured } = await stopped(() => jsonResponse("cztery", 200));

    expect(reason).toBe("usage_unavailable");
    expect(captured.entries()).toStrictEqual([
      entry("error", { outcome: "failed", stage: "usage", reason: "usage_unavailable", ...RESERVING }),
    ]);
  });
});
