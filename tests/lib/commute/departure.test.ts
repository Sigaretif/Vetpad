import { describe, expect, it } from "vitest";
import { nextWorkingDayAt8Warsaw } from "@/lib/commute/departure";

// Expected values are written by hand from context/changes/commute-times/plan.md („Departure time”:
// the first Monday–Friday strictly after today's Warsaw date, at 08:00 Warsaw time, as RFC 3339 with
// that day's offset) and the calendar: in 2026 Warsaw moves to summer time on Sunday 29 March and
// back to winter time on Sunday 25 October. Every `now` is written in UTC.

describe("nextWorkingDayAt8Warsaw (FR-016)", () => {
  it.each([
    // [what, now (UTC), Warsaw date it gives, RFC 3339]
    ["Mon 07:00 → Tue", "2026-10-19T06:00:00Z", "2026-10-20", "2026-10-20T08:00:00+02:00"],
    [
      "Mon 09:00 → Tue (today's 08:00 is never used)",
      "2026-10-19T07:00:00Z",
      "2026-10-20",
      "2026-10-20T08:00:00+02:00",
    ],
    ["Fri 18:00 → Mon", "2026-10-16T16:00:00Z", "2026-10-19", "2026-10-19T08:00:00+02:00"],
    ["Sat → Mon", "2026-10-17T10:00:00Z", "2026-10-19", "2026-10-19T08:00:00+02:00"],
    ["Sun → Mon", "2026-10-18T10:00:00Z", "2026-10-19", "2026-10-19T08:00:00+02:00"],
    ["Wed in winter → Thu, +01:00", "2026-01-14T11:00:00Z", "2026-01-15", "2026-01-15T08:00:00+01:00"],
  ])("%s", (_what, now, date, rfc3339) => {
    expect(nextWorkingDayAt8Warsaw(new Date(now))).toEqual({ date, rfc3339 });
  });

  it("takes today from Warsaw's calendar, not UTC's: Mon 23:30 UTC is Tue 00:30 in Warsaw → Wed", () => {
    expect(nextWorkingDayAt8Warsaw(new Date("2026-10-19T22:30:00Z"))).toEqual({
      date: "2026-10-21",
      rfc3339: "2026-10-21T08:00:00+02:00",
    });
  });

  it("control: Mon 23:30 in Warsaw (21:30 UTC) is still Monday → Tue", () => {
    expect(nextWorkingDayAt8Warsaw(new Date("2026-10-19T21:30:00Z"))).toEqual({
      date: "2026-10-20",
      rfc3339: "2026-10-20T08:00:00+02:00",
    });
  });

  describe("the October DST weekend (back to +01:00 on Sun 25 Oct 2026)", () => {
    it("Fri 23 Oct, in summer time → Mon 26 Oct 08:00+01:00", () => {
      expect(nextWorkingDayAt8Warsaw(new Date("2026-10-23T16:00:00Z"))).toEqual({
        date: "2026-10-26",
        rfc3339: "2026-10-26T08:00:00+01:00",
      });
    });

    it("Sun 25 Oct, after the change → Mon 26 Oct 08:00+01:00", () => {
      expect(nextWorkingDayAt8Warsaw(new Date("2026-10-25T12:00:00Z"))).toEqual({
        date: "2026-10-26",
        rfc3339: "2026-10-26T08:00:00+01:00",
      });
    });
  });

  describe("the March DST weekend (forward to +02:00 on Sun 29 Mar 2026)", () => {
    it("Fri 27 Mar, in winter time → Mon 30 Mar 08:00+02:00", () => {
      expect(nextWorkingDayAt8Warsaw(new Date("2026-03-27T17:00:00Z"))).toEqual({
        date: "2026-03-30",
        rfc3339: "2026-03-30T08:00:00+02:00",
      });
    });

    it("Sat 28 Mar → Mon 30 Mar 08:00+02:00", () => {
      expect(nextWorkingDayAt8Warsaw(new Date("2026-03-28T10:00:00Z"))).toEqual({
        date: "2026-03-30",
        rfc3339: "2026-03-30T08:00:00+02:00",
      });
    });
  });

  it("names the same instant as 07:00 UTC in winter and 06:00 UTC in summer", () => {
    expect(new Date(nextWorkingDayAt8Warsaw(new Date("2026-10-23T16:00:00Z")).rfc3339).toISOString()).toBe(
      "2026-10-26T07:00:00.000Z",
    );
    expect(new Date(nextWorkingDayAt8Warsaw(new Date("2026-03-27T17:00:00Z")).rfc3339).toISOString()).toBe(
      "2026-03-30T06:00:00.000Z",
    );
  });
});
