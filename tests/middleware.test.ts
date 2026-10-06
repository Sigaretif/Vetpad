import { AuthApiError } from "@supabase/supabase-js";
import type { APIContext, MiddlewareNext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "@/middleware";
import { type ConsoleCapture, type ConsoleEntry, captureConsole, restoreConsole } from "./fixtures/console";
import {
  type FetchHandler,
  type FetchStub,
  SESSION_ACCESS_TOKEN,
  SESSION_REFRESH_TOKEN,
  SESSION_USER,
  SESSION_USER_EMAIL,
  authErrorResponse,
  isAuthRequest,
  jsonResponse,
  restoreFetch,
  sessionCookie,
  sessionCookieValue,
  stubFetch,
} from "./fixtures/http";

// The middleware with a configured Supabase client (test values, never a real project's): this
// mock overrides the zero-config one in tests/setup.ts. Only the network is stubbed below —
// @/lib/supabase, @/lib/auth-error and @/lib/log run as they do in production.
vi.mock("astro:env/server", async () => {
  const { SUPABASE_TEST_KEY, SUPABASE_TEST_URL } = await import("./fixtures/http");
  return { SUPABASE_URL: SUPABASE_TEST_URL, SUPABASE_KEY: SUPABASE_TEST_KEY, getSecret: () => undefined };
});

// Expected outcomes come from the three classes of src/lib/auth-error.ts: no session and a
// session Auth refused both read as signed out, and only the second leaves an entry; an Auth
// that could not answer is never a sign-out — the member gets the 503 page and keeps the cookie.

afterEach(restoreFetch);
afterEach(restoreConsole);

// Every id below is a literal of this file, never read back from the fixture at assertion time.
const USER_ID = "7a2e9d41-5c3b-4f6a-9e1d-00000000cafe";
const OFFER_ID = "0b9f0c2e-7d1a-4c55-9a53-0000000000aa";
const OFFER_PATH = `/offers/${OFFER_ID}`;

/** What Auth says in the body of a refusal or a rate limit; no entry may repeat it. */
const AUTH_MSG = "KANAREK-AUTH-MSG invalid JWT: token is malformed";
/** What the thrown value says; no entry may repeat it. */
const THROWN_MESSAGE = "KANAREK-THROWN-MESSAGE cannot read properties of undefined";
/** A paused project's answer: a page, not JSON. */
const PAUSED_PAGE = "<!DOCTYPE html><html><body>KANAREK-PAUSED-PAGE project is paused</body></html>";

/** The response `next` hands back; the middleware must pass on this very object. */
const NEXT_RESPONSE = new Response("next", { status: 200 });

type Answer = () => Response | Promise<Response>;

const validUser: Answer = () => jsonResponse(SESSION_USER, 200);
const badJwt: Answer = () => authErrorResponse(403, "bad_jwt", AUTH_MSG);
const unavailable: Answer = () => new Response("upstream connect error", { status: 503 });

/** Auth answers `GET /auth/v1/user` with `answer`; any other request is unplanned. */
function userEndpoint(answer: Answer): FetchHandler {
  return (request) => (isAuthRequest(request, "user") ? answer() : undefined);
}

/** Auth refuses the refresh token; no request for the user is planned, because none follows. */
const refreshRefused: FetchHandler = (request) =>
  isAuthRequest(request, "token") ? authErrorResponse(400, "refresh_token_not_found", AUTH_MSG) : undefined;

// What auth-js writes to the console by itself when a refresh token is refused: each of the two
// listeners the Supabase client registers (supabase-js and @supabase/ssr, `_emitInitialSession`
// in GoTrueClient.ts) warns with the error it got — message included, outside the reporter. The
// tests name these entries; they never filter the console down to the middleware's own.
const REFRESH_REFUSED_WARNING: ConsoleEntry = {
  method: "warn",
  args: [new AuthApiError(AUTH_MSG, 400, "refresh_token_not_found")],
};

/** No request is planned: any that goes out fails the test through `restoreFetch`. */
const noNetwork: FetchHandler = () => undefined;

/** Rejects with any value, the way a route can throw one that is not an `Error`. */
const rejectWith: (value: unknown) => Promise<Response> = Promise.reject.bind(Promise);

interface Pass {
  method?: string;
  /** The path with its query, as the browser asked for it. */
  path: string;
  /** The route Astro matched, e.g. `/offers/[id]`. */
  routePattern: string;
  cookie?: string;
  auth?: FetchHandler;
  /** What `next` does instead of answering. */
  nextThrows?: unknown;
  locals?: Record<string, unknown>;
}

interface PassResult {
  /** The response the middleware returned, when it returned. */
  response?: Response;
  /** The value the middleware threw, when it threw. */
  thrown?: { value: unknown };
  /** The arguments of every `next` call: `[]` for `next()`, `["/503"]` for a rewrite. */
  nextCalls: unknown[][];
  locals: Record<string, unknown>;
  cookiesSet: ReturnType<typeof vi.fn>;
  request: Request;
  stub: FetchStub;
  captured: ConsoleCapture;
}

/** One pass of a request through the middleware, with a hand-built context. */
async function pass({
  method = "GET",
  path,
  routePattern,
  cookie,
  auth = noNetwork,
  nextThrows,
  locals = {},
}: Pass): Promise<PassResult> {
  const captured = captureConsole();
  const stub = stubFetch(auth);
  const url = new URL(path, "http://localhost");
  const headers = new Headers();
  if (cookie !== undefined) headers.set("Cookie", cookie);
  const body = method === "GET" ? undefined : new URLSearchParams({ url: "https://www.otodom.pl/pl/oferta/x-ID1" });
  const request = new Request(url, { method, headers, body });
  const cookiesSet = vi.fn();
  const nextCalls: unknown[][] = [];
  const next = ((...args: unknown[]) => {
    nextCalls.push(args);
    if (nextThrows !== undefined) return rejectWith(nextThrows);
    return Promise.resolve(NEXT_RESPONSE);
  }) as MiddlewareNext;
  const context = {
    request,
    url,
    routePattern,
    locals,
    cookies: { set: cookiesSet },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as unknown as APIContext;

  const result: PassResult = { nextCalls, locals, cookiesSet, request, stub, captured };
  try {
    const response = await onRequest(context, next);
    if (!(response instanceof Response)) throw new Error("expected the middleware to return a Response");
    result.response = response;
  } catch (error) {
    if (nextThrows === undefined) throw error;
    result.thrown = { value: error };
  }
  return result;
}

function expectRedirect(result: PassResult, location: string): void {
  expect(result.response?.status).toBe(302);
  expect(result.response?.headers.get("Location")).toBe(location);
  expect(result.nextCalls).toStrictEqual([]);
}

/** The middleware handed the request on unchanged and returned what `next` answered. */
function expectPassedOn(result: PassResult): void {
  expect(result.nextCalls).toStrictEqual([[]]);
  expect(result.response).toBe(NEXT_RESPONSE);
}

/** The middleware rewrote the request to the 503 page, once, and returned what `next` answered. */
function expectRewrittenTo503(result: PassResult): void {
  expect(result.nextCalls).toStrictEqual([["/503"]]);
  expect(result.response).toBe(NEXT_RESPONSE);
}

function entry(level: "info" | "error", fields: Record<string, string | number>): ConsoleEntry {
  return { method: level, args: [{ level, ...fields }] };
}

describe("middleware: no session cookie is a signed-out visitor, with no entry and no request", () => {
  it("#1 sends a protected route to the sign-in page", async () => {
    const result = await pass({ path: "/dashboard", routePattern: "/dashboard" });

    expectRedirect(result, "/auth/signin");
    expect(result.locals.user).toBeNull();
    expect(result.stub.requests).toHaveLength(0);
    expect(result.captured.entries()).toStrictEqual([]);
  });

  it("#2 lets the home page through", async () => {
    const result = await pass({ path: "/", routePattern: "/" });

    expectPassedOn(result);
    expect(result.locals.user).toBeNull();
    expect(result.stub.requests).toHaveLength(0);
    expect(result.captured.entries()).toStrictEqual([]);
  });
});

describe("middleware: a session Auth confirms is the member, with no entry", () => {
  it("#3 lets a protected route through with the user on locals", async () => {
    const result = await pass({
      path: "/dashboard",
      routePattern: "/dashboard",
      cookie: sessionCookie(),
      auth: userEndpoint(validUser),
    });

    expectPassedOn(result);
    expect((result.locals.user as { id: string } | null)?.id).toBe(USER_ID);
    expect(result.stub.requests).toHaveLength(1);
    expect(result.captured.entries()).toStrictEqual([]);
  });

  it("#4 sends the home page to the board", async () => {
    const result = await pass({ path: "/", routePattern: "/", cookie: sessionCookie(), auth: userEndpoint(validUser) });

    expectRedirect(result, "/dashboard");
    expect(result.captured.entries()).toStrictEqual([]);
  });
});

describe("middleware: a session Auth refused is signed out, and leaves one info entry", () => {
  it("#5 sends a protected route to the sign-in page when the token is refused", async () => {
    const result = await pass({
      path: "/dashboard",
      routePattern: "/dashboard",
      cookie: sessionCookie(),
      auth: userEndpoint(badJwt),
    });

    expectRedirect(result, "/auth/signin");
    expect(result.locals.user).toBeNull();
    expect(result.captured.entries()).toStrictEqual([
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "auth_check",
            outcome: "rejected",
            route: "/dashboard",
            method: "GET",
            error_name: "AuthApiError",
            auth_status: 403,
            auth_code: "bad_jwt",
          },
        ],
      },
    ]);
  });

  it("#6 sends an offer's card to the sign-in page when the refresh token is refused", async () => {
    const result = await pass({
      path: OFFER_PATH,
      routePattern: "/offers/[id]",
      cookie: sessionCookie({ expired: true }),
      // 400 with a code is a refusal: the client does not retry it and asks for no user.
      auth: refreshRefused,
    });

    expectRedirect(result, "/auth/signin");
    expect(result.locals.user).toBeNull();
    expect(result.stub.requests).toHaveLength(1);
    expect(result.captured.entries()).toStrictEqual([
      REFRESH_REFUSED_WARNING,
      REFRESH_REFUSED_WARNING,
      {
        method: "info",
        args: [
          {
            level: "info",
            event: "auth_check",
            outcome: "rejected",
            route: "/offers/[id]",
            method: "GET",
            error_name: "AuthApiError",
            auth_status: 400,
            auth_code: "refresh_token_not_found",
          },
        ],
      },
    ]);
  });

  it("#7 lets the home page through", async () => {
    const result = await pass({ path: "/", routePattern: "/", cookie: sessionCookie(), auth: userEndpoint(badJwt) });

    expectPassedOn(result);
    expect(result.locals.user).toBeNull();
    expect(result.captured.entries()).toStrictEqual([
      entry("info", {
        event: "auth_check",
        outcome: "rejected",
        route: "/",
        method: "GET",
        error_name: "AuthApiError",
        auth_status: 403,
        auth_code: "bad_jwt",
      }),
    ]);
  });
});

describe("middleware: an Auth that could not answer is an outage, never a sign-out", () => {
  it("#8 rewrites a protected route to the 503 page and keeps the cookie", async () => {
    const result = await pass({
      path: "/dashboard",
      routePattern: "/dashboard",
      cookie: sessionCookie(),
      auth: userEndpoint(unavailable),
    });

    expectRewrittenTo503(result);
    expect(result.locals.user).toBeNull();
    expect(result.stub.requests).toHaveLength(1);
    expect(result.cookiesSet).not.toHaveBeenCalled();
    expect(result.captured.entries()).toStrictEqual([
      {
        method: "error",
        args: [
          {
            level: "error",
            event: "auth_check",
            outcome: "unavailable",
            route: "/dashboard",
            method: "GET",
            error_name: "AuthRetryableFetchError",
            auth_status: 503,
          },
        ],
      },
    ]);
  });

  it("#9 reads a request that never connected as an outage with status 0", async () => {
    const result = await pass({
      path: "/dashboard",
      routePattern: "/dashboard",
      cookie: sessionCookie(),
      // A rejected promise, not `undefined`: the request was planned, Auth just never answered.
      auth: userEndpoint(() => Promise.reject(new TypeError("fetch failed"))),
    });

    expectRewrittenTo503(result);
    expect(result.locals.user).toBeNull();
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "auth_check",
        outcome: "unavailable",
        route: "/dashboard",
        method: "GET",
        error_name: "AuthRetryableFetchError",
        auth_status: 0,
      }),
    ]);
  });

  it("#10 reads a paused project's page as an outage, without a status", async () => {
    const result = await pass({
      path: "/criteria",
      routePattern: "/criteria",
      cookie: sessionCookie(),
      auth: userEndpoint(() => new Response(PAUSED_PAGE, { status: 540, headers: { "Content-Type": "text/html" } })),
    });

    expectRewrittenTo503(result);
    expect(result.locals.user).toBeNull();
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "auth_check",
        outcome: "unavailable",
        route: "/criteria",
        method: "GET",
        error_name: "AuthUnknownError",
      }),
    ]);
  });

  it("#11 reads a rate limit as an outage: it says nothing about the session", async () => {
    const result = await pass({
      path: "/dashboard",
      routePattern: "/dashboard",
      cookie: sessionCookie(),
      auth: userEndpoint(() => authErrorResponse(429, "over_request_rate_limit", AUTH_MSG)),
    });

    expectRewrittenTo503(result);
    expect(result.locals.user).toBeNull();
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "auth_check",
        outcome: "unavailable",
        route: "/dashboard",
        method: "GET",
        error_name: "AuthApiError",
        auth_status: 429,
        auth_code: "over_request_rate_limit",
      }),
    ]);
  });

  it("#12 stops a form post before its route, without reading the body", async () => {
    const result = await pass({
      method: "POST",
      path: "/api/offers",
      routePattern: "/api/offers",
      cookie: sessionCookie(),
      auth: userEndpoint(unavailable),
    });

    // The route never sees `user: null` from an outage, so its `signed_out` stays true.
    expectRewrittenTo503(result);
    expect(result.locals.user).toBeNull();
    // The rewrite builds a new request from this one; a body already read would make it throw.
    expect(result.request.bodyUsed).toBe(false);
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "auth_check",
        outcome: "unavailable",
        route: "/api/offers",
        method: "POST",
        error_name: "AuthRetryableFetchError",
        auth_status: 503,
      }),
    ]);
  });

  it("#13 rewrites the home page too", async () => {
    const result = await pass({
      path: "/",
      routePattern: "/",
      cookie: sessionCookie(),
      auth: userEndpoint(unavailable),
    });

    expectRewrittenTo503(result);
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "auth_check",
        outcome: "unavailable",
        route: "/",
        method: "GET",
        error_name: "AuthRetryableFetchError",
        auth_status: 503,
      }),
    ]);
  });

  it("#14 leaves the sign-in page reachable", async () => {
    const result = await pass({
      path: "/auth/signin",
      routePattern: "/auth/signin",
      cookie: sessionCookie(),
      auth: userEndpoint(unavailable),
    });

    expectPassedOn(result);
    expect(result.locals.user).toBeNull();
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "auth_check",
        outcome: "unavailable",
        route: "/auth/signin",
        method: "GET",
        error_name: "AuthRetryableFetchError",
        auth_status: 503,
      }),
    ]);
  });

  it("#14 leaves the bare /auth path alone, but not a path that only begins like it", async () => {
    // Neither path has a page, so Astro matches both to its 404 route.
    const bare = await pass({
      path: "/auth",
      routePattern: "/404",
      cookie: sessionCookie(),
      auth: userEndpoint(unavailable),
    });

    expectPassedOn(bare);
    expect(bare.captured.entries()).toStrictEqual([
      entry("error", {
        event: "auth_check",
        outcome: "unavailable",
        route: "/404",
        method: "GET",
        error_name: "AuthRetryableFetchError",
        auth_status: 503,
      }),
    ]);

    const lookalike = await pass({
      path: "/authors",
      routePattern: "/404",
      cookie: sessionCookie(),
      auth: userEndpoint(unavailable),
    });

    expectRewrittenTo503(lookalike);
  });

  it("#15 leaves the sign-out route reachable", async () => {
    const result = await pass({
      method: "POST",
      path: "/api/auth/signout",
      routePattern: "/api/auth/signout",
      cookie: sessionCookie(),
      auth: userEndpoint(unavailable),
    });

    expectPassedOn(result);
    expect(result.locals.user).toBeNull();
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "auth_check",
        outcome: "unavailable",
        route: "/api/auth/signout",
        method: "POST",
        error_name: "AuthRetryableFetchError",
        auth_status: 503,
      }),
    ]);
  });
});

describe("middleware: an exception leaves one entry and goes on as the same value", () => {
  it("#16 logs the route, the method and the member, then rethrows the same error", async () => {
    const thrown = new TypeError(THROWN_MESSAGE);
    const result = await pass({
      path: OFFER_PATH,
      routePattern: "/offers/[id]",
      cookie: sessionCookie(),
      auth: userEndpoint(validUser),
      nextThrows: thrown,
    });

    expect(result.thrown?.value).toBe(thrown);
    expect(result.nextCalls).toStrictEqual([[]]);
    expect(result.captured.entries()).toStrictEqual([
      {
        method: "error",
        args: [
          {
            level: "error",
            event: "request",
            outcome: "unhandled",
            route: "/offers/[id]",
            method: "GET",
            user_id: USER_ID,
            error_name: "TypeError",
          },
        ],
      },
    ]);
  });

  it("#17 logs a thrown value that is not an Error as NonError, without a member", async () => {
    const result = await pass({ path: "/auth/signin", routePattern: "/auth/signin", nextThrows: THROWN_MESSAGE });

    expect(result.thrown?.value).toBe(THROWN_MESSAGE);
    expect(result.nextCalls).toStrictEqual([[]]);
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "request",
        outcome: "unhandled",
        route: "/auth/signin",
        method: "GET",
        error_name: "NonError",
      }),
    ]);
  });
});

// After an exception Astro renders 500.astro in a second pass through the middleware: the
// route is `/500`, the path is still the one that threw.
describe("middleware: the second pass for the 500 page asks Auth nothing", () => {
  it("#18 passes on without a request, a redirect or a rewrite", async () => {
    const result = await pass({ path: "/dashboard", routePattern: "/500", cookie: sessionCookie() });

    expectPassedOn(result);
    expect(result.locals.user).toBeNull();
    expect(result.stub.requests).toHaveLength(0);
    expect(result.captured.entries()).toStrictEqual([]);
  });

  it("#18 keeps the user the first pass put on locals", async () => {
    const user = { id: USER_ID };
    const result = await pass({ path: "/", routePattern: "/500", cookie: sessionCookie(), locals: { user } });

    // No redirect to the board either, although the path is `/` and the member is known.
    expectPassedOn(result);
    expect(result.locals.user).toBe(user);
    expect(result.stub.requests).toHaveLength(0);
    expect(result.captured.entries()).toStrictEqual([]);
  });

  it("#19 logs an exception from the 500 page itself, which Astro would swallow", async () => {
    const thrown = new RangeError(THROWN_MESSAGE);
    const result = await pass({
      path: "/dashboard",
      routePattern: "/500",
      cookie: sessionCookie(),
      nextThrows: thrown,
    });

    expect(result.thrown?.value).toBe(thrown);
    expect(result.nextCalls).toStrictEqual([[]]);
    expect(result.stub.requests).toHaveLength(0);
    expect(result.captured.entries()).toStrictEqual([
      entry("error", {
        event: "request",
        outcome: "unhandled",
        route: "/500",
        method: "GET",
        error_name: "RangeError",
      }),
    ]);
  });
});

// One assertion over every kind of entry the middleware writes: whatever a later change adds to
// an entry, the console must not carry the member's address, a token, the cookie, the query, the
// raw path or an error's own words. Each scenario first names the outcome its entry reports, so
// a scenario that stopped logging fails instead of passing empty.
describe("middleware: no log entry carries the member, the session, the address or an error's message", () => {
  const QUERY = "?utm_source=kanarek-query";
  const FORBIDDEN = [
    SESSION_USER_EMAIL,
    SESSION_ACCESS_TOKEN,
    SESSION_REFRESH_TOKEN,
    "sb-supabase-auth-token",
    "base64-",
    "utm_source",
    "kanarek-query",
    // The id in the raw path; the entry names the route's pattern instead.
    OFFER_ID,
    THROWN_MESSAGE,
    "KANAREK-THROWN-MESSAGE",
    "KANAREK-PAUSED-PAGE",
    // What the JSON parser says about the paused project's page, which quotes its first characters.
    "DOCTYPE",
    "is not valid JSON",
    "upstream connect error",
  ];

  /** The words of Auth's answer, which auth-js prints by itself when it warns (see above). */
  const AUTH_WORDS = [AUTH_MSG, "KANAREK-AUTH-MSG"];

  // The last column names every entry that is not the middleware's: what the library wrote.
  const SCENARIOS: [string, string, Pass, ConsoleEntry[]][] = [
    [
      "rejected",
      "#5 a token Auth refused",
      { path: `/dashboard${QUERY}`, routePattern: "/dashboard", cookie: sessionCookie(), auth: userEndpoint(badJwt) },
      [],
    ],
    [
      "rejected",
      "#6 a refresh token Auth refused",
      {
        path: `${OFFER_PATH}${QUERY}`,
        routePattern: "/offers/[id]",
        cookie: sessionCookie({ expired: true }),
        auth: refreshRefused,
      },
      [REFRESH_REFUSED_WARNING, REFRESH_REFUSED_WARNING],
    ],
    [
      "unavailable",
      "#8 an Auth answering 503",
      {
        path: `/dashboard${QUERY}`,
        routePattern: "/dashboard",
        cookie: sessionCookie(),
        auth: userEndpoint(unavailable),
      },
      [],
    ],
    [
      "unavailable",
      "#10 a paused project's page",
      {
        path: `/criteria${QUERY}`,
        routePattern: "/criteria",
        cookie: sessionCookie(),
        auth: userEndpoint(() => new Response(PAUSED_PAGE, { status: 540, headers: { "Content-Type": "text/html" } })),
      },
      [],
    ],
    [
      "unhandled",
      "#16 an exception from the route",
      {
        path: `${OFFER_PATH}${QUERY}`,
        routePattern: "/offers/[id]",
        cookie: sessionCookie(),
        auth: userEndpoint(validUser),
        nextThrows: new TypeError(THROWN_MESSAGE),
      },
      [],
    ],
  ];

  it.each(SCENARIOS)("with outcome %s: %s", async (outcome, _label, scenario, foreign) => {
    const { captured } = await pass(scenario);

    const entries = captured.entries();
    const own = entries.at(-1);
    expect(own?.args).toHaveLength(1);
    expect(own?.args[0]).toMatchObject({ outcome });
    expect(entries.slice(0, -1)).toStrictEqual(foreign);

    const forbidden = [...FORBIDDEN, sessionCookieValue(), sessionCookieValue({ expired: true })];
    // The middleware's own entry carries none of it, Auth's words included.
    const ownText = JSON.stringify(own?.args[0]);
    for (const text of [...forbidden, ...AUTH_WORDS]) {
      expect(ownText).not.toContain(text);
    }
    // Nor does anything else in the console — except Auth's words where the library printed them.
    const consoleText = captured.text();
    for (const text of foreign.length === 0 ? [...forbidden, ...AUTH_WORDS] : forbidden) {
      expect(consoleText).not.toContain(text);
    }
  });
});
