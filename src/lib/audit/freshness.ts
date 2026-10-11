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
// (PRD, FR-010). Nothing here imports the provider or `@/lib/notes`.

import { listingFingerprint, readAuditOffer } from "@/lib/audit/input";

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
