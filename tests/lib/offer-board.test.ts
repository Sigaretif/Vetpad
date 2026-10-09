import { describe, expect, it } from "vitest";
import type { AuditIndex } from "@/lib/audit/store";
import {
  type AuditStatus,
  type BoardSort,
  type BoardSortKey,
  auditStatus,
  boardSortHref,
  parseBoardSort,
} from "@/lib/offer-board";

// Expected values are written by hand from the board's contract — the shared-offer-board plan
// (context/archive/2026-09-26-shared-offer-board/plan.md, "Logika tablicy") and the decision that
// `sort` and `dir` are read strictly, in lower case — never copied from what the functions return.
// That an offer without a price or an area stands last is a property of the SQL query in
// src/pages/dashboard.astro, not of this module: scripts/smoke.mjs proves it on a real database.
// For `auditStatus`: its contract in context/changes/grounded-listing-audit/plan.md (Phase 5 —
// `audited` when the offer has a stored result, `unknown` when the index could not be read).

/** The sort the board reads from a query string. */
function parse(query: string): BoardSort {
  return parseBoardSort(new URLSearchParams(query));
}

describe("parseBoardSort: the address always gives a valid sort (#1, FR-006)", () => {
  it("sorts by the date added, newest first, when the address names no sort", () => {
    expect(parse("")).toEqual({ key: "added", dir: "desc" });
  });

  it.each<[string, BoardSort]>([
    ["sort=added", { key: "added", dir: "desc" }],
    ["sort=price", { key: "price", dir: "asc" }],
    ["sort=area", { key: "area", dir: "desc" }],
  ])("starts %j in that key's own direction", (query, expected) => {
    expect(parse(query)).toEqual(expected);
  });

  it.each<[string, BoardSort]>([
    ["sort=added&dir=asc", { key: "added", dir: "asc" }],
    ["sort=added&dir=desc", { key: "added", dir: "desc" }],
    ["sort=price&dir=asc", { key: "price", dir: "asc" }],
    ["sort=price&dir=desc", { key: "price", dir: "desc" }],
    ["sort=area&dir=asc", { key: "area", dir: "asc" }],
    ["sort=area&dir=desc", { key: "area", dir: "desc" }],
    ["dir=desc&sort=price", { key: "price", dir: "desc" }],
  ])("respects the direction in %j", (query, expected) => {
    expect(parse(query)).toEqual(expected);
  });

  // Every key is asked with the direction opposite to its default beside it (above), so a
  // function that ignored `dir` altogether would not pass both.
  it.each<[string, BoardSort]>([
    ["sort=added&dir=sideways", { key: "added", dir: "desc" }],
    ["sort=price&dir=sideways", { key: "price", dir: "asc" }],
    ["sort=area&dir=sideways", { key: "area", dir: "desc" }],
    ["sort=added&dir=", { key: "added", dir: "desc" }],
    ["sort=price&dir=", { key: "price", dir: "asc" }],
    ["sort=area&dir=", { key: "area", dir: "desc" }],
  ])("falls back to the key's own direction for the unknown direction in %j", (query, expected) => {
    expect(parse(query)).toEqual(expected);
  });

  it.each(["sort=bogus", "sort=bogus&dir=asc", "sort=bogus&dir=sideways", "dir=asc"])(
    "reads %j as the default sort",
    (query) => {
      expect(parse(query)).toEqual({ key: "added", dir: "desc" });
    },
  );

  // Strict, lower case: the interface only ever builds lower-case links, so anything else is unknown.
  it.each(["sort=PRICE", "sort=Price&dir=desc", "sort=", "sort=&dir=asc", "sort=%20price", "sort=price%20"])(
    "reads %j as the default sort, because the key is not spelled exactly",
    (query) => {
      expect(parse(query)).toEqual({ key: "added", dir: "desc" });
    },
  );

  it.each<[string, BoardSort]>([
    ["sort=price&dir=ASC", { key: "price", dir: "asc" }],
    ["sort=price&dir=DESC", { key: "price", dir: "asc" }],
    ["sort=area&dir=ASC", { key: "area", dir: "desc" }],
    ["sort=added&dir=Asc", { key: "added", dir: "desc" }],
  ])("reads the direction in %j as unknown, because it is not spelled exactly", (query, expected) => {
    expect(parse(query)).toEqual(expected);
  });

  // A name every object inherits is not a sort key: it must neither throw nor come back as the key.
  it.each([
    "sort=toString",
    "sort=__proto__",
    "sort=constructor",
    "sort=hasOwnProperty&dir=asc",
    "sort=valueOf&dir=desc",
  ])("never throws on %j and reads it as the default sort", (query) => {
    expect(parse(query)).toEqual({ key: "added", dir: "desc" });
  });
});

describe("boardSortHref: the link of a sort control (#1, FR-006)", () => {
  it.each<[BoardSort, BoardSortKey, string]>([
    [{ key: "added", dir: "desc" }, "added", "/dashboard?sort=added&dir=asc"],
    [{ key: "added", dir: "asc" }, "added", "/dashboard?sort=added&dir=desc"],
    [{ key: "price", dir: "asc" }, "price", "/dashboard?sort=price&dir=desc"],
    [{ key: "price", dir: "desc" }, "price", "/dashboard?sort=price&dir=asc"],
    [{ key: "area", dir: "desc" }, "area", "/dashboard?sort=area&dir=asc"],
    [{ key: "area", dir: "asc" }, "area", "/dashboard?sort=area&dir=desc"],
  ])("flips the direction of the active key: %j, link for %j", (current, key, expected) => {
    expect(boardSortHref(current, key)).toBe(expected);
  });

  // The current direction belongs to the active key: another key starts in its own, whichever
  // way the board is sorted now.
  it.each<[BoardSort, BoardSortKey, string]>([
    [{ key: "added", dir: "desc" }, "price", "/dashboard?sort=price&dir=asc"],
    [{ key: "added", dir: "asc" }, "price", "/dashboard?sort=price&dir=asc"],
    [{ key: "added", dir: "desc" }, "area", "/dashboard?sort=area&dir=desc"],
    [{ key: "added", dir: "asc" }, "area", "/dashboard?sort=area&dir=desc"],
    [{ key: "price", dir: "asc" }, "added", "/dashboard?sort=added&dir=desc"],
    [{ key: "price", dir: "desc" }, "added", "/dashboard?sort=added&dir=desc"],
    [{ key: "price", dir: "asc" }, "area", "/dashboard?sort=area&dir=desc"],
    [{ key: "price", dir: "desc" }, "area", "/dashboard?sort=area&dir=desc"],
    [{ key: "area", dir: "desc" }, "added", "/dashboard?sort=added&dir=desc"],
    [{ key: "area", dir: "asc" }, "added", "/dashboard?sort=added&dir=desc"],
    [{ key: "area", dir: "desc" }, "price", "/dashboard?sort=price&dir=asc"],
    [{ key: "area", dir: "asc" }, "price", "/dashboard?sort=price&dir=asc"],
  ])("starts another key in its own direction: %j, link for %j", (current, key, expected) => {
    expect(boardSortHref(current, key)).toBe(expected);
  });
});

describe("auditStatus: what a board row says about the offer's audit (#3, FR-006)", () => {
  const AUDITED = "0b9f0c2e-7d1a-4c55-9a53-0000000000f1";
  const NOT_AUDITED = "0b9f0c2e-7d1a-4c55-9a53-0000000000f2";

  /** The index as read: one offer has a stored result. */
  const INDEX: AuditIndex = { ok: true, audited: new Set([AUDITED]) };
  /** A read that succeeded and found no stored result at all. */
  const EMPTY_INDEX: AuditIndex = { ok: true, audited: new Set() };
  const FAILED_INDEX: AuditIndex = { ok: false };

  it("says audited for an offer the index holds", () => {
    expect(auditStatus({ id: AUDITED }, INDEX)).toBe("audited");
  });

  it("says not audited for an offer the index was read without", () => {
    expect(auditStatus({ id: NOT_AUDITED }, INDEX)).toBe("not_audited");
    expect(auditStatus({ id: AUDITED }, EMPTY_INDEX)).toBe("not_audited");
  });

  // A failed read knows nothing about any offer — the audited one included. It is never "not audited".
  it.each([AUDITED, NOT_AUDITED])("says unknown for offer %s when the index could not be read", (id) => {
    const status: AuditStatus = auditStatus({ id }, FAILED_INDEX);

    expect(status).toBe("unknown");
    expect(status).not.toBe("not_audited");
  });
});
