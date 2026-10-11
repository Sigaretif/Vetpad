import type { APIRoute } from "astro";
import { type LogFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zmienić stanu archiwum oferty.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza archiwum. Stan oferty pozostał bez zmian.";
const UNKNOWN_INTENT = "Nieznana akcja formularza archiwum. Stan oferty pozostał bez zmian.";
const INVALID_OFFER =
  "Nie udało się rozpoznać oferty do zarchiwizowania lub przywrócenia. Stan żadnej oferty się nie zmienił.";
const OFFER_MISSING =
  "Nie ma już takiej oferty — mogła zostać usunięta. Niczego nie zarchiwizowano ani nie przywrócono.";
const READ_FAILED =
  "Nie udało się odczytać, czy oferta jest w archiwum. Jej stan pozostał bez zmian — spróbuj ponownie za chwilę.";
const ARCHIVE_FAILED = "Nie udało się zarchiwizować oferty. Oferta pozostała na tablicy — spróbuj ponownie.";
const RESTORE_FAILED = "Nie udało się przywrócić oferty. Oferta pozostała w archiwum — spróbuj ponownie.";
const NO_SESSION_IN_DATABASE =
  "Nie udało się potwierdzić Twojej sesji, więc archiwizacji nie miałby kto podpisać. Zaloguj się ponownie i spróbuj jeszcze raz.";
const SAVE_UNCONFIRMED =
  "Nie udało się potwierdzić zapisu. Odśwież kartę oferty i sprawdź, czy oferta jest w archiwum, zanim spróbujesz ponownie.";
const STATE_CHANGED =
  "Stan tej oferty zmienił się w trakcie zapisu — ktoś inny mógł ją właśnie zarchiwizować, przywrócić albo usunąć. Odśwież kartę oferty i sprawdź jej stan.";

/** The trigger's refusal of an archiving it cannot sign (20261011160031_offers_archive.sql). */
const INSUFFICIENT_PRIVILEGE = "42501";

/** What the route reads of the stored row: the offer, and whether and by whom it is archived. */
const STORED_COLUMNS = "id, archived_at, archived_by";

type Intent = "archive" | "restore";
type Outcome = "archived" | "restored" | "unchanged" | "refused" | "failed";
type Fields = Omit<LogFields, "event" | "outcome">;

/** The client is untyped; a row is read key by key and trusted for none of them. */
type Row = Record<string, unknown>;

/** One entry per way out of the route. A failure is an error; everything else is info. */
function report(outcome: Outcome, fields: Fields): void {
  logEvent(outcome === "failed" ? "error" : "info", { event: "offer_archive", outcome, ...fields });
}

/** What a failed Supabase call says about itself. `details` is never read: Postgres quotes the rejected row there. */
function dbFields(error: { code: string; message: string; hint: string }, status: number): Fields {
  return { db_code: error.code, db_message: error.message, db_hint: error.hint, db_status: status };
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Moves one offer to the archive or restores it from there, on a member's request (FR-014). Any
 * member may do either, whoever archived the offer. Everything that can be checked for free comes
 * first, then one write judged by its error and by the number of rows it reached:
 *
 *   session → Supabase configured → form → intent → offer id → stored row → update.
 *
 * The request only states the intent. The write sets `archived_at` — to any date to archive, to
 * null to restore — and never `archived_by`: the table's trigger replaces the date with the
 * database's time and signs the archiving with `auth.uid()`
 * (supabase/migrations/20261011160031_offers_archive.sql). Each write is filtered by the state it
 * expects to leave, so of two members archiving the same offer the first stays signed and the
 * second reaches no row — which is reported as a change in between, never as a success.
 *
 * An offer already in the state asked for is not written to and is not an error. Nothing is ever
 * restored or archived as a side effect, and the route reads and writes `public.offers` alone —
 * never a member's note and never an audit.
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

  // No default: the two actions undo each other, so a form that names neither does neither. The
  // value itself stays out of the entry — it is whatever the request carried.
  const sentIntent = textField(form, "intent");
  if (sentIntent !== "archive" && sentIntent !== "restore") {
    report("refused", { stage: "intent", reason: "unknown_intent", user_id: user.id });
    return failOnBoard(UNKNOWN_INTENT);
  }
  const intent: Intent = sentIntent;

  const offerId = textField(form, "offer_id");
  if (!isUuid(offerId)) {
    report("refused", { stage: "offer_id", reason: "invalid_offer", intent, user_id: user.id });
    return failOnBoard(INVALID_OFFER);
  }
  // Anything but `archive` is the card: the value is never put into an address.
  const returnTo = textField(form, "return") === "archive" ? "archive" : "card";

  const ids = { intent, user_id: user.id, offer_id: offerId };

  // `form=` names the form the message belongs to: the card's `?error=` is the note editor's
  // otherwise, and the page cannot see the `#` fragment.
  const failOnCard = (message: string) =>
    context.redirect(`/offers/${offerId}?error=${encodeURIComponent(message)}&form=archive#archiwum`);

  const read = await supabase.from("offers").select(STORED_COLUMNS).eq("id", offerId).maybeSingle<Row>();
  if (read.error) {
    report("failed", { ...ids, stage: "offer", reason: "offer_read_failed", ...dbFields(read.error, read.status) });
    return failOnCard(READ_FAILED);
  }
  // RLS lets every member read every offer, so no row is no offer.
  if (!read.data) {
    report("refused", { ...ids, stage: "offer", reason: "offer_missing" });
    return failOnBoard(OFFER_MISSING);
  }

  // Already where the member wants it: no write, and no error. The card names who archived it
  // from the row — nothing about that member travels in the address.
  const archived = read.data.archived_at !== null;
  if (archived === (intent === "archive")) {
    report("unchanged", { ...ids, stage: "offer", reason: archived ? "already_archived" : "already_live" });
    return context.redirect(`/offers/${offerId}?archive=${archived ? "already-archived" : "already-live"}`);
  }

  // `archived_at` alone, filtered by the state the row was read in. The date sent only says
  // "archive": the trigger writes the database's own time over it, and the signature beside it.
  const write =
    intent === "archive"
      ? supabase
          .from("offers")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", offerId)
          .is("archived_at", null)
      : supabase.from("offers").update({ archived_at: null }).eq("id", offerId).not("archived_at", "is", null);
  const updated = await write.select("id").overrideTypes<Row[], { merge: false }>();

  if (updated.error) {
    // No answer at all: the write may have landed, so the member is not told the state was kept.
    if (updated.status === 0) {
      report("failed", {
        ...ids,
        stage: "update",
        reason: "update_unconfirmed",
        db_message: updated.error.message,
        db_status: updated.status,
      });
      return failOnCard(SAVE_UNCONFIRMED);
    }
    // The trigger refuses an archiving it cannot sign: the database did not see a member's session.
    const unsigned = updated.error.code === INSUFFICIENT_PRIVILEGE;
    report("failed", {
      ...ids,
      stage: "update",
      reason: unsigned ? "unsigned" : "update_failed",
      ...dbFields(updated.error, updated.status),
    });
    if (unsigned) return failOnCard(NO_SESSION_IN_DATABASE);
    return failOnCard(intent === "archive" ? ARCHIVE_FAILED : RESTORE_FAILED);
  }
  // A write that reached no row answers 200 with an empty list: between the read and the write
  // another member archived, restored or deleted the offer, or RLS filtered the write out. Never
  // a success — the member did not do what the card would then say they did.
  if (updated.data.length === 0) {
    report("failed", { ...ids, stage: "update", reason: "state_changed", db_status: updated.status });
    return failOnCard(STATE_CHANGED);
  }

  if (intent === "archive") {
    report("archived", { ...ids, stage: "update" });
    return context.redirect(`/offers/${offerId}?archive=archived`);
  }
  report("restored", { ...ids, stage: "update" });
  return context.redirect(
    returnTo === "archive" ? "/offers/archive?restored=1" : `/offers/${offerId}?archive=restored`,
  );
};
