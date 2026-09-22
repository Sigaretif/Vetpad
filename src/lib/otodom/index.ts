import { fetchOfferAd } from "./fetch";
import { mapAdToOffer } from "./map";
import type { FetchFailureReason, MapFailureReason, OfferInsert, UrlFailureReason } from "./types";
import { normalizeOfferUrl } from "./url";

export type { OfferImage, OfferInsert } from "./types";
export { normalizeOfferUrl } from "./url";

/** Every way ingestion can refuse. The API route maps each one to a message in one place. */
export type IngestFailureReason = UrlFailureReason | FetchFailureReason | MapFailureReason;

export type IngestResult =
  | { ok: true; url: string; offer: OfferInsert }
  | { ok: false; reason: IngestFailureReason; status?: number; detail?: string };

/**
 * Pasted URL to a mapped offer row: normalise, fetch, gate and map. Knows nothing
 * about Supabase or the app's HTTP layer; the caller adds `source_url` (the returned
 * `url`) and `created_by` before inserting.
 */
export async function ingestOffer(rawUrl: string, signal: AbortSignal): Promise<IngestResult> {
  const normalized = normalizeOfferUrl(rawUrl);
  if (!normalized.ok) return normalized;

  const fetched = await fetchOfferAd(normalized.url, signal);
  if (!fetched.ok) return fetched;

  const mapped = mapAdToOffer(fetched.ad);
  if (!mapped.ok) return mapped;

  return { ok: true, url: normalized.url, offer: mapped.offer };
}
