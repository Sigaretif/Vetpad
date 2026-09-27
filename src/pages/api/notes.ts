import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { NOTE_BLANK, noteError, type NoteField } from "@/lib/notes";
import { isUuid } from "@/lib/uuid";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zapisać notatki.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza notatki.";
const OFFER_NOT_FOUND = "Nie znaleziono oferty, do której należy notatka.";
const SAVE_FAILED = "Nie udało się zapisać notatki. Spróbuj ponownie.";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

/**
 * A form field as it will be stored: a form submits a textarea's line breaks as CRLF, while its
 * `maxlength` counts each as one character — normalised to `\n` before validation, so a note at
 * the limit is not rejected and lost. Otherwise saved exactly as typed, untrimmed.
 */
function noteField(form: FormData, name: NoteField): string {
  const value = form.get(name);
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : "";
}

/**
 * Saves or changes the member's own note on an offer (FR-012). The author is always the session's
 * user, never a form field: the upsert on (offer_id, author_id) can only ever reach their own note,
 * and RLS (offer_notes_insert_own / offer_notes_update_own) enforces the same.
 */
export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/dashboard?error=${encodeURIComponent(message)}`);

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(NOT_CONFIGURED);
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // A body that is not a form (a hand-crafted request) is a failed save, never a 500.
    return fail(UNREADABLE_FORM);
  }

  const rawOfferId = form.get("offer_id");
  const offerId = typeof rawOfferId === "string" ? rawOfferId : "";
  if (!isUuid(offerId)) {
    return fail(OFFER_NOT_FOUND);
  }
  const card = `/offers/${offerId}`;
  const failOnCard = (message: string) => context.redirect(`${card}?error=${encodeURIComponent(message)}#notatki`);

  const fields: Record<NoteField, string> = {
    pros: noteField(form, "pros"),
    cons: noteField(form, "cons"),
    observations: noteField(form, "observations"),
  };
  const invalid = noteError(fields);
  if (invalid !== null) {
    return failOnCard(invalid);
  }

  try {
    const saved = await supabase
      .from("offer_notes")
      .upsert({ offer_id: offerId, author_id: user.id, ...fields }, { onConflict: "offer_id,author_id" });
    if (saved.error) {
      // The offer does not exist (never did, or was deleted while the note was being written).
      if (saved.error.code === FOREIGN_KEY_VIOLATION) {
        return fail(OFFER_NOT_FOUND);
      }
      // noteError already rejects an over-long field (JS length never counts fewer characters than char_length),
      // so a check violation here is offer_notes_not_blank: whitespace trim() keeps but Postgres `\S` does not.
      if (saved.error.code === CHECK_VIOLATION) {
        return failOnCard(NOTE_BLANK);
      }
      return failOnCard(SAVE_FAILED);
    }
  } catch {
    return failOnCard(SAVE_FAILED);
  }

  return context.redirect(`${card}#notatki`);
};
