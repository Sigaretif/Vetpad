// Every write to `public.offer_audits` (FR-010): taking an offer's row for a new attempt, storing
// the attempt's result, and marking the attempt failed. The triggers in
// supabase/migrations/20261007073300_create_offer_audits.sql own the dates, the people and the
// allowed moves; this module only asks, and reads the answer two ways — by the error's code and
// by the number of rows the write reached. A write row-level security or another attempt turned
// away answers `200` with no rows, exactly like a write that had nothing to do.
//
// The row is the lock. Of two requests to audit one offer, the database lets one through
// (`VP001` for the other), so the route claims the row before anything is paid for. A claim is
// named by the `run_started_at` the database gave it: the two writes that end an attempt reach
// the row only while it is still that attempt's — `running`, with that very start. A request
// that outlived its 175 seconds and was taken over therefore writes nothing over the newer attempt.
//
// No function here throws: an exception from the client is a failed write like any other.
// `@/lib/supabase` enters only through `import type`.

import type { AuditFailureReason } from "@/lib/audit/failure";
import type { StoredFindings } from "@/lib/audit/schema";
import type { AuditEffort, AuditModel } from "@/lib/audit/settings";
import type { createClient } from "@/lib/supabase";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const TABLE = "offer_audits";

/** An offer's row already exists: its second and later attempts are updates. */
const UNIQUE_VIOLATION = "23505";

/** The table's own SQLSTATE: an attempt started less than 175 seconds ago is still running. */
const AUDIT_RUNNING = "VP001";

/** What a failed write says about itself, for a log entry. `details` is never read: Postgres quotes the row there. */
export interface StoreFailure {
  dbCode?: string;
  dbMessage?: string;
  dbHint?: string;
  dbStatus?: number;
  /** The class of what the client threw, when it threw instead of answering. */
  errorName?: string;
}

function answered(error: { code: string; message: string; hint: string }, status: number): StoreFailure {
  return { dbCode: error.code, dbMessage: error.message, dbHint: error.hint, dbStatus: status };
}

function threw(error: unknown): StoreFailure {
  return { errorName: error instanceof Error ? error.name : "NonError" };
}

export type ClaimResult =
  | { state: "claimed"; /** `run_started_at` as the database set it: the name of this attempt. */ startedAt: string }
  | { state: "busy" }
  | ({ state: "error"; /** Which of the two writes failed. */ step: "insert" | "takeover" } & StoreFailure);

/** The start of the attempt from the one row a claim writes, or `null` when the answer is not that row. */
function startedAt(rows: unknown): string | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row: unknown = rows[0];
  const value = typeof row === "object" && row !== null ? (row as Record<string, unknown>).run_started_at : undefined;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Takes the offer's audit row for a new attempt, as the member whose session the client carries.
 *
 * The first attempt is an insert. A row that is already there (`23505`) is taken over with an
 * update to `running`, which the trigger refuses with `VP001` while an attempt younger than 175
 * seconds holds the row — `busy`, the answer that keeps a second paid call from being made. Any
 * other error, an answer without the row (the offer vanished, or the session did), or an
 * exception is `error`: nothing was claimed and the caller must not call the provider.
 */
export async function claimAudit(supabase: SupabaseClient, offerId: string): Promise<ClaimResult> {
  let step: "insert" | "takeover" = "insert";
  try {
    const inserted = await supabase
      .from(TABLE)
      .insert({ offer_id: offerId, run_state: "running" })
      .select("run_started_at");
    if (!inserted.error) {
      const started = startedAt(inserted.data);
      return started === null
        ? { state: "error", step, dbStatus: inserted.status }
        : { state: "claimed", startedAt: started };
    }
    if (inserted.error.code !== UNIQUE_VIOLATION) {
      return { state: "error", step, ...answered(inserted.error, inserted.status) };
    }

    step = "takeover";
    const taken = await supabase
      .from(TABLE)
      .update({ run_state: "running" })
      .eq("offer_id", offerId)
      .select("run_started_at");
    if (taken.error) {
      if (taken.error.code === AUDIT_RUNNING) return { state: "busy" };
      return { state: "error", step, ...answered(taken.error, taken.status) };
    }
    const started = startedAt(taken.data);
    return started === null
      ? { state: "error", step, dbStatus: taken.status }
      : { state: "claimed", startedAt: started };
  } catch (error) {
    return { state: "error", step, ...threw(error) };
  }
}

/** Everything a completed audit stores; the trigger refuses a result with a part missing. */
export interface AuditResult {
  findings: StoredFindings;
  /** Positive findings turned away because their excerpt is not the listing's text. */
  rejectedCount: number;
  model: AuditModel;
  effort: AuditEffort;
  /** `criteria_revision.revision` the criteria were read under. */
  criteriaRevision: number;
  listingFingerprint: string;
  hadLimits: boolean;
  requirementsCount: number;
}

/**
 * How a write that ends an attempt went. `claim_lost`: the write reached no row — the row is no
 * longer this attempt's, because another attempt took it over (or the offer is gone). That is
 * not a failed write and is never retried.
 */
export type EndResult =
  { state: "saved" } | { state: "claim_lost" } | ({ state: "error"; attempts: number } & StoreFailure);

type WriteOutcome = { state: "saved" } | { state: "claim_lost" } | ({ state: "failed" } & StoreFailure);

/** One update of the row, reaching it only while it is still the attempt that started at `startedAt`. */
async function endAttempt(
  supabase: SupabaseClient,
  offerId: string,
  claimedAt: string,
  values: Record<string, unknown>,
): Promise<WriteOutcome> {
  try {
    const written = await supabase
      .from(TABLE)
      .update(values)
      .eq("offer_id", offerId)
      .eq("run_state", "running")
      .eq("run_started_at", claimedAt)
      .select("offer_id");
    if (written.error) return { state: "failed", ...answered(written.error, written.status) };
    // The key is the offer, so the write reaches one row or none.
    if (!Array.isArray(written.data)) return { state: "failed", dbStatus: written.status };
    return written.data.length === 1 ? { state: "saved" } : { state: "claim_lost" };
  } catch (error) {
    return { state: "failed", ...threw(error) };
  }
}

/** How many times the result is written before the save is given up: the model has been paid for by then. */
const SAVE_ATTEMPTS = 2;

/**
 * Stores the result of the attempt that started at `claimedAt` and ends it as `completed`. The
 * date and the auditor are the trigger's: now, and the member who started the attempt.
 *
 * A write that fails — an error from the database, or no answer — is tried once more: by now the
 * model has answered and been paid for, and the result exists nowhere else. A write that reached
 * no row is `claim_lost` at once. After the second failure the answer is `error`, carrying what
 * the last write said.
 */
export async function completeAudit(
  supabase: SupabaseClient,
  offerId: string,
  claimedAt: string,
  result: AuditResult,
): Promise<EndResult> {
  const values = {
    run_state: "completed",
    findings: result.findings,
    rejected_count: result.rejectedCount,
    model: result.model,
    effort: result.effort,
    criteria_revision: result.criteriaRevision,
    listing_fingerprint: result.listingFingerprint,
    had_limits: result.hadLimits,
    requirements_count: result.requirementsCount,
  };
  let last: StoreFailure = {};
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt += 1) {
    const { state, ...failure } = await endAttempt(supabase, offerId, claimedAt, values);
    if (state !== "failed") return { state };
    last = failure;
  }
  return { state: "error", attempts: SAVE_ATTEMPTS, ...last };
}

/**
 * Ends the attempt that started at `claimedAt` as `failed`, with the reason the card will show.
 * The previous result, if the offer has one, stays as it was — the trigger keeps it. Written
 * once: a failed attempt that could not be marked reads as interrupted after 175 seconds anyway.
 */
export async function failAudit(
  supabase: SupabaseClient,
  offerId: string,
  claimedAt: string,
  reason: AuditFailureReason,
): Promise<EndResult> {
  const { state, ...failure } = await endAttempt(supabase, offerId, claimedAt, {
    run_state: "failed",
    run_failure: reason,
  });
  return state === "failed" ? { state: "error", attempts: 1, ...failure } : { state };
}
