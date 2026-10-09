import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditProvider } from "@/lib/audit/provider";
import { POST } from "@/pages/api/audits";
import { providerCalls } from "../../fixtures/anthropic";
import { captureConsole, restoreConsole } from "../../fixtures/console";
import { restoreFetch, stubFetch } from "../../fixtures/http";

// The route in the zero-config state tests/setup.ts puts every test in: this file does not
// override `astro:env/server`, so there is no Supabase client and no provider key (CLAUDE.md,
// "The project runs with zero configuration"). tests/pages/api/audits.test.ts overrides it for
// its whole file, which is why this exit has a file of its own. Pattern: offers.unconfigured.test.ts.
//
// Missing configuration is a supported state: the route answers as it always does — 200 with a
// stream whose last line says why there is no audit — and nothing is sent anywhere. The exit
// that needs a database and no provider key, `unconfigured_provider`, is in audits.test.ts.

afterEach(restoreFetch);
afterEach(restoreConsole);
afterEach(() => {
  vi.unstubAllEnvs();
});

const USER_ID = "4c1d7e2a-9b3f-4e8a-8d2c-00000000beef";
const USER_EMAIL = "czlonek.kanarek@vetpad.local";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000a0d17";

function context(fields: Record<string, string>): APIContext {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return {
    request: new Request("http://localhost/api/audits", { method: "POST", body: form }),
    locals: { user: { id: USER_ID, email: USER_EMAIL } },
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;
}

describe("POST /api/audits without Supabase and without a provider key", () => {
  it("says that Supabase is not configured, logs the refusal as info and makes no request", async () => {
    const captured = captureConsole();
    const stub = stubFetch(() => undefined);

    const response = await POST(context({ offer_id: OFFER_ID }));
    const text = await response.text();

    // A stream with a reason, never a 500 and never a redirect: the member is signed in.
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(text.split("\n").filter((line) => line !== "")).toHaveLength(1);
    expect(JSON.parse(text)).toStrictEqual({
      type: "failed",
      reason: "unconfigured_supabase",
      message: "Supabase nie jest skonfigurowany — nie można uruchomić audytu.",
    });
    expect(providerCalls(stub.requests)).toHaveLength(0);
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "offer_audit",
            outcome: "refused",
            stage: "config",
            reason: "unconfigured_supabase",
            user_id: USER_ID,
          },
        ],
      },
    ]);
    expect(captured.text()).not.toContain(USER_EMAIL);
    expect(captured.text()).not.toContain(OFFER_ID);
  });

  // The configuration is looked at before the offer's id: what is missing is said first.
  it("says the same for a form that names no offer", async () => {
    captureConsole();
    const stub = stubFetch(() => undefined);

    const response = await POST(context({}));

    expect((JSON.parse(await response.text()) as { reason: string }).reason).toBe("unconfigured_supabase");
    expect(stub.requests).toHaveLength(0);
  });
});

describe("createAuditProvider without a provider key", () => {
  it("gives no provider", () => {
    expect(createAuditProvider()).toBeNull();
  });

  // The SDK's constructor reads `ANTHROPIC_API_KEY` from the process environment by itself. The
  // key the application did not declare must not switch the audit on behind the banner's back.
  it("gives no provider when the process environment holds a key the application was not given", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-kanarek-srodowisko");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "kanarek-token-srodowiska");

    expect(createAuditProvider()).toBeNull();
  });
});
