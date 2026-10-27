// Why a commute calculation (FR-016) ended without a result, the one sentence a member reads for
// each reason, the time limit of a call to Google and the team's daily limit of calls — shared by
// the calculation route, which reports the reason, and the card's island, which shows the sentence.
//
// No imports at all: the island reads this module in the browser, so nothing here may pull in
// server code.

/**
 * How long one Routes call may take before the route abandons it. The calls run in parallel, so
 * this is also about how long a calculation waits for Google. Waiting on `fetch` costs no CPU time.
 */
export const COMMUTE_CALL_DEADLINE_MS = 10_000;

/**
 * The team's daily allowance of Routes calls, the day being Europe/Warsaw's. Must equal the literal
 * `300` in `reserve_commute_calls`, supabase/migrations/20261027081817_create_commute_usage.sql,
 * where the database enforces it; change the two together (tests/lib/commute/usage.test.ts reads
 * the migration and fails when they differ).
 */
export const COMMUTE_DAILY_CALL_LIMIT = 300;

/** Every way a calculation can end without a result, in the order the route can meet them. */
export const COMMUTE_FAILURE_REASONS = [
  "offer_not_found",
  "offer_unreadable",
  "offer_archived",
  "no_origin",
  "points_unreadable",
  "no_points",
  "too_many_points",
  "not_configured",
  "daily_limit",
  "usage_unavailable",
  "request_rejected",
  "denied",
  "quota",
  "unavailable",
  "timeout",
  "unreadable",
] as const;

export type CommuteFailureReason = (typeof COMMUTE_FAILURE_REASONS)[number];

/** Whether a value is a reason this version knows; an unknown one gets no sentence invented for it. */
export function isCommuteFailureReason(value: unknown): value is CommuteFailureReason {
  return (COMMUTE_FAILURE_REASONS as readonly unknown[]).includes(value);
}

/** One reason, one distinguishable sentence. A new reason fails the exhaustiveness check below. */
export function commuteFailureMessage(reason: CommuteFailureReason): string {
  switch (reason) {
    case "offer_not_found":
      return "Ta oferta już nie istnieje — mogła zostać usunięta. Dojazdy nie zostały policzone.";
    case "offer_unreadable":
      return "Nie udało się wczytać oferty, więc dojazdy nie zostały policzone. Spróbuj ponownie za chwilę.";
    case "offer_archived":
      return "Ta oferta jest w archiwum, więc dojazdy nie zostały policzone. Przywróć ofertę, żeby je policzyć.";
    case "no_origin":
      return "Ogłoszenie nie podaje ani współrzędnych, ani lokalizacji, więc nie ma skąd liczyć dojazdów.";
    case "points_unreadable":
      return "Nie udało się odczytać punktów dojazdu zespołu. Dojazdy nie zostały policzone — spróbuj ponownie za chwilę.";
    case "no_points":
      return "Zespół nie ma jeszcze punktów dojazdu. Dodaj je w kryteriach, żeby policzyć dojazdy.";
    case "too_many_points":
      // 6: COMMUTE_POINTS_MAX in src/lib/commute/points.ts, written out because this module imports nothing.
      return "Zespół ma więcej punktów dojazdu, niż można policzyć naraz (najwyżej 6). Usuń nadmiarowe w kryteriach.";
    case "not_configured":
      return "Liczenie dojazdów jest wyłączone — aplikacja nie ma klucza Google Maps do tras.";
    case "daily_limit":
      return "Dzienny limit liczenia dojazdów zespołu został wyczerpany — spróbuj jutro.";
    case "usage_unavailable":
      return "Nie udało się sprawdzić, czy liczenie mieści się w dziennym limicie zespołu, więc nic nie zostało wysłane do Google. Spróbuj ponownie za chwilę.";
    case "request_rejected":
      return "Google odrzucił zapytanie o trasy jako niepoprawne. Jeśli zespół ma jeden punkt, sprawdź jego adres w kryteriach; w przeciwnym razie to wymaga poprawki w aplikacji.";
    case "denied":
      return "Google odrzucił klucz aplikacji. Dojazdy nie zostały policzone — klucz trzeba sprawdzić w konfiguracji aplikacji.";
    case "quota":
      return "Google ogranicza teraz liczbę zapytań o trasy. Dojazdy nie zostały policzone — spróbuj ponownie później.";
    case "unavailable":
      return "Google Maps jest chwilowo niedostępny albo nie udało się z nim połączyć. Dojazdy nie zostały policzone — spróbuj ponownie za chwilę.";
    case "timeout":
      return `Google nie odpowiedział w ciągu ${COMMUTE_CALL_DEADLINE_MS / 1000} sekund. Dojazdy nie zostały policzone — spróbuj ponownie.`;
    case "unreadable":
      return "Google zwrócił odpowiedź, której nie udało się odczytać. Dojazdy nie zostały policzone.";
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

/**
 * A refusal the product expects, or a failure somebody has to look at — `info` or `error` in the
 * log. Exhaustive like `commuteFailureMessage`: a new reason without an entry fails `astro check`.
 *
 * Refused: turned away before anything reached Google, for a reason the product provides for —
 * an offer that is gone, archived or without a start, a team without points, the zero-config
 * state, the day's allowance spent. Everything else is a failure: `usage_unavailable` too, since
 * the counter that should have answered did not.
 */
export const COMMUTE_OUTCOME: Record<CommuteFailureReason, "refused" | "failed"> = {
  offer_not_found: "refused",
  offer_unreadable: "failed",
  offer_archived: "refused",
  no_origin: "refused",
  points_unreadable: "failed",
  no_points: "refused",
  too_many_points: "refused",
  not_configured: "refused",
  daily_limit: "refused",
  usage_unavailable: "failed",
  request_rejected: "failed",
  denied: "failed",
  quota: "failed",
  unavailable: "failed",
  timeout: "failed",
  unreadable: "failed",
};
