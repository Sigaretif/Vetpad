import { describe, expect, it } from "vitest";
import {
  AUDIT_OUTPUT_SCHEMA,
  type AuditOutput,
  type MissingAttribute,
  type OutputExcerpted,
  type OutputMissing,
  type OutputRedFlag,
  type StoredFindings,
  readAuditOutput,
  readFindings,
} from "@/lib/audit/schema";

// Expected values are written by hand from the Phase 3 contract in
// context/changes/grounded-listing-audit/plan.md (the answer's four lists and their fields, the
// ten attribute tokens, `StoredFindings` with `version: 1`, `source` and a requirement snapshot)
// and from what the provider's schema-constrained output needs of a schema (research.md, "What
// the provider's SDK and API allow": every object closed, no length or pattern keywords).
//
// `readFindings` answers `null` for a failed read and four empty lists for an audit that found
// nothing. Those two must never be confused — „brak znalezisk" shown for a row that could not be
// read would be a fact nobody established — so every refusal stands beside the read that succeeds.
//
// `readAuditOutput` is the same rule one step earlier, for the model's answer (Phase 4 of the same
// plan: an answer of another shape ends the audit as `provider_malformed` and never reaches the
// grounding). It reads what the schema types and nothing the schema does not say.

/** A JSON value against a schema, for the keywords `AUDIT_OUTPUT_SCHEMA` uses. Written here, apart from src/. */
function conforms(schema: unknown, value: unknown): boolean {
  const node = schema as {
    type?: string | readonly string[];
    enum?: readonly unknown[];
    properties?: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties?: boolean;
    items?: unknown;
  };
  const types = typeof node.type === "string" ? [node.type] : (node.type ?? []);
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (!types.includes(actual)) return false;
  if (node.enum !== undefined && !node.enum.includes(value)) return false;
  if (actual === "array") return (value as unknown[]).every((item) => conforms(node.items, item));
  if (actual === "object") {
    const record = value as Record<string, unknown>;
    const properties = node.properties ?? {};
    if ((node.required ?? []).some((key) => !(key in record))) return false;
    if (node.additionalProperties === false && Object.keys(record).some((key) => !(key in properties))) return false;
    return Object.entries(record).every(([key, entry]) => !(key in properties) || conforms(properties[key], entry));
  }
  return true;
}

/** Every object node of a schema, the root included. */
function objectNodes(schema: unknown): Record<string, unknown>[] {
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const below = [
    ...Object.values((node.properties as Record<string, unknown> | undefined) ?? {}),
    ...(node.items === undefined ? [] : [node.items]),
  ].flatMap(objectNodes);
  return node.type === "object" ? [node, ...below] : below;
}

/** Every key used anywhere in a schema. */
function keywords(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  if (Array.isArray(schema)) return (schema as unknown[]).flatMap(keywords);
  return Object.entries(schema).flatMap(([key, value]) => [key, ...keywords(value)]);
}

// The TypeScript side of the answer, as key sets the compiler checks: a field added to a type
// and left out here — or the other way round — fails `npx astro check`. The tests below compare
// these with the schema at run time, so the type and the schema cannot drift apart unnoticed.
const OUTPUT_FIELDS = { missing: true, conditions: true, costs: true, red_flags: true } satisfies Record<
  keyof AuditOutput,
  true
>;
const MISSING_FIELDS = { attribute: true, requirement_ref: true, question: true } satisfies Record<
  keyof OutputMissing,
  true
>;
const EXCERPTED_FIELDS = { label: true, excerpt: true } satisfies Record<keyof OutputExcerpted, true>;
const RED_FLAG_FIELDS = { label: true, excerpt: true, requirement_ref: true } satisfies Record<
  keyof OutputRedFlag,
  true
>;
const ATTRIBUTES = {
  price: true,
  area: true,
  location: true,
  floor: true,
  heating: true,
  ownership: true,
  admin_rent: true,
  build_year: true,
  finish_state: true,
  requirement: true,
} satisfies Record<MissingAttribute, true>;

/** An answer the type accepts, with every field and both kinds of nullable value in use. */
const TYPED_ANSWER: AuditOutput = {
  missing: [
    { attribute: "floor", requirement_ref: null, question: "Na którym piętrze jest mieszkanie?" },
    { attribute: "requirement", requirement_ref: "W1", question: "Czy jest balkon?" },
  ],
  conditions: [{ label: "Warunek", excerpt: "tylko za gotówkę" }],
  costs: [{ label: "Koszt", excerpt: "prowizja 2% ceny" }],
  red_flags: [
    { label: "Flaga", excerpt: "mieszkanie z lokatorem", requirement_ref: null },
    { label: "Flaga", excerpt: "bez windy w budynku", requirement_ref: "W1" },
  ],
};

describe("AUDIT_OUTPUT_SCHEMA: the shape the provider is asked to enforce (FR-011)", () => {
  it("is four lists: missing information, conditions, costs and red flags", () => {
    const excerpted = {
      type: "object",
      additionalProperties: false,
      required: ["label", "excerpt"],
      properties: { label: { type: "string" }, excerpt: { type: "string" } },
    };

    expect(AUDIT_OUTPUT_SCHEMA).toEqual({
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
              attribute: {
                type: "string",
                enum: [
                  "price",
                  "area",
                  "location",
                  "floor",
                  "heating",
                  "ownership",
                  "admin_rent",
                  "build_year",
                  "finish_state",
                  "requirement",
                ],
              },
              requirement_ref: { type: ["string", "null"] },
              question: { type: "string" },
            },
          },
        },
        conditions: { type: "array", items: excerpted },
        costs: { type: "array", items: excerpted },
        red_flags: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "excerpt", "requirement_ref"],
            properties: {
              label: { type: "string" },
              excerpt: { type: "string" },
              requirement_ref: { type: ["string", "null"] },
            },
          },
        },
      },
    });
  });

  it("closes every object and requires every property of it", () => {
    const nodes = objectNodes(AUDIT_OUTPUT_SCHEMA);

    // The root and the item of each of the four lists.
    expect(nodes).toHaveLength(5);
    for (const node of nodes) {
      expect(node.additionalProperties).toBe(false);
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
    }
  });

  // The provider does not enforce these, so a rule written with them would hold nowhere.
  it("states no rule the provider does not enforce", () => {
    const used = new Set(keywords(AUDIT_OUTPUT_SCHEMA));

    for (const keyword of [
      "minLength",
      "maxLength",
      "pattern",
      "minItems",
      "maxItems",
      "minimum",
      "maximum",
      "format",
    ]) {
      expect(used.has(keyword)).toBe(false);
    }
  });
});

describe("AUDIT_OUTPUT_SCHEMA and the AuditOutput type describe the same answer", () => {
  it("names the same fields as the types, list by list", () => {
    const { properties } = AUDIT_OUTPUT_SCHEMA;

    expect(Object.keys(properties).sort()).toEqual(Object.keys(OUTPUT_FIELDS).sort());
    expect(Object.keys(properties.missing.items.properties).sort()).toEqual(Object.keys(MISSING_FIELDS).sort());
    expect(Object.keys(properties.conditions.items.properties).sort()).toEqual(Object.keys(EXCERPTED_FIELDS).sort());
    expect(Object.keys(properties.costs.items.properties).sort()).toEqual(Object.keys(EXCERPTED_FIELDS).sort());
    expect(Object.keys(properties.red_flags.items.properties).sort()).toEqual(Object.keys(RED_FLAG_FIELDS).sort());
  });

  it("admits the same attribute tokens as the type", () => {
    const admitted = AUDIT_OUTPUT_SCHEMA.properties.missing.items.properties.attribute.enum;

    expect([...admitted].sort()).toEqual(Object.keys(ATTRIBUTES).sort());
  });

  it("accepts an answer the type accepts", () => {
    expect(conforms(AUDIT_OUTPUT_SCHEMA, TYPED_ANSWER)).toBe(true);
    expect(conforms(AUDIT_OUTPUT_SCHEMA, { missing: [], conditions: [], costs: [], red_flags: [] })).toBe(true);
  });

  // The same answer, one thing wrong at a time: what the type would not compile, the schema refuses.
  it.each<[string, unknown]>([
    ["a list missing", { missing: [], conditions: [], costs: [] }],
    ["a list that is null", { ...TYPED_ANSWER, costs: null }],
    ["a fifth list", { ...TYPED_ANSWER, notes: [] }],
    ["an attribute off the list", { ...TYPED_ANSWER, missing: [{ ...TYPED_ANSWER.missing[0], attribute: "balcony" }] }],
    ["a missing finding with an excerpt", { ...TYPED_ANSWER, missing: [{ ...TYPED_ANSWER.missing[0], excerpt: "x" }] }],
    ["a missing finding without its reference", { ...TYPED_ANSWER, missing: [{ attribute: "floor", question: "?" }] }],
    ["a question that is null", { ...TYPED_ANSWER, missing: [{ ...TYPED_ANSWER.missing[0], question: null }] }],
    ["a condition without an excerpt", { ...TYPED_ANSWER, conditions: [{ label: "Warunek" }] }],
    ["an excerpt that is null", { ...TYPED_ANSWER, costs: [{ label: "Koszt", excerpt: null }] }],
    ["a cost with a reference", { ...TYPED_ANSWER, costs: [{ ...TYPED_ANSWER.costs[0], requirement_ref: "W1" }] }],
    ["a red flag without its reference", { ...TYPED_ANSWER, red_flags: [{ label: "Flaga", excerpt: "tekst" }] }],
    [
      "a reference that is a number",
      { ...TYPED_ANSWER, red_flags: [{ ...TYPED_ANSWER.red_flags[0], requirement_ref: 1 }] },
    ],
    ["a list of texts", { ...TYPED_ANSWER, conditions: ["tylko za gotówkę"] }],
  ])("refuses %s", (_what, answer) => {
    expect(conforms(AUDIT_OUTPUT_SCHEMA, answer)).toBe(false);
  });
});

/** Stored findings of every kind, as the grounding stores them. */
function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    missing: [
      { attribute: "floor", requirement: null, question: "Na którym piętrze jest mieszkanie?" },
      { attribute: "requirement", requirement: "Balkon albo loggia.", question: "Czy jest balkon?" },
    ],
    conditions: [{ label: "Lokator", excerpt: "Mieszkanie z lokatorem", source: "description" }],
    costs: [{ label: "Prowizja", excerpt: "prowizję biura w wysokości 2% ceny", source: "description" }],
    red_flags: [
      { label: "Piętro", excerpt: "na 7. piętrze", source: "description", requirement: "Balkon albo loggia." },
      { label: "Tytuł", excerpt: "3 pokoje z balkonem", source: "title", requirement: null },
    ],
    ...overrides,
  };
}

/** "The audit found nothing": a successful read, and what a failed one must never equal. */
const FOUND_NOTHING: StoredFindings = { version: 1, missing: [], conditions: [], costs: [], red_flags: [] };

describe("readFindings: a stored result is read, never trusted (#4)", () => {
  it("control: reads findings of every kind as they were stored", () => {
    expect(readFindings(stored())).toEqual({
      version: 1,
      missing: [
        { attribute: "floor", requirement: null, question: "Na którym piętrze jest mieszkanie?" },
        { attribute: "requirement", requirement: "Balkon albo loggia.", question: "Czy jest balkon?" },
      ],
      conditions: [{ label: "Lokator", excerpt: "Mieszkanie z lokatorem", source: "description" }],
      costs: [{ label: "Prowizja", excerpt: "prowizję biura w wysokości 2% ceny", source: "description" }],
      red_flags: [
        { label: "Piętro", excerpt: "na 7. piętrze", source: "description", requirement: "Balkon albo loggia." },
        { label: "Tytuł", excerpt: "3 pokoje z balkonem", source: "title", requirement: null },
      ],
    });
  });

  it("control: reads an audit that found nothing as four empty lists — a result, not a failed read", () => {
    expect(readFindings({ version: 1, missing: [], conditions: [], costs: [], red_flags: [] })).toEqual({
      version: 1,
      missing: [],
      conditions: [],
      costs: [],
      red_flags: [],
    });
  });

  it.each<[string, unknown]>([
    ["an empty object", {}],
    ["a list", []],
    ["a list holding findings", [stored()]],
    ["null", null],
    ["undefined", undefined],
    ["a text", "brak znalezisk"],
    ["findings as JSON text", JSON.stringify(stored())],
    ["a number", 1],
    ["a boolean", true],
    // The model's answer is not what is stored: it has `requirement_ref` and no `version`.
    [
      "the model's answer",
      { missing: [], conditions: [{ label: "Lokator", excerpt: "Mieszkanie z lokatorem" }], costs: [], red_flags: [] },
    ],
    ["another shape altogether", { findings: stored(), rejected: 0 }],
  ])("answers null for %s", (_what, value) => {
    const read = readFindings(value);

    expect(read).toBeNull();
    expect(read).not.toEqual(FOUND_NOTHING);
  });

  it.each<[string, Record<string, unknown>]>([
    ["version 2", { version: 2 }],
    ["version 0", { version: 0 }],
    ["the version as text", { version: "1" }],
    ["no version", { version: undefined }],
    ["a null version", { version: null }],
  ])("answers null for findings of %s, and does not guess at them", (_what, overrides) => {
    expect(readFindings(stored(overrides))).toBeNull();
    // Also when there is nothing in them: an unknown version is not "found nothing".
    expect(readFindings({ ...FOUND_NOTHING, ...overrides })).toBeNull();
  });

  it.each(["missing", "conditions", "costs", "red_flags"])("answers null when the %s list is absent", (list) => {
    const { [list]: _removed, ...rest } = stored();

    expect(readFindings(rest)).toBeNull();
  });

  it.each(["missing", "conditions", "costs", "red_flags"])("answers null when %s is not a list", (list) => {
    for (const value of [null, {}, "tekst", 0, { 0: "a", length: 1 }]) {
      expect(readFindings(stored({ [list]: value }))).toBeNull();
    }
  });

  it.each(["missing", "conditions", "costs", "red_flags"])(
    "answers null when %s holds something that is not an object",
    (list) => {
      for (const item of [null, "tekst", 5, ["tekst"]]) {
        expect(readFindings(stored({ [list]: [item] }))).toBeNull();
      }
    },
  );

  // One item wrong at a time; beside each stands the control above, where the same item reads.
  it.each<[string, Record<string, unknown>]>([
    ["an attribute off the list", { attribute: "balcony", requirement: null, question: "Czy jest balkon?" }],
    ["a requirement's number as the attribute", { attribute: "W1", requirement: null, question: "Czy jest balkon?" }],
    ["no attribute", { requirement: null, question: "Czy jest balkon?" }],
    ["an attribute that is null", { attribute: null, requirement: null, question: "Czy jest balkon?" }],
    ["an empty question", { attribute: "floor", requirement: null, question: "" }],
    ["a question of spaces", { attribute: "floor", requirement: null, question: "   " }],
    ["no question", { attribute: "floor", requirement: null }],
    ["a question that is a number", { attribute: "floor", requirement: null, question: 7 }],
    [
      "one of the nine attributes carrying a requirement",
      { attribute: "floor", requirement: "Balkon.", question: "?" },
    ],
    ["one of the nine attributes without the requirement field", { attribute: "floor", question: "Które piętro?" }],
    ["a requirement finding without its requirement", { attribute: "requirement", requirement: null, question: "?" }],
    ["a requirement finding with an empty requirement", { attribute: "requirement", requirement: "", question: "?" }],
    ["a requirement finding with a blank requirement", { attribute: "requirement", requirement: "  ", question: "?" }],
    ["a requirement finding with a number for it", { attribute: "requirement", requirement: 1, question: "?" }],
    // The model's field name, where the stored one is expected.
    ["a requirement finding that still carries Wn", { attribute: "requirement", requirement_ref: "W1", question: "?" }],
  ])("answers null for a missing-information finding with %s", (_what, item) => {
    expect(readFindings(stored({ missing: [item] }))).toBeNull();
  });

  const EXCERPTED_LISTS = ["conditions", "costs", "red_flags"] as const;

  it.each<[string, Record<string, unknown>]>([
    ["no excerpt", { label: "Lokator", source: "description", requirement: null }],
    ["an empty excerpt", { label: "Lokator", excerpt: "", source: "description", requirement: null }],
    ["an excerpt of spaces", { label: "Lokator", excerpt: "   ", source: "description", requirement: null }],
    ["an excerpt that is null", { label: "Lokator", excerpt: null, source: "description", requirement: null }],
    ["an excerpt that is a number", { label: "Lokator", excerpt: 650, source: "description", requirement: null }],
    [
      "an excerpt that is a list",
      { label: "Lokator", excerpt: ["z lokatorem"], source: "description", requirement: null },
    ],
    ["no source", { label: "Lokator", excerpt: "z lokatorem", requirement: null }],
    ["a source off the list", { label: "Lokator", excerpt: "z lokatorem", source: "raw", requirement: null }],
    ["a source in capitals", { label: "Lokator", excerpt: "z lokatorem", source: "Title", requirement: null }],
    ["a source that is null", { label: "Lokator", excerpt: "z lokatorem", source: null, requirement: null }],
    ["no label", { excerpt: "z lokatorem", source: "description", requirement: null }],
    ["a label that is null", { label: null, excerpt: "z lokatorem", source: "description", requirement: null }],
    ["a label that is a number", { label: 5, excerpt: "z lokatorem", source: "description", requirement: null }],
  ])("answers null for a positive finding with %s, in every list", (_what, item) => {
    for (const list of EXCERPTED_LISTS) expect(readFindings(stored({ [list]: [item] }))).toBeNull();
    // The control: the same item with a label, an excerpt and a source reads in every list.
    const readable = { label: "Lokator", excerpt: "z lokatorem", source: "description", requirement: null };
    for (const list of EXCERPTED_LISTS) expect(readFindings(stored({ [list]: [readable] }))).not.toBeNull();
  });

  it.each<[string, unknown]>([
    ["an empty text", ""],
    ["spaces", "   "],
    ["a number", 1],
    ["a list", ["Balkon."]],
    ["nothing at all", undefined],
  ])("answers null for a red flag whose requirement is %s", (_what, requirement) => {
    const flag = { label: "Piętro", excerpt: "na 7. piętrze", source: "description", requirement };

    expect(readFindings(stored({ red_flags: [flag] }))).toBeNull();
    // Beside it: the flag with a requirement's text, and with none.
    expect(readFindings(stored({ red_flags: [{ ...flag, requirement: "Balkon." }] }))).not.toBeNull();
    expect(readFindings(stored({ red_flags: [{ ...flag, requirement: null }] }))).not.toBeNull();
  });

  // One unreadable item makes the whole result unreadable: half a result is not shown as one.
  it("answers null when one item among readable ones does not read", () => {
    const readable = { label: "Lokator", excerpt: "z lokatorem", source: "description" };

    expect(readFindings(stored({ costs: [readable, { ...readable, source: "raw" }, readable] }))).toBeNull();
    expect(readFindings(stored({ costs: [readable, readable, readable] }))).not.toBeNull();
  });

  it("stores a label as it is, an empty one included", () => {
    const read = readFindings(stored({ conditions: [{ label: "", excerpt: "z lokatorem", source: "title" }] }));

    expect(read?.conditions).toEqual([{ label: "", excerpt: "z lokatorem", source: "title" }]);
  });

  // The answer is rebuilt from the known fields: whatever else a row carries reaches no view.
  it("passes on nothing but the fields it knows", () => {
    const read = readFindings(
      stored({
        author: "anna@example.test",
        missing: [{ attribute: "floor", requirement: null, question: "Które piętro?", requirement_ref: "W1" }],
        conditions: [{ label: "Lokator", excerpt: "z lokatorem", source: "title", note: "kanarek-notatka" }],
        costs: [],
        red_flags: [
          { label: "Piętro", excerpt: "na 7. piętrze", source: "description", requirement: null, html: "<b>" },
        ],
      }),
    );

    expect(read).toEqual({
      version: 1,
      missing: [{ attribute: "floor", requirement: null, question: "Które piętro?" }],
      conditions: [{ label: "Lokator", excerpt: "z lokatorem", source: "title" }],
      costs: [],
      red_flags: [{ label: "Piętro", excerpt: "na 7. piętrze", source: "description", requirement: null }],
    });
  });

  // A condition and a cost have no requirement: one sent with them is not passed on.
  it("gives a requirement to red flags only", () => {
    const withRequirement = { label: "Lokator", excerpt: "z lokatorem", source: "title", requirement: "Balkon." };
    const read = readFindings(stored({ conditions: [withRequirement], costs: [withRequirement] }));

    expect(read?.conditions).toEqual([{ label: "Lokator", excerpt: "z lokatorem", source: "title" }]);
    expect(read?.costs).toEqual([{ label: "Lokator", excerpt: "z lokatorem", source: "title" }]);
  });
});

describe("readAuditOutput: the model's answer is read before it is grounded (#4)", () => {
  /** "The model found nothing": an answer, and what an unreadable one must never equal. */
  const NOTHING_FOUND: AuditOutput = { missing: [], conditions: [], costs: [], red_flags: [] };

  it("control: reads an answer the type accepts, field for field", () => {
    expect(readAuditOutput(TYPED_ANSWER)).toEqual({
      missing: [
        { attribute: "floor", requirement_ref: null, question: "Na którym piętrze jest mieszkanie?" },
        { attribute: "requirement", requirement_ref: "W1", question: "Czy jest balkon?" },
      ],
      conditions: [{ label: "Warunek", excerpt: "tylko za gotówkę" }],
      costs: [{ label: "Koszt", excerpt: "prowizja 2% ceny" }],
      red_flags: [
        { label: "Flaga", excerpt: "mieszkanie z lokatorem", requirement_ref: null },
        { label: "Flaga", excerpt: "bez windy w budynku", requirement_ref: "W1" },
      ],
    });
  });

  it("control: reads four empty lists as an answer that found nothing — not as an unreadable one", () => {
    expect(readAuditOutput({ missing: [], conditions: [], costs: [], red_flags: [] })).toEqual({
      missing: [],
      conditions: [],
      costs: [],
      red_flags: [],
    });
  });

  it.each<[string, unknown]>([
    ["an empty object", {}],
    ["a list", []],
    ["a list holding an answer", [TYPED_ANSWER]],
    ["null", null],
    ["undefined", undefined],
    ["a text", "brak znalezisk"],
    ["an answer as JSON text", JSON.stringify(TYPED_ANSWER)],
    ["a number", 0],
    ["a boolean", false],
    ["an answer wrapped in another object", { output: TYPED_ANSWER }],
  ])("answers null for %s", (_what, value) => {
    const read = readAuditOutput(value);

    expect(read).toBeNull();
    expect(read).not.toEqual(NOTHING_FOUND);
  });

  it.each(["missing", "conditions", "costs", "red_flags"])("answers null when the %s list is absent", (list) => {
    const { [list]: _removed, ...rest } = TYPED_ANSWER as unknown as Record<string, unknown>;

    expect(readAuditOutput(rest)).toBeNull();
  });

  it.each(["missing", "conditions", "costs", "red_flags"])("answers null when %s is not a list", (list) => {
    for (const value of [null, {}, "tekst", 0, { 0: "a", length: 1 }]) {
      expect(readAuditOutput({ ...TYPED_ANSWER, [list]: value })).toBeNull();
    }
  });

  it.each(["missing", "conditions", "costs", "red_flags"])(
    "answers null when %s holds something that is not an object",
    (list) => {
      for (const item of [null, "tekst", 5, ["tekst"]]) {
        expect(readAuditOutput({ ...TYPED_ANSWER, [list]: [item] })).toBeNull();
      }
    },
  );

  // One item wrong at a time; beside each stands the control above, where the same item reads.
  it.each<[string, Record<string, unknown>]>([
    ["an attribute off the list", { attribute: "balcony", requirement_ref: null, question: "Czy jest balkon?" }],
    ["a requirement's number as the attribute", { attribute: "W1", requirement_ref: null, question: "?" }],
    ["an attribute that is null", { attribute: null, requirement_ref: null, question: "?" }],
    ["no attribute", { requirement_ref: null, question: "?" }],
    ["a question that is null", { attribute: "floor", requirement_ref: null, question: null }],
    ["a question that is a number", { attribute: "floor", requirement_ref: null, question: 7 }],
    ["no question", { attribute: "floor", requirement_ref: null }],
    ["no reference field", { attribute: "floor", question: "Które piętro?" }],
    ["a reference that is a number", { attribute: "requirement", requirement_ref: 1, question: "?" }],
    ["a reference that is a list", { attribute: "requirement", requirement_ref: ["W1"], question: "?" }],
  ])("answers null for a missing-information finding with %s", (_what, item) => {
    expect(readAuditOutput({ ...TYPED_ANSWER, missing: [item] })).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ["no excerpt", { label: "Lokator", requirement_ref: null }],
    ["an excerpt that is null", { label: "Lokator", excerpt: null, requirement_ref: null }],
    ["an excerpt that is a number", { label: "Lokator", excerpt: 650, requirement_ref: null }],
    ["an excerpt that is a list", { label: "Lokator", excerpt: ["z lokatorem"], requirement_ref: null }],
    ["no label", { excerpt: "z lokatorem", requirement_ref: null }],
    ["a label that is null", { label: null, excerpt: "z lokatorem", requirement_ref: null }],
    ["a label that is a number", { label: 5, excerpt: "z lokatorem", requirement_ref: null }],
  ])("answers null for a positive finding with %s, in every list", (_what, item) => {
    for (const list of ["conditions", "costs", "red_flags"]) {
      expect(readAuditOutput({ ...TYPED_ANSWER, [list]: [item] })).toBeNull();
    }
    // The control: the same item with a label and an excerpt reads in every list.
    const readable = { label: "Lokator", excerpt: "z lokatorem", requirement_ref: null };
    for (const list of ["conditions", "costs", "red_flags"]) {
      expect(readAuditOutput({ ...TYPED_ANSWER, [list]: [readable] })).not.toBeNull();
    }
  });

  it.each<[string, unknown]>([
    ["a number", 1],
    ["a list", ["W1"]],
    ["a boolean", false],
    ["nothing at all", undefined],
  ])("answers null for a red flag whose reference is %s", (_what, reference) => {
    const flag = { label: "Piętro", excerpt: "na 7. piętrze", requirement_ref: reference };

    expect(readAuditOutput({ ...TYPED_ANSWER, red_flags: [flag] })).toBeNull();
    // Beside it: the flag with a requirement's number, and with none.
    expect(readAuditOutput({ ...TYPED_ANSWER, red_flags: [{ ...flag, requirement_ref: "W1" }] })).not.toBeNull();
    expect(readAuditOutput({ ...TYPED_ANSWER, red_flags: [{ ...flag, requirement_ref: null }] })).not.toBeNull();
  });

  // One unreadable item makes the whole answer unreadable: half an answer is not grounded as one.
  it("answers null when one item among readable ones does not read", () => {
    const readable = { label: "Lokator", excerpt: "z lokatorem" };

    expect(readAuditOutput({ ...TYPED_ANSWER, costs: [readable, { ...readable, excerpt: 5 }, readable] })).toBeNull();
    expect(readAuditOutput({ ...TYPED_ANSWER, costs: [readable, readable, readable] })).not.toBeNull();
  });

  // Shape only, as the schema is. What a finding says is the grounding's to judge, one finding
  // at a time: a blank question, an empty excerpt and a number no requirement has all read here.
  it("reads what the schema types, whatever it says", () => {
    const read = readAuditOutput({
      missing: [{ attribute: "requirement", requirement_ref: "W9", question: "   " }],
      conditions: [{ label: "", excerpt: "" }],
      costs: [],
      red_flags: [{ label: "Flaga", excerpt: "parafraza, której nie ma w ogłoszeniu", requirement_ref: "W9" }],
    });

    expect(read).toEqual({
      missing: [{ attribute: "requirement", requirement_ref: "W9", question: "   " }],
      conditions: [{ label: "", excerpt: "" }],
      costs: [],
      red_flags: [{ label: "Flaga", excerpt: "parafraza, której nie ma w ogłoszeniu", requirement_ref: "W9" }],
    });
  });

  // The answer is rebuilt from the known fields: whatever else it carries goes no further.
  it("passes on nothing but the fields it knows", () => {
    const read = readAuditOutput({
      ...TYPED_ANSWER,
      notes: ["kanarek-notatka"],
      missing: [{ attribute: "floor", requirement_ref: null, question: "Które piętro?", excerpt: "na 7. piętrze" }],
      conditions: [{ label: "Warunek", excerpt: "tylko za gotówkę", requirement_ref: "W1", html: "<b>" }],
    });

    expect(read).toEqual({
      missing: [{ attribute: "floor", requirement_ref: null, question: "Które piętro?" }],
      conditions: [{ label: "Warunek", excerpt: "tylko za gotówkę" }],
      costs: [{ label: "Koszt", excerpt: "prowizja 2% ceny" }],
      red_flags: [
        { label: "Flaga", excerpt: "mieszkanie z lokatorem", requirement_ref: null },
        { label: "Flaga", excerpt: "bez windy w budynku", requirement_ref: "W1" },
      ],
    });
  });
});
