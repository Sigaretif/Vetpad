// One structured entry per event, and the only module under src/ that calls `console`:
// eslint.config.js makes `no-console` an error everywhere else. Workers Logs indexes the fields
// of an entry only when a single object is logged, hence one argument and flat keys.

/**
 * Every key an entry can hold. The entry is built by walking this list, never the caller's
 * keys, so a field that is not named here cannot reach the log — whatever a call site passes.
 */
const FIELDS = [
  "event",
  "outcome",
  "stage",
  "reason",
  "status",
  "detail",
  "db_code",
  "db_message",
  "db_hint",
  "db_status",
  "user_id",
  "listing",
  "otodom_id",
  "offer_id",
  "route",
  "method",
  "error_name",
  "auth_status",
  "auth_code",
  "landed_host",
  "landed_path",
  "landed_listing",
  "content_type",
  "body_length",
  "marker_present",
  "cf_mitigated",
  "retry_after",
  "error_message",
  "error_cause",
  "phase",
  "model",
  "effort",
  "provider_request_id",
  "provider_error_type",
  "provider_error_message",
  "stop_reason",
  "input_tokens",
  "output_tokens",
  "duration_ms",
  "findings_count",
  "rejected_count",
  "dropped_count",
  "criteria_revision",
  "listing_chars",
  "stream_events",
] as const;

const MAX_TEXT_LENGTH = 300;

type Field = (typeof FIELDS)[number];
type LogValue = string | number | boolean;

export type LogFields = { event: string } & Partial<Record<Exclude<Field, "event">, LogValue | undefined>>;

/**
 * Writes `fields` as one entry. A value gets in only as a non-empty text (cut to 300
 * characters), a finite number or a boolean; anything else leaves its key out.
 */
export function logEvent(level: "info" | "error", fields: LogFields): void {
  const entry: Record<string, LogValue> = { level };
  for (const key of FIELDS) {
    const value: unknown = fields[key];
    if (typeof value === "string") {
      if (value !== "") entry[key] = value.slice(0, MAX_TEXT_LENGTH);
    } else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      entry[key] = value;
    }
  }
  if (level === "error") console.error(entry);
  else console.info(entry);
}
