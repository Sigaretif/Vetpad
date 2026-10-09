import type { APIRoute } from "astro";
import {
  AUDIT_HEARTBEAT_MS,
  AUDIT_OUTCOME,
  AUDIT_PROVIDER_DEADLINE_MS,
  type AuditFailureReason,
  auditFailureMessage,
} from "@/lib/audit/failure";
import { groundFindings } from "@/lib/audit/grounding";
import { AUDIT_OFFER_COLUMNS, buildAuditInput, listingFingerprint, readAuditOffer } from "@/lib/audit/input";
import { buildAuditPrompt } from "@/lib/audit/prompt";
import { type AuditProvider, createAuditProvider } from "@/lib/audit/provider";
import { loadAuditSettings } from "@/lib/audit/settings";
import { type EndResult, type StoreFailure, claimAudit, completeAudit, failAudit } from "@/lib/audit/store";
import { loadAuditCriteria, type ReadFailure } from "@/lib/criteria";
import { type LogFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";

/** What a member watches an audit go through: the reads, the model call, the save. */
export type AuditStage = "reading" | "model" | "saving";

/**
 * One line of the answer. The body is NDJSON — one JSON object per line — written while the
 * audit runs. `alive` only says the request is still there. The last line is always `done` or
 * `failed`; a body that ends without one was cut off, and says nothing about how the audit ended.
 */
export type AuditStreamLine =
  | { type: "stage"; stage: AuditStage }
  | { type: "alive" }
  | { type: "done" }
  | { type: "failed"; reason: AuditFailureReason; message: string };

const STREAM_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" };

type Outcome = "started" | "completed" | "refused" | "failed";
type Fields = Omit<LogFields, "event" | "outcome">;

/** One entry per way out of the route, and one before the model is called. A failure is an error; everything else is info. */
function report(outcome: Outcome, fields: Fields): void {
  logEvent(outcome === "failed" ? "error" : "info", { event: "offer_audit", outcome, ...fields });
}

/** How an audit ended: stored (`reason: null`), or not, and why. `fields` is what the exit's log entry adds. */
interface Ending {
  reason: AuditFailureReason | null;
  fields: Fields;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "NonError";
}

/** What a failed Supabase call says about itself. `details` is never read: Postgres quotes the rejected row there. */
function dbFields(error: { code: string; message: string; hint: string }, status: number): Fields {
  return { db_code: error.code, db_message: error.message, db_hint: error.hint, db_status: status };
}

function storeFields(failure: StoreFailure): Fields {
  return {
    db_code: failure.dbCode,
    db_message: failure.dbMessage,
    db_hint: failure.dbHint,
    db_status: failure.dbStatus,
    error_name: failure.errorName,
  };
}

/** Why a read that stands before the claim failed: the step, and the database's code and status. */
function readFields(failure: ReadFailure | undefined): Fields {
  return {
    detail: failure?.detail,
    db_code: failure?.dbCode,
    db_status: failure?.dbStatus,
    error_name: failure?.errorName,
  };
}

/**
 * What the entry says when the attempt could not be marked `failed`: the row then stays `running`
 * until it reads as interrupted, and the reason the member was told is in this entry alone.
 */
function unmarked(marked: EndResult): Fields {
  if (marked.state === "saved") return {};
  if (marked.state === "claim_lost") return { detail: "attempt_taken_over" };
  return { detail: "attempt_not_marked", ...storeFields(marked) };
}

/** The part of the platform's execution context the route uses: keeping a promise alive past the response. */
interface ExecutionLifetime {
  waitUntil: (promise: Promise<unknown>) => void;
}

interface Attempt {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  /** The form's `offer_id` as sent; an unreadable form is an empty one. */
  offerId: string;
  /** Why the request could not be prepared, when it could not: the class of what was thrown. */
  unprepared?: string;
  send: (line: AuditStreamLine) => void;
}

/**
 * One audit, start to finish (FR-010, FR-011). Everything that can be checked for free is checked
 * before the offer's audit row is claimed, and the row is claimed before anything is paid for:
 *
 *   Supabase configured → offer id → offer → provider key → criteria → settings → claim →
 *   model call → grounding → save.
 *
 * The provider key stands after the offer, so an unknown offer gets the same answer whether or
 * not the environment has a key. Only the listing and the criteria reach the provider: the
 * request is `buildAuditPrompt(buildAuditInput(…))` and nothing else, and this route never reads
 * a member's note.
 *
 * Once the row is claimed, every way out ends the attempt in the database too — `completed`, or
 * `failed` with its reason — so an attempt is left `running` only when the route can no longer
 * write. `known` collects what the log entry of any exit should carry; it is filled as the facts
 * become known and never holds the listing, the criteria or anything the provider wrote.
 */
async function audit({ supabase, userId, offerId, unprepared, send }: Attempt, known: Fields): Promise<Ending> {
  const refuse = (reason: AuditFailureReason, fields: Fields): Ending => ({ reason, fields });

  if (!supabase) return refuse("unconfigured_supabase", { stage: "config" });
  if (unprepared !== undefined) return refuse("unexpected", { stage: "session", error_name: unprepared });
  // The value itself stays out of the entry: it is whatever the request carried.
  if (!isUuid(offerId)) return refuse("invalid_offer", { stage: "offer_id" });
  known.offer_id = offerId;

  send({ type: "stage", stage: "reading" });

  const read = await supabase.from("offers").select(AUDIT_OFFER_COLUMNS.join(", ")).eq("id", offerId).maybeSingle();
  if (read.error) {
    return refuse("offer_read_failed", {
      stage: "offer",
      detail: "query_failed",
      ...dbFields(read.error, read.status),
    });
  }
  // Deleted meanwhile, or never there: RLS lets every member read every offer, so no row is no offer.
  if (read.data === null) return refuse("offer_not_found", { stage: "offer" });
  const offer = readAuditOffer(read.data);
  // The row is there and does not read as an offer: this lasts until the row is fixed.
  if (offer === null) return refuse("offer_read_failed", { stage: "offer", detail: "row_unreadable" });

  const provider = createAuditProvider();
  if (!provider) return refuse("unconfigured_provider", { stage: "config" });

  const criteria = await loadAuditCriteria(supabase);
  if (criteria.state === "error") {
    return refuse("criteria_read_failed", { stage: "criteria", ...readFields(criteria.failure) });
  }

  const settings = await loadAuditSettings(supabase, userId);
  if (settings.state === "error") {
    return refuse("settings_read_failed", { stage: "settings", ...readFields(settings.failure) });
  }
  const { model, effort } = settings;

  // Built before the claim: a row that cannot be turned into a request must not hold the lock.
  const input = buildAuditInput(offer, criteria);
  const prompt = buildAuditPrompt(input);
  const fingerprint = await listingFingerprint(offer);
  Object.assign(known, {
    model,
    effort,
    criteria_revision: criteria.revision,
    listing_chars: offer.title.length + offer.description.length,
  } satisfies Fields);

  const claim = await claimAudit(supabase, offerId);
  if (claim.state === "busy") return refuse("busy", { stage: "claim" });
  if (claim.state === "error") {
    return refuse("claim_failed", { stage: "claim", detail: claim.step, ...storeFields(claim) });
  }
  const claimedAt = Date.now();
  const timed = (ending: Ending): Ending => ({
    ...ending,
    fields: { ...ending.fields, duration_ms: Date.now() - claimedAt },
  });

  try {
    // Written before the call, which may take minutes: a request the platform cuts short still leaves a trace.
    report("started", { ...known, stage: "provider" });
    send({ type: "stage", stage: "model" });
    const run = await callModel(provider, { model, effort, ...prompt }, send);
    const called: Fields = {
      provider_request_id: run.requestId,
      stop_reason: run.stopReason,
      input_tokens: run.usage.inputTokens,
      output_tokens: run.usage.outputTokens,
      stream_events: run.streamEvents,
    };
    if (!run.ok) {
      const marked = await failAudit(supabase, offerId, claim.startedAt, run.reason);
      return timed(
        refuse(run.reason, {
          ...unmarked(marked),
          ...called,
          stage: "provider",
          status: run.status,
          provider_error_type: run.errorType,
          provider_error_message: run.errorMessage,
          // The provider's failure names itself; the write's name stands only when the provider has none.
          ...(run.errorName === undefined ? {} : { error_name: run.errorName }),
        }),
      );
    }

    send({ type: "stage", stage: "saving" });
    const { findings, rejected, dropped } = groundFindings(run.output, input);
    const counted: Fields = {
      ...called,
      findings_count:
        findings.missing.length + findings.conditions.length + findings.costs.length + findings.red_flags.length,
      rejected_count: rejected,
      dropped_count: dropped,
    };
    const saved = await completeAudit(supabase, offerId, claim.startedAt, {
      findings,
      rejectedCount: rejected,
      model,
      effort,
      criteriaRevision: criteria.revision,
      listingFingerprint: fingerprint,
      hadLimits: Object.values(criteria.limits).some((limit) => limit !== null),
      requirementsCount: criteria.requirements.length,
    });
    if (saved.state === "saved") return timed({ reason: null, fields: { ...counted, stage: "save" } });
    // The row belongs to a newer attempt now: nothing of it is this request's to write.
    if (saved.state === "claim_lost") return timed(refuse("claim_lost", { ...counted, stage: "save" }));
    const marked = await failAudit(supabase, offerId, claim.startedAt, "save_failed");
    return timed(refuse("save_failed", { ...counted, ...unmarked(marked), ...storeFields(saved), stage: "save" }));
  } catch (error) {
    // Nothing above is meant to throw. If something did, the attempt still must not stay `running`.
    const marked = await failAudit(supabase, offerId, claim.startedAt, "unexpected");
    return timed(refuse("unexpected", { ...unmarked(marked), stage: "unexpected", error_name: errorName(error) }));
  }
}

/**
 * The model call under its deadline, with a sign of life written every few seconds while it
 * lasts. Both timers are cleared on every way out. The deadline is a timer and a controller of
 * the route's own rather than `AbortSignal.timeout`, so that it is cleared the moment the call
 * ends and a test can move it.
 */
async function callModel(
  provider: AuditProvider,
  request: Omit<Parameters<AuditProvider["runAudit"]>[0], "signal">,
  send: Attempt["send"],
) {
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, AUDIT_PROVIDER_DEADLINE_MS);
  const heartbeat = setInterval(() => {
    send({ type: "alive" });
  }, AUDIT_HEARTBEAT_MS);
  try {
    return await provider.runAudit({ ...request, signal: deadline.signal });
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
  }
}

/**
 * Runs an AI audit of a saved offer (FR-010) and answers with its progress as it goes. The first
 * endpoint an island drives with `fetch`: a form `POST` with one field, `offer_id`.
 *
 * No session redirects to sign-in, before anything else is looked at. Every other answer is `200`
 * with an NDJSON body (`AuditStreamLine`) whose last line is `done` or `failed` — a refusal and a
 * failure included, each with the reason and the sentence the card shows for it. The result
 * itself is not in the answer: it is stored in `offer_audits`, and the card reads it from there.
 *
 * The audit is a promise of its own, handed to the platform's `waitUntil`: a member who closes
 * the card does not stop it — the model call is paid for either way — and the platform lets it
 * run on for up to 30 seconds after the connection is gone.
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    report("refused", { stage: "auth", reason: "signed_out" });
    return context.redirect("/auth/signin");
  }

  // A cookie set once the response is on its way never reaches the browser: Astro warns about the
  // write and drops it, and has a path on which it throws instead — which would fail the database
  // call that triggered the write. The Supabase client writes a cookie whenever it refreshes the
  // session. So the session is settled now, while a write still gets out, and a refresh during
  // the audit — at its end, before the write of a paid result — stays in the client's memory.
  let responseLeft = false;
  const supabase = createClient(context.request.headers, {
    set(...write) {
      if (!responseLeft) context.cookies.set(...write);
    },
  });

  let offerId = "";
  let unprepared: string | undefined;
  try {
    if (supabase) await supabase.auth.getSession();
  } catch (error) {
    unprepared = errorName(error);
  }
  try {
    const sent = (await context.request.formData()).get("offer_id");
    if (typeof sent === "string") offerId = sent;
  } catch {
    // A body that is not a form (a hand-crafted request) names no offer: `invalid_offer`, never a 500.
  }

  const encoder = new TextEncoder();
  // The reader's side of the body. Closed by the member's browser, it takes no more lines — and
  // the audit goes on without it.
  let listening = true;
  let lines: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      lines = controller;
    },
    cancel() {
      listening = false;
    },
  });
  const send = (line: AuditStreamLine): void => {
    if (!listening) return;
    try {
      lines?.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
    } catch {
      // The stream was torn down under the write. The line has nowhere to go; the audit carries on.
      listening = false;
    }
  };

  const known: Fields = { user_id: user.id };
  const work = audit({ supabase, userId: user.id, offerId, unprepared, send }, known)
    .catch(
      // A throw before the claim: nothing was claimed and nothing was paid for.
      (error: unknown): Ending => ({
        reason: "unexpected",
        fields: { stage: "unexpected", error_name: errorName(error) },
      }),
    )
    .then(({ reason, fields }) => {
      if (reason === null) {
        report("completed", { ...known, ...fields });
        send({ type: "done" });
      } else {
        report(AUDIT_OUTCOME[reason], { ...known, ...fields, reason });
        send({ type: "failed", reason, message: auditFailureMessage(reason) });
      }
      if (listening) lines?.close();
    });

  // The adapter says `cfContext` is always there, and a test builds `locals` without it. Its
  // declared type, `ExecutionContext`, is one this project has no definition of, so the one method
  // used is named here.
  (context.locals as { cfContext?: ExecutionLifetime }).cfContext?.waitUntil(work);

  responseLeft = true;
  return new Response(body, { status: 200, headers: STREAM_HEADERS });
};
