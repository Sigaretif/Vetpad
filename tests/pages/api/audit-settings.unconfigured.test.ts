import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/audit-settings";
import { captureConsole, restoreConsole } from "../../fixtures/console";
import { restoreFetch, stubFetch } from "../../fixtures/http";

// The route in the zero-config state tests/setup.ts puts every test in: this file does not
// override `astro:env/server`, so `createClient()` returns `null` (CLAUDE.md, "The project runs
// with zero configuration"). tests/pages/api/audit-settings.test.ts overrides it for its whole
// file, which is why this exit has a file of its own. Pattern: offers.unconfigured.test.ts.

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const USER_EMAIL = "czlonek.kanarek@vetpad.local";

describe("POST /api/audit-settings without Supabase configured", () => {
  it("says so on the settings form, logs the refusal as info and makes no request", async () => {
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);
    const form = new FormData();
    form.set("model", "claude-sonnet-5-5");
    form.set("effort", "high");
    const context = {
      request: new Request("http://localhost/api/audit-settings", { method: "POST", body: form }),
      locals: { user: { id: USER_ID, email: USER_EMAIL } },
      cookies: { set: vi.fn() },
      redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
    } as unknown as APIContext;

    const response = await POST(context);

    // A redirect with a message, never a 500: missing configuration is a supported state.
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location") ?? "", "http://localhost");
    expect(target.pathname).toBe("/criteria");
    expect(target.searchParams.get("error")).toBe(
      "Supabase nie jest skonfigurowany — nie można zmienić ustawień audytu.",
    );
    expect(target.searchParams.get("form")).toBe("audit");
    expect(target.hash).toBe("#audyt");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "audit_settings",
            outcome: "refused",
            stage: "config",
            reason: "unconfigured",
            user_id: USER_ID,
          },
        ],
      },
    ]);
    expect(captured.text()).not.toContain(USER_EMAIL);
  });
});
