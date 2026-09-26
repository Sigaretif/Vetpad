// Naming a member of the team: turns an author column (`offers.created_by`, and later the note
// and archive authors of S-05 and S-10) into what the viewing member sees. The name is the
// email address from `public.members` (supabase/migrations/20260926185936_create_members.sql).
//
// Two outcomes must never be confused. `deleted` is a fact read from the row — the author
// column is `null` only when the author's account was deleted — and is rendered „osoba z
// usuniętym kontem". `unknown` is everything we could not establish: no client, a failed read,
// no `members` row, or a `null` email. Showing a deleted account for a failed read would invent
// a fact about a teammate.

import type { createClient } from "@/lib/supabase";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

export type Saver = { kind: "self" } | { kind: "member"; email: string } | { kind: "deleted" } | { kind: "unknown" };

/**
 * Who saved the offer, as the viewer should read it. `createdBy` comes from the offer row,
 * never from the URL. Never throws: any failure is `unknown`, so the card keeps rendering.
 */
export async function resolveSaver(
  supabase: SupabaseClient | null,
  createdBy: string | null,
  viewerId: string | undefined,
): Promise<Saver> {
  if (createdBy === null) return { kind: "deleted" };
  if (createdBy === viewerId) return { kind: "self" };
  if (!supabase) return { kind: "unknown" };
  try {
    const result = await supabase.from("members").select("email").eq("id", createdBy).maybeSingle();
    if (result.error) return { kind: "unknown" };
    const email: unknown = result.data?.email;
    return typeof email === "string" && email.trim() !== "" ? { kind: "member", email } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
