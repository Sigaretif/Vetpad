// An id from a URL or a form is checked before it reaches a query: Postgres rejects a non-uuid
// with 22P02, which must not surface as a 500.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
