// The one gate between the model's answer and what the team sees (FR-011; PRD, Guardrails: the
// AI never asserts without evidence). It only ever takes away: a finding is kept as the model
// gave it or not kept at all. Nothing here repairs an excerpt, adds a finding, or concludes from
// an empty column that the listing is silent — the text may state what the parameter omits.
//
// Pure: no I/O, no clock, no logging. The caller logs the two counts.

import type { AuditInput } from "@/lib/audit/input";
import {
  type AuditOutput,
  type ExcerptSource,
  FINDINGS_VERSION,
  type OutputExcerpted,
  REQUIREMENT_ATTRIBUTE,
  type StoredExcerpted,
  type StoredFindings,
  type StoredMissing,
  type StoredRedFlag,
} from "@/lib/audit/schema";

/**
 * The shortest excerpt that grounds a finding, in characters (code points) of the excerpt once
 * its whitespace is collapsed and its ends trimmed. Below it, a "quotation" such as „nie" or
 * „tak" occurs in every listing and proves nothing. The instruction states the same number.
 */
export const MIN_EXCERPT_LENGTH = 10;

/**
 * The longest label and the longest question that are kept, in characters (code points) once the
 * ends are trimmed. The excerpt is checked against the listing; the label and the question are the
 * model's own words and are checked against nothing, so a listing that steers the model could put
 * a paragraph of its choosing beside a genuine quotation. The instruction asks for about ten
 * words and for one sentence; these are several times that (the user's choice, 2026-10-09).
 */
export const MAX_LABEL_LENGTH = 200;
export const MAX_QUESTION_LENGTH = 400;

/** Whether a label or a question says something and stays within its limit. */
function fits(text: string, limit: number): boolean {
  const length = Array.from(text.trim()).length;
  return length > 0 && length <= limit;
}

export interface GroundingResult {
  findings: StoredFindings;
  /** Positive findings turned away because their excerpt is not the listing's text. The card shows this number. */
  rejected: number;
  /**
   * Every other finding turned away: missing-information findings that broke a rule, and findings
   * of any kind whose label or question is blank or over its limit. For the log, never the card.
   */
  dropped: number;
}

/** Any whitespace character: `\s` covers the no-break space (U+00A0) the mapper decodes from `&#160;`. */
const WHITESPACE = /\s/;
const WHITESPACE_RUNS = /\s+/g;

/** A text with every run of whitespace collapsed to one space, and the way back to the original. */
interface Collapsed {
  text: string;
  /** For each character of `text`, where in the original it begins… */
  starts: number[];
  /** …and where it ends: past the whole run, for the space that stands for one. */
  ends: number[];
}

function collapse(original: string): Collapsed {
  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  while (index < original.length) {
    const character = original.charAt(index);
    let end = index + 1;
    if (WHITESPACE.test(character)) {
      // `charAt` past the end is "", which is not whitespace: the run stops there by itself.
      while (WHITESPACE.test(original.charAt(end))) end += 1;
      parts.push(" ");
    } else {
      parts.push(character);
    }
    starts.push(index);
    ends.push(end);
    index = end;
  }
  return { text: parts.join(""), starts, ends };
}

/** The listing's two texts, collapsed once per audit, in the order an excerpt is looked for. */
type References = readonly [source: ExcerptSource, original: string, collapsed: Collapsed][];

/** The listing's own words behind a finding, and which of the two texts they were found in. */
type Grounded = Pick<StoredExcerpted, "excerpt" | "source">;

/**
 * The listing's own words the model's excerpt points at, or `null` when it points at none.
 *
 * The excerpt and the listing are compared with every run of whitespace read as one space —
 * the model writes an ordinary space where the listing has a no-break one or a line break — and
 * otherwise character for character, case included. Whitespace around the excerpt is not part
 * of it. What is returned is cut from the stored text, with the listing's own whitespace: the
 * model's string is never what gets stored. An excerpt found in both texts is the title's.
 */
function ground(excerpt: string, references: References): Grounded | null {
  const needle = excerpt.replace(WHITESPACE_RUNS, " ").trim();
  if (Array.from(needle).length < MIN_EXCERPT_LENGTH) return null;
  for (const [source, original, collapsed] of references) {
    const at = collapsed.text.indexOf(needle);
    if (at === -1) continue;
    const last = at + needle.length - 1;
    return { excerpt: original.slice(collapsed.starts[at], collapsed.ends[last]), source };
  }
  return null;
}

interface Sorted<Finding> {
  kept: { finding: Finding; grounded: Grounded }[];
  rejected: number;
  dropped: number;
}

/**
 * The positive findings whose excerpt is the listing's text, each with that text, and how many
 * were not. The excerpt is judged first: a finding without one counts as `rejected` whatever its
 * label; one with an excerpt and a label that does not fit counts as `dropped`.
 */
function sortByExcerpt<Finding extends OutputExcerpted>(
  list: readonly Finding[],
  references: References,
): Sorted<Finding> {
  const sorted: Sorted<Finding> = { kept: [], rejected: 0, dropped: 0 };
  for (const finding of list) {
    const grounded = ground(finding.excerpt, references);
    if (grounded === null) {
      sorted.rejected += 1;
    } else if (!fits(finding.label, MAX_LABEL_LENGTH)) {
      sorted.dropped += 1;
    } else {
      sorted.kept.push({ finding, grounded });
    }
  }
  return sorted;
}

function storeExcerpted({ finding, grounded }: Sorted<OutputExcerpted>["kept"][number]): StoredExcerpted {
  return { label: finding.label, excerpt: grounded.excerpt, source: grounded.source };
}

/**
 * The model's answer with everything that cannot be shown taken out.
 *
 * A positive finding (a condition, a cost, a red flag) stays when its excerpt is at least
 * `MIN_EXCERPT_LENGTH` characters long and occurs in the title or the description, and its label
 * is not blank and no longer than `MAX_LABEL_LENGTH`; it is stored with the listing's own text
 * and with where that text was found. A red flag keeps its
 * requirement — as a snapshot of that requirement's text — only when `requirement_ref` names
 * one that exists; otherwise the flag stays and the reference alone goes.
 *
 * A missing-information finding stays when it asks a question no longer than
 * `MAX_QUESTION_LENGTH` and is either about one of the
 * nine attributes whose column is empty, or about a requirement `requirement_ref` names. One of
 * the nine attributes stays once; its `requirement_ref`, if the model sent one, is not kept.
 * Findings about requirements are not counted against each other: one member's requirements may
 * leave several things unanswered.
 *
 * `rejected` counts positive findings turned away for their excerpt, and nothing else. `dropped`
 * counts every missing-information finding turned away — no question or one over its limit, a
 * filled column, an attribute named twice, a requirement that does not exist — and every positive
 * finding whose excerpt is the listing's but whose label is blank or over its limit.
 */
export function groundFindings(output: AuditOutput, input: AuditInput): GroundingResult {
  const references: References = [
    ["title", input.title, collapse(input.title)],
    ["description", input.description, collapse(input.description)],
  ];
  // Keyed by `Wn`. A `null` reference is looked up like any other and finds nothing.
  const requirements = new Map<string | null, string>(
    input.requirements.map((requirement) => [requirement.ref, requirement.body]),
  );

  const missing: StoredMissing[] = [];
  const named = new Set<string>();
  let dropped = 0;
  for (const finding of output.missing) {
    const { attribute, question } = finding;
    if (!fits(question, MAX_QUESTION_LENGTH)) {
      dropped += 1;
    } else if (attribute === REQUIREMENT_ATTRIBUTE) {
      const requirement = requirements.get(finding.requirement_ref);
      if (requirement === undefined) {
        dropped += 1;
      } else {
        missing.push({ attribute, requirement, question });
      }
    } else if (!input.unstatedAttributes.includes(attribute) || named.has(attribute)) {
      dropped += 1;
    } else {
      named.add(attribute);
      missing.push({ attribute, requirement: null, question });
    }
  }

  const conditions = sortByExcerpt(output.conditions, references);
  const costs = sortByExcerpt(output.costs, references);
  const redFlags = sortByExcerpt(output.red_flags, references);

  return {
    findings: {
      version: FINDINGS_VERSION,
      missing,
      conditions: conditions.kept.map(storeExcerpted),
      costs: costs.kept.map(storeExcerpted),
      red_flags: redFlags.kept.map((kept): StoredRedFlag => ({
        ...storeExcerpted(kept),
        requirement: requirements.get(kept.finding.requirement_ref) ?? null,
      })),
    },
    rejected: conditions.rejected + costs.rejected + redFlags.rejected,
    dropped: dropped + conditions.dropped + costs.dropped + redFlags.dropped,
  };
}
