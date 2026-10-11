import { describe, expect, it } from "vitest";
import type { IngestFailureReason } from "@/lib/otodom";
import { INGEST_OUTCOME, fetchFields, ingestFailureMessage } from "@/lib/otodom/failure";

// Expected outcomes come from prd.md: FR-005 (a refusal names which check failed), the Guardrails
// (a failed fetch is reported explicitly as a fetch problem) and FR-009 (a re-fetch that fails
// leaves the saved listing as it was). Every sentence below is written out by hand: for `add` it
// is, character for character, what the add route has always said.

/** Every reason ingestion can refuse with, written out by hand, with the status the fetch got. */
const ADD_MESSAGES: [IngestFailureReason, number | undefined, string][] = [
  ["empty", undefined, "To nie wygląda na poprawny adres URL."],
  ["malformed", undefined, "To nie wygląda na poprawny adres URL."],
  ["foreign_host", undefined, "Vetpad obsługuje wyłącznie ogłoszenia z otodom.pl."],
  ["not_an_offer", undefined, "Ten adres nie prowadzi do ogłoszenia otodom.pl."],
  ["not_for_sale", undefined, "Vetpad służy do kupowania mieszkań — to ogłoszenie dotyczy wynajmu."],
  [
    "not_a_flat",
    undefined,
    "Vetpad obsługuje wyłącznie mieszkania — to ogłoszenie dotyczy innego rodzaju nieruchomości.",
  ],
  ["not_found", 404, "Ogłoszenie nie istnieje lub wygasło. Nic nie zostało zapisane."],
  ["expired", 200, "Ogłoszenie nie istnieje lub wygasło. Nic nie zostało zapisane."],
  ["unexpected_landing", 200, "Ogłoszenie nie istnieje lub wygasło. Nic nie zostało zapisane."],
  [
    "challenged",
    403,
    "otodom.pl zablokował pobranie ogłoszenia — odpowiedział stroną zabezpieczającą przed automatami. Nic nie zostało zapisane — spróbuj ponownie później.",
  ],
  [
    "http_denied",
    403,
    "otodom.pl odmówił pobrania ogłoszenia (HTTP 403). Nic nie zostało zapisane — spróbuj ponownie za chwilę.",
  ],
  [
    "upstream_error",
    503,
    "otodom.pl jest chwilowo niedostępny (HTTP 503). Nic nie zostało zapisane — spróbuj ponownie za chwilę.",
  ],
  [
    "data_missing",
    200,
    "otodom.pl przysłał stronę bez danych ogłoszenia — mógł zablokować pobranie albo zmienić format strony. Nic nie zostało zapisane.",
  ],
  [
    "shape_changed",
    200,
    "Nie udało się odczytać treści ogłoszenia — strona otodom.pl mogła zmienić format. Nic nie zostało zapisane.",
  ],
  [
    "timeout",
    undefined,
    "Pobieranie ogłoszenia trwało dłużej niż 45 sekund. Nic nie zostało zapisane — spróbuj ponownie.",
  ],
  ["network", undefined, "Nie udało się połączyć z otodom.pl. Nic nie zostało zapisane."],
];

const REASONS = ADD_MESSAGES.map(([reason]) => reason);

const KEPT = "Zapisane dane oferty pozostały bez zmian";

describe("ingestFailureMessage for adding an offer", () => {
  it.each(ADD_MESSAGES)("says for %s (status %s) what the add route has always said", (reason, status, message) => {
    expect(ingestFailureMessage(reason, status, "add")).toBe(message);
  });

  // A refusal can come with 200 — a redirect off otodom — and that status explains nothing.
  it.each([
    [undefined, "otodom.pl odmówił pobrania ogłoszenia. Nic nie zostało zapisane — spróbuj ponownie za chwilę."],
    [200, "otodom.pl odmówił pobrania ogłoszenia. Nic nie zostało zapisane — spróbuj ponownie za chwilę."],
    [399, "otodom.pl odmówił pobrania ogłoszenia. Nic nie zostało zapisane — spróbuj ponownie za chwilę."],
    [400, "otodom.pl odmówił pobrania ogłoszenia (HTTP 400). Nic nie zostało zapisane — spróbuj ponownie za chwilę."],
  ])("shows the status of a denied fetch only from 400 up (%s)", (status, message) => {
    expect(ingestFailureMessage("http_denied", status, "add")).toBe(message);
  });

  it("writes a question mark for an outage whose status is not known", () => {
    expect(ingestFailureMessage("upstream_error", undefined, "add")).toBe(
      "otodom.pl jest chwilowo niedostępny (HTTP ?). Nic nie zostało zapisane — spróbuj ponownie za chwilę.",
    );
  });
});

describe("ingestFailureMessage for re-fetching a saved offer", () => {
  // After a failed add nothing was saved; after a failed re-fetch something is — the offer, as
  // it was. The add route's closing words would be false here.
  it.each(ADD_MESSAGES)("says for %s (status %s) that the saved data stayed as it was", (reason, status, added) => {
    const message = ingestFailureMessage(reason, status, "refetch");

    expect(message).toContain(KEPT);
    expect(message).not.toContain("Nic nie zostało zapisane");
    expect(message).not.toBe(added);
  });

  it.each([
    ["not_for_sale", "To ogłoszenie dotyczy teraz wynajmu"],
    ["not_a_flat", "To ogłoszenie dotyczy teraz innego rodzaju nieruchomości niż mieszkanie"],
  ] as const)("says what a listing refused as %s is now", (reason, fragment) => {
    expect(ingestFailureMessage(reason, undefined, "refetch")).toContain(fragment);
  });

  // The member did not type the address: the sentence is about the one the row holds.
  it.each(["empty", "malformed", "foreign_host", "not_an_offer"] as const)(
    "speaks about the stored address for %s, and says nothing was fetched",
    (reason) => {
      const message = ingestFailureMessage(reason, undefined, "refetch");

      expect(message).toContain("Zapisany adres tej oferty");
      expect(message).toContain("niczego nie pobrano");
    },
  );

  it.each([
    ["challenged", 403, "stroną zabezpieczającą przed automatami"],
    ["http_denied", 429, "odmówił pobrania ogłoszenia (HTTP 429)"],
    ["upstream_error", 503, "chwilowo niedostępny (HTTP 503)"],
    ["data_missing", 200, "przysłał stronę bez danych ogłoszenia"],
    ["shape_changed", 200, "mogła zmienić format"],
    ["timeout", undefined, "dłużej niż 45 sekund"],
    ["network", undefined, "Nie udało się połączyć z otodom.pl"],
    ["expired", 200, "wygasło"],
  ] as const)("still names the reason for %s", (reason, status, fragment) => {
    expect(ingestFailureMessage(reason, status, "refetch")).toContain(fragment);
  });

  it("leaves out the status of a denied fetch that came with 200", () => {
    expect(ingestFailureMessage("http_denied", 200, "refetch")).toBe(
      `otodom.pl odmówił pobrania ogłoszenia. ${KEPT} — spróbuj ponownie za chwilę.`,
    );
  });

  // The reasons one sentence covers in the add route share one here too; every other reason
  // reads differently from every other.
  it("keeps the reasons as distinguishable as the add route does", () => {
    const distinct = (action: "add" | "refetch") =>
      new Set(REASONS.map((reason) => ingestFailureMessage(reason, 403, action))).size;

    expect(distinct("add")).toBe(13);
    expect(distinct("refetch")).toBe(13);
  });
});

describe("INGEST_OUTCOME", () => {
  // Written out by hand: a refusal the product expects is logged as info, a failure as an error.
  it("tells a refusal the product expects from a failure somebody has to look at", () => {
    expect(INGEST_OUTCOME).toStrictEqual({
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
    });
  });
});

describe("fetchFields", () => {
  it("names what the fetch learned by the log's keys", () => {
    expect(
      fetchFields({
        landedHost: "www.otodom.pl",
        landedPath: "/pl/wyniki",
        landedListing: "IDKANAR2",
        contentType: "text/html",
        bodyLength: 0,
        markerPresent: false,
        cfMitigated: "challenge",
        retryAfter: "120",
        errorName: "TypeError",
        errorMessage: "fetch failed",
        errorCause: "ECONNRESET",
        phase: "body",
      }),
    ).toStrictEqual({
      landed_host: "www.otodom.pl",
      landed_path: "/pl/wyniki",
      landed_listing: "IDKANAR2",
      content_type: "text/html",
      body_length: 0,
      marker_present: false,
      cf_mitigated: "challenge",
      retry_after: "120",
      error_name: "TypeError",
      error_message: "fetch failed",
      error_cause: "ECONNRESET",
      phase: "body",
    });
  });

  it("adds no fact for a refusal that has no evidence", () => {
    expect(Object.values(fetchFields())).toStrictEqual(Array.from({ length: 12 }, () => undefined));
  });
});
