// The ingestion mode (FR-004, FR-009): which way an otodom.pl listing is fetched — directly, through
// the extraction service (Apify), or directly with the service as a fallback. The closed list, the
// labels a member reads, the read of the singleton row, and the one rule that turns the configured
// mode into the mode that actually runs, shared by the two ingestion routes and by /criteria so the
// two never disagree. The table: supabase/migrations/20261017193318_create_ingestion_settings.sql.
//
// Members only read the mode; the owner changes it in Supabase Studio. A view may import this
// module, so `@/lib/supabase` enters it only through `import type`: a value import would pull
// `astro:env/server` into the browser bundle (as in `@/lib/audit/settings`).

import type { ReadFailure } from "@/lib/criteria";
import type { createClient } from "@/lib/supabase";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** The modes the owner may choose. Mirrors `ingestion_settings_mode_known`. */
export const INGESTION_MODES = ["direct_with_fallback", "apify_only", "direct_only"] as const;

export type IngestionMode = (typeof INGESTION_MODES)[number];

/** A mode as a member reads it on /criteria. */
export const INGESTION_MODE_LABELS: Record<IngestionMode, string> = {
  direct_with_fallback: "najpierw bezpośrednio, potem Apify",
  apify_only: "tylko Apify",
  direct_only: "tylko bezpośrednio",
};

export function isIngestionMode(value: unknown): value is IngestionMode {
  return (INGESTION_MODES as readonly unknown[]).includes(value);
}

/** How the read of the row ended: `ok`, or which way it failed. */
export type IngestionSettingsRead = "ok" | "error" | "missing_row" | "off_list";

/**
 * The configured mode, or a failed read — which is never the seeded default: a failed read runs as
 * `direct_only` (`resolveIngestionMode`), so it can never start a paid call nobody chose.
 */
export type IngestionSettingsResult =
  | { state: "ok"; mode: IngestionMode }
  | {
      state: "error";
      read: Exclude<IngestionSettingsRead, "ok">;
      /** Why, for a route's log entry; a view has no use for it. */
      failure: ReadFailure;
    };

/**
 * The mode the singleton row holds. No client (the zero-config state), a failed query or an
 * exception is `error`; no row is `missing_row`; a value outside the list is `off_list`. Never
 * throws.
 */
export async function loadIngestionSettings(supabase: SupabaseClient | null): Promise<IngestionSettingsResult> {
  if (!supabase) return { state: "error", read: "error", failure: { detail: "unconfigured" } };
  try {
    const result = await supabase.from("ingestion_settings").select("mode").eq("id", true).maybeSingle();
    if (result.error) {
      return {
        state: "error",
        read: "error",
        failure: { detail: "query", dbCode: result.error.code, dbStatus: result.status },
      };
    }
    if (!result.data) {
      return { state: "error", read: "missing_row", failure: { detail: "missing", dbStatus: result.status } };
    }

    const { mode } = result.data as Record<string, unknown>;
    if (!isIngestionMode(mode)) return { state: "error", read: "off_list", failure: { detail: "off_list" } };

    return { state: "ok", mode };
  } catch (error) {
    return {
      state: "error",
      read: "error",
      failure: { detail: "threw", errorName: error instanceof Error ? error.name : "NonError" },
    };
  }
}

/** The configured mode, the mode that runs, why the two differ, and how the read ended. */
export interface ResolvedIngestionMode {
  /** What the row holds, or `null` when it could not be read. */
  configured: IngestionMode | null;
  effective: IngestionMode;
  /** Why `effective` is not `configured`; `null` when they are the same. */
  reason: "apify_unconfigured" | "mode_read_failed" | null;
  read: IngestionSettingsRead;
}

/**
 * The mode that actually runs. A failed read runs as `direct_only`, never as the seeded default.
 * Without an Apify token every mode runs as `direct_only`, and the reason is named unless the owner
 * chose `direct_only` anyway. Otherwise the configured mode runs.
 */
export function resolveIngestionMode(
  settings: IngestionSettingsResult,
  apifyAvailable: boolean,
): ResolvedIngestionMode {
  if (settings.state === "error") {
    return { configured: null, effective: "direct_only", reason: "mode_read_failed", read: settings.read };
  }
  const configured = settings.mode;
  if (!apifyAvailable) {
    return {
      configured,
      effective: "direct_only",
      reason: configured === "direct_only" ? null : "apify_unconfigured",
      read: "ok",
    };
  }
  return { configured, effective: configured, reason: null, read: "ok" };
}
