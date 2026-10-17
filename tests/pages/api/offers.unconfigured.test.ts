import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/offers";
import { isApifyAvailable } from "@/lib/config-status";
import { createApifyLeg } from "@/lib/otodom/apify";
import { apifyCalls } from "../../fixtures/apify";
import { captureConsole, restoreConsole } from "../../fixtures/console";
import { restoreFetch, stubFetch } from "../../fixtures/http";

// The route in the zero-config state tests/setup.ts puts every test in: this file does not
// override `astro:env/server`, so `createClient()` returns `null` (CLAUDE.md, "The project runs
// with zero configuration"). tests/pages/api/offers.test.ts overrides it for its whole file,
// which is why this exit has a file of its own.

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const USER_EMAIL = "czlonek.kanarek@vetpad.local";

describe("POST /api/offers without Supabase configured", () => {
  it("says so, logs the refusal as info and makes no request", async () => {
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);
    const form = new FormData();
    form.set("url", "https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1");
    const context = {
      request: new Request("http://localhost/api/offers", { method: "POST", body: form }),
      locals: { user: { id: USER_ID, email: USER_EMAIL } },
      cookies: { set: vi.fn() },
      redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
    } as unknown as APIContext;

    const response = await POST(context);

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location") ?? "", "http://localhost");
    expect(target.pathname).toBe("/dashboard");
    expect(target.searchParams.get("error")).toBe("Supabase nie jest skonfigurowany — nie można zapisać oferty.");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_add",
            outcome: "refused",
            stage: "config",
            reason: "unconfigured",
            user_id: USER_ID,
          },
        ],
      },
    ]);
    // The `config` stage of the privacy check in tests/pages/api/offers.test.ts, which cannot
    // reach this exit: neither the member's address nor the pasted listing is in the entry.
    for (const forbidden of [USER_EMAIL, "otodom.pl", "mieszkanie", "warszawa"]) {
      expect(captured.text()).not.toContain(forbidden);
    }
  });
});

// The module loaded with no Apify token at all — not switched off by a test's toggle: the fallback
// is off, no leg can be built, and the route sends nothing to Apify (or anywhere).
describe("POST /api/offers without an Apify token", () => {
  it("has no Apify leg to build and sends no Apify request: otodom 0, Apify 0, writes 0", async () => {
    captureConsole();
    const stub = stubFetch(() => undefined);
    const form = new FormData();
    form.set("url", "https://www.otodom.pl/pl/oferta/mieszkanie-54-m-warszawa-IDKANAR1");
    const context = {
      request: new Request("http://localhost/api/offers", { method: "POST", body: form }),
      locals: { user: { id: USER_ID, email: USER_EMAIL } },
      cookies: { set: vi.fn() },
      redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
    } as unknown as APIContext;

    expect(isApifyAvailable()).toBe(false);
    expect(createApifyLeg()).toBeNull();
    const response = await POST(context);

    expect(response.status).toBe(302);
    expect(apifyCalls(stub.requests)).toHaveLength(0);
    expect(stub.requests).toHaveLength(0);
  });
});
