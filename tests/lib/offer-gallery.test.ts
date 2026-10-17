import { describe, expect, it } from "vitest";
import {
  clampOpenAt,
  galleryPhotos,
  gridSizes,
  gridSrc,
  gridSrcset,
  nextPhoto,
  opensViewer,
  photoCounter,
  previousPhoto,
  type GalleryPhoto,
  type ViewerClick,
} from "@/lib/offer-gallery";

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

describe("the viewer's navigation", () => {
  it("steps forward inside the range and wraps from the last photo to the first", () => {
    expect(nextPhoto(0, 4)).toBe(1);
    expect(nextPhoto(2, 4)).toBe(3);
    expect(nextPhoto(3, 4)).toBe(0);
  });

  it("steps back inside the range and wraps from the first photo to the last", () => {
    expect(previousPhoto(3, 4)).toBe(2);
    expect(previousPhoto(1, 4)).toBe(0);
    expect(previousPhoto(0, 4)).toBe(3);
  });

  it("stays on the only photo either way", () => {
    expect(nextPhoto(0, 1)).toBe(0);
    expect(previousPhoto(0, 1)).toBe(0);
  });

  it("counts from one", () => {
    expect(photoCounter(0, 4)).toBe("1 z 4");
    expect(photoCounter(3, 4)).toBe("4 z 4");
    expect(photoCounter(0, 1)).toBe("1 z 1");
  });
});

describe("opensViewer", () => {
  const PLAIN: ViewerClick = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };

  it("opens the viewer for a plain click of the main button", () => {
    expect(opensViewer(PLAIN)).toBe(true);
  });

  it.each<[string, Partial<ViewerClick>]>([
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["the middle button", { button: 1 }],
    ["the secondary button", { button: 2 }],
    ["a click already handled", { defaultPrevented: true }],
  ])("leaves the link's own action to a click with %s", (_case, change) => {
    expect(opensViewer({ ...PLAIN, ...change })).toBe(false);
  });
});

describe("clampOpenAt", () => {
  it("turns photo-<n> into a 0-based index inside the range", () => {
    expect(clampOpenAt("photo-1", 4)).toBe(0);
    expect(clampOpenAt("photo-3", 4)).toBe(2);
    expect(clampOpenAt("photo-4", 4)).toBe(3);
  });

  it.each<[string, unknown]>([
    ["photo-0", "photo-0"],
    ["one past the last photo", "photo-5"],
    ["a negative number", "photo--1"],
    ["a fraction", "photo-1.5"],
    ["a leading zero", "photo-01"],
    ["another section's name", "delete"],
    ["a bare number", "3"],
    ["an empty value", ""],
    ["no parameter", null],
    ["a number", 3],
  ])("leaves the viewer closed for %s", (_case, value) => {
    expect(clampOpenAt(value, 4)).toBeNull();
  });

  it("leaves the viewer closed when there are no photos", () => {
    expect(clampOpenAt("photo-1", 0)).toBeNull();
  });
});
