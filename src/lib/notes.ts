// Members' notes on an offer (FR-012, FR-013): reading an offer's notes split into the viewer's
// own and everyone else's, and the rules a note must satisfy, shared by `POST /api/notes` and the
// note editor island. The table and its limits: supabase/migrations/20260926202537_create_offer_notes.sql.
//
// The island imports this module, so `@/lib/supabase` enters it only through `import type`: a
// value import would pull `astro:env/server` into the browser bundle (as in `@/lib/members`).
//
// Notes never leave the system (PRD, Non-Functional Requirements): nothing here is ever passed to
// the audit or the model provider.

import type { createClient } from "@/lib/supabase";
import { resolveAuthors, type Saver } from "@/lib/members";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

export const NOTE_FIELDS = ["pros", "cons", "observations"] as const;

export type NoteField = (typeof NOTE_FIELDS)[number];

/** The per-field limit of the `offer_notes_*_length` checks. */
export const NOTE_MAX_LENGTH = 5000;

export const NOTE_FIELD_LABELS: Record<NoteField, string> = {
  pros: "Zalety",
  cons: "Wady",
  observations: "Obserwacje ogólne",
};

export interface NoteView {
  id: string;
  author: Saver;
  pros: string;
  cons: string;
  observations: string;
  updatedAt: string;
}

/** An offer's notes, or a failed read — which is never shown as "no notes yet". */
export type OfferNotes = { state: "ok"; own: NoteView | null; others: NoteView[] } | { state: "error" };

interface NoteRow {
  id: string;
  author_id: string | null;
  pros: string;
  cons: string;
  observations: string;
  updated_at: string;
}

/**
 * Every note on the offer, most recently edited first, split into the viewer's own and the rest.
 * No client (the zero-config state), a failed read or an exception is `{ state: "error" }`,
 * never an empty `ok`. Never throws.
 */
export async function loadNotes(
  supabase: SupabaseClient | null,
  offerId: string,
  viewerId: string | undefined,
): Promise<OfferNotes> {
  if (!supabase) return { state: "error" };
  try {
    const result = await supabase
      .from("offer_notes")
      .select("id, author_id, pros, cons, observations, updated_at")
      .eq("offer_id", offerId)
      .order("updated_at", { ascending: false });
    if (result.error) return { state: "error" };

    const rows = result.data as NoteRow[];
    const authors = await resolveAuthors(
      supabase,
      rows.map((row) => row.author_id),
      viewerId,
    );

    let own: NoteView | null = null;
    const others: NoteView[] = [];
    // `resolveAuthors` answers in the order of its input, so `authors[index]` is this row's author.
    for (const [index, row] of rows.entries()) {
      const view: NoteView = {
        id: row.id,
        author: authors[index],
        pros: row.pros,
        cons: row.cons,
        observations: row.observations,
        updatedAt: row.updated_at,
      };
      if (row.author_id !== null && row.author_id === viewerId) {
        own = view;
      } else {
        others.push(view);
      }
    }
    return { state: "ok", own, others };
  } catch {
    return { state: "error" };
  }
}

export const NOTE_BLANK = "Wpisz coś w co najmniej jednym polu notatki.";
const NOTE_TOO_LONG = `Każde pole notatki może mieć najwyżej ${NOTE_MAX_LENGTH} znaków.`;

/**
 * Why a note cannot be saved, or `null` when it can. The fields are checked as they will be
 * stored, so line endings are normalised to `\n` before this runs. `.length` counts UTF-16 units,
 * as a textarea's `maxlength` does, which is never fewer than the characters Postgres counts:
 * a note this accepts is never rejected by the length checks.
 */
export function noteError(fields: Record<NoteField, string>): string | null {
  if (NOTE_FIELDS.every((field) => fields[field].trim() === "")) return NOTE_BLANK;
  if (NOTE_FIELDS.some((field) => fields[field].length > NOTE_MAX_LENGTH)) return NOTE_TOO_LONG;
  return null;
}
