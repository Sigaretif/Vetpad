import { fetchOfferAd } from "./fetch";
import { mapAdToOffer } from "./map";
import type { FetchEvidence, FetchFailureReason, MapFailureReason, OfferInsert, UrlFailureReason } from "./types";
import { normalizeOfferUrl } from "./url";

export type { FetchEvidence, OfferImage, OfferInsert } from "./types";
export { normalizeOfferUrl } from "./url";

/** Every way ingestion can refuse. The API route maps each one to a message in one place. */
export type IngestFailureReason = UrlFailureReason | FetchFailureReason | MapFailureReason;

/**
 * Where ingestion refused. `shape_changed` comes from both the fetch and the mapper; only the
 * stage tells them apart.
 */
export type IngestStage = "url" | "fetch" | "map";

/** `evidence` is what the fetch learned about the answer: present for the `fetch` stage alone. */
export type IngestResult =
  | { ok: true; url: string; offer: OfferInsert }
  | {
      ok: false;
      stage: IngestStage;
      reason: IngestFailureReason;
      status?: number;
      detail?: string;
      evidence?: FetchEvidence;
    };

/**
 * Pasted URL to a mapped offer row: normalise, fetch, gate and map. Knows nothing
 * about Supabase or the app's HTTP layer; the caller adds `source_url` (the returned
 * `url`) and `created_by` before inserting.
 */
export async function ingestOffer(rawUrl: string, signal: AbortSignal): Promise<IngestResult> {
  const normalized = normalizeOfferUrl(rawUrl);
  if (!normalized.ok) return { ...normalized, stage: "url" };

  const fetched = await fetchOfferAd(normalized.url, signal);
  if (!fetched.ok) return { ...fetched, stage: "fetch" };

  const mapped = mapAdToOffer(fetched.ad);
  if (!mapped.ok) return { ...mapped, stage: "map" };

  return { ok: true, url: normalized.url, offer: mapped.offer };
}
