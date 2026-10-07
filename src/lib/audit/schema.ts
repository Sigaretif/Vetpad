// The two shapes of an audit's findings (FR-011): what the model is asked to answer, and what is
// stored and shown once the grounding has passed over it (`@/lib/audit/grounding`).
//
// The answer's shape is enforced by the provider from `AUDIT_OUTPUT_SCHEMA`; no validation
// library is involved (CLAUDE.md, Conventions). The schema guarantees shape, never content: that
// an excerpt really occurs in the listing is the grounding's job, not the schema's.
//
// No runtime import beyond the attribute list: the card reads `readFindings` from here.

import { DECISION_CRITICAL_ATTRIBUTES, type DecisionCriticalAttribute } from "@/lib/audit/input";

/** A missing-information finding about a member's requirement rather than one of the nine attributes. */
export const REQUIREMENT_ATTRIBUTE = "requirement";

/** What a missing-information finding may be about: one of the nine attributes, or a requirement. */
export type MissingAttribute = DecisionCriticalAttribute | typeof REQUIREMENT_ATTRIBUTE;

export const MISSING_ATTRIBUTES: readonly MissingAttribute[] = [...DECISION_CRITICAL_ATTRIBUTES, REQUIREMENT_ATTRIBUTE];

/** Something the listing does not say, and the question for the seller it implies. Carries no excerpt: an absence cannot be quoted. */
export interface OutputMissing {
  attribute: MissingAttribute;
  /** `Wn` for a finding about a requirement; `null` for one of the nine attributes. */
  requirement_ref: string | null;
  question: string;
}

/** A positive finding: a short label and the listing's own words it rests on. */
export interface OutputExcerpted {
  label: string;
  excerpt: string;
}

export interface OutputRedFlag extends OutputExcerpted {
  /** `Wn` when the flag concerns a member's requirement; `null` otherwise. */
  requirement_ref: string | null;
}

/** The model's answer, as `AUDIT_OUTPUT_SCHEMA` shapes it. `tests/lib/audit/schema.test.ts` keeps the two in step. */
export interface AuditOutput {
  missing: OutputMissing[];
  conditions: OutputExcerpted[];
  costs: OutputExcerpted[];
  red_flags: OutputRedFlag[];
}

const TEXT = { type: "string" } as const;
const TEXT_OR_NULL = { type: ["string", "null"] } as const;

const EXCERPTED_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["label", "excerpt"],
  properties: { label: TEXT, excerpt: TEXT },
} as const;

/**
 * The answer's shape as raw JSON Schema, written for the provider's schema-constrained output:
 * every object closes itself with `additionalProperties: false` and lists every property as
 * required, a nullable field is a type union, and there is no `minLength`, `pattern` or
 * `minItems` — the provider does not enforce them, so a rule stated that way would hold nowhere.
 */
export const AUDIT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["missing", "conditions", "costs", "red_flags"],
  properties: {
    missing: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["attribute", "requirement_ref", "question"],
        properties: {
          attribute: { type: "string", enum: [...MISSING_ATTRIBUTES] },
          requirement_ref: TEXT_OR_NULL,
          question: TEXT,
        },
      },
    },
    conditions: { type: "array", items: EXCERPTED_ITEM },
    costs: { type: "array", items: EXCERPTED_ITEM },
    red_flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "excerpt", "requirement_ref"],
        properties: { label: TEXT, excerpt: TEXT, requirement_ref: TEXT_OR_NULL },
      },
    },
  },
} as const;

/** Which of the listing's two texts an excerpt was found in. */
export const EXCERPT_SOURCES = ["title", "description"] as const;

export type ExcerptSource = (typeof EXCERPT_SOURCES)[number];

export interface StoredMissing {
  attribute: MissingAttribute;
  /**
   * For a finding about a requirement: that requirement's text as it read when the audit ran —
   * a snapshot, never `Wn` (the numbering belongs to one audit's input) and never its author.
   * `null` for a finding about one of the nine attributes.
   */
  requirement: string | null;
  question: string;
}

export interface StoredExcerpted {
  label: string;
  /** The listing's own text, cut from the stored title or description — never the model's copy of it. */
  excerpt: string;
  source: ExcerptSource;
}

export interface StoredRedFlag extends StoredExcerpted {
  /** The text of the requirement the flag concerns, as a snapshot; `null` when it concerns none. */
  requirement: string | null;
}

/** The value of `offer_audits.findings`: what the grounding let through, and nothing it did not. */
export interface StoredFindings {
  version: 1;
  missing: StoredMissing[];
  conditions: StoredExcerpted[];
  costs: StoredExcerpted[];
  red_flags: StoredRedFlag[];
}

export const FINDINGS_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isMissingAttribute(value: unknown): value is MissingAttribute {
  return (MISSING_ATTRIBUTES as readonly unknown[]).includes(value);
}

function isExcerptSource(value: unknown): value is ExcerptSource {
  return (EXCERPT_SOURCES as readonly unknown[]).includes(value);
}

/** Every item of a stored list through its reader, or `null` when the value is not a list or an item does not read. */
function readList<Item>(value: unknown, read: (item: unknown) => Item | null): Item[] | null {
  if (!Array.isArray(value)) return null;
  const items: Item[] = [];
  for (const entry of value as unknown[]) {
    const item = read(entry);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

/** A requirement snapshot is there exactly when the finding is about a requirement. */
function readMissing(item: unknown): StoredMissing | null {
  if (!isRecord(item)) return null;
  const { attribute, requirement, question } = item;
  if (!isMissingAttribute(attribute) || !isText(question)) return null;
  if (attribute === REQUIREMENT_ATTRIBUTE) return isText(requirement) ? { attribute, requirement, question } : null;
  return requirement === null ? { attribute, requirement, question } : null;
}

function readExcerpted(item: unknown): StoredExcerpted | null {
  if (!isRecord(item)) return null;
  const { label, excerpt, source } = item;
  if (typeof label !== "string" || !isText(excerpt) || !isExcerptSource(source)) return null;
  return { label, excerpt, source };
}

function readRedFlag(item: unknown): StoredRedFlag | null {
  const excerpted = readExcerpted(item);
  if (excerpted === null || !isRecord(item)) return null;
  const { requirement } = item;
  if (requirement !== null && !isText(requirement)) return null;
  return { ...excerpted, requirement };
}

/**
 * Stored findings as the card may show them, or `null` when the value does not read as findings
 * of this version: another `version`, a missing list, an item that is not an object, an attribute
 * or a source off the lists, a blank question or excerpt, a requirement snapshot where there
 * should be none or none where there should be one.
 *
 * `null` is a failed read, never "no findings" — an audit that found nothing is four empty lists.
 * The row is not trusted: any member can write `offer_audits` through the Data API. The answer is
 * rebuilt from the known fields alone, so nothing else a row carries reaches a view.
 */
export function readFindings(value: unknown): StoredFindings | null {
  if (!isRecord(value) || value.version !== FINDINGS_VERSION) return null;
  const missing = readList(value.missing, readMissing);
  const conditions = readList(value.conditions, readExcerpted);
  const costs = readList(value.costs, readExcerpted);
  const redFlags = readList(value.red_flags, readRedFlag);
  if (missing === null || conditions === null || costs === null || redFlags === null) return null;
  return { version: FINDINGS_VERSION, missing, conditions, costs, red_flags: redFlags };
}
