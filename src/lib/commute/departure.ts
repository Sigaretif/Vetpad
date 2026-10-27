// The departure time of a public-transport commute (FR-016): the first working day after today, at
// 08:00 in Warsaw. A fixed morning instead of the moment of the press, so a calculation made at night
// or on a Sunday shows the commute a member would make. Monday to Friday count as working days; no
// public-holiday calendar is kept (the plan's decision).
//
// Pure: the clock is passed in. Built on `Intl.DateTimeFormat` in `Europe/Warsaw`, no date library.

const ZONE = "Europe/Warsaw";
const DAY_MS = 86_400_000;

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const offsetParts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, timeZoneName: "longOffset" });

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((p) => p.type === type);
  if (found === undefined) throw new Error(`Intl.DateTimeFormat gave no ${type}`);
  return found.value;
}

/** Warsaw's offset from UTC at `instant`, in minutes: `GMT+02:00` is 120, `GMT` is 0. */
function offsetMinutes(instant: number): number {
  const name = part(offsetParts.formatToParts(new Date(instant)), "timeZoneName");
  if (name === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (match === null) throw new Error(`unexpected offset name ${name}`);
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * The first Monday–Friday strictly after `now`'s date in Warsaw, at 08:00 Warsaw time: as RFC 3339
 * with that day's offset (`rfc3339`, what Routes reads) and as a `YYYY-MM-DD` date (`date`, what the
 * card shows). 08:00 never falls inside a DST change, which happens at night.
 */
export function nextWorkingDayAt8Warsaw(now: Date): { rfc3339: string; date: string } {
  const today = dateParts.formatToParts(now);
  // The Warsaw calendar date, handled as a UTC midnight: only its day of the week and its successors are needed.
  let day = Date.UTC(Number(part(today, "year")), Number(part(today, "month")) - 1, Number(part(today, "day")));
  do {
    day += DAY_MS;
  } while (new Date(day).getUTCDay() === 0 || new Date(day).getUTCDay() === 6);

  const date = new Date(day).toISOString().slice(0, 10);
  const eightUtc = day + 8 * 3_600_000;
  // The offset at that local 08:00: read once at a first guess, then again at the instant it gives.
  const guess = offsetMinutes(eightUtc);
  const offset = offsetMinutes(eightUtc - guess * 60_000);
  return { rfc3339: `${date}T08:00:00${formatOffset(offset)}`, date };
}
