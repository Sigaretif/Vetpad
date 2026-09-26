// Formatting for the app's own columns (created_at and, later, note and archive dates), as
// opposed to `@/lib/otodom/labels`, which formats what the listing portal stated.

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
