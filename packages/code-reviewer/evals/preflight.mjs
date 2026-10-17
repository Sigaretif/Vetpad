// Free preflight: proves that promptfoo's loader runs provider.ts (with its `.ts` imports,
// under tsx) and that the provider reaches reviewDiff — without a paid call.
// - The test has no `assert`, so no judge model is ever called.
// - The diff is empty, so reviewDiff throws `empty_diff` before query()
//   (src/reviewer.ts:59-61); nothing reaches the model provider.
// Without packages/code-reviewer/.env the provider stops earlier, at `missing_api_key:` —
// also free, but it does not prove the provider got to reviewDiff, so it fails here.
import { existsSync } from "node:fs";
import path from "node:path";

// promptfoo's database and config stay inside this folder (git-ignored), not in ~/.promptfoo.
process.env.PROMPTFOO_CONFIG_DIR ??= path.join(import.meta.dirname, ".promptfoo");

const { evaluate } = await import("promptfoo");

const evalRecord = await evaluate(
  {
    providers: [{ id: "file://provider.ts", config: { model: "claude-haiku-5-5" } }],
    prompts: ["{{diff}}"],
    tests: [{ vars: { diff: "", pr_title: "preflight" } }],
    writeLatestResults: false,
  },
  { cache: false, maxConcurrency: 1 },
);
const summary = await evalRecord.toEvaluateSummary();
const results = summary.results;
const error = results.length === 1 ? (results[0].response?.error ?? results[0].error ?? "") : "";

if (error.startsWith("empty_diff:")) {
  console.log("preflight ok: promptfoo loaded provider.ts and reviewDiff refused the empty diff (no paid call).");
  process.exit(0);
}

if (error.startsWith("missing_api_key:")) {
  const envFile = path.resolve(import.meta.dirname, "..", ".env");
  if (!existsSync(envFile)) {
    console.error(`preflight failed: ${envFile} does not exist. Copy ../.env.example to ../.env and set ANTHROPIC_API_KEY.`);
    process.exit(1);
  }
}

console.error("preflight failed: expected exactly one result with an `empty_diff:` error, got:");
console.error(
  JSON.stringify(
    results.map((result) => ({ success: result.success, error: result.error, responseError: result.response?.error })),
    null,
    2,
  ),
);
process.exit(1);
