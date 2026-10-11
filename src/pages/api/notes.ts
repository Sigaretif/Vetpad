import type { APIRoute } from "astro";
import { type LogFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase";
import { NOTE_BLANK, noteError, type NoteField } from "@/lib/notes";
import { isUuid } from "@/lib/uuid";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zapisać notatki.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza notatki.";
const UNKNOWN_INTENT = "Nieznana akcja formularza notatki. Notatka pozostała bez zmian.";
const OFFER_NOT_FOUND = "Nie znaleziono oferty, do której należy notatka.";
const SAVE_FAILED = "Nie udało się zapisać notatki. Spróbuj ponownie.";
const DELETE_FAILED = "Nie udało się usunąć notatki. Notatka pozostała bez zmian — spróbuj ponownie.";
const DELETE_UNCONFIRMED =
  "Nie udało się potwierdzić usunięcia notatki. Odśwież kartę oferty i sprawdź, czy notatka nadal istnieje, zanim spróbujesz ponownie.";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

type Intent = "save" | "delete";
type Outcome = "saved" | "deleted" | "already_gone" | "refused" | "failed";
type Fields = Omit<LogFields, "event" | "outcome">;

/** The client is untyped; a row is read key by key and trusted for none of them. */
type Row = Record<string, unknown>;

/**
 * One entry per way out of the route. A failure is an error; everything else is info. No entry
 * ever carries a note's text: a field's content, and the sentence of a validation that quotes
 * nothing, both stay out.
 */
function report(outcome: Outcome, fields: Fields): void {
  logEvent(outcome === "failed" ? "error" : "info", { event: "note", outcome, ...fields });
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
 * A form field as it will be stored: a form submits a textarea's line breaks as CRLF, while its
 * `maxlength` counts each as one character — normalised to `\n` before validation, so a note at
 * the limit is not rejected and lost. Otherwise saved exactly as typed, untrimmed.
 */
function noteField(form: FormData, name: NoteField): string {
  return textField(form, name).replace(/\r\n/g, "\n");
}

/**
 * Saves, changes or deletes the member's own note on an offer (FR-012, FR-015). The author is
 * always the session's user, never a form field: the upsert on (offer_id, author_id) and the
 * delete filtered by both can only ever reach their own note, and RLS (offer_notes_insert_own /
 * offer_notes_update_own / offer_notes_delete_own) enforces the same.
 *
 * `intent=save` — or no intent, as a form submitted with Enter may send — writes the fields;
 * `intent=delete` removes the note and reads none of them. A member has one note per offer, so
 * the delete needs no note id from the client, and it takes the note as the database holds it,
 * not as some window last showed it: both windows belong to the member who has just confirmed.
 *
 * A delete is judged by its error and by the number of rows it reached. No row is neither a
 * success nor a failure: the note was already gone, and the member is told exactly that. If the
 * offer is gone as well, the card they return to answers 404.
 */
export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    report("refused", { stage: "auth", reason: "signed_out" });
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    report("refused", { stage: "config", reason: "unconfigured", user_id: user.id });
    return fail(NOT_CONFIGURED);
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // A body that is not a form (a hand-crafted request) is a failed save, never a 500.
    report("refused", { stage: "body", reason: "unreadable_body", user_id: user.id });
    return fail(UNREADABLE_FORM);
  }

  // The value itself stays out of the entry — it is whatever the request carried.
  const sentIntent = textField(form, "intent") || "save";
  if (sentIntent !== "save" && sentIntent !== "delete") {
    report("refused", { stage: "intent", reason: "unknown_intent", user_id: user.id });
    return fail(UNKNOWN_INTENT);
  }
  const intent: Intent = sentIntent;

  const offerId = textField(form, "offer_id");
  if (!isUuid(offerId)) {
    report("refused", { stage: "offer_id", reason: "invalid_offer", intent, user_id: user.id });
    return fail(OFFER_NOT_FOUND);
  }
  const card = `/offers/${offerId}`;
  const ids = { intent, user_id: user.id, offer_id: offerId };

  if (intent === "delete") {
    // `form=` names the form the message belongs to: the card's `?error=` opens the note editor
    // otherwise, and the page cannot see the `#` fragment.
    const failDelete = (message: string) =>
      context.redirect(`${card}?error=${encodeURIComponent(message)}&form=note-delete#notatki`);

    const deleted = await supabase
      .from("offer_notes")
      .delete()
      .eq("offer_id", offerId)
      .eq("author_id", user.id)
      .select("id")
      .overrideTypes<Row[], { merge: false }>();

    if (deleted.error) {
      // No answer at all: the delete may have landed, so the member is not told the note was kept.
      if (deleted.status === 0) {
        report("failed", {
          ...ids,
          stage: "delete",
          reason: "delete_unconfirmed",
          db_message: deleted.error.message,
          db_status: deleted.status,
        });
        return failDelete(DELETE_UNCONFIRMED);
      }
      report("failed", {
        ...ids,
        stage: "delete",
        reason: "delete_failed",
        ...dbFields(deleted.error, deleted.status),
      });
      return failDelete(DELETE_FAILED);
    }
    // A delete that reached no row answers 200 with an empty list: the member had no note here.
    if (deleted.data.length === 0) {
      report("already_gone", { ...ids, stage: "delete", reason: "note_missing", db_status: deleted.status });
      return context.redirect(`${card}?note=gone#notatki`);
    }
    report("deleted", { ...ids, stage: "delete" });
    return context.redirect(`${card}?note=deleted#notatki`);
  }

  const failOnCard = (message: string) => context.redirect(`${card}?error=${encodeURIComponent(message)}#notatki`);

  const fields: Record<NoteField, string> = {
    pros: noteField(form, "pros"),
    cons: noteField(form, "cons"),
    observations: noteField(form, "observations"),
  };
  const invalid = noteError(fields);
  if (invalid !== null) {
    report("refused", { ...ids, stage: "note", reason: invalid === NOTE_BLANK ? "blank_note" : "note_too_long" });
    return failOnCard(invalid);
  }

  try {
    const saved = await supabase
      .from("offer_notes")
      .upsert({ offer_id: offerId, author_id: user.id, ...fields }, { onConflict: "offer_id,author_id" });
    if (saved.error) {
      // The offer does not exist (never did, or was deleted while the note was being written).
      if (saved.error.code === FOREIGN_KEY_VIOLATION) {
        report("refused", { ...ids, stage: "save", reason: "offer_missing", db_code: saved.error.code });
        return fail(OFFER_NOT_FOUND);
      }
      // noteError already rejects an over-long field (JS length never counts fewer characters than char_length),
      // so a check violation here is offer_notes_not_blank: whitespace trim() keeps but Postgres `\S` does not.
      if (saved.error.code === CHECK_VIOLATION) {
        report("refused", { ...ids, stage: "save", reason: "blank_note", db_code: saved.error.code });
        return failOnCard(NOTE_BLANK);
      }
      report("failed", { ...ids, stage: "save", reason: "save_failed", ...dbFields(saved.error, saved.status) });
      return failOnCard(SAVE_FAILED);
    }
  } catch (error) {
    // Only the error's name: its message is the client's to word, and the request held the note.
    report("failed", {
      ...ids,
      stage: "save",
      reason: "save_threw",
      error_name: error instanceof Error ? error.name : "unknown",
    });
    return failOnCard(SAVE_FAILED);
  }

  report("saved", { ...ids, stage: "save" });
  return context.redirect(`${card}#notatki`);
};
