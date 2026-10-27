import type { APIRoute } from "astro";
import { nextWorkingDayAt8Warsaw } from "@/lib/commute/departure";
import {
  COMMUTE_CALL_DEADLINE_MS,
  COMMUTE_OUTCOME,
  type CommuteFailureReason,
  commuteFailureMessage,
} from "@/lib/commute/failure";
import { type RouteCallResult, type RoutesClient, createRoutesClient } from "@/lib/commute/google";
import { COMMUTE_OFFER_COLUMNS, type CommuteOrigin, commuteOrigin, readCommuteOffer } from "@/lib/commute/origin";
import { type CommuteCalls, type CommuteRow, decideCommuteOutcome } from "@/lib/commute/outcome";
import { COMMUTE_POINTS_MAX, type CommutePoint, loadCommutePoints } from "@/lib/commute/points";
import { reserveCommuteCalls } from "@/lib/commute/usage";
import { type LogFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";

/** What a calculation hands the card: nothing of it is stored anywhere, and it holds no point's address. */
export interface CommuteResult {
  /** The public-transport departure: the first working day after today, at 08:00 Warsaw time. */
  departure: { date: string; time: "08:00" };
  /** Which start the routes left from — the offer's coordinates, or its location label and street. */
  origin: CommuteOrigin["kind"];
  /** One row per point, in the team's order: the name and the two cells; the route's line lives inside a route cell. */
  rows: CommuteRow[];
}

/**
 * One line of the answer: NDJSON, one JSON object per line. `stage: "routing"` is written once the
 * calls to Google are on their way. The last line is always `done` or `failed`; a body that ends
 * without one was cut off, and says nothing about how the calculation ended. The island's typing
 * contract — imported there only through `import type`.
 */
export type CommuteStreamLine =
  | { type: "stage"; stage: "routing" }
  | { type: "done"; result: CommuteResult }
  | { type: "failed"; reason: CommuteFailureReason; message: string };

const STREAM_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" };

type Outcome = "started" | "completed" | "refused" | "failed";
type Fields = Omit<LogFields, "event" | "outcome">;

/** One entry per way out of the route, and one before Google is called. A failure is an error; everything else is info. */
function report(outcome: Outcome, fields: Fields): void {
  logEvent(outcome === "failed" ? "error" : "info", { event: "offer_commute", outcome, ...fields });
}

/** How a calculation ended: a result, or a reason. `outcome` overrides the reason's own class where a read failed. */
type Ending =
  { result: CommuteResult; fields: Fields } | { reason: CommuteFailureReason; fields: Fields; outcome?: "failed" };

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "NonError";
}

/** The part of the platform's execution context the route uses: keeping a promise alive past the response. */
interface ExecutionLifetime {
  waitUntil: (promise: Promise<unknown>) => void;
}

interface Attempt {
  supabase: ReturnType<typeof createClient>;
  /** The form's `offer_id` as sent; an unreadable form is an empty one. */
  offerId: string;
  send: (line: CommuteStreamLine) => void;
}

/**
 * Both calls of every point at once, under one deadline: the calls start together, so one timer at
 * `COMMUTE_CALL_DEADLINE_MS` ends each of them where its own would. A timer and a controller of the
 * route's own rather than `AbortSignal.timeout`, so that it is cleared the moment the last call
 * ends and a test can move it. No call is retried: `computeRoute` makes one request and never throws.
 */
async function callRoutes(
  routes: RoutesClient,
  origin: CommuteOrigin,
  points: readonly CommutePoint[],
  departureTime: string,
): Promise<CommuteCalls[]> {
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort();
  }, COMMUTE_CALL_DEADLINE_MS);
  const call = (destinationAddress: string, mode: "TRANSIT" | "DRIVE"): Promise<RouteCallResult> =>
    routes.computeRoute({
      origin,
      destinationAddress,
      mode,
      ...(mode === "TRANSIT" ? { departureTime } : {}),
      signal: deadline.signal,
    });
  try {
    return await Promise.all(
      points.map(async (point): Promise<CommuteCalls> => {
        const [transit, drive] = await Promise.all([call(point.address, "TRANSIT"), call(point.address, "DRIVE")]);
        return { transit, drive };
      }),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** The cells of a result, counted for the log entry: routes, no route, a rejected address. Never a value of one. */
function counted(rows: readonly CommuteRow[]): Fields {
  const cells = rows.flatMap((row) => [row.transit, row.drive]);
  return {
    commute_routes: cells.filter((cell) => cell.kind === "route").length,
    commute_no_route: cells.filter((cell) => cell.kind === "no_route").length,
    commute_address_rejected: cells.filter((cell) => cell.kind === "address_rejected").length,
  };
}

/**
 * One calculation, start to finish (FR-016). Everything that can be checked for free is checked
 * before anything is spent, and the day's allowance is reserved before anything reaches Google:
 *
 *   offer id → offer → not archived → a start → points → Google key → reservation → 2N calls → outcome.
 *
 * The key stands after every free refusal, so an unknown offer gets the same answer whether or not
 * the application has a key, and an unconfigured application never touches the counter. The
 * reservation stands where the audit claims its row: the counter never lets a call through on
 * doubt, and a reservation is never given back — calls Google failed, rejected or never answered
 * stay counted.
 *
 * Only a point's address and the offer's start reach Google, and nothing of it reaches the log: an
 * entry carries counts, kinds and Google's status tokens. This route never reads a member's note
 * (`commuteNoNotesConfig` in eslint.config.js), and it writes nothing but the reservation.
 */
async function calculate({ supabase, offerId, send }: Attempt, known: Fields): Promise<Ending> {
  const refuse = (reason: CommuteFailureReason, fields: Fields, outcome?: "failed"): Ending => ({
    reason,
    fields,
    outcome,
  });

  // The value itself stays out of the entry: it is whatever the request carried.
  if (!isUuid(offerId)) return refuse("offer_not_found", { stage: "offer_id" });
  // Without a database there is no offer and no point to read. Unreachable behind the middleware,
  // which resolves no member without Supabase; the zero-config state's answer all the same.
  if (!supabase) return refuse("not_configured", { stage: "config", detail: "supabase" });
  known.offer_id = offerId;

  const read = await supabase
    .from("offers")
    .select(COMMUTE_OFFER_COLUMNS.join(", "))
    .eq("id", offerId)
    .maybeSingle<Record<string, unknown>>();
  if (read.error) {
    // A failed read is its own state, never "no such offer". `message` and `details` are never read —
    // Postgres can quote the row there.
    return refuse(
      "offer_unreadable",
      { stage: "offer", detail: "query_failed", db_code: read.error.code, db_status: read.status },
      "failed",
    );
  }
  // Deleted meanwhile, or never there: RLS lets every member read every offer, so no row is no offer.
  if (read.data === null) return refuse("offer_not_found", { stage: "offer" });
  const offer = readCommuteOffer(read.data);
  // The row is there and does not read as an offer — whether it is archived could not be told.
  if (offer === null) return refuse("offer_unreadable", { stage: "offer", detail: "row_unreadable" }, "failed");
  if (offer.archivedAt !== null) return refuse("offer_archived", { stage: "offer" });
  const origin = commuteOrigin(offer);
  if (origin === null) return refuse("no_origin", { stage: "origin" });
  known.commute_origin = origin.kind;

  const loaded = await loadCommutePoints(supabase);
  if (loaded.state === "error") return refuse("points_unreadable", { stage: "points" });
  const { points } = loaded;
  known.commute_points = points.length;
  if (points.length === 0) return refuse("no_points", { stage: "points" });
  // The table's trigger caps the team at six; a seventh row is never sent to Google, whatever let it in.
  if (points.length > COMMUTE_POINTS_MAX) return refuse("too_many_points", { stage: "points" });

  const routes = createRoutesClient();
  if (!routes) return refuse("not_configured", { stage: "config" });

  const calls = points.length * 2;
  known.commute_calls_reserved = calls;
  const reservation = await reserveCommuteCalls(supabase, calls);
  if (reservation.kind === "limit") return refuse("daily_limit", { stage: "usage" });
  if (reservation.kind === "failed") {
    return refuse("usage_unavailable", { stage: "usage", db_code: reservation.dbCode ?? undefined });
  }
  known.commute_usage_total = reservation.total;

  // Written before the calls: a request the platform cuts short still leaves a trace of what was reserved.
  report("started", { ...known, stage: "routing" });
  send({ type: "stage", stage: "routing" });

  const departure = nextWorkingDayAt8Warsaw(new Date());
  const startedAt = Date.now();
  const answers = await callRoutes(routes, origin, points, departure.rfc3339);
  const timing: Fields = { stage: "routing", commute_duration_ms: Date.now() - startedAt };

  const outcome = decideCommuteOutcome(points, answers);
  if (outcome.kind === "failed") {
    return refuse(outcome.reason, {
      ...timing,
      point_index: outcome.call?.pointIndex,
      commute_mode: outcome.call?.mode,
      google_http_status: outcome.call?.httpStatus ?? undefined,
      google_status: outcome.call?.googleStatus ?? undefined,
    });
  }
  return {
    result: { departure: { date: departure.date, time: "08:00" }, origin: origin.kind, rows: outcome.rows },
    fields: { ...timing, ...counted(outcome.rows) },
  };
}

/**
 * Calculates the commute from a saved offer to each of the team's points (FR-016) and answers with
 * its progress. A fetch-driven endpoint on the pattern of `POST /api/audits`: a form `POST` with one
 * field, `offer_id`.
 *
 * No session redirects to sign-in, before anything else is looked at — the only redirect. Every
 * other answer is `200` with an NDJSON body (`CommuteStreamLine`) whose last line is `done`, with
 * the result, or `failed`, with the reason and the sentence the card shows for it. The result is
 * not stored anywhere: it lives in the answer and in the island, until the page is reloaded.
 *
 * The calculation is a promise of its own, handed to the platform's `waitUntil`, so the log entry
 * of its end is written even when the member closes the card while Google answers.
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    report("refused", { stage: "auth", reason: "signed_out" });
    return context.redirect("/auth/signin");
  }

  // A cookie set once the response is on its way never reaches the browser, so the session is
  // settled now, while a write still gets out (the reasoning of `POST /api/audits`).
  let responseLeft = false;
  const supabase = createClient(context.request.headers, {
    set(...write) {
      if (!responseLeft) context.cookies.set(...write);
    },
  });

  let offerId = "";
  try {
    if (supabase) await supabase.auth.getSession();
  } catch {
    // A session that cannot be settled is no answer by itself: the reads below meet the same
    // failure and end the calculation with their own reason.
  }
  try {
    const sent = (await context.request.formData()).get("offer_id");
    if (typeof sent === "string") offerId = sent;
  } catch {
    // A body that is not a form (a hand-crafted request) names no offer: `offer_not_found`, never a 500.
  }

  const encoder = new TextEncoder();
  // The reader's side of the body. Closed by the member's browser, it takes no more lines.
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
  const send = (line: CommuteStreamLine): void => {
    if (!listening) return;
    try {
      lines?.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
    } catch {
      listening = false;
    }
  };

  const known: Fields = { user_id: user.id };
  const work = calculate({ supabase, offerId, send }, known)
    .then((ending) => {
      if ("result" in ending) {
        report("completed", { ...known, ...ending.fields });
        send({ type: "done", result: ending.result });
      } else {
        const { reason } = ending;
        report(ending.outcome ?? COMMUTE_OUTCOME[reason], { ...known, ...ending.fields, reason });
        send({ type: "failed", reason, message: commuteFailureMessage(reason) });
      }
    })
    .catch((error: unknown) => {
      // Nothing above is meant to throw. If something did, no reason is invented for it: the body
      // ends without its last line, which the island reads as "not known how it ended".
      report("failed", { ...known, stage: "unexpected", error_name: errorName(error) });
    })
    .finally(() => {
      if (listening) lines?.close();
    });

  // The adapter says `cfContext` is always there, and a test builds `locals` without it.
  (context.locals as { cfContext?: ExecutionLifetime }).cfContext?.waitUntil(work);

  responseLeft = true;
  return new Response(body, { status: 200, headers: STREAM_HEADERS });
};
