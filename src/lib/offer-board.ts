// Rules of the shared offer board on /dashboard (FR-006): which columns it reads, how the sort
// is read from the URL, how a sort link is built, and what audit status a row shows.
// Pure on purpose, like otodom/labels.ts: no runtime imports, only types.

import type { OfferRow } from "@/lib/otodom/types";

export type BoardSortKey = "added" | "price" | "area";
export type BoardSortDir = "asc" | "desc";

export interface BoardSort {
  key: BoardSortKey;
  dir: BoardSortDir;
}

/**
 * The column each sort key orders by. The page orders price and area with `nullsFirst: false`
 * in both directions: an offer that does not state the value is always last, never the
 * cheapest or the largest (prd.md, Guardrails).
 */
export const BOARD_SORT_COLUMN: Record<BoardSortKey, "created_at" | "price" | "area_m2"> = {
  added: "created_at",
  price: "price",
  area: "area_m2",
};

/** The direction a key starts in when it is picked: newest, cheapest, largest first. */
const DEFAULT_DIR: Record<BoardSortKey, BoardSortDir> = {
  added: "desc",
  price: "asc",
  area: "desc",
};

const DEFAULT_SORT: BoardSort = { key: "added", dir: DEFAULT_DIR.added };

function isSortKey(value: string | null): value is BoardSortKey {
  return value !== null && Object.hasOwn(BOARD_SORT_COLUMN, value);
}

function isSortDir(value: string | null): value is BoardSortDir {
  return value === "asc" || value === "desc";
}

/**
 * `?sort=<key>&dir=<dir>` as a sort. An unknown or missing `sort` is the default sort; a known
 * `sort` with an unknown or missing `dir` takes that key's default direction. Never throws.
 */
export function parseBoardSort(params: URLSearchParams): BoardSort {
  const key = params.get("sort");
  if (!isSortKey(key)) return { ...DEFAULT_SORT };
  const dir = params.get("dir");
  return { key, dir: isSortDir(dir) ? dir : DEFAULT_DIR[key] };
}

/** The link for a sort control: the active key flips its direction, another key starts at its default. */
export function boardSortHref(current: BoardSort, key: BoardSortKey): string {
  const dir = current.key === key ? (current.dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[key];
  return `/dashboard?sort=${key}&dir=${dir}`;
}

/** The board's `select`: what a row shows, without `raw` and `description`, the row's largest fields. */
export const BOARD_COLUMNS =
  "id, title, price, price_currency, area_m2, location_label, street_name, images, created_at";

export type OfferBoardItem = Pick<
  OfferRow,
  "id" | "title" | "price" | "price_currency" | "area_m2" | "location_label" | "street_name" | "images" | "created_at"
>;

/** A board read: the rows, or a failure the board shows as an error — never as an empty board. */
export type BoardResult = { ok: true; offers: OfferBoardItem[] } | { ok: false };

export type AuditStatus = "not_audited";

/**
 * Every offer is unaudited today: there is no audit table yet. This is the swap point for S-04
 * (grounded-listing-audit), which extends `AuditStatus` with the audited state and gives this
 * function its data source; `AuditStatusBadge.astro` is the one place its label is rendered.
 */
export function auditStatus(_offer: OfferBoardItem): AuditStatus {
  return "not_audited";
}
