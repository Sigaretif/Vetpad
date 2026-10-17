import type { ResolvedIngestionMode } from "@/lib/ingestion-settings";
import type { ApifyFailure, ApifyLeg, ApifyLegResult } from "./apify";
import { APIFY_CLIENT_DEADLINE_MS, DIRECT_BEFORE_FALLBACK_MS, INGEST_ACTION_BUDGET_MS } from "./deadlines";
import { fetchOfferAd } from "./fetch";
import { mapAdToOffer } from "./map";
import type {
  FetchEvidence,
  FetchFailureReason,
  FetchOfferResult,
  MapFailureReason,
  OfferInsert,
  UrlFailureReason,
} from "./types";
import { normalizeOfferUrl } from "./url";

export type { FetchEvidence, OfferImage, OfferInsert } from "./types";
export { normalizeOfferUrl } from "./url";

/**
 * Every way ingestion can refuse. The API route maps each one to a message in one place.
 * `extraction_failed` is the one reason no fetch names: in `apify_only`, the extraction service
 * never reached otodom.pl, so nothing is known about the listing.
 */
export type IngestFailureReason = UrlFailureReason | FetchFailureReason | MapFailureReason | "extraction_failed";

/**
 * Where ingestion refused. `shape_changed` comes from both the fetch and the mapper; only the
 * stage tells them apart.
 */
export type IngestStage = "url" | "fetch" | "map";

/** Which way the listing was fetched: directly from otodom.pl, or through the extraction service. */
export type IngestSource = "direct" | "apify";

/**
 * What the log is told about how the listing was fetched: which leg produced the outcome, why the
 * fallback ran, what Apify said about its run (never its words) and how long each leg took. Absent
 * for a refusal of the address, which fetched nothing.
 */
export interface IngestTrace {
  source?: IngestSource;
  /** The direct leg's reason that started the Apify leg; absent when no fallback ran. */
  fallbackReason?: FetchFailureReason;
  apifyStatus?: number;
  /** Apify's own token for its error, e.g. `user-or-token-not-found`. */
  apifyErrorType?: string;
  apifyFailure?: ApifyFailure;
  directDurationMs?: number;
  apifyDurationMs?: number;
}

/** `evidence` is what the fetch learned about the answer: present for the `fetch` stage alone. */
export type IngestResult =
  | ({ ok: true; url: string; offer: OfferInsert } & IngestTrace)
  | ({
      ok: false;
      stage: IngestStage;
      reason: IngestFailureReason;
      status?: number;
      detail?: string;
      evidence?: FetchEvidence;
    } & IngestTrace);

/**
 * The direct leg's reasons after which one Apify run follows in `direct_with_fallback`: a refusal
 * or a block of our own egress, or a page that came without the listing's data. Never a listing
 * that is gone, an outage of the portal, a landing nobody has seen or a changed page — Apify
 * would only pay to learn the same.
 */
export const FALLBACK_TRIGGERS: readonly FetchFailureReason[] = [
  "challenged",
  "http_denied",
  "timeout",
  "network",
  "data_missing",
];

function isFallbackTrigger(reason: FetchFailureReason): boolean {
  return FALLBACK_TRIGGERS.includes(reason);
}

/** A fetch's result, or the one failure no fetch names. */
export type LegOutcome = FetchOfferResult | { ok: false; reason: "extraction_failed"; evidence: FetchEvidence };

/** What `chooseOutcome` decided: the result the member's sentence comes from, and which leg it is. */
export interface ChosenOutcome {
  fetched: LegOutcome;
  source: IngestSource;
  fallbackReason?: FetchFailureReason;
}

/**
 * Which result the member reads once an Apify leg ran: after a direct fetch (`direct`, a failure
 * with a trigger reason) or alone (`direct` is `null`, `apify_only`). Pure.
 *
 * - An Apify leg that reached otodom.pl knows about the listing: its result wins. A page without
 *   data on both legs keeps `data_missing` with `detail: "both_sources"`.
 * - One that did not reach it knows nothing: the direct reason wins, or — with no direct leg —
 *   `extraction_failed`.
 */
export function chooseOutcome(direct: FetchOfferResult | null, apify: ApifyLegResult): ChosenOutcome {
  const fallbackReason = direct !== null && !direct.ok ? direct.reason : undefined;
  const after = fallbackReason === undefined ? {} : { fallbackReason };

  if (apify.reachedOtodom) {
    let fetched: FetchOfferResult;
    if (apify.ok) {
      fetched = { ok: true, ad: apify.ad };
    } else {
      const bothMissing = apify.reason === "data_missing" && fallbackReason === "data_missing";
      const detail = bothMissing ? "both_sources" : apify.detail;
      fetched = {
        ok: false,
        reason: apify.reason,
        ...(apify.status === undefined ? {} : { status: apify.status }),
        ...(detail === undefined ? {} : { detail }),
        evidence: apify.evidence,
      };
    }
    return { fetched, source: "apify", ...after };
  }

  if (direct !== null) return { fetched: direct, source: "direct", ...after };
  return { fetched: { ok: false, reason: "extraction_failed", evidence: { source: "apify" } }, source: "apify" };
}

/**
 * One leg's deadline: a controller of its own and a timer that aborts it with a `TimeoutError`, so
 * the fetch reads the end as `timeout`. `clear` stops the timer the moment the leg ends — no timer
 * outlives the action — and a test can move it. Not `AbortSignal.timeout`, for both reasons (the
 * pattern of `callModel` in src/pages/api/audits.ts).
 */
function legDeadline(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

async function directLeg(url: string, ms: number): Promise<{ result: FetchOfferResult; durationMs: number }> {
  const deadline = legDeadline(ms);
  const start = Date.now();
  try {
    const result = await fetchOfferAd(url, deadline.signal);
    return { result, durationMs: Date.now() - start };
  } finally {
    deadline.clear();
  }
}

async function apifyLeg(leg: ApifyLeg, url: string): Promise<{ result: ApifyLegResult; durationMs: number }> {
  const deadline = legDeadline(APIFY_CLIENT_DEADLINE_MS);
  const start = Date.now();
  try {
    const result = await leg.fetchAd(url, deadline.signal);
    return { result, durationMs: Date.now() - start };
  } finally {
    deadline.clear();
  }
}

/** What an Apify leg's result tells the log, and nothing else of it. */
function apifyTrace(result: ApifyLegResult, durationMs: number): IngestTrace {
  return {
    ...(result.apifyStatus === undefined ? {} : { apifyStatus: result.apifyStatus }),
    ...(result.apifyErrorType === undefined ? {} : { apifyErrorType: result.apifyErrorType }),
    ...(result.apifyFailure === undefined ? {} : { apifyFailure: result.apifyFailure }),
    apifyDurationMs: durationMs,
  };
}

/** The listing fetched the way `mode` says, with the trace of every leg that ran. */
async function fetchListing(
  url: string,
  effective: ResolvedIngestionMode["effective"],
  apify: ApifyLeg | null,
): Promise<{ fetched: LegOutcome; trace: IngestTrace }> {
  // A mode that needs the extraction service and has no leg runs as `direct_only`: nothing is
  // sent to a service the request cannot pay for.
  if (apify === null || effective === "direct_only") {
    const direct = await directLeg(url, INGEST_ACTION_BUDGET_MS);
    return { fetched: direct.result, trace: { source: "direct", directDurationMs: direct.durationMs } };
  }

  if (effective === "apify_only") {
    const run = await apifyLeg(apify, url);
    const chosen = chooseOutcome(null, run.result);
    return { fetched: chosen.fetched, trace: { source: chosen.source, ...apifyTrace(run.result, run.durationMs) } };
  }

  // `direct_with_fallback`. The direct leg's timer is cleared before the Apify leg starts, so a
  // direct timeout never eats into Apify's own deadline.
  const direct = await directLeg(url, DIRECT_BEFORE_FALLBACK_MS);
  if (direct.result.ok || !isFallbackTrigger(direct.result.reason)) {
    return { fetched: direct.result, trace: { source: "direct", directDurationMs: direct.durationMs } };
  }
  const run = await apifyLeg(apify, url);
  const chosen = chooseOutcome(direct.result, run.result);
  return {
    fetched: chosen.fetched,
    trace: {
      source: chosen.source,
      ...(chosen.fallbackReason === undefined ? {} : { fallbackReason: chosen.fallbackReason }),
      ...apifyTrace(run.result, run.durationMs),
      directDurationMs: direct.durationMs,
    },
  };
}

/**
 * Pasted URL to a mapped offer row: normalise, fetch the way the effective mode says, gate and
 * map. Knows nothing about Supabase or the app's HTTP layer; the caller adds `source_url` (the
 * returned `url`) and `created_by` before inserting. Every deadline is made here, from
 * `./deadlines`: the whole budget for a direct fetch nothing can follow, a shorter one when an
 * Apify run may follow it, and the Apify run's own. At most one Apify run — never a retry.
 */
export async function ingestOffer(
  rawUrl: string,
  { mode, apify }: { mode: ResolvedIngestionMode; apify: ApifyLeg | null },
): Promise<IngestResult> {
  const normalized = normalizeOfferUrl(rawUrl);
  if (!normalized.ok) return { ...normalized, stage: "url" };

  const { fetched, trace } = await fetchListing(normalized.url, mode.effective, apify);
  if (!fetched.ok) return { ...fetched, stage: "fetch", ...trace };

  // The same mapper on whichever leg returned an `ad`.
  const mapped = mapAdToOffer(fetched.ad);
  if (!mapped.ok) return { ...mapped, stage: "map", ...trace };

  return { ok: true, url: normalized.url, offer: mapped.offer, ...trace };
}
