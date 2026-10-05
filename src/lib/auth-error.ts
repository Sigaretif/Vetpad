import { isAuthRetryableFetchError, isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";

/** What an error from Supabase Auth says about the session: there is none, Auth refused it, or Auth could not answer. */
export type AuthErrorClass = "missing" | "rejected" | "unavailable";

/** True when Auth itself failed, as opposed to answering with a refusal. */
export function isAuthOutage(error: AuthError): boolean {
  // auth-js marks only 500–504 and 520–530 as retryable; a paused project answers 540 (an
  // AuthApiError without a code, or AuthUnknownError for an HTML body), so any 5xx counts here.
  return isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500 || error.name === "AuthUnknownError";
}

/**
 * Sorts an error from Supabase Auth into one of three classes. Only a 4xx other than 429 is a
 * refusal; whatever cannot be recognised is `unavailable`, so an unknown error is never read as
 * a signed-out member.
 */
export function classifyAuthError(error: AuthError): AuthErrorClass {
  // First, because AuthSessionMissingError carries status 400 and would otherwise read as a refusal.
  if (isAuthSessionMissingError(error)) return "missing";
  if (isAuthOutage(error)) return "unavailable";
  const status = error.status ?? 0;
  // 429 is a rate limit: it says nothing about the session.
  if (status >= 400 && status <= 499 && status !== 429) return "rejected";
  return "unavailable";
}
