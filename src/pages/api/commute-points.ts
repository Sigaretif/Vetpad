import type { APIRoute } from "astro";
import {
  COMMUTE_POINTS_MAX,
  COMMUTE_POINT_FIELDS,
  type CommutePointValues,
  commutePointErrors,
  normalizeCommutePoint,
} from "@/lib/commute/points";
import { type LogFields, logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";

const NOT_CONFIGURED = "Supabase nie jest skonfigurowany — nie można zmienić punktów dojazdu.";
const UNREADABLE_FORM = "Nie udało się odczytać formularza punktu dojazdu.";
const UNKNOWN_INTENT = "Nieznana akcja formularza punktu dojazdu. Punkty pozostały bez zmian.";
const INVALID_POINT = "Nie znaleziono punktu dojazdu, którego dotyczy formularz.";
const TOO_MANY_POINTS = `Zespół ma już ${COMMUTE_POINTS_MAX} punktów — usuń któryś, żeby dodać nowy.`;
const POINT_REJECTED = "Baza odrzuciła ten punkt — sprawdź nazwę i adres i spróbuj ponownie.";
const NO_SESSION_IN_DATABASE = "Nie udało się potwierdzić Twojej sesji — zaloguj się ponownie i spróbuj jeszcze raz.";
const POINT_GONE = "Ten punkt został w międzyczasie usunięty — zmiany nie zapisano.";
const SAVE_FAILED = "Nie udało się zapisać punktu dojazdu. Spróbuj ponownie.";
const DELETE_FAILED = "Nie udało się usunąć punktu dojazdu. Spróbuj ponownie.";

const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";
/** The project's own SQLSTATE for "the team already has six points" (create_commute_points.sql). */
const TOO_MANY_POINTS_CODE = "VP002";

type Intent = "save" | "delete";
type Outcome = "saved" | "deleted" | "already_gone" | "refused" | "failed";
type Fields = Omit<LogFields, "event" | "outcome">;

/** The client is untyped; a row is read key by key and trusted for none of them. */
type Row = Record<string, unknown>;

/**
 * One entry per way out of the route. A failure is an error; everything else is info. No entry
 * ever carries a point's name or address: neither the fields, nor Postgres' `message` or
 * `details`, which can quote the rejected row.
 */
function report(outcome: Outcome, fields: Fields): void {
  logEvent(outcome === "failed" ? "error" : "info", { event: "commute_point", outcome, ...fields });
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Adds, changes or deletes one of the team's commute points (FR-016). A point belongs to the team:
 * any member writes any point, and RLS (commute_points_*_authenticated) asks for nothing but a
 * signed-in session. The cap of six and the dates are the database's (the triggers of
 * create_commute_points.sql), never this route's.
 *
 * `intent=save` — or no intent, as a form submitted with Enter may send — adds a point when `id` is
 * empty and changes the point `id` names otherwise. `intent=delete` removes the point `id` names.
 *
 * Every write is judged by its error and by the number of rows it reached. An update that reached
 * no row is a point deleted in the meantime, reported as a failed save. A delete that reached no row
 * is neither a success nor a failure: the point was already gone, and the member is told exactly
 * that (`?point=gone`).
 */
export const POST: APIRoute = async (context) => {
  // `form=` names the form the message belongs to: the page cannot see the `#` fragment, and every
  // criteria form redirects to the same page.
  const fail = (message: string) =>
    context.redirect(`/criteria?error=${encodeURIComponent(message)}&form=points#punkty`);

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
  const ids = { intent, user_id: user.id };

  // Empty for a new point; otherwise the point to change or delete.
  const id = textField(form, "id");
  if ((intent === "delete" || id !== "") && !isUuid(id)) {
    report("refused", { ...ids, stage: "id", reason: "invalid_point" });
    return fail(INVALID_POINT);
  }

  if (intent === "delete") {
    try {
      const deleted = await supabase
        .from("commute_points")
        .delete()
        .eq("id", id)
        .select("id")
        .overrideTypes<Row[], { merge: false }>();
      if (deleted.error) {
        report("failed", {
          ...ids,
          stage: "delete",
          reason: "delete_failed",
          db_code: deleted.error.code,
          db_status: deleted.status,
        });
        return fail(DELETE_FAILED);
      }
      // A delete that reached no row answers 200 with an empty list: the point was already gone.
      if (deleted.data.length === 0) {
        report("already_gone", { ...ids, stage: "delete", reason: "point_missing", db_status: deleted.status });
        return context.redirect("/criteria?point=gone#punkty");
      }
    } catch (error) {
      // Only the error's name: its message is the client's to word.
      report("failed", {
        ...ids,
        stage: "delete",
        reason: "delete_threw",
        error_name: error instanceof Error ? error.name : "unknown",
      });
      return fail(DELETE_FAILED);
    }
    report("deleted", { ...ids, stage: "delete" });
    return context.redirect("/criteria#punkty");
  }

  const values = normalizeCommutePoint(
    Object.fromEntries(COMMUTE_POINT_FIELDS.map((name) => [name, textField(form, name)])) as CommutePointValues,
  );
  const errors = commutePointErrors(values);
  const invalid = errors.name ?? errors.address;
  if (invalid !== undefined) {
    const reason = errors.name !== undefined ? "invalid_name" : "invalid_address";
    report("refused", { ...ids, stage: "point", reason });
    return fail(invalid);
  }

  const stage = id === "" ? "insert" : "update";
  try {
    const saved =
      id === ""
        ? await supabase
            .from("commute_points")
            .insert({ name: values.name, address: values.address })
            .select("id")
            .overrideTypes<Row[], { merge: false }>()
        : await supabase
            .from("commute_points")
            .update({ name: values.name, address: values.address })
            .eq("id", id)
            .select("id")
            .overrideTypes<Row[], { merge: false }>();

    if (saved.error) {
      const code = saved.error.code;
      const fields = { ...ids, stage, db_code: code, db_status: saved.status };
      // The trigger's cap: the team already has six points.
      if (code === TOO_MANY_POINTS_CODE) {
        report("refused", { ...fields, reason: "too_many_points" });
        return fail(TOO_MANY_POINTS);
      }
      // commutePointErrors mirrors both checks, so this is a value it let through.
      if (code === CHECK_VIOLATION) {
        report("refused", { ...fields, reason: "point_rejected" });
        return fail(POINT_REJECTED);
      }
      // RLS refused the write: the database did not see a member's session.
      if (code === INSUFFICIENT_PRIVILEGE) {
        report("refused", { ...fields, reason: "no_session_in_database" });
        return fail(NO_SESSION_IN_DATABASE);
      }
      report("failed", { ...fields, reason: "save_failed" });
      return fail(SAVE_FAILED);
    }
    // An update that reached no row answers 200 with an empty list: the point is gone.
    if (saved.data.length === 0) {
      if (stage === "update") {
        report("refused", { ...ids, stage, reason: "point_missing", db_status: saved.status });
        return fail(POINT_GONE);
      }
      report("failed", { ...ids, stage, reason: "insert_returned_no_row", db_status: saved.status });
      return fail(SAVE_FAILED);
    }
  } catch (error) {
    report("failed", {
      ...ids,
      stage,
      reason: "save_threw",
      error_name: error instanceof Error ? error.name : "unknown",
    });
    return fail(SAVE_FAILED);
  }

  report("saved", { ...ids, stage });
  return context.redirect("/criteria#punkty");
};
