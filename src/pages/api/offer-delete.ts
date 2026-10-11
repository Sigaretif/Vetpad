import type { APIRoute } from "astro";
import { type LogFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można usunąć oferty.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza usuwania. Żadna oferta nie została usunięta.";
const INVALID_OFFER = "Nie udało się rozpoznać oferty do usunięcia. Żadna oferta nie została usunięta.";
const DELETE_FAILED =
  "Nie udało się usunąć oferty. Oferta, jej notatki i wynik audytu pozostały bez zmian — spróbuj ponownie.";
const DELETE_UNCONFIRMED =
  "Nie udało się potwierdzić usunięcia. Odśwież stronę i sprawdź, czy oferta nadal istnieje, zanim spróbujesz ponownie.";

/** What the route asks back of the deleted row: the offer, and the listing's id for the log. */
const DELETED_COLUMNS = "id, otodom_id";

type Outcome = "deleted" | "already_gone" | "refused" | "failed";
type Fields = Omit<LogFields, "event" | "outcome">;

/** The client is untyped; a row is read key by key and trusted for none of them. */
type Row = Record<string, unknown>;

/** One entry per way out of the route. A failure is an error; everything else is info. */
function report(outcome: Outcome, fields: Fields): void {
  logEvent(outcome === "failed" ? "error" : "info", { event: "offer_delete", outcome, ...fields });
}

/** What a failed Supabase call says about itself. `details` is never read: Postgres quotes the rejected row there. */
function dbFields(error: { code: string; message: string; hint: string }, status: number): Fields {
  return { db_code: error.code, db_message: error.message, db_hint: error.hint, db_status: status };
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The listing's id as the deleted row held it — a `bigint`, which PostgREST sends as a number. */
function otodomId(row: Row | undefined): string | number | undefined {
  const value = row?.otodom_id;
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

/**
 * Deletes one offer on a member's request (FR-015), live or archived. Any member may delete any
 * offer, and every member's notes on it and its audit go with it — by `on delete cascade` in the
 * database, never by this route, which reads and writes `public.offers` alone. Everything that can
 * be checked for free comes first, then one write judged by its error and by the number of rows it
 * reached:
 *
 *   session → Supabase configured → form → offer id → delete.
 *
 * Nothing is read before the write. A read would add nothing: the delete policy filters no offer
 * out, and the deleted row itself is what the write hands back.
 *
 * A write that reached no row is neither a success nor a failure: the offer was already gone —
 * another member deleted it first — and the member is told exactly that, never that they deleted
 * it. One state reads the same and cannot be told apart: a database that did not see the member's
 * session filters the delete down to no row while the offer still stands. No read would tell it
 * either, since the select policy needs the same session, and the middleware has just confirmed
 * the session with the same cookie — an accepted limit.
 *
 * The deletion cannot be undone, so the entry of a deleted offer carries the listing's id: after
 * the write there is no row left to look it up in.
 */
export const POST: APIRoute = async (context) => {
  // Before an offer is known there is no card to return to.
  const failOnBoard = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    report("refused", { stage: "auth", reason: "signed_out" });
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    report("refused", { stage: "config", reason: "unconfigured", user_id: user.id });
    return failOnBoard(NOT_CONFIGURED);
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // A body that is not a form (a hand-crafted request) is a refusal, never a 500.
    report("refused", { stage: "body", reason: "unreadable_body", user_id: user.id });
    return failOnBoard(UNREADABLE_FORM);
  }

  const offerId = textField(form, "offer_id");
  if (!isUuid(offerId)) {
    report("refused", { stage: "offer_id", reason: "invalid_offer", user_id: user.id });
    return failOnBoard(INVALID_OFFER);
  }
  // Anything but `archive` is the card: the value is never put into an address.
  const returnTo = textField(form, "return") === "archive" ? "archive" : "card";

  const ids = { user_id: user.id, offer_id: offerId };

  // A failed delete goes back to where the member pressed the button. `form=` names the form the
  // message belongs to: the card's `?error=` is the note editor's otherwise, and the page cannot
  // see the `#` fragment.
  const fail = (message: string) =>
    context.redirect(
      returnTo === "archive"
        ? `/offers/archive?error=${encodeURIComponent(message)}`
        : `/offers/${offerId}?error=${encodeURIComponent(message)}&form=delete#usuwanie`,
    );
  // The card is gone with the offer, so both results are told where the member came from.
  const done = (result: "1" | "gone") =>
    context.redirect(`${returnTo === "archive" ? "/offers/archive" : "/dashboard"}?deleted=${result}`);

  const deleted = await supabase
    .from("offers")
    .delete()
    .eq("id", offerId)
    .select(DELETED_COLUMNS)
    .overrideTypes<Row[], { merge: false }>();

  if (deleted.error) {
    // No answer at all: the delete may have landed, so the member is not told the offer was kept.
    if (deleted.status === 0) {
      report("failed", {
        ...ids,
        stage: "delete",
        reason: "delete_unconfirmed",
        db_message: deleted.error.message,
        db_status: deleted.status,
      });
      return fail(DELETE_UNCONFIRMED);
    }
    report("failed", { ...ids, stage: "delete", reason: "delete_failed", ...dbFields(deleted.error, deleted.status) });
    return fail(DELETE_FAILED);
  }
  // A delete that reached no row answers 200 with an empty list: the offer was not there. Never a
  // success — the member did not delete what the banner would then say they deleted.
  if (deleted.data.length === 0) {
    report("already_gone", { ...ids, stage: "delete", reason: "offer_missing", db_status: deleted.status });
    return done("gone");
  }

  report("deleted", { ...ids, stage: "delete", otodom_id: otodomId(deleted.data[0]) });
  return done("1");
};
