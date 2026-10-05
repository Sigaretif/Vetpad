// risk: note-roundtrip-verbatim — a note a member writes on an offer card comes back altered, lost
//       or as somebody else's once the card is loaded again (prd.md FR-012, FR-013). Not a numbered
//       risk in context/foundation/test-plan.md, which plans no e2e layer (§4).
// seed: tests/e2e/seed.spec.ts
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createFixtureOffer, deleteFixtureOffer, memberApi, type MemberApi } from "./fixture-offer";
import { testUser, waitForIslands } from "./helpers";

test.describe("note-roundtrip-verbatim", () => {
  let member: MemberApi | undefined;
  let offerId: string | undefined;

  // Cleanup: deleting the offer takes its notes with it. Asserted inside, and never skipped quietly.
  test.afterEach(async ({ request }) => {
    if (!member || !offerId) throw new Error("the test never got as far as its fixture offer");
    await deleteFixtureOffer(request, member, offerId);
  });

  test("a member's note on an offer card reads exactly as typed, as their own, after a full reload", async ({
    page,
    request,
  }) => {
    const { username } = testUser();
    const token = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
    test.info().annotations.push({ type: "test-data", description: token });

    // What a "tidying" save or a careless render would change: leading and trailing spaces, a blank
    // line, line breaks (a form posts them as CRLF), diacritics, and characters that read as markup.
    const pros = `  Jasny pokój — żółć, ąę (${token})\n\n- 3. piętro  \n- winda`;
    const cons = `<b>hałas</b> & "tramwaj" o 5:00`;

    // Setup: an offer nobody has written a note on, and its card open with the editor ready.
    member = await memberApi(request);
    offerId = randomUUID();
    await createFixtureOffer(request, member, offerId, `E2E notatka ${token}`);
    await page.goto(`/offers/${offerId}`);
    const notes = page.getByRole("region", { name: "Notatki zespołu" });
    await waitForIslands(page);

    // Action: the member types into two of the three fields and saves; the third stays empty.
    await notes.getByRole("textbox", { name: "Zalety" }).fill(pros);
    await notes.getByRole("textbox", { name: "Wady" }).fill(cons);
    await notes.getByRole("button", { name: "Zapisz notatkę" }).click();

    // The save answers with the card itself — a failed one would carry `?error=`.
    await page.waitForURL(`**/offers/${offerId}#notatki`);

    // A full reload: everything below comes from the database through a fresh request.
    await page.reload();

    // Assertion: the note is this member's own — signed „Ty", theirs to edit, not among the others'.
    await expect(page.getByRole("navigation", { name: "Konto" })).toContainText(username);
    await expect(notes.getByRole("heading", { name: "Ty", exact: true, level: 3 })).toBeVisible();
    await expect(notes.getByRole("button", { name: "Edytuj" })).toBeVisible();
    await expect(notes.getByText("Pozostali członkowie nie napisali jeszcze notatek.")).toBeVisible();

    // Assertion: each field reads character for character as typed, and the empty one invents nothing.
    // `innerText` is the text as rendered, white space included; `toHaveText` would collapse it.
    await expect(notes.getByRole("term")).toHaveText(["Zalety", "Wady", "Obserwacje ogólne"]);
    await expect.poll(() => notes.getByRole("definition").allInnerTexts()).toEqual([pros, cons, "nie wpisano"]);
  });
});
