// The team's search criteria (FR-002, FR-003): the shared hard limits — city, price range,
// minimum square meters — that any member edits, and each member's own free-text requirements,
// which only their author writes. Reading them, and the rules a save must satisfy, shared by
// `POST /api/criteria`, `POST /api/requirements` and the criteria islands. The tables and their
// limits: supabase/migrations/20260927144141_create_team_criteria.sql.
//
// The islands import this module, so `@/lib/supabase` enters it only through `import type`: a
// value import would pull `astro:env/server` into the browser bundle (as in `@/lib/notes`).
//
// Unlike notes, criteria may leave the system: the limits and every member's requirements are an
// input to the audit (PRD, Non-Functional Requirements).

import type { createClient } from "@/lib/supabase";
import { resolveAuthors, type Saver } from "@/lib/members";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** The shared hard limits. An unset limit is `null` — never `0`, never an empty string. */
export interface TeamLimits {
  city: string | null;
  priceMin: number | null;
  priceMax: number | null;
  areaMin: number | null;
}

export const LIMIT_FIELDS = ["city", "price_min", "price_max", "area_min"] as const;

export type LimitField = (typeof LIMIT_FIELDS)[number];

export type LimitsFormValues = Record<LimitField, string>;

export type ParsedLimits = { ok: true; limits: TeamLimits } | { ok: false; error: string };

/** The length limit of the `team_criteria_city_not_blank` check. */
export const CITY_MAX_LENGTH = 100;

const CITY_TOO_LONG = `Nazwa miasta może mieć najwyżej ${CITY_MAX_LENGTH} znaków.`;
const CITY_HAS_COMMA = "Wpisz samo miasto, bez przecinka, np. „Warszawa”.";
const PRICE_RANGE_REVERSED = "Cena od nie może być wyższa niż cena do.";

type NumberField = Exclude<LimitField, "city">;

interface NumberRule {
  /** Digits only, once spaces are removed: a price is whole złoty, an area may have two decimals. */
  pattern: RegExp;
  notANumber: string;
  notPositive: string;
}

const WHOLE = /^\d+$/;
const UP_TO_TWO_DECIMALS = /^\d+(?:[.,]\d{1,2})?$/;

const NUMBER_RULES: Record<NumberField, NumberRule> = {
  price_min: {
    pattern: WHOLE,
    notANumber: "Cena od musi być kwotą w pełnych złotych, np. 850 000.",
    notPositive: "Cena od musi być większa od zera.",
  },
  price_max: {
    pattern: WHOLE,
    notANumber: "Cena do musi być kwotą w pełnych złotych, np. 900 000.",
    notPositive: "Cena do musi być większa od zera.",
  },
  area_min: {
    pattern: UP_TO_TWO_DECIMALS,
    notANumber: "Minimalny metraż musi być liczbą, np. 45 albo 45,5.",
    notPositive: "Minimalny metraż musi być większy od zera.",
  },
};

type ParsedNumber = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * One numeric limit as typed. Every whitespace character is dropped first, so „850 000" reads as
 * 850000 whether its space is typed or is the non-breaking (U+00A0) or narrow (U+202F) space
 * Polish number formatting inserts. Empty is no limit. A price takes no decimal separator at all: „850.000" is a
 * Polish thousands separator as often as a decimal point, and reading it as 850 would silently
 * set the wrong limit. An area takes a comma or a dot with at most two decimals, so „45,5" is
 * 45.5 and „45.000" is refused rather than guessed.
 */
function parseNumber(raw: string, rule: NumberRule): ParsedNumber {
  const compact = raw.replace(/\s/g, "");
  if (compact === "") return { ok: true, value: null };
  if (compact.startsWith("-") && rule.pattern.test(compact.slice(1))) {
    return { ok: false, error: rule.notPositive };
  }
  if (!rule.pattern.test(compact)) return { ok: false, error: rule.notANumber };

  const value = Number(compact.replace(",", "."));
  // A whole price beyond 2^53 would be stored as a different number than the one typed. An area
  // shares the bound, which the table's check also sets.
  const exact = rule.pattern === WHOLE ? Number.isSafeInteger(value) : value <= Number.MAX_SAFE_INTEGER;
  if (!exact) return { ok: false, error: rule.notANumber };
  if (value <= 0) return { ok: false, error: rule.notPositive };
  return { ok: true, value };
}

/**
 * The limits form as the values `team_criteria` will store, or the first reason it cannot be
 * saved — one message per reason. Mirrors every check on the table, so a limit this accepts is
 * never rejected by the database, and the checks mirror it back, so a stored limit is never one the
 * form refuses to save unchanged. The city is trimmed and an empty one is no limit; its length is
 * counted in code points, as Postgres `char_length` counts it.
 */
export function parseLimitsForm(values: LimitsFormValues): ParsedLimits {
  const trimmedCity = values.city.trim();
  if (Array.from(trimmedCity).length > CITY_MAX_LENGTH) return { ok: false, error: CITY_TOO_LONG };
  // The board compares the city with each comma-separated part of an offer's location, so a limit
  // with a comma („Warszawa, mazowieckie") would match no part and mark every offer.
  if (trimmedCity.includes(",")) return { ok: false, error: CITY_HAS_COMMA };

  const priceMin = parseNumber(values.price_min, NUMBER_RULES.price_min);
  if (!priceMin.ok) return priceMin;
  const priceMax = parseNumber(values.price_max, NUMBER_RULES.price_max);
  if (!priceMax.ok) return priceMax;
  const areaMin = parseNumber(values.area_min, NUMBER_RULES.area_min);
  if (!areaMin.ok) return areaMin;

  if (priceMin.value !== null && priceMax.value !== null && priceMin.value > priceMax.value) {
    return { ok: false, error: PRICE_RANGE_REVERSED };
  }

  return {
    ok: true,
    limits: {
      city: trimmedCity === "" ? null : trimmedCity,
      priceMin: priceMin.value,
      priceMax: priceMax.value,
      areaMin: areaMin.value,
    },
  };
}

/** The length limit of the `member_requirements_body_length` check. */
export const REQUIREMENTS_MAX_LENGTH = 2000;

export const REQUIREMENTS_BLANK = "Wpisz treść wymagań.";
const REQUIREMENTS_TOO_LONG = `Wymagania mogą mieć najwyżej ${REQUIREMENTS_MAX_LENGTH} znaków.`;

/**
 * Why requirements cannot be saved, or `null` when they can. The body is checked as it will be
 * stored, so line endings are normalised to `\n` before this runs (as for `noteError`). "No
 * requirements" is a delete, never an empty row.
 */
export function requirementsError(body: string): string | null {
  if (body.trim() === "") return REQUIREMENTS_BLANK;
  if (body.length > REQUIREMENTS_MAX_LENGTH) return REQUIREMENTS_TOO_LONG;
  return null;
}

export interface RequirementsView {
  author: Saver;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The criteria page's read, or a failed read — which is never shown as "no limits" or "no
 * requirements", because a form prefilled from it would overwrite the team's row with blanks.
 * `limitsChangedBy` is `null` only when the limits have never been set.
 */
export type CriteriaResult =
  | {
      state: "ok";
      limits: TeamLimits;
      limitsChangedBy: Saver | null;
      limitsChangedAt: string | null;
      own: RequirementsView | null;
      others: RequirementsView[];
    }
  | { state: "error" };

export type TeamLimitsResult = { ok: true; limits: TeamLimits } | { ok: false };

const LIMIT_COLUMNS = "city, price_min, price_max, area_min";

/** A numeric limit as PostgREST sends it (a JSON number, or a string for a `numeric`), or `undefined` when unreadable. */
function limitNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The limits in a `team_criteria` row, or `null` when the row does not read as one — a value we
 * cannot read is a failed read, never "no limit", which would invent a fact about the team.
 */
function readLimits(row: Record<string, unknown>): TeamLimits | null {
  const city = row.city === null ? null : typeof row.city === "string" ? row.city : undefined;
  const priceMin = limitNumber(row.price_min);
  const priceMax = limitNumber(row.price_max);
  const areaMin = limitNumber(row.area_min);
  if (city === undefined || (city !== null && city.trim() === "")) return null;
  if (priceMin === undefined || priceMax === undefined || areaMin === undefined) return null;
  return { city, priceMin, priceMax, areaMin };
}

interface RequirementsRow {
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/**
 * The limits with who last changed them, and every member's requirements, most recently edited
 * first, split into the viewer's own and the rest. Every author is named in one `members` read
 * (`resolveAuthors`), the limits' signature included: a null `updated_by` with a date is a
 * deleted account, and with no date the limits were never set. No client (the zero-config
 * state), a failed query, a missing singleton row or an exception is `{ state: "error" }`.
 * Never throws.
 */
export async function loadCriteria(
  supabase: SupabaseClient | null,
  viewerId: string | undefined,
): Promise<CriteriaResult> {
  if (!supabase) return { state: "error" };
  try {
    const [criteria, requirements] = await Promise.all([
      supabase.from("team_criteria").select(`${LIMIT_COLUMNS}, updated_at, updated_by`).eq("id", true).maybeSingle(),
      supabase
        .from("member_requirements")
        .select("author_id, body, created_at, updated_at")
        .order("updated_at", { ascending: false }),
    ]);
    if (criteria.error || requirements.error || !criteria.data) return { state: "error" };

    const row = criteria.data as Record<string, unknown>;
    const limits = readLimits(row);
    if (limits === null) return { state: "error" };
    const changedAt = typeof row.updated_at === "string" ? row.updated_at : null;
    const changedBy = typeof row.updated_by === "string" ? row.updated_by : null;

    const rows = requirements.data as RequirementsRow[];
    const authorIds: (string | null)[] = rows.map((requirement) => requirement.author_id);
    // The limits' signature rides in the same read, last; never set means nobody to name.
    if (changedAt !== null) authorIds.push(changedBy);
    const authors = await resolveAuthors(supabase, authorIds, viewerId);

    let own: RequirementsView | null = null;
    const others: RequirementsView[] = [];
    // `resolveAuthors` answers in the order of its input, so `authors[index]` is this row's author.
    for (const [index, requirement] of rows.entries()) {
      const view: RequirementsView = {
        author: authors[index],
        body: requirement.body,
        createdAt: requirement.created_at,
        updatedAt: requirement.updated_at,
      };
      if (requirement.author_id === viewerId) {
        own = view;
      } else {
        others.push(view);
      }
    }

    return {
      state: "ok",
      limits,
      limitsChangedBy: changedAt === null ? null : authors[rows.length],
      limitsChangedAt: changedAt,
      own,
      others,
    };
  } catch {
    return { state: "error" };
  }
}

/**
 * Just the limits, for the offer board. No client, a failed query, a missing singleton row or an
 * exception is `{ ok: false }` — never "no limits", which would hide every breach. Never throws.
 */
export async function loadTeamLimits(supabase: SupabaseClient | null): Promise<TeamLimitsResult> {
  if (!supabase) return { ok: false };
  try {
    const result = await supabase.from("team_criteria").select(LIMIT_COLUMNS).eq("id", true).maybeSingle();
    if (result.error || !result.data) return { ok: false };
    const limits = readLimits(result.data);
    return limits === null ? { ok: false } : { ok: true, limits };
  } catch {
    return { ok: false };
  }
}
