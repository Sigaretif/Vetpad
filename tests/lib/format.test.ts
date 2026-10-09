import { describe, expect, it } from "vitest";
import { formatClock, formatElapsed, pluralForm } from "@/lib/format";

// Expected values are written by hand: the clock is the one the team reads in Poland
// (Europe/Warsaw — UTC+2 in summer, UTC+1 in winter), the running time counts whole seconds, and
// the noun forms follow the Polish rule for counts (1; 2–4 except 12–14; everything else).

describe("formatClock: the time of day as read in Poland", () => {
  it.each<[string, string]>([
    ["2026-10-09T12:31:00Z", "14:31"],
    ["2026-10-09T12:31:59.999Z", "14:31"],
    ["2026-12-01T07:05:00Z", "08:05"],
    ["2026-10-09T22:30:00Z", "00:30"],
    ["2026-10-09T14:31:00+02:00", "14:31"],
  ])("shows %s as %s", (value, expected) => {
    expect(formatClock(value)).toBe(expected);
  });

  it("shows a value that is not a date as it stands", () => {
    expect(formatClock("niedawno")).toBe("niedawno");
  });
});

describe("formatElapsed: a running time in whole seconds", () => {
  it.each<[number, string]>([
    [0, "0 s"],
    [1, "1 s"],
    [59, "59 s"],
    [60, "1 min 0 s"],
    [74, "1 min 14 s"],
    [180, "3 min 0 s"],
    [59.9, "59 s"],
    [-5, "0 s"],
  ])("shows %d as %j", (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected);
  });
});

describe("pluralForm: the noun form a count takes in Polish", () => {
  const form = (count: number) => pluralForm(count, "wymaganie", "wymagania", "wymagań");

  it.each([1])("takes the singular for %d", (count) => {
    expect(form(count)).toBe("wymaganie");
  });

  it.each([2, 3, 4, 22, 23, 24, 32, 102, 104])("takes the form of 2–4 for %d", (count) => {
    expect(form(count)).toBe("wymagania");
  });

  it.each([0, 5, 9, 10, 11, 12, 13, 14, 15, 20, 21, 25, 100, 101, 111, 112, 114])(
    "takes the form of 5 and more for %d",
    (count) => {
      expect(form(count)).toBe("wymagań");
    },
  );
});
