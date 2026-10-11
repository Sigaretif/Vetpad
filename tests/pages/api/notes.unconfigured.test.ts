import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/notes";
import { captureConsole, restoreConsole } from "../../fixtures/console";
import { restoreFetch, stubFetch } from "../../fixtures/http";

// The route in the zero-config state tests/setup.ts puts every test in: this file does not
// override `astro:env/server`, so `createClient()` returns `null` (CLAUDE.md, "The project runs
// with zero configuration"). tests/pages/api/notes.test.ts overrides it for its whole file, which
// is why this exit has a file of its own. Pattern: offer-archive.unconfigured.test.ts.

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const USER_EMAIL = "czlonek.kanarek@vetpad.local";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-00000000a07e";

function context(fields: Record<string, string>): APIContext {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return {
    request: new Request("http://localhost/api/notes", { method: "POST", body: form }),
    locals: { user: { id: USER_ID, email: USER_EMAIL } },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}

describe("POST /api/notes without Supabase configured", () => {
  it.each([
    ["a save", { offer_id: OFFER_ID, pros: "kanarek-zalety" }],
    ["a delete", { offer_id: OFFER_ID, intent: "delete" }],
  ])("says so for %s, logs the refusal as info and makes no request", async (_label, fields) => {
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);

    const response = await POST(context(fields));

    // A redirect with a reason, never a 500: missing configuration is a supported state.
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location") ?? "", "http://localhost");
    expect(target.pathname).toBe("/dashboard");
    expect(target.searchParams.get("error")).toBe("Supabase nie jest skonfigurowany — nie można zapisać notatki.");
    expect(target.searchParams.has("note")).toBe(false);
    // No database was asked for anything: nothing was saved and nothing was deleted.
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "note",
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
    expect(captured.text()).not.toContain("kanarek");
  });
});
