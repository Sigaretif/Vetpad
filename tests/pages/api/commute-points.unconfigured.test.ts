import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/pages/api/commute-points";
import { captureConsole, restoreConsole } from "../../fixtures/console";
import { restoreFetch, stubFetch } from "../../fixtures/http";

// The route in the zero-config state tests/setup.ts puts every test in: this file does not
// override `astro:env/server`, so `createClient()` returns `null` (CLAUDE.md, "The project runs
// with zero configuration"). tests/pages/api/commute-points.test.ts overrides it for its whole
// file, which is why this exit has a file of its own. Pattern: notes.unconfigured.test.ts.

afterEach(restoreFetch);
afterEach(restoreConsole);

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const POINT_ID = "0b9f0c2e-7d1a-4c55-9a53-00000000c0de";

function context(fields: Record<string, string>): APIContext {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return {
    request: new Request("http://localhost/api/commute-points", { method: "POST", body: form }),
    locals: { user: { id: USER_ID } },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}

describe("POST /api/commute-points without Supabase configured", () => {
  it.each([
    ["an add", { name: "kanarek-nazwa", address: "kanarek-adres" }],
    ["a delete", { intent: "delete", id: POINT_ID }],
  ])("says so for %s, logs the refusal as info and makes no request", async (_label, fields) => {
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);

    const response = await POST(context(fields));

    // A redirect with a reason, never a 500: missing configuration is a supported state.
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location") ?? "", "http://localhost");
    expect(target.pathname).toBe("/criteria");
    expect(target.searchParams.get("error")).toBe(
      "Supabase nie jest skonfigurowany — nie można zmienić punktów dojazdu.",
    );
    expect(target.searchParams.get("form")).toBe("points");
    expect(target.hash).toBe("#punkty");
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "commute_point",
            outcome: "refused",
            stage: "config",
            reason: "unconfigured",
            user_id: USER_ID,
          },
        ],
      },
    ]);
    expect(captured.text()).not.toContain("kanarek");
  });
});
