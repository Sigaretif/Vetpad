import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { loadRenderers } from "astro:container";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import OfferBoardItem from "@/components/offers/OfferBoardItem.astro";
import OfferCard from "@/components/offers/OfferCard.astro";
import OfferGallery from "@/components/offers/OfferGallery.astro";
import type { OfferImage, OfferRow } from "@/lib/otodom/types";
import { fullOffer, malformedImagesOffer, memberSaver, noLimits } from "@/pages/dev/_offer-fixtures";

// The stored row, not the ingest, is the attack surface (lessons.md): any member can PATCH any
// `offers` column, so these renders feed the views hostile and broken values directly, with no
// mapper in between. Expected values are written by hand from the rule — only an https URL
// reaches href/src, and a URL that fails renders no link or image — never copied from output.

const NO_PHOTOS = "Ogłoszenie nie zawiera zdjęć.";
const SOURCE_LINK = "Otwórz oryginał";

const JS = "javascript:alert(1)";
const THUMB = "https://picsum.photos/seed/render-test/320/240";
const LARGE = "https://picsum.photos/seed/render-test/800/600";
const VALID: OfferImage = { thumbnail: THUMB, large: LARGE };

let container: AstroContainer;

beforeAll(async () => {
  // The views render React `Card`/`Badge` server-side, so the container needs the React renderer.
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/**
 * Every `href`/`src` value in the markup. The count of attribute names guards the extraction: an
 * attribute the pattern cannot read (unquoted, single-quoted) fails the test instead of slipping
 * past the whitelist.
 */
function urlsIn(html: string): string[] {
  const values = Array.from(html.matchAll(/(?<![\w-])(?:href|src)\s*=\s*"([^"]*)"/gi), (match) => match[1]);
  const names = html.match(/(?<![\w-])(?:href|src)\s*=/gi) ?? [];
  expect(values).toHaveLength(names.length);
  return values;
}

function hrefsIn(html: string): string[] {
  return Array.from(html.matchAll(/(?<![\w-])href\s*=\s*"([^"]*)"/gi), (match) => match[1]);
}

function imgSrcsIn(html: string): string[] {
  return Array.from(html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi), (match) => match[1]);
}

function countTags(html: string, tag: string): number {
  return html.match(new RegExp(`<${tag}\\b`, "gi"))?.length ?? 0;
}

/**
 * The whitelist: an absolute https URL, or an internal path. `//host` and `/\host` are
 * protocol-relative in a browser, so a path must not start with a second slash or a backslash.
 */
function expectOnlySafeUrls(html: string): void {
  for (const url of urlsIn(html)) {
    expect(url).toMatch(/^(?:https:\/\/|\/(?![/\\]))/);
  }
}

function card(offer: OfferRow): Promise<string> {
  return container.renderToString(OfferCard, { props: { offer, saver: memberSaver } });
}

function gallery(images: unknown[]): Promise<string> {
  return container.renderToString(OfferGallery, { props: { images, title: fullOffer.title } });
}

function boardItem(images: unknown): Promise<string> {
  const offer = { ...fullOffer, images: images as OfferImage[] };
  return container.renderToString(OfferBoardItem, { props: { offer, limits: noLimits } });
}

describe("OfferCard: the source link (#7)", () => {
  it.each<unknown>([
    JS,
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "data:text/html,x",
    "http://www.otodom.pl/pl/oferta/x",
    "//evil.example/x",
    null,
    42,
  ])("renders no source link for the stored source_url %j", async (sourceUrl) => {
    const html = await card({ ...fullOffer, source_url: sourceUrl as string });

    expect(html).not.toContain(SOURCE_LINK);
    expectOnlySafeUrls(html);
  });

  it.each(["https://www.otodom.pl/pl/oferta/x", " https://www.otodom.pl/pl/oferta/x"])(
    "links the https source_url %j as the parsed URL",
    async (sourceUrl) => {
      const html = await card({ ...fullOffer, source_url: sourceUrl });

      expect(html).toContain(SOURCE_LINK);
      expect(hrefsIn(html).filter((href) => href.startsWith("https://www.otodom.pl/"))).toEqual([
        "https://www.otodom.pl/pl/oferta/x",
      ]);
      expectOnlySafeUrls(html);
    },
  );

  it("renders a stored images element that is not a photo without failing", async () => {
    const html = await card({ ...fullOffer, images: [null] as unknown as OfferImage[] });

    expect(html).toContain(NO_PHOTOS);
    expect(countTags(html, "img")).toBe(0);
    expectOnlySafeUrls(html);
  });

  it("renders the malformed-images fixture with no photo", async () => {
    const html = await card(malformedImagesOffer);

    expect(html).toContain(NO_PHOTOS);
    expect(countTags(html, "img")).toBe(0);
    expectOnlySafeUrls(html);
  });
});

describe("OfferGallery: a photo renders only when both its URLs are https (#7)", () => {
  it.each([
    ["a hostile thumbnail", { thumbnail: JS, large: LARGE }],
    ["a hostile large photo", { thumbnail: THUMB, large: JS }],
  ])("skips an entry with %s", async (_case, image) => {
    const html = await gallery([image]);

    expect(countTags(html, "img")).toBe(0);
    expect(html).toContain(NO_PHOTOS);
    expectOnlySafeUrls(html);
  });

  it.each<unknown>([null, 42, {}, "https://x.pl/a.jpg"])(
    "renders the element %j, which is not a photo, as no photo without failing",
    async (element) => {
      const html = await gallery([element]);

      expect(countTags(html, "img")).toBe(0);
      expect(html).toContain(NO_PHOTOS);
      expectOnlySafeUrls(html);
    },
  );

  it("renders exactly the one valid entry among broken and hostile ones", async () => {
    const html = await gallery([
      null,
      42,
      {},
      "https://x.pl/a.jpg",
      { thumbnail: JS, large: LARGE },
      VALID,
      { thumbnail: THUMB, large: "http://picsum.photos/seed/render-test/800/600" },
    ]);

    expect(imgSrcsIn(html)).toEqual([THUMB]);
    expect(hrefsIn(html)).toEqual([LARGE]);
    expect(countTags(html, "img")).toBe(1);
    expect(countTags(html, "a")).toBe(1);
    expect(html).not.toContain(NO_PHOTOS);
    expectOnlySafeUrls(html);
  });
});

describe("OfferBoardItem: the thumbnail and the row link (#7)", () => {
  const PLACEHOLDER = /<div\b[^>]*aria-hidden="true"[^>]*>\s*<\/div>/;
  const ROW_LINK = `/offers/${fullOffer.id}`;

  it("shows the first https thumbnail, past an element that is not a photo", async () => {
    const html = await boardItem([null, VALID]);

    expect(imgSrcsIn(html)).toEqual([THUMB]);
    expect(html).not.toMatch(PLACEHOLDER);
    expect(hrefsIn(html)).toEqual([ROW_LINK]);
    expectOnlySafeUrls(html);
  });

  it.each<[string, unknown]>([
    ["a javascript: thumbnail", [{ thumbnail: JS }]],
    ["an http: thumbnail", [{ thumbnail: "http://picsum.photos/seed/render-test/320/240" }]],
    ["no photos", []],
    ["images: null", null],
  ])("shows the placeholder and no image for %s", async (_case, images) => {
    const html = await boardItem(images);

    expect(countTags(html, "img")).toBe(0);
    expect(html).toMatch(PLACEHOLDER);
    expect(hrefsIn(html)).toEqual([ROW_LINK]);
    expectOnlySafeUrls(html);
  });
});
