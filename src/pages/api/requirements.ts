import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { REQUIREMENTS_BLANK, requirementsError } from "@/lib/criteria";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zmienić wymagań.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza wymagań.";
const UNKNOWN_INTENT = "Nieznana akcja formularza wymagań.";
const SAVE_FAILED = "Nie udało się zapisać wymagań. Spróbuj ponownie.";
const DELETE_FAILED = "Nie udało się usunąć wymagań. Spróbuj ponownie.";
const CHECK_VIOLATION = "23514";

/**
 * The body as it will be stored: a form submits a textarea's line breaks as CRLF, while its
 * `maxlength` counts each as one character — normalised to `\n` before validation, as in
 * `POST /api/notes`. Otherwise saved exactly as typed, untrimmed.
 */
function bodyField(form: FormData): string {
  const value = form.get("body");
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : "";
}

/**
 * Saves, changes or deletes the member's own requirements (FR-002, FR-003). The author is always
 * the session's user, never a form field: the upsert on author_id and the delete can only ever
 * reach their own row, and RLS (member_requirements_insert_own / _update_own / _delete_own)
 * enforces the same.
 *
 * `intent=delete` removes the row — deleting requirements that are not there is not an error;
 * `intent=save` (or no intent, as a form submitted with Enter may send) writes the body.
 */
export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/criteria?error=${encodeURIComponent(message)}#wymagania`);

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

  const rawIntent = form.get("intent");
  const intent = (typeof rawIntent === "string" ? rawIntent : "") || "save";

  if (intent === "delete") {
    try {
      const deleted = await supabase.from("member_requirements").delete().eq("author_id", user.id);
      if (deleted.error) {
        return fail(DELETE_FAILED);
      }
    } catch {
      return fail(DELETE_FAILED);
    }
    return context.redirect("/criteria#wymagania");
  }

  if (intent !== "save") {
    return fail(UNKNOWN_INTENT);
  }

  const body = bodyField(form);
  const invalid = requirementsError(body);
  if (invalid !== null) {
    return fail(invalid);
  }

  try {
    const saved = await supabase
      .from("member_requirements")
      .upsert({ author_id: user.id, body }, { onConflict: "author_id" });
    if (saved.error) {
      // requirementsError already rejects an over-long body (JS length never counts fewer characters than
      // char_length), so a check violation here is member_requirements_not_blank: whitespace trim() keeps but
      // Postgres `\S` does not.
      if (saved.error.code === CHECK_VIOLATION) {
        return fail(REQUIREMENTS_BLANK);
      }
      return fail(SAVE_FAILED);
    }
  } catch {
    return fail(SAVE_FAILED);
  }

  return context.redirect("/criteria#wymagania");
};
