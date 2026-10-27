import { describe, expect, it } from "vitest";
import { ROUTE_COLOR_COUNT, rgbaToHex, routeColorToken, routeSwatchClass } from "@/lib/commute/colors";

// The colours of a calculated commute (FR-016). Expected values are written by hand from the
// contract in context/changes/commute-times/plan.md (Phase 4, „Islands” and „Critical
// Implementation Details”): the map reads `--route-N` back from a canvas pixel and `rgbaToHex`
// turns its bytes into the hex `google.maps.Polyline` accepts — alpha ignored, every channel two
// digits.

describe("rgbaToHex: a canvas pixel as the hex a map line takes", () => {
  it.each<[string, number[], string]>([
    ["an opaque colour", [244, 63, 94, 255], "#f43f5e"],
    ["black", [0, 0, 0, 255], "#000000"],
    ["white", [255, 255, 255, 255], "#ffffff"],
    ["single-digit channels, zero-padded", [1, 10, 15, 255], "#010a0f"],
  ])("reads %s", (_case, bytes, hex) => {
    expect(rgbaToHex(Uint8ClampedArray.from(bytes))).toBe(hex);
  });

  it("ignores the alpha byte: a half-transparent pixel gives the same colour as an opaque one", () => {
    expect(rgbaToHex([16, 32, 48, 128])).toBe("#102030");
    expect(rgbaToHex([16, 32, 48, 0])).toBe("#102030");
    expect(rgbaToHex([16, 32, 48])).toBe("#102030");
  });

  it("clamps what a typed array would never hold, and reads a missing channel as 0", () => {
    expect(rgbaToHex([300, -5, 127.6, 255])).toBe("#ff0080");
    expect(rgbaToHex([Number.NaN, 255])).toBe("#00ff00");
    expect(rgbaToHex([])).toBe("#000000");
  });
});

describe("routeSwatchClass and routeColorToken: one colour per row, in the points' order", () => {
  it("gives the first row route-1 and the sixth route-6", () => {
    expect(ROUTE_COLOR_COUNT).toBe(6);
    expect(routeSwatchClass(0)).toBe("bg-route-1");
    expect(routeColorToken(0)).toBe("--route-1");
    expect(routeSwatchClass(5)).toBe("bg-route-6");
    expect(routeColorToken(5)).toBe("--route-6");
  });

  it("starts again past the sixth, and reads an index that is not a row as the first", () => {
    expect(routeSwatchClass(6)).toBe("bg-route-1");
    expect(routeColorToken(7)).toBe("--route-2");
    expect(routeSwatchClass(-1)).toBe("bg-route-1");
    expect(routeColorToken(1.5)).toBe("--route-1");
  });
});
