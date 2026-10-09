import { describe, expect, it } from "vitest";
import { MAX_LABEL_LENGTH, MAX_QUESTION_LENGTH, MIN_EXCERPT_LENGTH, groundFindings } from "@/lib/audit/grounding";
import { type AuditInput, buildAuditInput, readAuditOffer } from "@/lib/audit/input";
import { type AuditOutput, type OutputExcerpted, type OutputMissing, readFindings } from "@/lib/audit/schema";
import { AUDIT_DESCRIPTION, AUDIT_TITLE, auditCriteria, auditOfferRow } from "../../fixtures/audit";

// Expected values are written by hand from the documented rule — prd.md (Guardrails: the AI
// never asserts without evidence; FR-011: every positive finding carries a verbatim excerpt, a
// missing-data finding carries none and covers only decision-critical attributes), test-plan.md
// risk #4, and the grounding contract in context/changes/grounded-listing-audit/plan.md, Phase 3
// — never copied from what the function returns. Every finding that is turned away stands
// beside one that is kept: alone, the first half passes on a function that keeps nothing.
//
// The listing the excerpts are checked against is the fixture's (tests/fixtures/audit.ts):
//
//   title        Mieszkanie 3 pokoje z balkonem, Praga-Południe
//   description  Sprzedam mieszkanie 3-pokojowe o powierzchni 54,5⍽m² na 7. piętrze.
//                Blok z 1975 roku, Praga-Południe, blisko metra.
//                Czynsz administracyjny 650⍽zł miesięcznie, w tym fundusz remontowy.
//
//                Kupujący pokrywa prowizję biura w wysokości 2% ceny.
//                Mieszkanie z lokatorem, umowa najmu
//                do końca 2027 roku.
//                Zapraszam 🏠 na prezentację.
//                Kontakt: Kanarek Testowy, tel. +48 600 000 001.
//
// where ⍽ stands for a no-break space (U+00A0).

const BALCONY = "Balkon albo loggia. Najwyżej trzecie piętro bez windy.";

/** The listing with one requirement (W1) and no unstated attribute, unless a case says otherwise. */
function input(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    title: AUDIT_TITLE,
    description: AUDIT_DESCRIPTION,
    parameters: [],
    features: [],
    limits: [],
    requirements: [{ ref: "W1", body: BALCONY }],
    unstatedAttributes: [],
    ...overrides,
  };
}

/** An answer with nothing in it, unless a case puts something in. */
function output(overrides: Partial<AuditOutput> = {}): AuditOutput {
  return { missing: [], conditions: [], costs: [], red_flags: [], ...overrides };
}

function finding(excerpt: string, label = "Etykieta"): OutputExcerpted {
  return { label, excerpt };
}

function missing(overrides: Partial<OutputMissing> = {}): OutputMissing {
  return { attribute: "floor", requirement_ref: null, question: "Na którym piętrze jest mieszkanie?", ...overrides };
}

/** One condition with the given excerpt, grounded against the fixture listing. */
function groundOne(excerpt: string) {
  return groundFindings(output({ conditions: [finding(excerpt)] }), input());
}

const NOTHING = { version: 1, missing: [], conditions: [], costs: [], red_flags: [] };

describe("groundFindings: a positive finding stays only with the listing's own words (#4)", () => {
  it("keeps a finding whose excerpt is a verbatim fragment of the description", () => {
    const result = groundFindings(
      output({
        costs: [finding("Kupujący pokrywa prowizję biura w wysokości 2% ceny", "Prowizja biura po stronie kupującego")],
      }),
      input(),
    );

    expect(result).toEqual({
      findings: {
        version: 1,
        missing: [],
        conditions: [],
        costs: [
          {
            label: "Prowizja biura po stronie kupującego",
            excerpt: "Kupujący pokrywa prowizję biura w wysokości 2% ceny",
            source: "description",
          },
        ],
        red_flags: [],
      },
      rejected: 0,
      dropped: 0,
    });
  });

  it("keeps a finding quoted from the title, and says so", () => {
    const result = groundOne("Mieszkanie 3 pokoje z balkonem");

    expect(result.findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "Mieszkanie 3 pokoje z balkonem", source: "title" },
    ]);
    expect(result.rejected).toBe(0);
  });

  // „Praga-Południe" stands in the title and in the description; the first text looked in wins.
  it("names the title for an excerpt that occurs in both texts", () => {
    expect(AUDIT_TITLE).toContain("Praga-Południe");
    expect(AUDIT_DESCRIPTION).toContain("Praga-Południe");

    expect(groundOne("Praga-Południe").findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "Praga-Południe", source: "title" },
    ]);
    // Beside it: a little more context exists in the description alone.
    expect(groundOne("Praga-Południe, blisko metra").findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "Praga-Południe, blisko metra", source: "description" },
    ]);
  });

  // The paraphrase says the same thing in other words — exactly what must not pass.
  it.each([
    ["a paraphrase", "Kupujący płaci prowizję biura w wysokości 2% ceny"],
    ["a summary of the sentence", "prowizja 2% po stronie kupującego"],
    ["the sentence with a typo corrected into one", "Kupujący pokrywa prowizje biura w wysokości 2% ceny"],
    ["the sentence without its diacritics", "Kupujacy pokrywa prowizje biura w wysokosci 2% ceny"],
    ["the sentence in other letter case", "kupujący pokrywa prowizję biura w wysokości 2% ceny"],
    ["the sentence in capitals", "KUPUJĄCY POKRYWA PROWIZJĘ BIURA"],
    ["the sentence wrapped in quotation marks", "„Kupujący pokrywa prowizję biura”"],
    ["two fragments joined into one", "Czynsz administracyjny 650 zł miesięcznie Kupujący pokrywa prowizję biura"],
    ["two fragments joined with an ellipsis", "Czynsz administracyjny … w tym fundusz remontowy"],
    ["two fragments joined with three dots", "Mieszkanie z lokatorem... do końca 2027 roku"],
    ["a fragment with a word left out", "Kupujący pokrywa prowizję w wysokości 2% ceny"],
    ["a fragment with the words glued together", "Kupującypokrywaprowizjębiura"],
    ["words the listing does not hold at all", "mieszkanie wymaga generalnego remontu"],
    ["the end of the title run into the start of the description", "Praga-Południe Sprzedam mieszkanie"],
    ["a parameter's value, which is not the listing's text", "ogrzewanie miejskie"],
    ["a requirement's text, which is not the listing's text", "Balkon albo loggia"],
  ])("turns away %s, and counts it as rejected", (_case, excerpt) => {
    const result = groundOne(excerpt);

    expect(result.findings).toEqual(NOTHING);
    expect(result.rejected).toBe(1);
    expect(result.dropped).toBe(0);
  });

  it("turns away a finding without an excerpt", () => {
    expect(groundOne("")).toEqual({ findings: NOTHING, rejected: 1, dropped: 0 });
  });

  it.each([
    ["spaces", "            "],
    ["line breaks and tabs", "\n\t\n\t\n\t\n\t\n\t\n\t"],
    ["no-break spaces", "            "],
  ])("turns away an excerpt that is only %s", (_what, excerpt) => {
    expect(groundOne(excerpt)).toEqual({ findings: NOTHING, rejected: 1, dropped: 0 });
  });

  it("never stores the model's wording in place of the listing's", () => {
    const result = groundFindings(
      output({ red_flags: [{ label: "Lokator", excerpt: "  Mieszkanie  z\tlokatorem ", requirement_ref: null }] }),
      input(),
    );

    expect(result.findings.red_flags).toEqual([
      { label: "Lokator", excerpt: "Mieszkanie z lokatorem", source: "description", requirement: null },
    ]);
  });
});

describe("groundFindings: whitespace is the one thing an excerpt may differ in (#4)", () => {
  // research.md, Open Question 12: the mapper decodes `&#160;` to U+00A0 and the model writes an
  // ordinary space there — a correct excerpt an exact comparison would turn away.
  it("accepts an ordinary space where the listing has a no-break one, and stores the listing's", () => {
    const result = groundOne("Czynsz administracyjny 650 zł miesięcznie");

    expect(result.findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "Czynsz administracyjny 650 zł miesięcznie", source: "description" },
    ]);
    expect(result.findings.conditions[0].excerpt).toContain(" ");
    expect(result.rejected).toBe(0);
  });

  it("accepts a no-break space where the listing has an ordinary one, and stores the listing's", () => {
    const result = groundOne("Kupujący pokrywa prowizję biura");

    expect(result.findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "Kupujący pokrywa prowizję biura", source: "description" },
    ]);
    expect(result.findings.conditions[0].excerpt).not.toContain(" ");
  });

  it("accepts an excerpt that runs over a line break, and stores it with the break", () => {
    const result = groundOne("z lokatorem, umowa najmu do końca 2027 roku");

    expect(result.findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "z lokatorem, umowa najmu\ndo końca 2027 roku", source: "description" },
    ]);
  });

  it("accepts an excerpt that runs over a blank line, and stores it with both breaks", () => {
    const result = groundOne("w tym fundusz remontowy. Kupujący pokrywa prowizję");

    expect(result.findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "w tym fundusz remontowy.\n\nKupujący pokrywa prowizję", source: "description" },
    ]);
  });

  it("accepts several spaces, a tab or a line break where the listing has one space", () => {
    for (const excerpt of ["Blok  z   1975 roku", "Blok\tz 1975 roku", "Blok z\n1975 roku"]) {
      expect(groundOne(excerpt).findings.conditions).toEqual([
        { label: "Etykieta", excerpt: "Blok z 1975 roku", source: "description" },
      ]);
    }
  });

  it("does not count whitespace around the excerpt as part of it", () => {
    const result = groundOne("  \n z lokatorem, umowa najmu  \n");

    expect(result.findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "z lokatorem, umowa najmu", source: "description" },
    ]);
  });

  // An excerpt reaching the very start and the very end of a text maps back to the whole of it.
  it("stores the whole text for an excerpt that is the whole text", () => {
    const text = "  Sprzedam kawalerkę \n  bez pośredników.  ";
    const result = groundFindings(
      output({ conditions: [finding("Sprzedam kawalerkę bez pośredników.")] }),
      input({ title: "Kawalerka", description: text }),
    );

    expect(result.findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "Sprzedam kawalerkę \n  bez pośredników.", source: "description" },
    ]);
  });

  // Whitespace may differ; it may not be invented or removed.
  it("turns away an excerpt with a space the listing does not have, or without one it has", () => {
    expect(groundOne("3 - pokojowe o powierzchni").rejected).toBe(1);
    expect(groundOne("54,5m² na 7. piętrze").rejected).toBe(1);
    // Beside them: the same words as the listing has them.
    expect(groundOne("3-pokojowe o powierzchni").rejected).toBe(0);
    expect(groundOne("54,5 m² na 7. piętrze").rejected).toBe(0);
  });
});

describe(`groundFindings: an excerpt shorter than ${MIN_EXCERPT_LENGTH} characters grounds nothing (#4)`, () => {
  it("is ten characters", () => {
    expect(MIN_EXCERPT_LENGTH).toBe(10);
  });

  // „lokatorem" is nine characters and „lokatorem," ten; both stand in the description.
  it("turns away nine characters and keeps ten", () => {
    expect(AUDIT_DESCRIPTION).toContain("lokatorem,");

    expect(groundOne("lokatorem")).toEqual({ findings: NOTHING, rejected: 1, dropped: 0 });
    expect(groundOne("lokatorem,").findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "lokatorem,", source: "description" },
    ]);
  });

  it.each(["z", "2%", "nie", "650", "biura"])("turns away „%s”, which the listing holds", (excerpt) => {
    expect(AUDIT_DESCRIPTION).toContain(excerpt);

    expect(groundOne(excerpt)).toEqual({ findings: NOTHING, rejected: 1, dropped: 0 });
  });

  // Padding does not make a short excerpt long: the length is the excerpt's, not the string's.
  it("counts the length without the whitespace around the excerpt", () => {
    expect(groundOne("   lokatorem   ").rejected).toBe(1);
    expect(groundOne("   lokatorem,   ").rejected).toBe(0);
  });

  it("counts a run of whitespace inside the excerpt as one character", () => {
    // „2% ceny." is eight characters however many spaces the model puts in it.
    expect(groundOne("2%      ceny.").rejected).toBe(1);
    // „ci 2% ceny" is ten.
    expect(groundOne("ci 2%  ceny").rejected).toBe(0);
  });

  // An emoji is one character and two UTF-16 units: „am 🏠 na p" is nine characters long.
  it("counts characters, not UTF-16 units", () => {
    expect("am 🏠 na p").toHaveLength(10);

    expect(groundOne("am 🏠 na p")).toEqual({ findings: NOTHING, rejected: 1, dropped: 0 });
    expect(groundOne("am 🏠 na pr").findings.conditions).toEqual([
      { label: "Etykieta", excerpt: "am 🏠 na pr", source: "description" },
    ]);
  });
});

describe("groundFindings: a missing-information finding stays only where the rule allows one (#4)", () => {
  // The column and the grounding end to end: the same finding against the same row, with the
  // floor stated in its column and without.
  it("keeps a missing floor when the floor column is empty, and drops it when the column is filled", () => {
    const answer = output({ missing: [missing()] });
    const inputFor = (overrides: Record<string, unknown>): AuditInput => {
      const offer = readAuditOffer(auditOfferRow(overrides));
      if (offer === null) throw new Error("expected a readable offer");
      return buildAuditInput(offer, auditCriteria());
    };

    expect(groundFindings(answer, inputFor({ floor: null }))).toEqual({
      findings: {
        ...NOTHING,
        missing: [{ attribute: "floor", requirement: null, question: "Na którym piętrze jest mieszkanie?" }],
      },
      rejected: 0,
      dropped: 0,
    });
    expect(groundFindings(answer, inputFor({ floor: "floor_7" }))).toEqual({
      findings: NOTHING,
      rejected: 0,
      dropped: 1,
    });
  });

  it.each([
    "price",
    "area",
    "location",
    "floor",
    "heating",
    "ownership",
    "admin_rent",
    "build_year",
    "finish_state",
  ] as const)("keeps a missing %s only when that attribute is unstated", (attribute) => {
    const answer = output({ missing: [missing({ attribute })] });

    expect(groundFindings(answer, input({ unstatedAttributes: [attribute] })).findings.missing).toEqual([
      { attribute, requirement: null, question: "Na którym piętrze jest mieszkanie?" },
    ]);
    expect(groundFindings(answer, input({ unstatedAttributes: [] }))).toEqual({
      findings: NOTHING,
      rejected: 0,
      dropped: 1,
    });
  });

  // An empty column for one attribute says nothing about another.
  it("drops a missing heating when only the floor is unstated", () => {
    const result = groundFindings(
      output({ missing: [missing({ attribute: "heating" })] }),
      input({ unstatedAttributes: ["floor"] }),
    );

    expect(result).toEqual({ findings: NOTHING, rejected: 0, dropped: 1 });
  });

  it.each([
    ["an empty question", ""],
    ["a question of spaces", "   "],
    ["a question that is a line break", "\n"],
  ])("drops a finding with %s, beside the same finding with a question", (_what, question) => {
    const unstated = input({ unstatedAttributes: ["floor"] });

    expect(groundFindings(output({ missing: [missing({ question })] }), unstated)).toEqual({
      findings: NOTHING,
      rejected: 0,
      dropped: 1,
    });
    expect(groundFindings(output({ missing: [missing()] }), unstated).dropped).toBe(0);
  });

  it("keeps an attribute named twice once — the first — and drops the repeat", () => {
    const result = groundFindings(
      output({
        missing: [
          missing({ question: "Na którym piętrze jest mieszkanie?" }),
          missing({ attribute: "heating", question: "Jakie jest ogrzewanie?" }),
          missing({ question: "Czy to parter?" }),
        ],
      }),
      input({ unstatedAttributes: ["floor", "heating"] }),
    );

    expect(result).toEqual({
      findings: {
        ...NOTHING,
        missing: [
          { attribute: "floor", requirement: null, question: "Na którym piętrze jest mieszkanie?" },
          { attribute: "heating", requirement: null, question: "Jakie jest ogrzewanie?" },
        ],
      },
      rejected: 0,
      dropped: 1,
    });
  });

  // A finding dropped for having no question has not used up its attribute.
  it("keeps the second naming of an attribute when the first had no question", () => {
    const result = groundFindings(
      output({ missing: [missing({ question: " " }), missing({ question: "Czy to parter?" })] }),
      input({ unstatedAttributes: ["floor"] }),
    );

    expect(result.findings.missing).toEqual([{ attribute: "floor", requirement: null, question: "Czy to parter?" }]);
    expect(result.dropped).toBe(1);
  });

  // One of the nine attributes is about the attribute: a reference sent with it is not kept.
  it("keeps a missing attribute sent with a requirement reference, without the reference", () => {
    const result = groundFindings(
      output({
        missing: [missing({ requirement_ref: "W1" }), missing({ attribute: "heating", requirement_ref: "W9" })],
      }),
      input({ unstatedAttributes: ["floor", "heating"] }),
    );

    expect(result).toEqual({
      findings: {
        ...NOTHING,
        missing: [
          { attribute: "floor", requirement: null, question: "Na którym piętrze jest mieszkanie?" },
          { attribute: "heating", requirement: null, question: "Na którym piętrze jest mieszkanie?" },
        ],
      },
      rejected: 0,
      dropped: 0,
    });
  });
});

describe("groundFindings: a finding about a requirement points at one that exists (#4)", () => {
  const aboutRequirement = (ref: string | null, question = "Czy mieszkanie ma loggię?"): OutputMissing =>
    missing({ attribute: "requirement", requirement_ref: ref, question });

  it("keeps a missing requirement that names W1, with the requirement's text in place of the number", () => {
    const result = groundFindings(output({ missing: [aboutRequirement("W1")] }), input());

    expect(result).toEqual({
      findings: {
        ...NOTHING,
        missing: [
          {
            attribute: "requirement",
            requirement: "Balkon albo loggia. Najwyżej trzecie piętro bez windy.",
            question: "Czy mieszkanie ma loggię?",
          },
        ],
      },
      rejected: 0,
      dropped: 0,
    });
  });

  it.each<[string, string | null]>([
    ["W2, with one requirement", "W2"],
    ["W0", "W0"],
    ["no requirement at all", null],
    ["an empty reference", ""],
    ["the number in lower case", "w1"],
    ["the number with a space after it", "W1 "],
    ["the number alone", "1"],
    ["the requirement's text instead of its number", BALCONY],
  ])("drops a missing requirement that names %s", (_what, ref) => {
    expect(groundFindings(output({ missing: [aboutRequirement(ref)] }), input())).toEqual({
      findings: NOTHING,
      rejected: 0,
      dropped: 1,
    });
  });

  it("drops a missing requirement when the team has none", () => {
    const result = groundFindings(output({ missing: [aboutRequirement("W1")] }), input({ requirements: [] }));

    expect(result).toEqual({ findings: NOTHING, rejected: 0, dropped: 1 });
  });

  it("drops a missing requirement that asks nothing", () => {
    expect(groundFindings(output({ missing: [aboutRequirement("W1", "")] }), input())).toEqual({
      findings: NOTHING,
      rejected: 0,
      dropped: 1,
    });
  });

  it("points each finding at its own requirement", () => {
    const result = groundFindings(
      output({ missing: [aboutRequirement("W2", "Czy jest miejsce w garażu?"), aboutRequirement("W1")] }),
      input({
        requirements: [
          { ref: "W1", body: BALCONY },
          { ref: "W2", body: "Miejsce postojowe w garażu podziemnym." },
        ],
      }),
    );

    expect(result.findings.missing).toEqual([
      {
        attribute: "requirement",
        requirement: "Miejsce postojowe w garażu podziemnym.",
        question: "Czy jest miejsce w garażu?",
      },
      { attribute: "requirement", requirement: BALCONY, question: "Czy mieszkanie ma loggię?" },
    ]);
  });

  // One member's requirements may leave several things unanswered: these are not repeats.
  it("keeps two findings about the same requirement", () => {
    const result = groundFindings(
      output({ missing: [aboutRequirement("W1"), aboutRequirement("W1", "Czy w budynku jest winda?")] }),
      input(),
    );

    expect(result.findings.missing).toEqual([
      { attribute: "requirement", requirement: BALCONY, question: "Czy mieszkanie ma loggię?" },
      { attribute: "requirement", requirement: BALCONY, question: "Czy w budynku jest winda?" },
    ]);
    expect(result.dropped).toBe(0);
  });

  it("keeps a red flag that names W1 with the requirement's text", () => {
    const result = groundFindings(
      output({ red_flags: [{ label: "Wysokie piętro", excerpt: "na 7. piętrze", requirement_ref: "W1" }] }),
      input(),
    );

    expect(result.findings.red_flags).toEqual([
      { label: "Wysokie piętro", excerpt: "na 7. piętrze", source: "description", requirement: BALCONY },
    ]);
  });

  // The flag rests on its excerpt, not on its reference: only the reference goes.
  it.each<[string, string | null]>([
    ["W2, with one requirement", "W2"],
    ["no requirement", null],
    ["the number in lower case", "w1"],
  ])("keeps a red flag that names %s, without the reference, and counts nothing", (_what, ref) => {
    const result = groundFindings(
      output({ red_flags: [{ label: "Wysokie piętro", excerpt: "na 7. piętrze", requirement_ref: ref }] }),
      input(),
    );

    expect(result).toEqual({
      findings: {
        ...NOTHING,
        red_flags: [{ label: "Wysokie piętro", excerpt: "na 7. piętrze", source: "description", requirement: null }],
      },
      rejected: 0,
      dropped: 0,
    });
  });

  it("turns away a red flag whose excerpt is not the listing's, whatever requirement it names", () => {
    const result = groundFindings(
      output({ red_flags: [{ label: "Wysokie piętro", excerpt: "siódme piętro bez windy", requirement_ref: "W1" }] }),
      input(),
    );

    expect(result).toEqual({ findings: NOTHING, rejected: 1, dropped: 0 });
  });
});

// The excerpt is checked against the listing; the label and the question are the model's own
// words and are checked against nothing. A limit is all that stands between a listing that steers
// the model and a paragraph of its choosing beside a genuine quotation (impl review, F5).
describe("groundFindings: a label or a question that is blank or over its limit takes its finding with it (#4)", () => {
  const TENANT = "Mieszkanie z lokatorem, umowa najmu";

  it("states the limits: 200 characters for a label, 400 for a question", () => {
    expect(MAX_LABEL_LENGTH).toBe(200);
    expect(MAX_QUESTION_LENGTH).toBe(400);
  });

  it.each<[string, string]>([
    ["a blank label", " \n "],
    ["an empty label", ""],
    ["a label of 201 characters", "ł".repeat(201)],
  ])("drops a grounded finding with %s, as dropped and not as rejected", (_case, label) => {
    const result = groundFindings(output({ conditions: [finding(TENANT, label)] }), input());

    expect(result).toEqual({ findings: NOTHING, rejected: 0, dropped: 1 });
  });

  it.each<[string, string]>([
    ["a label of 200 characters", "ł".repeat(200)],
    // Counted in code points, as the excerpt is: a hundred houses are a hundred characters.
    ["a label of 200 emoji", "🏠".repeat(200)],
    ["a label of 200 characters between spaces", ` ${"ł".repeat(200)} `],
  ])("control: keeps a grounded finding with %s, as the model wrote it", (_case, label) => {
    const result = groundFindings(output({ conditions: [finding(TENANT, label)] }), input());

    expect(result).toEqual({
      findings: { ...NOTHING, conditions: [{ label, excerpt: TENANT, source: "description" }] },
      rejected: 0,
      dropped: 0,
    });
  });

  it("applies the limit to costs and red flags alike", () => {
    const long = "x".repeat(201);
    const result = groundFindings(
      output({
        costs: [finding("Czynsz administracyjny 650 zł miesięcznie", long)],
        red_flags: [{ label: long, excerpt: "do końca 2027 roku", requirement_ref: null }],
      }),
      input(),
    );

    expect(result).toEqual({ findings: NOTHING, rejected: 0, dropped: 2 });
  });

  // The excerpt is judged first: what the card counts as "no excerpt" does not depend on the label.
  it("counts a finding with no excerpt as rejected, whatever its label", () => {
    const result = groundFindings(output({ conditions: [finding("mieszkanie jest wynajęte", "")] }), input());

    expect(result).toEqual({ findings: NOTHING, rejected: 1, dropped: 0 });
  });

  it("drops a missing-information finding whose question has 401 characters", () => {
    const result = groundFindings(
      output({ missing: [missing({ question: "c".repeat(401) })] }),
      input({ unstatedAttributes: ["floor"] }),
    );

    expect(result).toEqual({ findings: NOTHING, rejected: 0, dropped: 1 });
  });

  it("control: keeps one whose question has 400 characters", () => {
    const question = "c".repeat(400);
    const result = groundFindings(
      output({ missing: [missing({ question })] }),
      input({ unstatedAttributes: ["floor"] }),
    );

    expect(result).toEqual({
      findings: { ...NOTHING, missing: [{ attribute: "floor", requirement: null, question }] },
      rejected: 0,
      dropped: 0,
    });
  });
});

describe("groundFindings: it only takes away, and counts what it took (#4)", () => {
  it("answers four empty lists for an answer with nothing in it", () => {
    expect(groundFindings(output(), input())).toEqual({ findings: NOTHING, rejected: 0, dropped: 0 });
  });

  // An empty column does not prove the text is silent: nothing is ever added for one.
  it("adds no missing-information finding of its own, whatever the listing leaves unstated", () => {
    const result = groundFindings(
      output(),
      input({ unstatedAttributes: ["price", "area", "floor", "heating", "ownership"], requirements: [] }),
    );

    expect(result).toEqual({ findings: NOTHING, rejected: 0, dropped: 0 });
  });

  it("counts a turned-away excerpt as rejected and every other loss as dropped, each in its own count", () => {
    const result = groundFindings(
      output({
        missing: [
          missing(), // kept
          missing({ question: "Czy to parter?" }), // dropped: the attribute named twice
          missing({ attribute: "heating" }), // dropped: the column is filled
          missing({ attribute: "ownership", question: "" }), // dropped: no question
          missing({ attribute: "requirement", requirement_ref: "W2" }), // dropped: no such requirement
          missing({ attribute: "requirement", requirement_ref: "W1", question: "Czy jest balkon?" }), // kept
        ],
        conditions: [
          finding("Mieszkanie z lokatorem, umowa najmu", "Lokator z umową najmu"), // kept
          finding("mieszkanie jest wynajęte", "Lokator"), // rejected: a paraphrase
        ],
        costs: [
          finding("prowizja 2%", "Prowizja"), // rejected: not the listing's words
          finding("Czynsz administracyjny 650 zł miesięcznie", "Czynsz administracyjny"), // kept
          finding("biura", "Biuro"), // rejected: too short
        ],
        red_flags: [
          { label: "Najem do 2027", excerpt: "do końca 2027 roku", requirement_ref: "W2" }, // kept, the reference goes
          { label: "Brak windy", excerpt: "", requirement_ref: "W1" }, // rejected: no excerpt
        ],
      }),
      input({ unstatedAttributes: ["floor", "ownership"] }),
    );

    expect(result).toEqual({
      findings: {
        version: 1,
        missing: [
          { attribute: "floor", requirement: null, question: "Na którym piętrze jest mieszkanie?" },
          { attribute: "requirement", requirement: BALCONY, question: "Czy jest balkon?" },
        ],
        conditions: [
          { label: "Lokator z umową najmu", excerpt: "Mieszkanie z lokatorem, umowa najmu", source: "description" },
        ],
        costs: [
          {
            label: "Czynsz administracyjny",
            excerpt: "Czynsz administracyjny 650 zł miesięcznie",
            source: "description",
          },
        ],
        red_flags: [
          { label: "Najem do 2027", excerpt: "do końca 2027 roku", source: "description", requirement: null },
        ],
      },
      rejected: 4,
      dropped: 4,
    });
  });

  it("keeps the findings in the order the model gave them", () => {
    const result = groundFindings(
      output({
        conditions: [finding("do końca 2027 roku", "trzeci"), finding("Blok z 1975 roku", "pierwszy")],
      }),
      input(),
    );

    expect(result.findings.conditions.map((kept) => kept.label)).toEqual(["trzeci", "pierwszy"]);
  });

  it("keeps the same excerpt under two categories when the model reports it in both", () => {
    const excerpt = "Kupujący pokrywa prowizję biura";
    const result = groundFindings(output({ conditions: [finding(excerpt)], costs: [finding(excerpt)] }), input());

    expect(result.findings.conditions).toHaveLength(1);
    expect(result.findings.costs).toHaveLength(1);
    expect(result.rejected).toBe(0);
  });

  // The label is the model's and is stored as given; only the excerpt is the listing's.
  it("stores the label as the model wrote it", () => {
    const result = groundFindings(output({ costs: [finding("Blok z 1975 roku", "  Rok budowy w tekście ")] }), input());

    expect(result.findings.costs).toEqual([
      { label: "  Rok budowy w tekście ", excerpt: "Blok z 1975 roku", source: "description" },
    ]);
  });

  it("stores neither a requirement's number nor the model's field names", () => {
    const result = groundFindings(
      output({
        missing: [missing({ attribute: "requirement", requirement_ref: "W1" })],
        red_flags: [{ label: "Piętro", excerpt: "na 7. piętrze", requirement_ref: "W1" }],
      }),
      input(),
    );
    const stored = JSON.stringify(result.findings);

    expect(stored).not.toContain("W1");
    expect(stored).not.toContain("requirement_ref");
  });

  // What the grounding stores is what the card's reader accepts, unchanged.
  it("stores findings that read back as they were stored", () => {
    const { findings } = groundFindings(
      output({
        missing: [missing(), missing({ attribute: "requirement", requirement_ref: "W1" })],
        conditions: [finding("Mieszkanie z lokatorem, umowa najmu")],
        costs: [finding("Czynsz administracyjny 650 zł miesięcznie")],
        red_flags: [{ label: "Piętro", excerpt: "na 7. piętrze", requirement_ref: "W1" }],
      }),
      input({ unstatedAttributes: ["floor"] }),
    );

    expect(readFindings(JSON.parse(JSON.stringify(findings)))).toEqual(findings);
  });

  it("leaves the model's answer and the input as they were", () => {
    const answer = output({
      missing: [missing(), missing()],
      conditions: [finding("  Blok z 1975 roku  "), finding("parafraza, której nie ma")],
    });
    const given = input({ unstatedAttributes: ["floor"] });
    const answerBefore = JSON.stringify(answer);
    const givenBefore = JSON.stringify(given);

    groundFindings(answer, given);

    expect(JSON.stringify(answer)).toBe(answerBefore);
    expect(JSON.stringify(given)).toBe(givenBefore);
  });
});
