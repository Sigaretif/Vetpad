// The archive of offers (FR-014): what "recently archived" means, and the one read of the
// archived offers that the board's section and the archive page share. The columns and the
// triggers that sign them: supabase/migrations/20261011160031_offers_archive.sql.
//
// The state always comes from the row — `archived_at` is null for a live offer — and the
// signature from `archived_by`, named through `@/lib/members`. Archiving touches neither notes
// nor audits, and this module imports neither.
//
// `@/lib/supabase` enters only through `import type`, as in `@/lib/notes`.

import type { createClient } from "@/lib/supabase";
import { resolveAuthors, type Saver } from "@/lib/members";
import { BOARD_COLUMNS, type OfferBoardItem } from "@/lib/offer-board";
import type { OfferRow } from "@/lib/otodom/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** How long an archiving counts as recent: 7 days (168 hours). */
export const RECENTLY_ARCHIVED_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether an offer archived at `archivedAt` is still "recently archived" at `now`: no more than
 * `RECENTLY_ARCHIVED_MS` ago, the boundary included. A date in the future is recent — the
 * database's clock set it, and it may run ahead of this one. A date that does not parse is not.
 */
export function isRecentlyArchived(archivedAt: string, now: Date): boolean {
  const at = Date.parse(archivedAt);
  if (Number.isNaN(at)) return false;
  return now.getTime() - at <= RECENTLY_ARCHIVED_MS;
}

/** The archive's `select`: what a board row shows, plus when the offer was archived and by whom. */
export const ARCHIVE_COLUMNS = `${BOARD_COLUMNS}, archived_at, archived_by`;

/** One archived offer as read: the board's columns, the date — never null here — and the signature. */
export type ArchivedOfferRow = OfferBoardItem & { archived_at: string; archived_by: string | null };

export interface ArchivedOffer {
  offer: ArchivedOfferRow;
  archivedAt: string;
  archiver: Saver;
}

/**
 * An archive read: every archived offer, most recently archived first, and the ones among them
 * archived recently — or a failure, which is shown as an error and never as an empty archive.
 */
export type ArchiveResult = { ok: true; offers: ArchivedOffer[]; recent: ArchivedOffer[] } | { ok: false };

/** A row of the answer as an archived offer, or `null` when it does not read as one. */
function readArchivedRow(row: unknown): ArchivedOfferRow | null {
  if (typeof row !== "object" || row === null) return null;
  const { id, archived_at: archivedAt, archived_by: archivedBy } = row as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return null;
  if (typeof archivedAt !== "string" || archivedAt === "") return null;
  if (archivedBy !== null && typeof archivedBy !== "string") return null;
  return row as ArchivedOfferRow;
}

/**
 * Every archived offer, most recently archived first (then by id, so equal dates keep one order),
 * each with who archived it as the viewer should read it. One read of `offers`, and one of
 * `members` for all the names (`resolveAuthors`): a null `archived_by` is a deleted account, and
 * a failed read of the names is `unknown` for each of them, with the archive still read.
 *
 * No client (the zero-config state), a failed query, a row that does not read as an archived
 * offer or an exception is `{ ok: false }` — never an empty archive, which would say that
 * nothing was hidden from the board. Never throws.
 */
export async function loadArchive(
  supabase: SupabaseClient | null,
  viewerId: string | undefined,
  now: Date,
): Promise<ArchiveResult> {
  if (!supabase) return { ok: false };
  try {
    const result = await supabase
      .from("offers")
      .select(ARCHIVE_COLUMNS)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .order("id", { ascending: true });
    if (result.error) return { ok: false };

    const rows: ArchivedOfferRow[] = [];
    for (const raw of result.data as unknown[]) {
      const row = readArchivedRow(raw);
      if (row === null) return { ok: false };
      rows.push(row);
    }

    const archivers = await resolveAuthors(
      supabase,
      rows.map((row) => row.archived_by),
      viewerId,
    );
    // `resolveAuthors` answers in the order of its input, so `archivers[index]` is this row's.
    const offers = rows.map((row, index): ArchivedOffer => ({
      offer: row,
      archivedAt: row.archived_at,
      archiver: archivers[index],
    }));
    return { ok: true, offers, recent: offers.filter((entry) => isRecentlyArchived(entry.archivedAt, now)) };
  } catch {
    return { ok: false };
  }
}

/** An archived offer's state on its card: since when, and who archived it. */
export interface OfferArchiveState {
  archivedAt: string;
  archiver: Saver;
}

/**
 * The archive state of an offer the card already holds: `null` for a live offer, and for an
 * archived one its date with `archiver` — the offer's `archived_by` named by `resolveSaver`.
 * The state is the row's alone; nothing in a URL makes an offer archived.
 */
export function archiveOf(offer: Pick<OfferRow, "archived_at">, archiver: Saver): OfferArchiveState | null {
  return offer.archived_at === null ? null : { archivedAt: offer.archived_at, archiver };
}
