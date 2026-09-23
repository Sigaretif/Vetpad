/**
 * `url` as an absolute `https:` URL, or `null`. Every link or image source rendered from a
 * database row goes through this: RLS lets any member PATCH a row through PostgREST, and Astro
 * escapes attribute values but never checks their scheme, so a stored `javascript:` link would
 * run in another member's session on click.
 */
export function safeHttpsUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}
