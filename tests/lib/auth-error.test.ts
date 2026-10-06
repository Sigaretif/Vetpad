import { describe, expect, it } from "vitest";
import {
  AuthApiError,
  AuthError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { classifyAuthError, isAuthOutage } from "@/lib/auth-error";

// Expected values are written by hand from the contract in the auth-outage-not-signed-out plan
// (Phase 1, "Test contract") — never copied from what the function returns. The errors are built
// from the auth-js classes, the way getUser() hands them back. Every "rejected" case stands
// beside an "unavailable" one on the other side of its bound: alone, either half would pass on a
// function that always gives one answer.

/** What Auth answers with: a status and, for most refusals, a code. */
function apiError(status: number, code?: string): AuthApiError {
  return new AuthApiError("KANAREK-KOMUNIKAT", status, code);
}

/** A network failure (status 0) or one of the statuses auth-js retries. */
function fetchError(status: number): AuthRetryableFetchError {
  return new AuthRetryableFetchError("KANAREK-KOMUNIKAT", status);
}

/** An answer auth-js could not read, such as the HTML body of a paused project. */
function unknownError(): AuthUnknownError {
  return new AuthUnknownError("KANAREK-KOMUNIKAT", new SyntaxError("Unexpected token <"));
}

describe("classifyAuthError: no session is neither a rejection nor an outage", () => {
  it("reads AuthSessionMissingError as missing, although it carries status 400", () => {
    expect(classifyAuthError(new AuthSessionMissingError())).toBe("missing");
  });

  it("reads another error with status 400 as rejected", () => {
    expect(classifyAuthError(apiError(400, "refresh_token_not_found"))).toBe("rejected");
  });
});

describe("classifyAuthError: a session Auth refused is rejected", () => {
  it.each<[number, string | undefined]>([
    [400, "refresh_token_not_found"],
    [403, "bad_jwt"],
    [403, "user_not_found"],
    [499, undefined],
  ])("reads AuthApiError %d with code %j as rejected", (status, code) => {
    expect(classifyAuthError(apiError(status, code))).toBe("rejected");
  });

  it("reads 429 as unavailable: a rate limit says nothing about the session", () => {
    expect(classifyAuthError(apiError(429, "over_request_rate_limit"))).toBe("unavailable");
    expect(classifyAuthError(apiError(403, "bad_jwt"))).toBe("rejected");
  });

  it("puts the bound between 499 and 500", () => {
    expect(classifyAuthError(apiError(499))).toBe("rejected");
    expect(classifyAuthError(apiError(500))).toBe("unavailable");
  });
});

describe("classifyAuthError: everything that is not a refusal is unavailable", () => {
  it.each<[string, AuthError]>([
    ["AuthApiError 429", apiError(429, "over_request_rate_limit")],
    ["AuthApiError 500", apiError(500)],
    ["AuthApiError 540 without a code", apiError(540)],
    ["AuthRetryableFetchError with status 0", fetchError(0)],
    ["AuthRetryableFetchError with status 503", fetchError(503)],
    ["AuthUnknownError", unknownError()],
    ["AuthError without a status", new AuthError("KANAREK-KOMUNIKAT")],
  ])("reads %s as unavailable", (_name, error) => {
    expect(classifyAuthError(error)).toBe("unavailable");
  });

  it("reads the same AuthApiError as rejected once its status is a refusal", () => {
    expect(classifyAuthError(apiError(403, "user_not_found"))).toBe("rejected");
  });
});

describe("isAuthOutage", () => {
  it.each<[string, AuthError]>([
    ["AuthRetryableFetchError with status 0", fetchError(0)],
    ["AuthRetryableFetchError with status 503", fetchError(503)],
    ["AuthApiError 540 without a code", apiError(540)],
    ["AuthUnknownError", unknownError()],
  ])("is true for %s", (_name, error) => {
    expect(isAuthOutage(error)).toBe(true);
  });

  it.each<[string, AuthError]>([
    ["AuthApiError 429", apiError(429, "over_request_rate_limit")],
    ["AuthApiError 403", apiError(403, "bad_jwt")],
  ])("is false for %s", (_name, error) => {
    expect(isAuthOutage(error)).toBe(false);
  });

  // The sign-in route reads this predicate alone: a 500 from Auth is an outage there, never a wrong password.
  it("puts the bound between 499 and 500", () => {
    expect(isAuthOutage(apiError(499))).toBe(false);
    expect(isAuthOutage(apiError(500))).toBe(true);
  });
});
