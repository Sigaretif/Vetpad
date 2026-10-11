// risk: delete-with-confirmation — a deletion that cannot be undone happens without the member
//       confirming it, or the confirmation never sends its form: the dialog's form lives in a
//       portal, and a dialog that closes on the click unmounts it before the browser posts it
//       (prd.md FR-015). Not a numbered risk in context/foundation/test-plan.md, which plans no
//       e2e layer (§4); what the routes do with the request is tests/pages/api/offer-delete.test.ts
//       and tests/pages/api/notes.test.ts.
// seed: tests/e2e/seed.spec.ts
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  countFixtureRows,
  createFixtureNote,
  createFixtureOffer,
  deleteFixtureOffer,
  memberApi,
  type MemberApi,
} from "./fixture-offer";
import { waitForIslands } from "./helpers";

test.describe("delete-with-confirmation", () => {
  let member: MemberApi | undefined;
  let offerId: string | undefined;
  /** What the cleanup will find: the offer, until a test has deleted it through the app. */
  let offersLeft: 0 | 1 = 1;

  test.beforeEach(() => {
    member = undefined;
    offerId = undefined;
    offersLeft = 1;
  });

  // Cleanup, asserted inside and never skipped quietly. After the first test it proves the app's
  // deletion: an offer the app only claimed to delete would come back here as one row.
  test.afterEach(async ({ request }) => {
    if (!member || !offerId) throw new Error("the test never got as far as its fixture offer");
    await deleteFixtureOffer(request, member, offerId, offersLeft);
  });

  test("an offer is deleted only after the dialog is confirmed, and its card is gone afterwards", async ({
    page,
    request,
  }) => {
    const token = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
    test.info().annotations.push({ type: "test-data", description: token });

    // Setup: an offer with the member's note on it, and its card open.
    member = await memberApi(request);
    offerId = randomUUID();
    await createFixtureOffer(request, member, offerId, `E2E usuwanie ${token}`);
    await createFixtureNote(request, member, offerId, `notatka ${token}`);
    await page.goto(`/offers/${offerId}`);
    await waitForIslands(page);

    const open = page.locator("[data-offer-delete]").getByRole("button", { name: "Usuń ofertę" });
    const dialog = page.getByRole("alertdialog", { name: "Usunąć tę ofertę?" });

    // Action: the button opens the confirmation, which says what will be gone.
    await open.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("notatkami wszystkich członków zespołu i wynikiem audytu");
    await expect(dialog).toContainText("nie da się cofnąć");

    // Assertion: „Anuluj” closes it, hands the focus back and deletes nothing.
    await dialog.getByRole("button", { name: "Anuluj" }).click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    expect(await countFixtureRows(request, member, "offers", offerId)).toBe(1);

    // Assertion: so does Escape.
    await open.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await countFixtureRows(request, member, "offers", offerId)).toBe(1);
    expect(await countFixtureRows(request, member, "offer_notes", offerId)).toBe(1);
    expect(new URL(page.url()).pathname).toBe(`/offers/${offerId}`);

    // Action: the member confirms.
    await open.click();
    await dialog.getByRole("button", { name: "Usuń ofertę" }).click();

    // Assertion: the board says so, and does not list the offer.
    await page.waitForURL("**/dashboard?deleted=1");
    offersLeft = 0;
    await expect(page.locator('[data-delete-result="deleted"]')).toHaveText(
      "Oferta została usunięta razem z notatkami zespołu i wynikiem audytu.",
    );
    await expect(page.getByText(`E2E usuwanie ${token}`)).toHaveCount(0);

    // Assertion: the offer and its note are gone from the database, and the card answers 404.
    expect(await countFixtureRows(request, member, "offers", offerId)).toBe(0);
    expect(await countFixtureRows(request, member, "offer_notes", offerId)).toBe(0);
    const card = await page.goto(`/offers/${offerId}`);
    expect(card?.status()).toBe(404);
  });

  test("a member's own note is deleted only after the dialog is confirmed, and the editor is empty afterwards", async ({
    page,
    request,
  }) => {
    const token = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
    test.info().annotations.push({ type: "test-data", description: token });
    const pros = `Zalety do usunięcia (${token})`;

    // Setup: an offer with the member's note on it, and its card open with the note in preview.
    member = await memberApi(request);
    offerId = randomUUID();
    await createFixtureOffer(request, member, offerId, `E2E usuwanie notatki ${token}`);
    await createFixtureNote(request, member, offerId, pros);
    await page.goto(`/offers/${offerId}`);
    await waitForIslands(page);

    const notes = page.getByRole("region", { name: "Notatki zespołu" });
    const open = notes.getByRole("button", { name: "Usuń", exact: true });
    const dialog = page.getByRole("alertdialog", { name: "Usunąć Twoją notatkę?" });
    await expect(notes.getByText(pros)).toBeVisible();

    // Action: the button opens the confirmation; „Anuluj” closes it and deletes nothing.
    await open.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Anuluj" }).click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    expect(await countFixtureRows(request, member, "offer_notes", offerId)).toBe(1);
    await expect(notes.getByText(pros)).toBeVisible();

    // Action: the member confirms.
    await open.click();
    await dialog.getByRole("button", { name: "Usuń notatkę" }).click();

    // Assertion: the card says so, the note is gone and the editor is back, empty.
    await page.waitForURL(`**/offers/${offerId}?note=deleted#notatki`);
    await expect(page.locator('[data-note-result="deleted"]')).toHaveText("Twoja notatka została usunięta.");
    await waitForIslands(page);
    await expect(notes.getByText(pros)).toHaveCount(0);
    await expect(notes.getByRole("textbox", { name: "Zalety" })).toHaveValue("");
    await expect(notes.getByRole("textbox", { name: "Wady" })).toHaveValue("");
    await expect(notes.getByRole("button", { name: "Usuń", exact: true })).toHaveCount(0);

    // Assertion: the note is gone from the database, and the offer is not.
    expect(await countFixtureRows(request, member, "offer_notes", offerId)).toBe(0);
    expect(await countFixtureRows(request, member, "offers", offerId)).toBe(1);
  });
});
