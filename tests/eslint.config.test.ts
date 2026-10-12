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
