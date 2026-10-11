// What a member reads, and what the log is told, when ingestion refuses. Two routes ask: adding an
// offer (src/pages/api/offers.ts) and re-fetching a saved one (src/pages/api/offer-refetch.ts).
// The reasons are the same; only the end of the sentence differs — after a failed add nothing was
// saved, after a failed re-fetch the saved offer stands as it was. Pure: no client and no secrets.

import type { FetchEvidence, IngestFailureReason } from "@/lib/otodom";

/** Which route is speaking: saving a new offer, or re-fetching one that is already saved. */
export type IngestAction = "add" | "refetch";

/** How every re-fetch message ends: the stored row was not touched. */
const KEPT = "Zapisane dane oferty pozostały bez zmian";

/** One reason, one distinguishable message. A new reason fails the exhaustiveness check below. */
function addFailureMessage(reason: IngestFailureReason, status?: number): string {
  switch (reason) {
    case "empty":
    case "malformed":
      return "To nie wygląda na poprawny adres URL.";
    case "foreign_host":
      return "Vetpad obsługuje wyłącznie ogłoszenia z otodom.pl.";
    case "not_an_offer":
      return "Ten adres nie prowadzi do ogłoszenia otodom.pl.";
    case "not_for_sale":
      return "Vetpad służy do kupowania mieszkań — to ogłoszenie dotyczy wynajmu.";
    case "not_a_flat":
      return "Vetpad obsługuje wyłącznie mieszkania — to ogłoszenie dotyczy innego rodzaju nieruchomości.";
    case "not_found":
    case "expired":
    case "unexpected_landing":
      return "Ogłoszenie nie istnieje lub wygasło. Nic nie zostało zapisane.";
    case "challenged":
      return "otodom.pl zablokował pobranie ogłoszenia — odpowiedział stroną zabezpieczającą przed automatami. Nic nie zostało zapisane — spróbuj ponownie później.";
    case "http_denied":
      // A refusal can come with 200 — a redirect off otodom — and that status explains nothing.
      return `otodom.pl odmówił pobrania ogłoszenia${status === undefined || status < 400 ? "" : ` (HTTP ${status})`}. Nic nie zostało zapisane — spróbuj ponownie za chwilę.`;
    case "upstream_error":
      return `otodom.pl jest chwilowo niedostępny (HTTP ${status ?? "?"}). Nic nie zostało zapisane — spróbuj ponownie za chwilę.`;
    case "data_missing":
      return "otodom.pl przysłał stronę bez danych ogłoszenia — mógł zablokować pobranie albo zmienić format strony. Nic nie zostało zapisane.";
    case "shape_changed":
      return "Nie udało się odczytać treści ogłoszenia — strona otodom.pl mogła zmienić format. Nic nie zostało zapisane.";
    case "timeout":
      return "Pobieranie ogłoszenia trwało dłużej niż 45 sekund. Nic nie zostało zapisane — spróbuj ponownie.";
    case "network":
      return "Nie udało się połączyć z otodom.pl. Nic nie zostało zapisane.";
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

/**
 * The same reasons after a re-fetch. The address is the stored one, which the member did not
 * type, so the URL reasons speak about the saved address; a listing that no longer passes the
 * gate is described by what it is now. Exhaustive the same way as `addFailureMessage`.
 */
function refetchFailureMessage(reason: IngestFailureReason, status?: number): string {
  switch (reason) {
    case "empty":
    case "malformed":
      return `Zapisany adres tej oferty nie jest poprawnym adresem URL — niczego nie pobrano. ${KEPT}.`;
    case "foreign_host":
      return `Zapisany adres tej oferty nie prowadzi do otodom.pl — niczego nie pobrano. ${KEPT}.`;
    case "not_an_offer":
      return `Zapisany adres tej oferty nie prowadzi do ogłoszenia otodom.pl — niczego nie pobrano. ${KEPT}.`;
    case "not_for_sale":
      return `To ogłoszenie dotyczy teraz wynajmu, a Vetpad służy do kupowania mieszkań. ${KEPT}.`;
    case "not_a_flat":
      return `To ogłoszenie dotyczy teraz innego rodzaju nieruchomości niż mieszkanie. ${KEPT}.`;
    case "not_found":
    case "expired":
    case "unexpected_landing":
      return `Ogłoszenie nie istnieje już na otodom.pl lub wygasło. ${KEPT}.`;
    case "challenged":
      return `otodom.pl zablokował pobranie ogłoszenia — odpowiedział stroną zabezpieczającą przed automatami. ${KEPT} — spróbuj ponownie później.`;
    case "http_denied":
      // A refusal can come with 200 — a redirect off otodom — and that status explains nothing.
      return `otodom.pl odmówił pobrania ogłoszenia${status === undefined || status < 400 ? "" : ` (HTTP ${status})`}. ${KEPT} — spróbuj ponownie za chwilę.`;
    case "upstream_error":
      return `otodom.pl jest chwilowo niedostępny (HTTP ${status ?? "?"}). ${KEPT} — spróbuj ponownie za chwilę.`;
    case "data_missing":
      return `otodom.pl przysłał stronę bez danych ogłoszenia — mógł zablokować pobranie albo zmienić format strony. ${KEPT}.`;
    case "shape_changed":
      return `Nie udało się odczytać treści ogłoszenia — strona otodom.pl mogła zmienić format. ${KEPT}.`;
    case "timeout":
      return `Pobieranie ogłoszenia trwało dłużej niż 45 sekund. ${KEPT} — spróbuj ponownie.`;
    case "network":
      return `Nie udało się połączyć z otodom.pl. ${KEPT}.`;
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

/**
 * The sentence a member reads for `reason`. `status` is the HTTP status the fetch got, when it got
 * one. For `add` the message ends by saying nothing was saved; for `refetch` it says the saved
 * offer's data stayed as it was — nothing a re-fetch refuses ever touches the stored row.
 */
export function ingestFailureMessage(
  reason: IngestFailureReason,
  status: number | undefined,
  action: IngestAction,
): string {
  return action === "add" ? addFailureMessage(reason, status) : refetchFailureMessage(reason, status);
}

/**
 * A refusal the product expects, or a failure somebody has to look at. Stands beside
 * `ingestFailureMessage` and is exhaustive the same way: a new reason without an entry here fails
 * `npx astro check`.
 */
export const INGEST_OUTCOME: Record<IngestFailureReason, "refused" | "failed"> = {
  empty: "refused",
  malformed: "refused",
  foreign_host: "refused",
  not_an_offer: "refused",
  not_for_sale: "refused",
  not_a_flat: "refused",
  not_found: "refused",
  expired: "refused",
  challenged: "failed",
  http_denied: "failed",
  upstream_error: "failed",
  unexpected_landing: "failed",
  data_missing: "failed",
  shape_changed: "failed",
  timeout: "failed",
  network: "failed",
};

/**
 * What a failed fetch learned about the answer it got, key by key, under the log's field names.
 * Ingestion hands it over for the `fetch` stage alone; a refusal from the URL or the mapper has
 * none, and adds nothing.
 */
export function fetchFields(evidence: FetchEvidence = {}) {
  return {
    landed_host: evidence.landedHost,
    landed_path: evidence.landedPath,
    landed_listing: evidence.landedListing,
    content_type: evidence.contentType,
    body_length: evidence.bodyLength,
    marker_present: evidence.markerPresent,
    cf_mitigated: evidence.cfMitigated,
    retry_after: evidence.retryAfter,
    error_name: evidence.errorName,
    error_message: evidence.errorMessage,
    error_cause: evidence.errorCause,
    phase: evidence.phase,
  };
}
