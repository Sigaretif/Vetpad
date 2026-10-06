import type { APIContext, MiddlewareNext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "@/middleware";
import { captureConsole, restoreConsole } from "./fixtures/console";
import { restoreFetch, sessionCookie, stubFetch } from "./fixtures/http";

// The middleware in the zero-config state tests/setup.ts puts every test in: this file does not
// override `astro:env/server`, so `createClient()` returns `null` (CLAUDE.md, "The project runs
// with zero configuration"). tests/middleware.test.ts overrides it for its whole file, which is
// why this state has a file of its own.

afterEach(restoreFetch);
afterEach(restoreConsole);

const NEXT_RESPONSE = new Response("next", { status: 200 });

/** One pass with a session cookie on the request: without a client nobody reads it. */
async function pass(path: string) {
  const captured = captureConsole();
  const stub = stubFetch(() => undefined);
  const url = new URL(path, "http://localhost");
  const locals: Record<string, unknown> = {};
  const nextCalls: unknown[][] = [];
  const next = ((...args: unknown[]) => {
    nextCalls.push(args);
    return Promise.resolve(NEXT_RESPONSE);
  }) as MiddlewareNext;
  const context = {
    request: new Request(url, { headers: { Cookie: sessionCookie() } }),
    url,
    routePattern: path,
    locals,
    cookies: { set: vi.fn() },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;

  const response = await onRequest(context, next);
  return { response, nextCalls, locals, stub, captured };
}

describe("middleware without Supabase configured (#20)", () => {
  it("sends a protected route to the sign-in page, with no entry and no request", async () => {
    const { response, nextCalls, locals, stub, captured } = await pass("/dashboard");

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("Location")).toBe("/auth/signin");
    expect(nextCalls).toStrictEqual([]);
    expect(locals.user).toBeNull();
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([]);
  });

  it("lets the home page through, with no entry and no request", async () => {
    const { response, nextCalls, locals, stub, captured } = await pass("/");

    expect(response).toBe(NEXT_RESPONSE);
    expect(nextCalls).toStrictEqual([[]]);
    expect(locals.user).toBeNull();
    expect(stub.requests).toHaveLength(0);
    expect(captured.entries()).toStrictEqual([]);
  });
});
