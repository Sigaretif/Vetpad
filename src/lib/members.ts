// Naming a member of the team: turns an author column (`offers.created_by` through
// `resolveSaver`, `offer_notes.author_id` through `resolveAuthors`, and later the archive author
// of S-10) into what the viewing member sees. The name is the email address from
// `public.members` (supabase/migrations/20260926185936_create_members.sql).
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
 *
 * One author, one query. A view naming many authors reads them with `resolveAuthors` instead
 * of calling this per row: author columns reference auth.users, not `members`, so PostgREST
 * cannot embed the name in the offer or note query.
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

/**
 * The authors of many rows (an offer's notes), as the viewer should read them, in the order of
 * `authorIds`. The same four outcomes as `resolveSaver`: `null` is `deleted`, the viewer is
 * `self`, and every other distinct id is read in one `.in("id", ids)` query — no query at all
 * when nothing is left to read. No client, a failed read, no `members` row or an empty email is
 * `unknown`, never `deleted`. Never throws.
 */
export async function resolveAuthors(
  supabase: SupabaseClient | null,
  authorIds: readonly (string | null)[],
  viewerId: string | undefined,
): Promise<Saver[]> {
  const toRead = [...new Set(authorIds.filter((id): id is string => id !== null && id !== viewerId))];
  const emails = await readEmails(supabase, toRead);
  return authorIds.map((id): Saver => {
    if (id === null) return { kind: "deleted" };
    if (id === viewerId) return { kind: "self" };
    const email = emails.get(id);
    return email === undefined ? { kind: "unknown" } : { kind: "member", email };
  });
}

/** Member id → email for the ids that have a non-empty email; empty on any failure. */
async function readEmails(supabase: SupabaseClient | null, ids: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  if (ids.length === 0 || !supabase) return emails;
  try {
    const result = await supabase.from("members").select("id, email").in("id", ids);
    if (result.error) return emails;
    for (const row of result.data) {
      const id: unknown = row.id;
      const email: unknown = row.email;
      if (typeof id === "string" && typeof email === "string" && email.trim() !== "") {
        emails.set(id, email);
      }
    }
    return emails;
  } catch {
    return new Map();
  }
}

/**
 * Who to name after „przez", in the accusative the notice and the card's author line both use,
 * or `null` when the author could not be established — `unknown` names nobody.
 */
export function saverName(saver: Saver): string | null {
  switch (saver.kind) {
    case "member":
      return saver.email;
    case "self":
      return "Ciebie";
    case "deleted":
      return "osobę z usuniętym kontem";
    case "unknown":
      return null;
    default: {
      const unhandled: never = saver;
      return unhandled;
    }
  }
}

/**
 * Who wrote a note, in the nominative a note's heading uses, or `null` when the author could not
 * be established — `unknown` names nobody and is never shown as a deleted account.
 */
export function authorName(saver: Saver): string | null {
  switch (saver.kind) {
    case "member":
      return saver.email;
    case "self":
      return "Ty";
    case "deleted":
      return "Osoba z usuniętym kontem";
    case "unknown":
      return null;
    default: {
      const unhandled: never = saver;
      return unhandled;
    }
  }
}
