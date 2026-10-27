// The reservation of a calculation's Routes calls on the team's daily counter (FR-016): one call of
// `public.reserve_commute_calls(n)` (supabase/migrations/20261027081817_create_commute_usage.sql),
// made after every free refusal and the key check, and before the first request reaches Google.
//
// The counter never lets a call through on doubt: only the day's new total is a reservation.
// `VP003` — the day would go past `COMMUTE_DAILY_CALL_LIMIT` — is the limit; any other error, a
// thrown exception or an answer that does not read as a total is a failure, and the route sends
// nothing to Google. One request, no retry, and a reservation is never given back.
//
// Only the error's code leaves this module — never its `message`, `details` or `hint`.

import type { createClient } from "@/lib/supabase";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** The project's own SQLSTATE for a reservation that would take the day past the limit. */
export const DAILY_LIMIT_CODE = "VP003";

export type CommuteReservation =
  { kind: "reserved"; total: number } | { kind: "limit" } | { kind: "failed"; dbCode: string | null };

/** Reserves `n` calls on today's Warsaw counter. Never throws. */
export async function reserveCommuteCalls(supabase: SupabaseClient, n: number): Promise<CommuteReservation> {
  try {
    const result = await supabase.rpc("reserve_commute_calls", { n });
    const { error } = result;
    // The client is not typed against the schema, so the answer is read as unknown and checked here.
    const total: unknown = result.data;
    if (error) {
      if (error.code === DAILY_LIMIT_CODE) return { kind: "limit" };
      return { kind: "failed", dbCode: typeof error.code === "string" && error.code !== "" ? error.code : null };
    }
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0) return { kind: "failed", dbCode: null };
    return { kind: "reserved", total };
  } catch {
    return { kind: "failed", dbCode: null };
  }
}
