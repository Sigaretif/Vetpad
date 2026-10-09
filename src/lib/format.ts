// Formatting for the app's own columns (created_at and, later, note and archive dates), as
// opposed to `@/lib/otodom/labels`, which formats what the listing portal stated.
//
// No imports: islands read this module in the browser.

const TIMESTAMP = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Warsaw",
});

/**
 * A `timestamptz` column → „20 września 2026", the day as the team sees it in Poland (not in
 * UTC, which would show the previous day for anything saved just after midnight). An
 * unparseable value literally.
 */
export function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : TIMESTAMP.format(parsed);
}

const CLOCK = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});

/**
 * The time of day of a `timestamptz` column → „14:32", as the team reads the clock in Poland.
 * For a moment whose hour matters: when an audit was made, when an attempt started. An
 * unparseable value literally.
 */
export function formatClock(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : CLOCK.format(parsed);
}

/** A running time in whole seconds → „42 s", „1 min 5 s". A negative or fractional value is floored at zero. */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return minutes === 0 ? `${whole} s` : `${minutes} min ${whole % 60} s`;
}

/**
 * The form of a Polish noun that goes with a count: `one` for 1, `few` for a count ending in
 * 2–4 other than 12–14, `many` for everything else (0, 5–21, 25…). „1 wymaganie", „3 wymagania",
 * „12 wymagań", „22 wymagania".
 */
export function pluralForm(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}
