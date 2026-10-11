// Whether a stored audit result still describes what the team sees (FR-003, FR-009): the one
// place that compares what the audit recorded — the criteria revision and the listing
// fingerprint — with what stands now. The card and the board ask here and never compare on their
// own. Nothing is stored: freshness is worked out on every read.
//
// A value that cannot be compared is never read as "nothing changed". A side that cannot be
// compared says nothing; the other side may still prove the audit stale, and when it does not,
// the answer is `unknown` — never `fresh`.
//
// The team's audit settings (model, effort) are not an input: changing them makes no audit stale
// (PRD, FR-010). Nothing here imports the provider or `@/lib/notes`, and `@/lib/supabase` enters
// only through `import type`.

import { AUDIT_OFFER_COLUMNS, listingFingerprint, readAuditOffer } from "@/lib/audit/input";
import type { AuditIndex } from "@/lib/audit/store";
import type { createClient } from "@/lib/supabase";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** Why a stored result is stale: the listing's data changed, the team's criteria changed, or both. */
export type StaleReason = "listing" | "criteria";

export type AuditFreshness =
  | { state: "fresh" }
  | { state: "stale"; /** Always in the order `listing`, `criteria`. */ reasons: StaleReason[] }
  | { state: "unknown" };

/** What the audit recorded about what it was made against, as the row holds it. `null`: the value does not read. */
export interface StoredComparison {
  criteriaRevision: number | null;
  listingFingerprint: string | null;
}

/** What stands now. `null`: the read of the revision failed, or the offer's row does not read. */
export interface CurrentComparison {
  criteriaRevision: number | null;
  listingFingerprint: string | null;
}

/** How one side compares. `null`: it cannot be compared, which is neither of the two. */
type Comparison = "same" | "different" | null;

/**
 * A fingerprint's version: the text before its first colon. A fingerprint without a colon, or
 * with nothing before it, has no version and cannot be compared with anything.
 */
function fingerprintVersion(fingerprint: string): string | null {
  const colon = fingerprint.indexOf(":");
  return colon > 0 ? fingerprint.slice(0, colon) : null;
}

/**
 * Two fingerprints of different versions are taken from different things, so their difference
 * says nothing about the listing — and neither does one that has no version.
 */
function compareListing(stored: string | null, current: string | null): Comparison {
  if (stored === null || current === null) return null;
  const version = fingerprintVersion(stored);
  if (version === null || version !== fingerprintVersion(current)) return null;
  return stored === current ? "same" : "different";
}

function compareCriteria(stored: number | null, current: number | null): Comparison {
  if (stored === null || current === null) return null;
  return stored === current ? "same" : "different";
}

/**
 * The freshness of a stored audit result:
 *
 * - `stale`   at least one side was compared and differs — with every side that differs as a reason;
 * - `fresh`   both sides were compared and neither differs;
 * - `unknown` nothing differs, and at least one side could not be compared.
 */
export function auditFreshness(stored: StoredComparison, current: CurrentComparison): AuditFreshness {
  const listing = compareListing(stored.listingFingerprint, current.listingFingerprint);
  const criteria = compareCriteria(stored.criteriaRevision, current.criteriaRevision);

  const reasons: StaleReason[] = [];
  if (listing === "different") reasons.push("listing");
  if (criteria === "different") reasons.push("criteria");
  if (reasons.length > 0) return { state: "stale", reasons };

  return listing === "same" && criteria === "same" ? { state: "fresh" } : { state: "unknown" };
}

/**
 * The fingerprint of an offer as it stands now, from a `public.offers` row as the database
 * answered it — through `readAuditOffer`, the way the audit route takes the one it stores. `null`
 * for a row that does not read: its listing cannot be compared with anything.
 */
export async function currentListingFingerprint(row: unknown): Promise<string | null> {
  const offer = readAuditOffer(row);
  return offer === null ? null : listingFingerprint(offer);
}

/**
 * The freshness of every audited offer on the board, or a failed read — after which no audited
 * row may read as up to date: `auditStatus` in `@/lib/offer-board` answers `freshness_unknown`
 * for each of them, never `audited`.
 */
export type BoardFreshness = { ok: true; byOffer: ReadonlyMap<string, AuditFreshness> } | { ok: false };

/** The board's second read of the offers: the key and exactly what a fingerprint is taken from. */
const FRESHNESS_COLUMNS = ["id", ...AUDIT_OFFER_COLUMNS].join(", ");

/**
 * The freshness of each offer the index holds a result for, for the board (FR-003, FR-009): one
 * query for the audit's columns of those offers — the description among them, which the board's
 * own read leaves out — the fingerprint of each row, and `auditFreshness` against what the index
 * recorded. `revision` is the criteria revision as the page read it, `null` when that read
 * failed; the rule then decides, and never reads the criteria as unchanged.
 *
 * An index that holds no offer sends no query and answers an empty map. An index that could not
 * be read sends none either and is `{ ok: false }`: nothing was compared. So is no client (the
 * zero-config state), a failed query, an answer that is not a list of rows with an offer id, or
 * an exception. A row whose columns do not read fails nothing — that offer's listing cannot be
 * compared, and the rule answers for it. An offer the answer does not hold has no entry, which a
 * row reads as `freshness_unknown`. Never throws.
 */
export async function loadBoardFreshness(
  supabase: SupabaseClient | null,
  index: AuditIndex,
  revision: number | null,
): Promise<BoardFreshness> {
  if (!index.ok) return { ok: false };
  const { audited } = index;
  if (audited.size === 0) return { ok: true, byOffer: new Map() };
  if (!supabase) return { ok: false };
  try {
    const read = await supabase
      .from("offers")
      .select(FRESHNESS_COLUMNS)
      .in("id", [...audited.keys()]);
    if (read.error || !Array.isArray(read.data)) return { ok: false };

    const ids: string[] = [];
    for (const row of read.data as unknown[]) {
      const id: unknown = typeof row === "object" && row !== null ? (row as Record<string, unknown>).id : undefined;
      if (typeof id !== "string" || id === "") return { ok: false };
      ids.push(id);
    }
    const fingerprints = await Promise.all((read.data as unknown[]).map(currentListingFingerprint));

    const byOffer = new Map<string, AuditFreshness>();
    for (const [position, id] of ids.entries()) {
      const stored = audited.get(id);
      // A row nobody asked for is no audited offer's: it says nothing about any of them.
      if (stored === undefined) continue;
      byOffer.set(
        id,
        auditFreshness(stored, { criteriaRevision: revision, listingFingerprint: fingerprints[position] }),
      );
    }
    return { ok: true, byOffer };
  } catch {
    return { ok: false };
  }
}
