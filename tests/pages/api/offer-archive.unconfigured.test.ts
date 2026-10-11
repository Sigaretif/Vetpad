import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/offer-archive";
import { captureConsole, restoreConsole } from "../../fixtures/console";
import { restoreFetch, stubFetch } from "../../fixtures/http";

// The route in the zero-config state tests/setup.ts puts every test in: this file does not
// override `astro:env/server`, so `createClient()` returns `null` (CLAUDE.md, "The project runs
// with zero configuration"). tests/pages/api/offer-archive.test.ts overrides it for its whole
// file, which is why this exit has a file of its own. Pattern: offers.unconfigured.test.ts.

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const USER_EMAIL = "czlonek.kanarek@vetpad.local";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000a4c17";

function context(fields: Record<string, string>): APIContext {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return {
    request: new Request("http://localhost/api/offer-archive", { method: "POST", body: form }),
    locals: { user: { id: USER_ID, email: USER_EMAIL } },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}

describe("POST /api/offer-archive without Supabase configured", () => {
  it.each(["archive", "restore"])(
    "says so for intent=%s, logs the refusal as info and makes no request",
    async (intent) => {
      const captured = captureConsole();
      const stub = stubFetch(() => undefined);

      const response = await POST(context({ offer_id: OFFER_ID, intent, return: "archive" }));

      // A redirect with a reason, never a 500: missing configuration is a supported state.
      expect(response.status).toBe(302);
      const target = new URL(response.headers.get("Location") ?? "", "http://localhost");
      expect(target.pathname).toBe("/dashboard");
      expect(target.searchParams.get("error")).toBe(
        "Supabase nie jest skonfigurowany — nie można zmienić stanu archiwum oferty.",
      );
      // No database was asked for anything: nothing was read and nothing was written.
      expect(stub.requests).toHaveLength(0);
      expect(captured.entries()).toStrictEqual([
        {
          method: "info",
          args: [
            {
              level: "info",
              event: "offer_archive",
              outcome: "refused",
              stage: "config",
              reason: "unconfigured",
              user_id: USER_ID,
            },
          ],
        },
      ]);
      expect(captured.text()).not.toContain(USER_EMAIL);
      expect(captured.text()).not.toContain(OFFER_ID);
    },
  );

  // The configuration is looked at before the form: what is missing is said first.
  it("says the same for a form that names no offer and no intent", async () => {
    captureConsole();
    const stub = stubFetch(() => undefined);

    const response = await POST(context({}));

    const target = new URL(response.headers.get("Location") ?? "", "http://localhost");
    expect(target.pathname).toBe("/dashboard");
    expect(target.searchParams.get("error")).toContain("Supabase nie jest skonfigurowany");
    expect(stub.requests).toHaveLength(0);
  });
});
