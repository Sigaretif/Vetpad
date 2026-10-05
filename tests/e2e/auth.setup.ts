import { expect, test as setup } from "@playwright/test";
import { testUser, waitForIslands } from "./helpers";

const authFile = "playwright/.auth/user.json";

setup("sign in once and save the session", async ({ page }) => {
  const { username, password } = testUser();

  await page.goto("/auth/signin");
  await waitForIslands(page);
  await page.getByRole("textbox", { name: "E-mail" }).fill(username);
  await page.getByRole("textbox", { name: "Hasło" }).fill(password);
  await page.getByRole("button", { name: "Zaloguj" }).click();

  // A state only a signed-in member reaches: the board, with their address in the account bar.
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("navigation", { name: "Konto" })).toContainText(username);

  await page.context().storageState({ path: authFile });
});
