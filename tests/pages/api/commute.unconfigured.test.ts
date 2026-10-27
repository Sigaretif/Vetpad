import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoutesClient } from "@/lib/commute/google";
import { POST } from "@/pages/api/commute";
import { captureConsole, restoreConsole } from "../../fixtures/console";
import { routesCalls } from "../../fixtures/google";
import {
  isCommutePointsRequest,
  isReserveCommuteCallsRequest,
  isTableRequest,
  jsonResponse,
  restoreFetch,
  stubFetch,
} from "../../fixtures/http";

// The route without a Google server key — the zero-config state of the commute feature (CLAUDE.md,
// "The project runs with zero configuration"). `supabase` switches the database on, so every free
// check can pass first, and off, for the state tests/setup.ts puts every test in. Neither has a
// Google key: tests/pages/api/commute.test.ts gives one to its whole file, which is why this exit has
// a file of its own. Pattern: audits.unconfigured.test.ts.
//
// Missing configuration is a supported state: the route answers as it always does — 200 with a
// stream whose last line says why there is no result — and nothing reaches Google or the counter.
const env = vi.hoisted(() => ({ supabase: true }));
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return {
    get SUPABASE_URL() {
      return env.supabase ? SUPABASE_TEST_URL : undefined;
    },
    get SUPABASE_KEY() {
      return env.supabase ? SUPABASE_TEST_KEY : undefined;
    },
    ANTHROPIC_API_KEY: undefined,
    APIFY_TOKEN: undefined,
    GOOGLE_MAPS_SERVER_KEY: undefined,
    GOOGLE_MAPS_BROWSER_KEY: undefined,
    getSecret: () => undefined,
  };
});

afterEach(restoreFetch);
afterEach(restoreConsole);
afterEach(() => {
  env.supabase = true;
});

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const USER_EMAIL = "czlonek.kanarek@vetpad.local";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000c0a17";
const POINT_ADDRESS = "ul. Kanarkowa 9, Warszawa";

const OFFER_ROW = {
  id: OFFER_ID,
  archived_at: null,
  latitude: 52.2,
  longitude: 21.0,
  location_label: "Mokotów, Warszawa",
  street_name: null,
};

function context(fields: Record<string, string>): APIContext {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return {
    request: new Request("http://localhost/api/commute", { method: "POST", body: form }),
    locals: { user: { id: USER_ID, email: USER_EMAIL } },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}

/** The database with a live offer that has a start and two points: every free check passes. */
function stubDatabase() {
  return stubFetch((request) => {
    if (isTableRequest(request, "offers", "GET")) return jsonResponse([OFFER_ROW], 200);
    if (isCommutePointsRequest(request, "GET")) {
      return jsonResponse(
        [
          { id: "8f1e2d3c-0000-4a00-8000-000000000001", name: "Biuro", address: POINT_ADDRESS },
          { id: "8f1e2d3c-0000-4a00-8000-000000000002", name: "Szkoła", address: "pl. Drugi 2, Kraków" },
        ],
        200,
      );
    }
    return undefined;
  });
}

describe("POST /api/commute without a Google server key", () => {
  it("says not_configured once every free check passed: Google 0, reservations 0, no write", async () => {
    const captured = captureConsole();
    const stub = stubDatabase();

    const response = await POST(context({ offer_id: OFFER_ID }));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(text.split("\n").filter((line) => line !== "")).toHaveLength(1);
    expect(JSON.parse(text)).toStrictEqual({
      type: "failed",
      reason: "not_configured",
      message: "Liczenie dojazdów jest wyłączone — aplikacja nie ma klucza Google Maps do tras.",
    });
    // The free checks ran: the offer and the points were read, and nothing else was asked.
    expect(stub.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toStrictEqual([
      "GET /rest/v1/offers",
      "GET /rest/v1/commute_points",
    ]);
    expect(routesCalls(stub.requests)).toHaveLength(0);
    expect(stub.requests.filter(isReserveCommuteCallsRequest)).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_commute",
            outcome: "refused",
            stage: "config",
            reason: "not_configured",
            user_id: USER_ID,
            offer_id: OFFER_ID,
            commute_origin: "coordinates",
            commute_points: 2,
          },
        ],
      },
    ]);
    expect(captured.text()).not.toContain(POINT_ADDRESS);
    expect(captured.text()).not.toContain(USER_EMAIL);
  });

  it("says not_configured without Supabase either, and makes no request at all", async () => {
    env.supabase = false;
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);

    const response = await POST(context({ offer_id: OFFER_ID }));

    expect(response.status).toBe(200);
    expect((JSON.parse(await response.text()) as { reason: string }).reason).toBe("not_configured");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_commute",
            outcome: "refused",
            stage: "config",
            detail: "supabase",
            reason: "not_configured",
            user_id: USER_ID,
          },
        ],
      },
    ]);
  });
});

describe("createRoutesClient without a Google server key", () => {
  it("gives no client", () => {
    expect(createRoutesClient()).toBeNull();
  });
});
