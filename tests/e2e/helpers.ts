import type { Page } from "@playwright/test";

/** The seeded local account E2E signs in with, from the gitignored .env. */
export function testUser(): { username: string; password: string } {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("Set E2E_USERNAME and E2E_PASSWORD in .env (context/foundation/test-stack.md, ## E2E)");
  }
  return { username, password };
}

/**
 * Resolves once every React island on the page has hydrated. Input typed into a form island
 * before that is lost when React takes the fields over, so wait here before the first `fill`.
 * Astro drops the `ssr` attribute from an island when it hydrates; this DOM query is the one
 * place a spec relies on that, instead of a selector in every test.
 */
export async function waitForIslands(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
}
