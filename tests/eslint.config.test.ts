import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it, vi } from "vitest";

// Members' notes never leave the system (prd.md, Non-Functional Requirements), and row-level
// security cannot hold that line, so the code's structure does: `auditNoNotesConfig` in
// eslint.config.js makes an import of the notes module an error in the audit's code — the only
// code that talks to the model provider (test-plan.md risk #6). These cases run the project's
// own configuration, with no overrides, so the rule is proven inside `npm test`.
//
// A sample is linted as text under the path of a file that exists: for an invented path typed
// linting answers with a `fatal` message before any rule runs. Nothing is written to disk. Every
// case, the controls too, asserts that no message is fatal — otherwise "no rule message" would
// also pass when the lint never ran. Messages are filtered by rule, since a sample may break
// other rules as well.

// The first call loads the configuration and the type information, which takes longer than
// Vitest's default five seconds for a test.
vi.setConfig({ testTimeout: 120_000 });

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RULE = "no-restricted-imports";
// The audit's own wording: the re-fetch, the archive and the deletion carry sister rules with
// the same regex and another message.
const AUDIT_MESSAGE = "The audit must not import the notes module";

const AUDIT_DIRECTORY = "src/lib/audit";
const AUDIT_ROUTE = "src/pages/api/audits.ts";

const eslint = new ESLint({ cwd: ROOT });

function sample(specifier: string): string {
  return `import * as probe from "${specifier}";\n\nexport default probe;\n`;
}

async function lint(filePath: string, specifier: string): Promise<ESLint.LintResult> {
  // The path must be a real file, or the result below proves nothing about the rule.
  expect(existsSync(path.join(ROOT, filePath))).toBe(true);

  const results = await eslint.lintText(sample(specifier), { filePath: path.join(ROOT, filePath) });

  // One result: an ignored file would answer with none.
  expect(results).toHaveLength(1);
  const result = results[0];
  expect(result.messages.filter((message) => message.fatal === true)).toEqual([]);
  return result;
}

function restrictedImportMessages(result: ESLint.LintResult) {
  return result.messages.filter((message) => message.ruleId === RULE);
}

/** What the computed configuration holds for the rule: `[severity, options]`, or nothing. */
function restrictedImportsEntry(config: unknown): unknown {
  if (typeof config !== "object" || config === null || !("rules" in config)) return undefined;
  const rules = config.rules;
  if (typeof rules !== "object" || rules === null || !(RULE in rules)) return undefined;
  return rules[RULE];
}

/** Every file that stands under src/lib/audit/ today, read from the directory. */
function auditModuleFiles(): string[] {
  return readdirSync(path.join(ROOT, AUDIT_DIRECTORY), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

describe("eslint.config.js: the audit cannot import the notes module (#6)", () => {
  it.each([
    ["src/lib/audit/input.ts", "@/lib/notes"],
    ["src/lib/audit/input.ts", "../notes"],
    ["src/lib/audit/input.ts", "../notes.ts"],
    [AUDIT_ROUTE, "@/lib/notes"],
    [AUDIT_ROUTE, "../../lib/notes.ts"],
  ])("rejects, in %s, an import of %s", async (filePath, specifier) => {
    const messages = restrictedImportMessages(await lint(filePath, specifier));

    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain(AUDIT_MESSAGE);
  });

  // Beside the rejections: the same import where the rule does not reach, and another module
  // whose name only ends like the notes module's, where it does.
  it.each([
    ["src/lib/members.ts", "@/lib/notes"],
    ["src/lib/audit/input.ts", "@/lib/footnotes"],
  ])("allows, in %s, an import of %s", async (filePath, specifier) => {
    expect(restrictedImportMessages(await lint(filePath, specifier))).toEqual([]);
  });
});

// The team's commute points never reach the model provider either (prd.md, FR-016): the same block
// rejects every module under src/lib/commute/ in the audit's code. Expected outcomes come from
// context/changes/commute-times/plan.md (Phase 1, „Lint: the audit never reads points”): a
// rejected `@/lib/commute/points` stands beside an allowed `@/lib/criteria`, the module the audit
// does read its criteria through.
const COMMUTE_MESSAGE = "The audit must not import the commute modules";

describe("eslint.config.js: the audit cannot import the commute points module (FR-016)", () => {
  it.each([
    ["src/lib/audit/input.ts", "@/lib/commute/points"],
    ["src/lib/audit/input.ts", "../commute/points"],
    ["src/lib/audit/input.ts", "../commute/points.ts"],
    ["src/lib/audit/input.ts", "@/lib/commute/google"],
    [AUDIT_ROUTE, "@/lib/commute/points"],
    [AUDIT_ROUTE, "../../lib/commute/points.ts"],
  ])("rejects, in %s, an import of %s", async (filePath, specifier) => {
    const messages = restrictedImportMessages(await lint(filePath, specifier));

    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain(COMMUTE_MESSAGE);
  });

  // Beside the rejections: the criteria the audit does read, in the same file; the points module
  // where the rule does not reach; and a module whose name only ends like the directory's.
  it.each([
    ["src/lib/audit/input.ts", "@/lib/criteria"],
    [AUDIT_ROUTE, "@/lib/criteria"],
    ["src/lib/members.ts", "@/lib/commute/points"],
    ["src/lib/audit/input.ts", "@/lib/telecommute"],
  ])("allows, in %s, an import of %s", async (filePath, specifier) => {
    expect(restrictedImportMessages(await lint(filePath, specifier))).toEqual([]);
  });

  // The notes pattern and the commute pattern sit in one block: a second block over the same files
  // would have replaced the first's options instead of adding to them.
  it("holds both patterns in the configuration computed for an audit file", async () => {
    const config: unknown = await eslint.calculateConfigForFile(path.join(ROOT, "src/lib/audit/input.ts"));
    const entry = JSON.stringify(restrictedImportsEntry(config) ?? null);

    expect(entry).toContain(AUDIT_MESSAGE);
    expect(entry).toContain(COMMUTE_MESSAGE);
  });
});

describe("eslint.config.js: the rule reaches every file of the audit (#6)", () => {
  // Flat config replaces a rule's options instead of merging them: a later block that set
  // no-restricted-imports for one of these files would silently take the audit's pattern away.
  it("holds the audit's pattern, as an error, in the configuration computed for each of them", async () => {
    const files = [...auditModuleFiles(), AUDIT_ROUTE];

    // The control: the directory was read, and holds the modules that build and send the prompt.
    expect(files).toContain("src/lib/audit/input.ts");
    expect(files).toContain("src/lib/audit/prompt.ts");
    expect(files).toContain("src/lib/audit/provider.ts");

    for (const file of files) {
      const config: unknown = await eslint.calculateConfigForFile(path.join(ROOT, file));
      const entry = restrictedImportsEntry(config);
      const [severity] = Array.isArray(entry) ? (entry as unknown[]) : [];

      expect(severity, file).toBe(2);
      expect(JSON.stringify(entry), file).toContain(AUDIT_MESSAGE);
    }
  });

  // Beside it: a file outside the audit carries no such pattern.
  it("does not hold it for a file outside the audit", async () => {
    const config: unknown = await eslint.calculateConfigForFile(path.join(ROOT, "src/lib/members.ts"));

    expect(JSON.stringify(restrictedImportsEntry(config) ?? null)).not.toContain(AUDIT_MESSAGE);
  });
});

// The Apify token never leaves the server (CLAUDE.md, Secrets and data access): `apifyServerOnlyConfig`
// makes an import of `@/lib/otodom/apify` — the one module that holds it — an error in an island, a
// component, a layout and a page render. An `.astro` sample carries its import in the frontmatter,
// the only place an `.astro` file has one.
const APIFY_MESSAGE = "A view must not import the Apify module";

function astroSample(specifier: string): string {
  return `---\nimport * as probe from "${specifier}";\nconst loaded = Object.keys(probe).length;\n---\n\n<p>{loaded}</p>\n`;
}

async function lintAs(filePath: string, specifier: string): Promise<ESLint.LintResult> {
  if (!filePath.endsWith(".astro")) return lint(filePath, specifier);
  expect(existsSync(path.join(ROOT, filePath))).toBe(true);
  const results = await eslint.lintText(astroSample(specifier), { filePath: path.join(ROOT, filePath) });
  expect(results).toHaveLength(1);
  const result = results[0];
  expect(result.messages.filter((message) => message.fatal === true)).toEqual([]);
  return result;
}

describe("eslint.config.js: no view imports the module that holds the Apify token", () => {
  it.each([
    ["src/components/offers/AddOfferForm.tsx", "@/lib/otodom/apify"],
    ["src/components/offers/RefetchForm.tsx", "../../lib/otodom/apify.ts"],
    ["src/components/offers/OfferCard.astro", "@/lib/otodom/apify"],
    ["src/layouts/Layout.astro", "@/lib/otodom/apify"],
    ["src/pages/criteria.astro", "@/lib/otodom/apify"],
  ])("rejects, in %s, an import of %s", async (filePath, specifier) => {
    const messages = restrictedImportMessages(await lintAs(filePath, specifier));

    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain(APIFY_MESSAGE);
  });

  // Beside the rejections: the route that builds the leg, where the rule does not reach, and the
  // request module, which holds no token, in a view.
  it.each([
    ["src/pages/api/offers.ts", "@/lib/otodom/apify"],
    ["src/components/offers/AddOfferForm.tsx", "@/lib/otodom/apify-request"],
    ["src/pages/criteria.astro", "@/lib/config-status"],
  ])("allows, in %s, an import of %s", async (filePath, specifier) => {
    expect(restrictedImportMessages(await lintAs(filePath, specifier))).toEqual([]);
  });
});
