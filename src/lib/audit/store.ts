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
//
// The two reads at the end are what the views show: `loadOfferAudit` for the offer card and
// `loadAuditIndex` for the board. Neither ever answers "not audited" for a read that failed.
// Nothing here imports the provider or its SDK, so a card or a board render never loads them.

import {
  AUDIT_STALE_ATTEMPT_MS,
  type AuditFailureReason,
  auditFailureMessage,
  isAuditFailureReason,
} from "@/lib/audit/failure";
import { type StoredFindings, readFindings } from "@/lib/audit/schema";
import type { AuditEffort, AuditModel } from "@/lib/audit/settings";
import { type Saver, resolveAuthors } from "@/lib/members";
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

/**
 * Whether the row already holds the result of the attempt that started at `claimedAt`: it is
 * `completed`, and its start is that attempt's. Asked only after a write that failed, when the
 * next one reached no row — the first may have been stored with its answer lost on the way back.
 * A read that fails, or finds anything else, is `false`: the claim is then lost as far as anyone
 * can tell.
 */
async function storedAlready(supabase: SupabaseClient, offerId: string, claimedAt: string): Promise<boolean> {
  try {
    const read = await supabase.from(TABLE).select("run_state, run_started_at").eq("offer_id", offerId);
    if (read.error || !Array.isArray(read.data) || read.data.length !== 1) return false;
    const row = read.data[0] as Record<string, unknown>;
    return row.run_state === "completed" && row.run_started_at === claimedAt;
  } catch {
    return false;
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
 * no row is `claim_lost` at once — unless it follows a write that failed: that one may have been
 * stored and only its answer lost, so the row is read, and a row that holds this attempt's result
 * is `saved`. After the second failure the answer is `error`, carrying what the last write said.
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
    if (state === "claim_lost" && attempt > 1 && (await storedAlready(supabase, offerId, claimedAt))) {
      return { state: "saved" };
    }
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

// Reads for the views.

/**
 * The offer's latest attempt, as the card tells it. `none`: nothing to tell — the offer has no
 * row, or its last attempt completed and is the result itself. `interrupted`: the row says
 * `running`, and has for `AUDIT_STALE_ATTEMPT_MS` or longer — the request behind it is gone, and
 * the database lets another attempt take the row over.
 */
export type AuditAttempt =
  | { kind: "none" }
  | { kind: "running"; /** `run_started_at` as stored. */ startedAt: string; startedBy: Saver }
  | {
      kind: "failed";
      /** `run_failure` when it is a reason this version knows; `null` for any other text. */
      reason: AuditFailureReason | null;
      /** The sentence for the reason, or `AUDIT_FAILURE_UNNAMED`: no cause is invented for an unknown one. */
      message: string;
    }
  | { kind: "interrupted" };

/** What the card says about a failed attempt whose stored reason this version does not know. */
export const AUDIT_FAILURE_UNNAMED =
  "Ostatnia próba audytu nie powiodła się, a aplikacja nie rozpoznaje zapisanej przyczyny.";

/** The last audit that succeeded, as the card shows it. */
export interface StoredAudit {
  findings: StoredFindings;
  /** Positive findings left out because their excerpt was not found in the listing. */
  rejectedCount: number;
  auditedAt: string;
  auditedBy: Saver;
  /**
   * The model and the effort as stored — a record of what produced the findings, not a setting.
   * Kept as text: an audit made with an option the lists no longer hold must still be readable,
   * and the card shows such a value as it stands.
   */
  model: string;
  effort: string;
  hadLimits: boolean;
  requirementsCount: number;
}

/**
 * An offer's audit, or a failed read — which is never shown as "not audited". With `ok`, the
 * attempt and the result are independent: a failed or interrupted re-run stands beside the result
 * it did not replace, and so does one that is still running.
 *
 * `broken` is neither: the row was read and its attempt reads, but the result it holds does not —
 * findings of a version this code does not know, a count that is not one, a `completed` row with
 * nothing in it. There is nothing to show, and nothing a new audit could pay for twice, so the
 * card says so and offers the run that replaces it; an audit has no delete, and a card with no
 * button would leave the offer unauditable for good.
 */
export type OfferAudit =
  | { state: "error" }
  | { state: "broken"; attempt: AuditAttempt }
  | { state: "ok"; attempt: AuditAttempt; result: StoredAudit | null };

/** Everything the card reads. `criteria_revision` and `listing_fingerprint` are S-09's, and are not shown. */
const VIEW_COLUMNS =
  "run_state, run_started_at, run_started_by, run_failure, findings, rejected_count, audited_at, audited_by, model, effort, had_limits, requirements_count";

function isReadableDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** A person column: a member's id, or `null` for a deleted account. Anything else does not read. */
function isPerson(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value !== "");
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

type RowAttempt =
  | { kind: "none" }
  | { kind: "running"; startedAt: string; startedBy: string | null }
  | Extract<AuditAttempt, { kind: "failed" | "interrupted" }>;

/** The attempt columns of a row, or `null` when they do not read. The clock comes from the caller. */
function readAttempt(row: Record<string, unknown>, now: Date): RowAttempt | null {
  const { run_state: state, run_started_at: startedAt, run_started_by: startedBy, run_failure: failure } = row;
  if (!isReadableDate(startedAt) || !isPerson(startedBy)) return null;
  switch (state) {
    case "completed":
      return { kind: "none" };
    case "failed": {
      const reason = isAuditFailureReason(failure) ? failure : null;
      return { kind: "failed", reason, message: reason === null ? AUDIT_FAILURE_UNNAMED : auditFailureMessage(reason) };
    }
    case "running":
      // The same line the database draws: an attempt is protected while it is younger than the threshold.
      return now.getTime() - Date.parse(startedAt) >= AUDIT_STALE_ATTEMPT_MS
        ? { kind: "interrupted" }
        : { kind: "running", startedAt, startedBy };
    default:
      return null;
  }
}

type RowResult = Omit<StoredAudit, "auditedBy"> & { auditedBy: string | null };

/**
 * The result columns of a row: `null` for an offer never audited (every column empty),
 * `undefined` when they do not read — half a result, findings `readFindings` turns away, a count
 * that is not one, a date that is not one. The table's check keeps a result whole or absent; the
 * row is still not trusted to be either.
 */
function readResult(row: Record<string, unknown>): RowResult | null | undefined {
  const {
    findings: stored,
    rejected_count: rejectedCount,
    audited_at: auditedAt,
    audited_by: auditedBy,
    model,
    effort,
    had_limits: hadLimits,
    requirements_count: requirementsCount,
  } = row;
  if (!isPerson(auditedBy)) return undefined;
  const columns = [stored, rejectedCount, auditedAt, model, effort, hadLimits, requirementsCount];
  // `audited_by` stays out of the count: a deleted account leaves it empty beside a whole result.
  if (columns.every((value) => value === null) && auditedBy === null) return null;

  const findings = readFindings(stored);
  if (findings === null) return undefined;
  if (!isCount(rejectedCount) || !isCount(requirementsCount) || !isReadableDate(auditedAt)) return undefined;
  if (!isText(model) || !isText(effort) || typeof hadLimits !== "boolean") return undefined;
  return { findings, rejectedCount, auditedAt, auditedBy, model, effort, hadLimits, requirementsCount };
}

/**
 * The offer's audit for its card: the latest attempt and the last result that succeeded, with the
 * people named as the viewer should read them. `now` is the moment of the view — there is no
 * clock in here — and decides one thing: a `running` attempt that started `AUDIT_STALE_ATTEMPT_MS`
 * ago or earlier reads as `interrupted`.
 *
 * An offer without a row is `attempt: none, result: null`: never audited, and never tried. That
 * answer is given for a read that succeeded and found no row, and for nothing else. No client (the
 * zero-config state), a failed query, an answer that is not the offer's one row, an unknown
 * `run_state`, an attempt's date that is not one or a starter that is not an id is
 * `{ state: "error" }` — never "not audited". A row whose attempt reads and whose result does not —
 * findings `readFindings` turns away, half a result, a `completed` row without one — is `broken`,
 * with the attempt as read.
 *
 * The people are read with one `resolveAuthors` query, and only those the card will name: who
 * started an attempt that is still running, and who made the stored result. A failed read of
 * their names leaves them `unknown` and the audit readable. Never throws.
 */
export async function loadOfferAudit(
  supabase: SupabaseClient | null,
  offerId: string,
  viewerId: string | undefined,
  now: Date,
): Promise<OfferAudit> {
  if (!supabase) return { state: "error" };
  try {
    // No `maybeSingle()`: it would turn an answer that is not a list into "no row".
    const read = await supabase.from(TABLE).select(VIEW_COLUMNS).eq("offer_id", offerId);
    if (read.error || !Array.isArray(read.data)) return { state: "error" };
    const rows = read.data as unknown[];
    if (rows.length === 0) return { state: "ok", attempt: { kind: "none" }, result: null };
    const [row] = rows;
    // The key is the offer, so a second row is an answer to another question.
    if (rows.length !== 1 || typeof row !== "object" || row === null) return { state: "error" };

    const columns = row as Record<string, unknown>;
    const attempt = readAttempt(columns, now);
    if (attempt === null) return { state: "error" };
    const result = readResult(columns);
    // `completed` is the state of a row that holds its result; one without it does not read either.
    const broken = result === undefined || (columns.run_state === "completed" && result === null);

    const starter = attempt.kind === "running" ? [attempt.startedBy] : [];
    const auditor = broken || result === null ? [] : [result.auditedBy];
    // `resolveAuthors` answers in the order of its input: the starter, when asked for, comes first.
    const people = await resolveAuthors(supabase, [...starter, ...auditor], viewerId);
    const named = attempt.kind === "running" ? { ...attempt, startedBy: people[0] } : attempt;

    if (broken) return { state: "broken", attempt: named };
    return {
      state: "ok",
      attempt: named,
      result: result === null ? null : { ...result, auditedBy: people[starter.length] },
    };
  } catch {
    return { state: "error" };
  }
}

/** What the card's `data-audit-state` says. */
export type AuditDataState = "none" | "running" | "done" | "failed" | "broken" | "error";

/**
 * One word for an offer's audit, for the card's `data-audit-state` — where `scripts/smoke.mjs`
 * and the render tests read it. It describes the audit's data and nothing else: whether a
 * provider key exists is `data-audit-available`, and never changes this value.
 *
 * The latest attempt speaks first, the stored result only when the attempt has nothing to say:
 *
 * - `error`   the read failed;
 * - `running` an attempt is in progress — with or without an earlier result beside it;
 * - `failed`  the latest attempt failed or was interrupted — with or without an earlier result
 *             beside it, which the card still shows;
 * - `broken`  a stored result that does not read, and no attempt after it;
 * - `done`    a stored result, and no attempt after it;
 * - `none`    no result and no attempt: the offer was never audited.
 */
export function auditDataState(audit: OfferAudit): AuditDataState {
  if (audit.state === "error") return "error";
  switch (audit.attempt.kind) {
    case "running":
      return "running";
    case "failed":
    case "interrupted":
      return "failed";
    case "none":
      if (audit.state === "broken") return "broken";
      return audit.result === null ? "none" : "done";
    default: {
      const unhandled: never = audit.attempt;
      return unhandled;
    }
  }
}

/**
 * Which offers have a stored audit result, or a failed read — which the board shows as "could not
 * check", never as "not audited". An attempt alone (running, failed, interrupted) puts no offer in
 * the set: the set answers whether there are findings to read.
 */
export type AuditIndex = { ok: true; audited: ReadonlySet<string> } | { ok: false };

/**
 * The ids of every offer whose row holds a result, read once per board. No client (the
 * zero-config state), a failed query, an answer that is not a list of rows with an offer id, or
 * an exception is `{ ok: false }` — never an empty set. Never throws.
 */
export async function loadAuditIndex(supabase: SupabaseClient | null): Promise<AuditIndex> {
  if (!supabase) return { ok: false };
  try {
    const read = await supabase.from(TABLE).select("offer_id").not("findings", "is", null);
    if (read.error || !Array.isArray(read.data)) return { ok: false };
    const audited = new Set<string>();
    for (const row of read.data as unknown[]) {
      const id = typeof row === "object" && row !== null ? (row as Record<string, unknown>).offer_id : undefined;
      if (typeof id !== "string" || id === "") return { ok: false };
      audited.add(id);
    }
    return { ok: true, audited };
  } catch {
    return { ok: false };
  }
}
