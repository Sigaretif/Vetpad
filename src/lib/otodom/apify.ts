// The one module that holds the extraction service's token (`APIFY_TOKEN`) and talks to the service:
// Apify, running `apify/cheerio-scraper` with our own `pageFunction` on one otodom.pl listing. What
// is sent is defined in `./apify-request.ts`; this module adds the token, makes the one request, and
// turns every way it can end into the result the direct fetch gives, or into a reason of Apify's.
//
// Server-only: the token is read from `astro:env/server`, so no island, layout or page render
// imports this module (`apifyServerOnlyConfig` in eslint.config.js); a view asks
// `isApifyAvailable()` in `@/lib/config-status`. A missing token is a supported state — the factory
// answers `null` and nothing is sent (CLAUDE.md, the zero-config rule).
//
// A run is paid for, so two things hold here:
// - One request, never a retry. Running it again is the member's deliberate action.
// - Apify's words stay here. Its error's `message` and a run's `#debug` are never read into a
//   result; only the status, the error's `type` token and our own reason leave this module.

import { APIFY_TOKEN } from "astro:env/server";
import { buildApifyRequest, readApifyAnswer, type ApifyAnswerFailure } from "./apify-request";
import { classifyAnswer, classifyPayload, isAbort } from "./fetch";
import type { FetchOfferResult } from "./types";

/**
 * Why an Apify leg ended without reaching otodom.pl: the reasons of `readApifyAnswer` except
 * `run_error`, which did reach it, and the two ends of a request that got no answer.
 */
export type ApifyFailure = ApifyAnswerFailure | "timeout" | "network";

/** What Apify said about the run itself, for the log: never its text. */
interface ApifyFacts {
  /** The HTTP status of Apify's answer; absent when no answer came. */
  apifyStatus?: number;
  /** Apify's own name for its error, e.g. `user-or-token-not-found`; a token, never a message. */
  apifyErrorType?: string;
}

/**
 * A leg that reached otodom.pl gives the direct fetch's own result — the same union, named by the
 * same checks, with `source: "apify"` on a failure's evidence — and one that did not reach it says
 * why. A `run_error` reached it: the run could not read the page, which reads as a refusal
 * (`http_denied`), with no status, because otodom's own status is not known.
 */
export type ApifyLegResult =
  | (FetchOfferResult & ApifyFacts & { reachedOtodom: true; apifyFailure?: "run_error" })
  | (ApifyFacts & { ok: false; reachedOtodom: false; apifyFailure: Exclude<ApifyFailure, "run_error"> });

export interface ApifyLeg {
  /** One run for `url` — always the output of `normalizeOfferUrl` — ended by `signal` at the latest. */
  fetchAd: (url: string, signal: AbortSignal) => Promise<ApifyLegResult>;
}

/**
 * The leg for one request, or `null` when the application has no token — the zero-config state,
 * in which nothing is sent to Apify. The token is read at the call, never kept at module scope.
 */
export function createApifyLeg(): ApifyLeg | null {
  const token = APIFY_TOKEN;
  if (!token) return null;
  return { fetchAd: (url, signal) => fetchAd(token, url, signal) };
}

async function fetchAd(token: string, url: string, signal: AbortSignal): Promise<ApifyLegResult> {
  const request = buildApifyRequest(url);
  const noReach = (apifyFailure: Exclude<ApifyFailure, "run_error">, facts: ApifyFacts = {}): ApifyLegResult => ({
    ok: false,
    reachedOtodom: false,
    apifyFailure,
    ...facts,
  });

  // Two narrow `try` blocks, one per I/O call, as in the direct fetch. The thrown value is never
  // kept: an error's message may quote the request.
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      signal,
    });
  } catch (error) {
    return noReach(isAbort(error, signal) ? "timeout" : "network");
  }

  const apifyStatus = response.status;
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return noReach(isAbort(error, signal) ? "timeout" : "network", { apifyStatus });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: nothing in it is read. `readApifyAnswer` names it by the status.
    json = undefined;
  }

  const answer = readApifyAnswer(apifyStatus, json, url);
  if (!answer.ok) {
    if (answer.apifyFailure === "run_error") {
      return {
        ok: false,
        reason: "http_denied",
        evidence: { source: "apify" },
        reachedOtodom: true,
        apifyFailure: "run_error",
        apifyStatus,
      };
    }
    const { apifyFailure, apifyErrorType } = answer;
    return noReach(apifyFailure, { apifyStatus, ...(apifyErrorType === undefined ? {} : { apifyErrorType }) });
  }

  const { item } = answer;
  // The same checks as a direct answer, from what the item knows. Apify does not pass on the
  // headers otodom sent, so `cf-mitigated`, `retry-after` and the content type are never fed.
  const { failure, answered } = classifyAnswer({ status: item.status, requestedUrl: url, landedUrl: item.loadedUrl });
  const fromApify = { ...answered, evidence: { ...answered.evidence, source: "apify" as const } };
  if (failure !== null) {
    return { ...failure, evidence: { ...failure.evidence, source: "apify" }, reachedOtodom: true, apifyStatus };
  }
  const result = classifyPayload(item, fromApify);
  return { ...result, reachedOtodom: true, apifyStatus };
}
