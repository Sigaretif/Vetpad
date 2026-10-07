import type { APIRoute } from "astro";
import { AUDIT_SETTINGS_FIELDS, parseAuditSettingsForm, type AuditSettingsFormValues } from "@/lib/audit/settings";
import { type LogFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zmienić ustawień audytu.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza ustawień audytu.";
const SETTINGS_REJECTED = "Baza odrzuciła te ustawienia audytu — odśwież stronę i wybierz wartości z listy.";
const NO_SESSION_IN_DATABASE = "Nie udało się potwierdzić Twojej sesji — zaloguj się ponownie i spróbuj jeszcze raz.";
const SAVE_FAILED = "Nie udało się zapisać ustawień audytu. Spróbuj ponownie.";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

type Outcome = "saved" | "refused" | "failed";

/** One entry per way out of the route. A failure is an error; a refusal and a save are info. */
function report(outcome: Outcome, fields: Omit<LogFields, "event" | "outcome">): void {
  logEvent(outcome === "failed" ? "error" : "info", { event: "audit_settings", outcome, ...fields });
}

/** What a failed Supabase call says about itself. `details` is never read: Postgres quotes the rejected row there. */
function dbFields(error: { code: string; message: string; hint: string }, status: number) {
  return { db_code: error.code, db_message: error.message, db_hint: error.hint, db_status: status };
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Saves the model and the reasoning effort the team's AI audits run with (FR-010). Any member may
 * change them (flat roles); the row is a singleton, so this only ever updates it. Who changed the
 * settings and when is set by the `audit_settings_before_update` trigger, not trusted from here —
 * and saving the same values keeps the previous signature.
 *
 * A model or an effort outside the closed lists is refused before anything reaches the database:
 * what is stored is sent to the model provider as it stands.
 */
export const POST: APIRoute = async (context) => {
  // `form=` names the form the message belongs to: the page cannot see the `#` fragment, and
  // every form on the criteria page redirects to the same page.
  const fail = (message: string) => context.redirect(`/criteria?error=${encodeURIComponent(message)}&form=audit#audyt`);

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
    // A body that is not a form (a hand-crafted request) is a refused save, never a 500.
    report("refused", { stage: "body", reason: "unreadable_body", user_id: user.id });
    return fail(UNREADABLE_FORM);
  }

  const values = Object.fromEntries(
    AUDIT_SETTINGS_FIELDS.map((name) => [name, textField(form, name)]),
  ) as AuditSettingsFormValues;
  const parsed = parseAuditSettingsForm(values);
  if (!parsed.ok) {
    // The value itself stays out of the entry: it is whatever the request carried.
    report("refused", { stage: "form", reason: parsed.reason, user_id: user.id });
    return fail(parsed.error);
  }

  try {
    const updated = await supabase
      .from("audit_settings")
      .update({ model: parsed.settings.model, effort: parsed.settings.effort })
      .eq("id", true)
      .select("id");
    if (updated.error) {
      const failure = { stage: "update", user_id: user.id, ...dbFields(updated.error, updated.status) };
      // parseAuditSettingsForm mirrors both checks on the table, so this is a list out of step with it.
      if (updated.error.code === CHECK_VIOLATION) {
        report("failed", { ...failure, reason: "check_violation" });
        return fail(SETTINGS_REJECTED);
      }
      // The trigger refuses a change it cannot sign: the database did not see a member's session.
      if (updated.error.code === INSUFFICIENT_PRIVILEGE) {
        report("failed", { ...failure, reason: "no_session_in_database" });
        return fail(NO_SESSION_IN_DATABASE);
      }
      report("failed", { ...failure, reason: "update_failed" });
      return fail(SAVE_FAILED);
    }
    // An update RLS filters out answers 200 with no rows; that is a failed save, not a success.
    // The row is a singleton, so one changed row is the only answer that reads as a save.
    if (updated.data.length !== 1) {
      report("failed", { stage: "update", reason: "no_rows", user_id: user.id, db_status: updated.status });
      return fail(SAVE_FAILED);
    }
  } catch (error) {
    report("failed", {
      stage: "update",
      reason: "update_threw",
      user_id: user.id,
      error_name: error instanceof Error ? error.name : undefined,
    });
    return fail(SAVE_FAILED);
  }

  report("saved", { stage: "update", user_id: user.id });
  return context.redirect("/criteria#audyt");
};
