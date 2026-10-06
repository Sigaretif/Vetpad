/**
 * Where „Spróbuj ponownie” on the 503 page leads: the path the member was going to, or `/`.
 *
 * Only a GET can be repeated by following a link, so every other method goes to the home page —
 * as do the 503 page's own address (the link would lead nowhere new) and an API route (it answers
 * a form, not a visitor). `//host` and a path with a backslash are protocol-relative in a browser,
 * so neither is ever returned: the link never leaves the app.
 */
export function retryHref(method: string, originPathname: string): string {
  if (method !== "GET") return "/";
  // Astro appends a slash to `Astro.originPathname` under this app's config, so both forms arrive.
  if (originPathname === "/503" || originPathname === "/503/") return "/";
  if (originPathname.startsWith("/api/")) return "/";
  if (originPathname.startsWith("//")) return "/";
  if (originPathname.includes("\\")) return "/";
  return originPathname;
}
