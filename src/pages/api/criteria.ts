import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { LIMIT_FIELDS, parseLimitsForm, type LimitsFormValues, type TeamLimits } from "@/lib/criteria";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zmienić limitów.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza limitów.";
const UNKNOWN_INTENT = "Nieznana akcja formularza limitów.";
const LIMITS_REJECTED = "Baza odrzuciła te limity — sprawdź wartości i spróbuj ponownie.";
const NO_SESSION_IN_DATABASE = "Nie udało się potwierdzić Twojej sesji — zaloguj się ponownie i spróbuj jeszcze raz.";
const SAVE_FAILED = "Nie udało się zapisać limitów. Spróbuj ponownie.";
const CLEAR_FAILED = "Nie udało się wyczyścić limitów. Spróbuj ponownie.";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

const NO_LIMITS: TeamLimits = { city: null, priceMin: null, priceMax: null, areaMin: null };

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Saves or clears the team's shared limits (FR-002, FR-003). Any member may change them (flat
 * roles); the row is a singleton, so this only ever updates it. Who changed the limits and when
 * is set by the `team_criteria_before_update` trigger, not trusted from here — and saving the
 * same values keeps the previous signature.
 *
 * `intent=clear` writes four nulls; `intent=save` (or no intent, as a form submitted with Enter
 * may send) writes the parsed form. Clearing is never the default.
 */
export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/criteria?error=${encodeURIComponent(message)}#limity`);

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

  const intent = textField(form, "intent") || "save";
  if (intent !== "save" && intent !== "clear") {
    return fail(UNKNOWN_INTENT);
  }
  const failed = intent === "clear" ? CLEAR_FAILED : SAVE_FAILED;

  let limits = NO_LIMITS;
  if (intent === "save") {
    const values = Object.fromEntries(LIMIT_FIELDS.map((name) => [name, textField(form, name)])) as LimitsFormValues;
    const parsed = parseLimitsForm(values);
    if (!parsed.ok) {
      return fail(parsed.error);
    }
    limits = parsed.limits;
  }

  try {
    const updated = await supabase
      .from("team_criteria")
      .update({
        city: limits.city,
        price_min: limits.priceMin,
        price_max: limits.priceMax,
        area_min: limits.areaMin,
        updated_by: user.id,
      })
      .eq("id", true)
      .select("id");
    if (updated.error) {
      // parseLimitsForm mirrors every check on the table, so this is a value it let through.
      if (updated.error.code === CHECK_VIOLATION) {
        return fail(LIMITS_REJECTED);
      }
      // The trigger refuses a change it cannot sign: the database did not see a member's session.
      if (updated.error.code === INSUFFICIENT_PRIVILEGE) {
        return fail(NO_SESSION_IN_DATABASE);
      }
      return fail(failed);
    }
    // An update RLS filters out answers 200 with no rows; that is a failed save, not a success.
    if (updated.data.length === 0) {
      return fail(failed);
    }
  } catch {
    return fail(failed);
  }

  return context.redirect("/criteria#limity");
};
