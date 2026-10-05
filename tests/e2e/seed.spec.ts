// Seed test — the pattern every generated E2E test copies.
// risk: auth-gate-roundtrip — a signed-out visitor sees a protected page, or a member who signs in
//       through the real form gets no session the middleware accepts. Not a numbered risk in
//       context/foundation/test-plan.md, which plans no e2e layer yet (§4).
import { expect, test } from "@playwright/test";
import { testUser, waitForIslands } from "./helpers";

// The risk is the signed-out path, so this test opts out of the saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test("signed-out visit to /dashboard is gated by sign-in, and signing in through the form opens the board", async ({
  page,
}) => {
  const { username, password } = testUser();

  // Setup: a visitor without a session opens a protected route.
  await page.goto("/dashboard");

  // The gate sends them to sign-in, and nothing of the board is rendered.
  await page.waitForURL("**/auth/signin");
  await expect(page.getByRole("heading", { name: "Zaloguj się", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Oferty", level: 1 })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Konto" })).toBeHidden();

  // Action: sign in through the real form, once the island accepts input.
  await waitForIslands(page);
  await page.getByRole("textbox", { name: "E-mail" }).fill(username);
  await page.getByRole("textbox", { name: "Hasło" }).fill(password);
  await page.getByRole("button", { name: "Zaloguj" }).click();

  // Assertion: the board, rendered for this member.
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Oferty", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Konto" })).toContainText(username);

  // The session is a cookie the middleware accepts on a fresh request, not a one-off redirect.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("navigation", { name: "Konto" })).toContainText(username);

  // No cleanup: the test creates no data. It does not sign out either — Supabase signs a member
  // out of every session, which would revoke the saved one the other specs load.
});
