import type { OfferImage } from "@/lib/otodom/types";
import { safeHttpsUrl } from "@/lib/safe-url";

// The offer card's gallery, as pure functions: which stored photos render and the attributes of
// their image in the grid. No runtime import but `@/lib/safe-url`, because a browser island reads
// this module too.

/** A photo the gallery may render: every URL is a `safeHttpsUrl` result, never the stored value. */
export interface GalleryPhoto {
  /** otodom's 655×491 variant, or `null` when the row has none (saved before it was stored) or it is not https. */
  medium: string | null;
  /** otodom's 2048×1536 variant. */
  large: string;
}

/** Widths of the variants as otodom serves them (`image;s=WxH` in the URL), for `srcset`. */
const MEDIUM_WIDTH = 655;
const LARGE_WIDTH = 2048;

/**
 * The stored `images` column as photos to render. Any member can PATCH the column, so an element
 * may be anything: one that is not an object, or whose `thumbnail` or `large` is not https, is
 * skipped. `thumbnail` still gates the entry although the grid does not render it, so the card
 * shows the same set of photos as the board row and the archive row. A `medium` that is not
 * https only drops the variant, never the photo.
 */
export function galleryPhotos(images: unknown[]): GalleryPhoto[] {
  return images.flatMap((image) => {
    if (typeof image !== "object" || image === null) return [];
    const entry = image as Partial<Record<keyof OfferImage, unknown>>;
    const thumbnail = safeHttpsUrl(entry.thumbnail);
    const large = safeHttpsUrl(entry.large);
    if (thumbnail === null || large === null) return [];
    return [{ medium: safeHttpsUrl(entry.medium), large }];
  });
}

/** The grid image's `src`: the medium variant, or the large one for a row that has none. */
export function gridSrc(photo: GalleryPhoto): string {
  return photo.medium ?? photo.large;
}

/**
 * The grid image's `srcset`. Each URL is a parser-normalised `href`, so whitespace in it is
 * percent-encoded and cannot split a candidate.
 */
export function gridSrcset(photo: GalleryPhoto): string {
  const large = `${photo.large} ${LARGE_WIDTH}w`;
  return photo.medium === null ? large : `${photo.medium} ${MEDIUM_WIDTH}w, ${large}`;
}

/**
 * The grid image's `sizes`, from the card page's layout at `lg` and up: one photo fills the
 * gallery (~694 px), several share three columns (~223 px each). Below `lg` the page is one column.
 */
export function gridSizes(total: number): string {
  return total === 1 ? "(min-width: 1024px) 694px, 100vw" : "(min-width: 1024px) 223px, (min-width: 640px) 33vw, 50vw";
}
