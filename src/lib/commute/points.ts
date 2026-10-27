// The team's commute points (FR-016): up to six named places — a name and an address — to which a
// member may ask for the travel time from an offer. Reading them, and the rules a save must
// satisfy, shared by `POST /api/commute-points` and the points editor island. The table and its
// limits: supabase/migrations/20261027081815_create_commute_points.sql.
//
// The island imports this module, so `@/lib/supabase` enters it only through `import type`: a value
// import would pull `astro:env/server` into the browser bundle (as in `@/lib/criteria`).
//
// A point's address goes only to Google Routes, from the Worker, on a member's deliberate
// calculation. Never to the model provider: `auditNoNotesConfig` in eslint.config.js makes an import
// of this module an error in the audit's code. Never to a log entry either.

import type { createClient } from "@/lib/supabase";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** The cap of the `commute_points_before_insert` trigger (SQLSTATE `VP002`). */
export const COMMUTE_POINTS_MAX = 6;

/** The length limit of the `commute_points_name_length` check. */
export const COMMUTE_POINT_NAME_MAX_LENGTH = 60;

/** The length limit of the `commute_points_address_length` check. */
export const COMMUTE_POINT_ADDRESS_MAX_LENGTH = 200;

/** A point as the team keeps it. */
export interface CommutePoint {
  id: string;
  name: string;
  address: string;
}

/** The points, oldest first — or a failed read, which is never "no points". */
export type CommutePointsResult = { state: "ok"; points: CommutePoint[] } | { state: "error" };

export const COMMUTE_POINT_FIELDS = ["name", "address"] as const;

export type CommutePointField = (typeof COMMUTE_POINT_FIELDS)[number];

export type CommutePointValues = Record<CommutePointField, string>;

export const COMMUTE_POINT_NAME_BLANK = "Wpisz nazwę punktu.";
const NAME_TOO_LONG = `Nazwa punktu może mieć najwyżej ${COMMUTE_POINT_NAME_MAX_LENGTH} znaków.`;
export const COMMUTE_POINT_ADDRESS_BLANK = "Wpisz adres punktu.";
const ADDRESS_TOO_LONG = `Adres punktu może mieć najwyżej ${COMMUTE_POINT_ADDRESS_MAX_LENGTH} znaków.`;

/**
 * A point as it will be stored: both fields trimmed. The table's check keeps a name without
 * surrounding whitespace, and an address is no better for it.
 */
export function normalizeCommutePoint(values: CommutePointValues): CommutePointValues {
  return { name: values.name.trim(), address: values.address.trim() };
}

/**
 * Why each field of a point cannot be saved, checked as it will be stored (after
 * `normalizeCommutePoint`); an empty object when it can. JS counts a string's length in UTF-16
 * units, never fewer than Postgres' `char_length`, so nothing passed here fails the table's check
 * on length.
 */
export function commutePointErrors(values: CommutePointValues): Partial<Record<CommutePointField, string>> {
  const { name, address } = normalizeCommutePoint(values);
  const errors: Partial<Record<CommutePointField, string>> = {};
  if (name === "") errors.name = COMMUTE_POINT_NAME_BLANK;
  else if (name.length > COMMUTE_POINT_NAME_MAX_LENGTH) errors.name = NAME_TOO_LONG;
  if (address === "") errors.address = COMMUTE_POINT_ADDRESS_BLANK;
  else if (address.length > COMMUTE_POINT_ADDRESS_MAX_LENGTH) errors.address = ADDRESS_TOO_LONG;
  return errors;
}

/** The rows as PostgREST answers them, or `null` when one does not read as a point. */
function readPoints(rows: unknown): CommutePoint[] | null {
  if (!Array.isArray(rows)) return null;
  const points: CommutePoint[] = [];
  for (const row of rows as unknown[]) {
    if (typeof row !== "object" || row === null) return null;
    const { id, name, address } = row as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string" || typeof address !== "string") return null;
    points.push({ id, name, address });
  }
  return points;
}

/**
 * Every point, in the order they were added (`created_at`, then `id`, so two points added in one
 * moment keep one order). No client (the zero-config state), a failed query, an exception or a row
 * that does not read as a point is `{ state: "error" }` — never "no points", which would offer an
 * empty list to a team that has some. Never throws.
 */
export async function loadCommutePoints(supabase: SupabaseClient | null): Promise<CommutePointsResult> {
  if (!supabase) return { state: "error" };
  try {
    const result = await supabase
      .from("commute_points")
      .select("id, name, address")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (result.error) return { state: "error" };
    const points = readPoints(result.data);
    return points === null ? { state: "error" } : { state: "ok", points };
  } catch {
    return { state: "error" };
  }
}
