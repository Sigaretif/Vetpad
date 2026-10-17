// risk: photo-lightbox-keyboard-focus — the card's photo viewer opens on a photo other than the
//       one clicked, the arrow keys or the buttons stop on the last or first photo instead of
//       wrapping, or closing it leaves the keyboard focus on the page body instead of the photo
//       the member clicked (prd.md FR-007). The server render and the pure index functions are
//       tests/components/offers/render.test.ts and tests/lib/offer-gallery.test.ts; the keys, the
//       dialog and the focus exist only in a browser. Not a numbered risk in
//       context/foundation/test-plan.md, which plans no e2e layer (§4).
// seed: tests/e2e/seed.spec.ts
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createFixtureOffer, deleteFixtureOffer, memberApi, type MemberApi } from "./fixture-offer";
import { waitForIslands } from "./helpers";

// The photos' host is not otodom's CDN and never reached: every request to it is answered here.
const PHOTO_HOST = "https://e2e-photos.example.com";
// A 1×1 transparent PNG, so every photo loads without a network.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function photo(n: number, medium: boolean) {
  const base = `${PHOTO_HOST}/${n}`;
  return {
    thumbnail: `${base}/thumbnail.png`,
    ...(medium ? { medium: `${base}/medium.png` } : {}),
    large: `${base}/large.png`,
  };
}

test.describe("photo-lightbox-keyboard-focus", () => {
  let member: MemberApi | undefined;
  let offerId: string | undefined;

  test.beforeEach(async ({ page }) => {
    member = undefined;
    offerId = undefined;
    await page.route(`${PHOTO_HOST}/**`, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
    );
  });

  // Cleanup, asserted inside and never skipped quietly.
  test.afterEach(async ({ request }) => {
    if (!member || !offerId) throw new Error("the test never got as far as its fixture offer");
    await deleteFixtureOffer(request, member, offerId, 1);
  });

  test("the viewer opens on the clicked photo, the arrows and the button wrap, and Escape hands the focus back to that photo", async ({
    page,
    request,
  }) => {
    const token = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
    test.info().annotations.push({ type: "test-data", description: token });
    const title = `E2E zdjęcia ${token}`;

    // Setup: an offer with three photos — the first one stored without a medium variant, as an
    // offer saved before it was mapped — and its card open.
    member = await memberApi(request);
    offerId = randomUUID();
    await createFixtureOffer(request, member, offerId, title, [photo(1, false), photo(2, true), photo(3, true)]);
    await page.goto(`/offers/${offerId}`);
    await waitForIslands(page);

    const dialog = page.getByRole("dialog", { name: `Zdjęcia: ${title}` });
    const shown = (n: number) => dialog.getByRole("img", { name: `Zdjęcie ${n} z 3: ${title}` });
    const counter = (n: number) => dialog.getByText(`${n} z 3`, { exact: true });
    const secondPhoto = page.getByRole("link", { name: `Zdjęcie 2 z 3: ${title}` });

    // Action: a plain click of the second photo.
    await secondPhoto.click();

    // Assertion: the viewer is open on that photo, in its large variant, and the page did not leave.
    await expect(dialog).toBeVisible();
    await expect(counter(2)).toBeVisible();
    await expect(shown(2)).toHaveAttribute("src", `${PHOTO_HOST}/2/large.png`);
    expect(new URL(page.url()).pathname).toBe(`/offers/${offerId}`);

    // Action and assertion: ArrowRight steps forward, and from the last photo wraps to the first.
    await page.keyboard.press("ArrowRight");
    await expect(counter(3)).toBeVisible();
    await expect(shown(3)).toHaveAttribute("src", `${PHOTO_HOST}/3/large.png`);
    await page.keyboard.press("ArrowRight");
    await expect(counter(1)).toBeVisible();
    await expect(shown(1)).toHaveAttribute("src", `${PHOTO_HOST}/1/large.png`);

    // Action and assertion: ArrowLeft from the first photo wraps to the last.
    await page.keyboard.press("ArrowLeft");
    await expect(counter(3)).toBeVisible();

    // Action and assertion: the „Następne zdjęcie” button wraps the same way.
    await dialog.getByRole("button", { name: "Następne zdjęcie" }).click();
    await expect(counter(1)).toBeVisible();
    await expect(shown(1)).toHaveAttribute("src", `${PHOTO_HOST}/1/large.png`);

    // Action: Escape.
    await page.keyboard.press("Escape");

    // Assertion: the viewer is closed and the focus is on the photo that was clicked — the
    // second one, not the first one the viewer showed last.
    await expect(dialog).toBeHidden();
    await expect(secondPhoto).toBeFocused();
  });
});
