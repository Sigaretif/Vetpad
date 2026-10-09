// The team's audit settings (FR-010): which model an AI audit runs on and with what reasoning
// effort. The closed lists, the defaults, the labels a member reads, the rule a save must satisfy
// and the read — shared by `POST /api/audit-settings`, the settings island and, later, the audit
// route, which takes the model and the effort from here and nowhere else. The table and its
// checks: supabase/migrations/20261007073258_create_audit_settings.sql.
//
// The island imports this module, so `@/lib/supabase` enters it only through `import type`: a
// value import would pull `astro:env/server` into the browser bundle (as in `@/lib/criteria`).
//
// The settings are not criteria: changing them touches no `criteria_revision` and flags no
// existing audit stale. An audit records the model and the effort it was made with.

import type { createClient } from "@/lib/supabase";
import { resolveSaver, type Saver } from "@/lib/members";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** The models a team may choose, as the provider names them. Mirrors `audit_settings_model_known`. */
export const AUDIT_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;

/** The reasoning efforts a team may choose. Mirrors `audit_settings_effort_known`. */
export const AUDIT_EFFORTS = ["low", "medium", "high"] as const;

export type AuditModel = (typeof AUDIT_MODELS)[number];
export type AuditEffort = (typeof AUDIT_EFFORTS)[number];

export interface AuditSettings {
  model: AuditModel;
  effort: AuditEffort;
}

/**
 * What the singleton row holds until a member changes it (the migration inserts the same pair).
 * Never a fallback for a failed read: an audit that could not read the team's choice does not run
 * on a guess.
 */
export const DEFAULT_AUDIT_SETTINGS: AuditSettings = { model: "claude-opus-5-5", effort: "medium" };

/**
 * The ceiling on one audit's answer, in output tokens — the model's reasoning included, which on
 * these models cannot be switched off. An answer that reaches it is cut short and not stored
 * (`provider_truncated`). Not a team setting: it bounds what one audit can cost, and raising it is
 * a decision about spend.
 */
export const AUDIT_MAX_TOKENS = 16000;

/** An option as a member reads it: its name, and what choosing it means for an audit. */
export interface AuditOptionLabel {
  name: string;
  hint: string;
}

export const AUDIT_MODEL_LABELS: Record<AuditModel, AuditOptionLabel> = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", hint: "najmocniejszy model — droższy audyt" },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", hint: "model średniej klasy — tańszy audyt" },
};

export const AUDIT_EFFORT_LABELS: Record<AuditEffort, AuditOptionLabel> = {
  low: { name: "Niski", hint: "mniej rozumowania — tańszy audyt" },
  medium: { name: "Średni", hint: "ustawienie domyślne" },
  high: { name: "Wysoki", hint: "więcej rozumowania — droższy audyt" },
};

export const AUDIT_SETTINGS_FIELDS = ["model", "effort"] as const;

export type AuditSettingsField = (typeof AUDIT_SETTINGS_FIELDS)[number];

export type AuditSettingsFormValues = Record<AuditSettingsField, string>;

/** `reason` names the refusal for a log entry; `error` is what the member reads. */
export type ParsedAuditSettings =
  { ok: true; settings: AuditSettings } | { ok: false; reason: "unknown_model" | "unknown_effort"; error: string };

const UNKNOWN_MODEL = "Wybierz model z listy.";
const UNKNOWN_EFFORT = "Wybierz poziom rozumowania z listy.";

function isAuditModel(value: unknown): value is AuditModel {
  return (AUDIT_MODELS as readonly unknown[]).includes(value);
}

function isAuditEffort(value: unknown): value is AuditEffort {
  return (AUDIT_EFFORTS as readonly unknown[]).includes(value);
}

/**
 * The settings form as the values `audit_settings` will store, or the first reason it cannot be
 * saved — one message per reason. A value is taken exactly as sent: nothing is trimmed, lowered
 * or mapped onto the nearest option, because what is stored is sent to the model provider as it
 * stands. Mirrors both checks on the table, so settings this accepts are never rejected by the
 * database.
 */
export function parseAuditSettingsForm(values: AuditSettingsFormValues): ParsedAuditSettings {
  if (!isAuditModel(values.model)) return { ok: false, reason: "unknown_model", error: UNKNOWN_MODEL };
  if (!isAuditEffort(values.effort)) return { ok: false, reason: "unknown_effort", error: UNKNOWN_EFFORT };
  return { ok: true, settings: { model: values.model, effort: values.effort } };
}

/**
 * The settings with who last changed them, or a failed read — which is never shown as the
 * defaults: a form prefilled from them would overwrite the team's choice, and an audit would run
 * on a model nobody picked. `changedBy` is `null` only when the settings were never changed.
 */
export type AuditSettingsResult =
  | { state: "ok"; model: AuditModel; effort: AuditEffort; changedBy: Saver | null; changedAt: string | null }
  | { state: "error" };

/**
 * The team's audit settings and their signature. A null `updated_by` with a date is a deleted
 * account, and with no date the settings were never changed, so nobody is named and `members` is
 * not read. No client (the zero-config state), a failed query, a missing singleton row, a model
 * or an effort outside the lists, or an exception is `{ state: "error" }` — never the defaults.
 * Never throws.
 */
export async function loadAuditSettings(
  supabase: SupabaseClient | null,
  viewerId: string | undefined,
): Promise<AuditSettingsResult> {
  if (!supabase) return { state: "error" };
  try {
    const result = await supabase
      .from("audit_settings")
      .select("model, effort, updated_at, updated_by")
      .eq("id", true)
      .maybeSingle();
    if (result.error || !result.data) return { state: "error" };

    const row = result.data as Record<string, unknown>;
    const { model, effort } = row;
    if (!isAuditModel(model) || !isAuditEffort(effort)) return { state: "error" };

    const changedAt = typeof row.updated_at === "string" ? row.updated_at : null;
    const signedBy = typeof row.updated_by === "string" ? row.updated_by : null;
    // Never changed means nobody to name; otherwise a null signature is a deleted account.
    const changedBy = changedAt === null ? null : await resolveSaver(supabase, signedBy, viewerId);

    return { state: "ok", model, effort, changedBy, changedAt };
  } catch {
    return { state: "error" };
  }
}
