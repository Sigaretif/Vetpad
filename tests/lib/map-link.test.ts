import { describe, expect, it } from "vitest";
import { mapSearchUrl } from "@/lib/map-link";

// Expected values are written by hand from the contract in the location-map-link plan — never
// copied from what the function returns. Every case that gives no link stands beside one where
// the same row gives it: alone, it would pass on a function that always answers null.

type MapOffer = Parameters<typeof mapSearchUrl>[0];

const MAPS_PREFIX = "https://www.google.com/maps/search/?";

const STREET = "ul. Przykładowa";
const LABEL = "Warszawa, Mokotów, Stary Mokotów";
const STREET_AND_LABEL = "ul. Przykładowa, Warszawa, Mokotów, Stary Mokotów";

/** A row as the Data API may hand it over: a column can hold anything, whatever its type says. */
function offer(location_label: unknown, street_name: unknown): MapOffer {
  return { location_label, street_name } as MapOffer;
}

/** The address parsed, after checking that the function gave one. */
function parsed(url: string | null): URL {
  if (url === null) throw new Error("expected a map address, got null");
  return new URL(url);
}

/** The search text the address carries, decoded. */
function queryOf(url: string | null): string | null {
  return parsed(url).searchParams.get("query");
}

describe("mapSearchUrl: the query is the street, then the location label", () => {
  it("joins a stated street and the label with a comma and a space, street first", () => {
    expect(queryOf(mapSearchUrl(offer(LABEL, STREET)))).toBe(STREET_AND_LABEL);
  });

  it("searches for the label alone when no street is stated", () => {
    expect(queryOf(mapSearchUrl(offer("Ząbki, wołomiński, mazowieckie", null)))).toBe("Ząbki, wołomiński, mazowieckie");
  });

  it("builds the whole address from the fixed prefix and the query encoded once", () => {
    expect(mapSearchUrl(offer("Zabki, mazowieckie", null))).toBe(
      "https://www.google.com/maps/search/?api=1&query=Zabki%2C%20mazowieckie",
    );
  });

  it("carries exactly the parameters api=1 and query", () => {
    const url = parsed(mapSearchUrl(offer(LABEL, STREET)));
    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/maps/search/");
    expect([...url.searchParams.keys()]).toEqual(["api", "query"]);
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.hash).toBe("");
  });
});

describe("mapSearchUrl: no location label, no link", () => {
  // null, empty and blank labels, and values a string column should never hold.
  const NO_LABEL: unknown[] = [null, "", "   ", "\t\n", undefined, 42, 0, true, {}, ["Warszawa"]];

  it.each(NO_LABEL)("gives no link for the label %j, with a street stated", (label) => {
    expect(mapSearchUrl(offer(label, STREET))).toBeNull();
  });

  it.each(NO_LABEL)("gives no link for the label %j, with no street", (label) => {
    expect(mapSearchUrl(offer(label, null))).toBeNull();
  });

  it("gives the link for the same rows once the label is stated", () => {
    expect(queryOf(mapSearchUrl(offer(LABEL, STREET)))).toBe(STREET_AND_LABEL);
    expect(queryOf(mapSearchUrl(offer(LABEL, null)))).toBe(LABEL);
  });
});

describe("mapSearchUrl: a street that states nothing is left out", () => {
  // The query is the label alone — in particular, it never starts with a comma.
  it.each<unknown>([null, "", "   ", "\t\n", undefined, 42, 0, true, {}, ["ul. Przykładowa"]])(
    "searches for the label alone when the street is %j",
    (street) => {
      expect(queryOf(mapSearchUrl(offer(LABEL, street)))).toBe(LABEL);
    },
  );

  it("puts the street in front once it is stated", () => {
    expect(queryOf(mapSearchUrl(offer(LABEL, STREET)))).toBe(STREET_AND_LABEL);
  });
});

describe("mapSearchUrl: whitespace around both values is trimmed", () => {
  it.each<[string, string | null, string]>([
    [`  ${LABEL}  `, `  ${STREET}  `, STREET_AND_LABEL],
    [`\n${LABEL}\t`, `\t${STREET}\n`, STREET_AND_LABEL],
    [`  ${LABEL}  `, null, LABEL],
    [LABEL, `  ${STREET}  `, STREET_AND_LABEL],
    [`  ${LABEL}  `, STREET, STREET_AND_LABEL],
  ])("reads the label %j and the street %j as the query %j", (label, street, expected) => {
    expect(queryOf(mapSearchUrl(offer(label, street)))).toBe(expected);
  });

  it("keeps the whitespace inside a value", () => {
    expect(queryOf(mapSearchUrl(offer("Nowy  Sącz", "al.  Wolności 1")))).toBe("al.  Wolności 1, Nowy  Sącz");
  });
});

// The row is the attack surface: any signed-in member can PATCH it through the Data API. Whatever
// it holds stays inside the value of `query`.
describe("mapSearchUrl: the row's content never leaves the query parameter", () => {
  const HOSTILE = [
    "javascript:alert(1)",
    '"><script>alert(1)</script>',
    "x&api=2&query=y",
    "https://evil.example/",
    "x#y?z=1",
    "100% + a/b\\c",
  ];

  function expectContained(url: string | null, query: string) {
    expect(url).not.toBeNull();
    expect(url?.startsWith(MAPS_PREFIX)).toBe(true);
    const address = parsed(url);
    expect(address.protocol).toBe("https:");
    expect(address.host).toBe("www.google.com");
    expect(address.pathname).toBe("/maps/search/");
    expect(address.hash).toBe("");
    expect(address.searchParams.get("api")).toBe("1");
    expect(address.searchParams.getAll("api")).toEqual(["1"]);
    expect(address.searchParams.getAll("query")).toEqual([query]);
    expect([...address.searchParams.keys()]).toEqual(["api", "query"]);
  }

  it.each(HOSTILE)("keeps the hostile label %j as the one query value", (value) => {
    expectContained(mapSearchUrl(offer(value, null)), value);
  });

  it.each(HOSTILE)("keeps the hostile street %j inside the one query value", (value) => {
    expectContained(mapSearchUrl(offer(LABEL, value)), `${value}, ${LABEL}`);
  });

  it.each(HOSTILE)("keeps %j as both the street and the label inside the one query value", (value) => {
    expectContained(mapSearchUrl(offer(value, value)), `${value}, ${value}`);
  });

  it("leaves no raw markup or separator from the row in the address", () => {
    const url = mapSearchUrl(offer('"><script>alert(1)</script>', "x&api=2&query=y"));
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=x%26api%3D2%26query%3Dy%2C%20%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    );
  });
});
