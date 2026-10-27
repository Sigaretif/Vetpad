// The colours of a calculated commute (FR-016): one role token per point, `--route-1` … `--route-6`
// in src/styles/global.css, in the points' order. The table's swatch takes the token as a class;
// the map's line needs it as hex, because `google.maps.Polyline` reads `strokeColor` as a hex
// string only. The island paints the token on a 1×1 canvas and reads the pixel back
// (src/components/offers/CommuteMap.tsx) — the `oklch` text is never parsed — and this module turns
// those bytes into hex.
//
// Pure and import-free: the island ships it to the browser.

/** How many route colours there are: one per point, and the team keeps at most six. */
export const ROUTE_COLOR_COUNT = 6;

// Written out in full, so Tailwind finds every class in the source.
const SWATCH_CLASSES = ["bg-route-1", "bg-route-2", "bg-route-3", "bg-route-4", "bg-route-5", "bg-route-6"] as const;

/** The position in the list of colours of the row at `index` (0-based): a seventh row would take the first again. */
function slot(index: number): number {
  const whole = Number.isInteger(index) && index >= 0 ? index : 0;
  return whole % ROUTE_COLOR_COUNT;
}

/** The swatch class of the row at `index` (0-based). */
export function routeSwatchClass(index: number): string {
  return SWATCH_CLASSES[slot(index)];
}

/** The custom property the map reads for the row at `index` (0-based): `--route-1` for the first. */
export function routeColorToken(index: number): string {
  return `--route-${slot(index) + 1}`;
}

function byte(value: number | undefined): string {
  const clamped = value === undefined || !Number.isFinite(value) ? 0 : Math.min(255, Math.max(0, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

/**
 * `#rrggbb` from the first three bytes of a pixel as `getImageData` reads it (red, green, blue,
 * alpha). The alpha byte is ignored: the line's opacity is the map's to set. A missing or
 * out-of-range channel is clamped to 0–255, so the answer is always a valid colour.
 */
export function rgbaToHex(bytes: ArrayLike<number>): string {
  return `#${byte(bytes[0])}${byte(bytes[1])}${byte(bytes[2])}`;
}
