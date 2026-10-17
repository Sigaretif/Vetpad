import { describe, expect, it } from "vitest";
import { galleryPhotos, gridSizes, gridSrc, gridSrcset, type GalleryPhoto } from "@/lib/offer-gallery";

// The stored row is the attack surface (lessons.md): any member can PATCH `images`, so the input
// here is hostile and broken directly, with no mapper in between. Expected values are written by
// hand from the rule.

const JS = "javascript:alert(1)";
const THUMB = "https://cdn.example.com/a/image;s=184x138;q=80";
const MEDIUM = "https://cdn.example.com/a/image;s=655x491;q=80";
const LARGE = "https://cdn.example.com/a/image;s=2048x1536;q=80";

describe("galleryPhotos", () => {
  it("keeps a photo with all three variants", () => {
    expect(galleryPhotos([{ thumbnail: THUMB, medium: MEDIUM, large: LARGE }])).toEqual([
      { medium: MEDIUM, large: LARGE },
    ]);
  });

  it.each<[string, unknown]>([
    ["a hostile thumbnail", { thumbnail: JS, medium: MEDIUM, large: LARGE }],
    ["an http: thumbnail", { thumbnail: "http://cdn.example.com/t", medium: MEDIUM, large: LARGE }],
    ["no thumbnail", { medium: MEDIUM, large: LARGE }],
    ["a hostile large photo", { thumbnail: THUMB, medium: MEDIUM, large: JS }],
    ["an http: large photo", { thumbnail: THUMB, medium: MEDIUM, large: "http://cdn.example.com/l" }],
    ["no large photo", { thumbnail: THUMB, medium: MEDIUM }],
    ["null", null],
    ["a number", 42],
    ["a string", LARGE],
    ["an array", [THUMB, LARGE]],
    ["an empty object", {}],
  ])("skips %s and keeps the valid photo beside it", (_case, entry) => {
    expect(galleryPhotos([entry, { thumbnail: THUMB, medium: MEDIUM, large: LARGE }])).toEqual([
      { medium: MEDIUM, large: LARGE },
    ]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a script URL", { medium: JS }],
    ["an http: URL", { medium: "http://cdn.example.com/m" }],
    ["a non-string", { medium: 42 }],
    ["missing", {}],
  ])("keeps the photo with no medium variant when it is %s", (_case, medium) => {
    expect(galleryPhotos([{ thumbnail: THUMB, large: LARGE, ...medium }])).toEqual([{ medium: null, large: LARGE }]);
  });

  it("returns the parser-normalised URLs, never the stored strings", () => {
    expect(
      galleryPhotos([{ thumbnail: " https://cdn.example.com/t", medium: "HTTPS://cdn.example.com/m", large: LARGE }]),
    ).toEqual([{ medium: "https://cdn.example.com/m", large: LARGE }]);
  });

  it("returns no photos for an empty column", () => {
    expect(galleryPhotos([])).toEqual([]);
  });
});

describe("the grid image's attributes", () => {
  const withMedium: GalleryPhoto = { medium: MEDIUM, large: LARGE };
  const legacy: GalleryPhoto = { medium: null, large: LARGE };

  it("takes the medium variant as src, and the large one when there is none", () => {
    expect(gridSrc(withMedium)).toBe(MEDIUM);
    expect(gridSrc(legacy)).toBe(LARGE);
  });

  it("lists both variants in srcset, or the large one alone", () => {
    expect(gridSrcset(withMedium)).toBe(
      "https://cdn.example.com/a/image;s=655x491;q=80 655w, https://cdn.example.com/a/image;s=2048x1536;q=80 2048w",
    );
    expect(gridSrcset(legacy)).toBe("https://cdn.example.com/a/image;s=2048x1536;q=80 2048w");
  });

  it("puts a hostile medium URL with a space and a comma into srcset as one token", () => {
    const [photo] = galleryPhotos([{ thumbnail: THUMB, medium: "https://x.pl/a b, 9999w", large: LARGE }]);

    expect(gridSrcset(photo)).toBe(
      "https://x.pl/a%20b,%209999w 655w, https://cdn.example.com/a/image;s=2048x1536;q=80 2048w",
    );
    expect(gridSrcset(photo).split(/\s+/)).toEqual([
      "https://x.pl/a%20b,%209999w",
      "655w,",
      "https://cdn.example.com/a/image;s=2048x1536;q=80",
      "2048w",
    ]);
  });

  it("sizes a single photo to the whole gallery and several to a third of it", () => {
    expect(gridSizes(1)).toBe("(min-width: 1024px) 694px, 100vw");
    expect(gridSizes(2)).toBe("(min-width: 1024px) 223px, (min-width: 640px) 33vw, 50vw");
    expect(gridSizes(12)).toBe("(min-width: 1024px) 223px, (min-width: 640px) 33vw, 50vw");
  });
});
