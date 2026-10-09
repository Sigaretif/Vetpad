// Why an audit did not produce a result, the one message a member reads for each reason, and
// the time limits of an attempt — shared by the audit route, which reports the reason, and the
// card, which reads it back from `offer_audits.run_failure` and shows the same words.
//
// No imports at all: the audit island reads this module in the browser, so nothing here may pull
// in server code.

/**
 * How long the model call may take before the route abandons it. The ~3-minute budget of the
 * PRD (Non-Functional Requirements) with room left to store the outcome.
 */
export const AUDIT_PROVIDER_DEADLINE_MS = 165_000;

/**
 * How long an attempt may stay `running` before it reads as interrupted and another may take
 * the row over. Must equal `interval '175 seconds'` in
 * supabase/migrations/20261007073300_create_offer_audits.sql, where the database enforces it;
 * change the two together.
 */
export const AUDIT_STALE_ATTEMPT_MS = 175_000;

/** How long the browser waits for the audit's stream before it stops waiting and reloads the card. */
export const AUDIT_BROWSER_LIMIT_MS = 180_000;

/** How often the route writes a sign of life into the stream, so the connection is never silent. */
export const AUDIT_HEARTBEAT_MS = 5_000;

// The order of the three limits is what matters: provider deadline < stale threshold < browser
// limit. A live request never loses its row before its own deadline, and a card reloaded at the
// browser's limit already reads the attempt as interrupted.

/** Every way an audit can end without a result, in the order the route can meet them. */
export const AUDIT_FAILURE_REASONS = [
  "unconfigured_supabase",
  "unconfigured_provider",
  "invalid_offer",
  "offer_not_found",
  "offer_read_failed",
  "criteria_read_failed",
  "settings_read_failed",
  "busy",
  "claim_failed",
  "provider_auth",
  "provider_credit",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_rejected",
  "provider_refused",
  "provider_truncated",
  "provider_malformed",
  "provider_timeout",
  "provider_network",
  "save_failed",
  "claim_lost",
  "interrupted",
] as const;

export type AuditFailureReason = (typeof AUDIT_FAILURE_REASONS)[number];

/** Whether a stored `run_failure` is a reason this version knows; an unknown one gets no message invented for it. */
export function isAuditFailureReason(value: unknown): value is AuditFailureReason {
  return (AUDIT_FAILURE_REASONS as readonly unknown[]).includes(value);
}

/** One reason, one distinguishable message. A new reason fails the exhaustiveness check below. */
export function auditFailureMessage(reason: AuditFailureReason): string {
  switch (reason) {
    case "unconfigured_supabase":
      return "Supabase nie jest skonfigurowany — nie można uruchomić audytu.";
    case "unconfigured_provider":
      return "Audyt AI jest wyłączony — aplikacja nie ma klucza dostawcy modelu.";
    case "invalid_offer":
      return "Nie rozpoznano oferty, której ma dotyczyć audyt. Odśwież kartę i spróbuj ponownie.";
    case "offer_not_found":
      return "Ta oferta już nie istnieje — mogła zostać usunięta. Audyt nie został uruchomiony.";
    case "offer_read_failed":
      // Two causes share this reason: a read the database failed, which passes, and a stored row
      // that does not read as an offer, which lasts until the row is fixed. So no "in a moment".
      return "Nie udało się odczytać danych tej oferty — baza danych nie odpowiedziała albo zapisane dane oferty są nieczytelne. Audyt nie został uruchomiony; jeśli kolejna próba skończy się tak samo, dane tej oferty trzeba poprawić.";
    case "criteria_read_failed":
      return "Nie udało się odczytać kryteriów zespołu. Audyt nie został uruchomiony — spróbuj ponownie za chwilę.";
    case "settings_read_failed":
      return "Nie udało się odczytać ustawień audytu (modelu i poziomu rozumowania). Audyt nie został uruchomiony — spróbuj ponownie za chwilę.";
    case "busy":
      return "Audyt tej oferty już trwa. Drugi nie został uruchomiony — poczekaj na wynik i odśwież kartę.";
    case "claim_failed":
      return "Nie udało się rozpocząć audytu — baza danych nie przyjęła nowej próby. Model nie został wywołany; spróbuj ponownie za chwilę.";
    case "provider_auth":
      return "Dostawca modelu odrzucił klucz API. Audyt nie został wykonany — klucz trzeba sprawdzić w konfiguracji aplikacji.";
    case "provider_credit":
      return "Konto u dostawcy modelu nie ma środków albo osiągnęło limit wydatków. To stan rozliczeń, a nie usterka audytu — po doładowaniu konta lub podniesieniu limitu uruchom audyt ponownie.";
    case "provider_rate_limited":
      return "Dostawca modelu ogranicza teraz liczbę zapytań. Audyt nie został wykonany — spróbuj ponownie za kilka minut.";
    case "provider_unavailable":
      return "Dostawca modelu jest chwilowo niedostępny albo przeciążony. Audyt nie został wykonany — spróbuj ponownie za chwilę.";
    case "provider_rejected":
      return "Dostawca modelu odrzucił zapytanie audytu jako niepoprawne. Ponowna próba najpewniej skończy się tak samo — to wymaga poprawki w aplikacji.";
    case "provider_refused":
      return "Model odmówił przeanalizowania tego ogłoszenia. Wynik nie powstał.";
    case "provider_truncated":
      return "Odpowiedź modelu przekroczyła limit długości i została ucięta. Niepełny wynik nie został zapisany.";
    case "provider_malformed":
      return "Model zwrócił odpowiedź w nieoczekiwanym kształcie. Wynik nie został zapisany — spróbuj ponownie.";
    case "provider_timeout":
      return `Model nie odpowiedział w ciągu ${AUDIT_PROVIDER_DEADLINE_MS / 1000} sekund. Audyt został przerwany — spróbuj ponownie.`;
    case "provider_network":
      return "Nie udało się połączyć z dostawcą modelu. Audyt nie został wykonany — spróbuj ponownie za chwilę.";
    case "save_failed":
      return "Model odpowiedział, ale wyniku nie udało się zapisać w bazie danych. Ponowne uruchomienie to nowe, płatne zapytanie do modelu.";
    case "claim_lost":
      return "Wynik tego audytu nie został zapisany, bo w tym czasie ofertę przejęła inna próba audytu. Odśwież kartę, aby zobaczyć jej stan.";
    case "interrupted":
      return "Poprzednia próba audytu została przerwana, zanim zapisała wynik. Możesz uruchomić audyt ponownie.";
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

/**
 * A refusal the product expects, or a failure somebody has to look at — `info` or `error` in
 * the log. Stands beside `auditFailureMessage` and is exhaustive the same way: a new reason
 * without an entry here fails `npx astro check`.
 *
 * Refused: the audit was turned away before anything was spent, for a reason the product
 * provides for — missing configuration (the zero-config state), an offer that is not there, an
 * audit already running. Everything else is a failure, a billing state at the provider
 * included: nothing is broken, but nobody gets an audit until somebody acts on it.
 */
export const AUDIT_OUTCOME: Record<AuditFailureReason, "refused" | "failed"> = {
  unconfigured_supabase: "refused",
  unconfigured_provider: "refused",
  invalid_offer: "refused",
  offer_not_found: "refused",
  offer_read_failed: "failed",
  criteria_read_failed: "failed",
  settings_read_failed: "failed",
  busy: "refused",
  claim_failed: "failed",
  provider_auth: "failed",
  provider_credit: "failed",
  provider_rate_limited: "failed",
  provider_unavailable: "failed",
  provider_rejected: "failed",
  provider_refused: "failed",
  provider_truncated: "failed",
  provider_malformed: "failed",
  provider_timeout: "failed",
  provider_network: "failed",
  save_failed: "failed",
  claim_lost: "failed",
  interrupted: "failed",
};
