import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/criteria";
import { type RecordedRequest, isTableRequest, jsonResponse, restoreFetch, stubFetch } from "../../fixtures/http";

// The route with a configured Supabase client (test values, never a real project's): this mock
// overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase and @/lib/criteria run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("../../fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes come from prd.md FR-002/FR-003 (the limits are the team's shared row, any
// member changes them, and who changed them is set by the database, not by the request), from
// research.md of testing-write-isolation, finding 3 and gap 8 (an update RLS filtered out is not
// an error: `200 []` with `Prefer: return=representation` — a row count tells it from a save),
// and from CLAUDE.md, Conventions (a form route reports failure with `?error=` and `&form=`).
// The real policies never give a signed-in member that answer, so smoke cannot reach it.

afterEach(restoreFetch);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";

/** The limits as a member types them; the price carries the space Polish formatting inserts. */
const TYPED_LIMITS = { city: "Warszawa", price_min: "800 000", price_max: "900 000", area_min: "45,5" };

/** Answers the route's one planned Supabase request, the limits `PATCH`, with `answer`. */
function stubLimitsUpdate(answer: () => Response) {
  return stubFetch((request) => (isTableRequest(request, "team_criteria", "PATCH") ? answer() : undefined));
}

async function submit(fields: Record<string, string>): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }
  const context = {
    request: new Request("http://localhost/api/criteria", { method: "POST", body: form }),
    locals: { user: { id: USER_ID } },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
  return POST(context);
}

function location(response: Response): URL {
  expect(response.status).toBe(302);
  const header = response.headers.get("Location");
  if (header === null) throw new Error("expected a redirect with a Location header");
  return new URL(header, "http://localhost");
}

function limitUpdates(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => isTableRequest(request, "team_criteria", "PATCH"));
}

/** The failed-save redirect: back to the limits form on `/criteria`, naming the form. Returns the message. */
function limitsError(response: Response): string {
  const target = location(response);
  expect(target.pathname).toBe("/criteria");
  expect(target.searchParams.get("form")).toBe("limits");
  expect(target.hash).toBe("#limity");
  const message = target.searchParams.get("error");
  if (message === null || message === "") throw new Error("expected the redirect to carry an error message");
  return message;
}

describe("POST /api/criteria: a limits write that changed no row is a failed save (#5)", () => {
  // Each fragment is the word that tells the two failures apart; the other one's must be absent.
  const INTENTS: [string, Record<string, string>, string, string][] = [
    ["save", { intent: "save", ...TYPED_LIMITS }, "zapisać", "wyczyścić"],
    ["clear", { intent: "clear" }, "wyczyścić", "zapisać"],
  ];

  it.each(INTENTS)(
    "reports intent=%s answered 200 [] as failed, on the limits form",
    async (_intent, fields, own, other) => {
      const stub = stubLimitsUpdate(() => jsonResponse([], 200));
      const message = limitsError(await submit(fields));

      expect(message).toContain(own);
      expect(message).not.toContain(other);
      // The failure came from the database's answer — the write did go out, once.
      expect(limitUpdates(stub.requests)).toHaveLength(1);
    },
  );

  it("reports a write the database refused (42501) as a session problem, not a success", async () => {
    const stub = stubLimitsUpdate(() =>
      jsonResponse({ code: "42501", message: "permission denied", details: null, hint: null }, 403),
    );
    const message = limitsError(await submit({ intent: "save", ...TYPED_LIMITS }));

    expect(message).toContain("sesji");
    expect(message).toContain("zaloguj się ponownie");
    expect(limitUpdates(stub.requests)).toHaveLength(1);
  });

  it("refuses a reversed price range before any request reaches Supabase", async () => {
    const stub = stubFetch(() => undefined);
    const message = limitsError(
      await submit({ ...TYPED_LIMITS, intent: "save", price_min: "900 000", price_max: "800 000" }),
    );

    expect(message).toContain("Cena od");
    expect(stub.requests).toHaveLength(0);
  });
});

describe("POST /api/criteria: a saved change sends the four limits and nothing else (#5, FR-003)", () => {
  async function saved(): Promise<{ response: Response; requests: RecordedRequest[] }> {
    const stub = stubLimitsUpdate(() => jsonResponse([{ id: true }], 200));
    const response = await submit({ intent: "save", ...TYPED_LIMITS });
    return { response, requests: stub.requests };
  }

  it("returns to the limits form without an error when one row changed", async () => {
    const { response } = await saved();
    const target = location(response);
    expect(target.pathname).toBe("/criteria");
    expect(target.search).toBe("");
    expect(target.hash).toBe("#limity");
  });

  it("sends exactly one PATCH, to the singleton, asking for the changed rows back", async () => {
    const { requests } = await saved();
    expect(requests).toHaveLength(1);
    const updates = limitUpdates(requests);
    expect(updates).toHaveLength(1);
    const params = new URL(updates[0]?.url ?? "").searchParams;
    expect(params.get("id")).toBe("eq.true");
    // Without `select`, PostgREST answers 204 with no body and a filtered write looks like a save.
    expect(params.get("select")).not.toBeNull();
  });

  it("sends the four limits as typed — no id, no signature and no date", async () => {
    const body = limitUpdates((await saved()).requests)[0]?.body;
    if (typeof body !== "string") throw new Error("expected the update to carry a JSON body");
    const row = JSON.parse(body) as Record<string, unknown>;

    // Written out by hand, not imported from the code under test.
    expect(Object.keys(row).sort()).toEqual(["area_min", "city", "price_max", "price_min"]);
    expect(row).toEqual({ city: "Warszawa", price_min: 800000, price_max: 900000, area_min: 45.5 });
    for (const forbidden of ["id", "updated_by", "updated_at"]) {
      expect(row).not.toHaveProperty(forbidden);
    }
    // The member's id travels in no column at all: the trigger signs the change.
    expect(body).not.toContain(USER_ID);
  });
});
