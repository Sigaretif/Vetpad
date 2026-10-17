// CI entrypoint of the code reviewer, run by the composite action:
//   ANTHROPIC_API_KEY=… DIFF_FILE=pr.diff PR_TITLE=… [PR_BODY=…] node src/ci.ts
// Unlike src/cli.ts, which reads the key from packages/code-reviewer/.env only, this one takes
// it from the environment on purpose: in CI the action supplies it from the repository secret
// CODE_REVIEWER_API_KEY. stdout carries the review JSON alone; meta and errors go to stderr.
// Everything that can be checked for free happens before reviewDiff, so a run with a missing
// key, a missing or unreadable diff file or an empty diff never reaches the model provider.
import { readFileSync } from "node:fs";
import { ReviewerError } from "./errors.ts";
import { logMeta, reportError } from "./report.ts";
import { reviewDiff } from "./reviewer.ts";

function readDiffFile(): string {
  const diffFile = process.env.DIFF_FILE?.trim();
  if (!diffFile) {
    throw new ReviewerError("invalid_options", "DIFF_FILE is not set.");
  }
  try {
    return readFileSync(diffFile, "utf8");
  } catch (error) {
    throw new ReviewerError("invalid_options", `Cannot read DIFF_FILE ${diffFile}.`, { cause: error });
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new ReviewerError("missing_api_key", "ANTHROPIC_API_KEY is not set in the environment.");
  }
  const diff = readDiffFile();
  if (!diff.trim()) {
    throw new ReviewerError("empty_diff", "The diff is empty — nothing to review.");
  }
  const pr = { title: process.env.PR_TITLE ?? "", body: process.env.PR_BODY };

  const { review, meta } = await reviewDiff(diff, { apiKey, pr });
  logMeta(meta);
  process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
}

main().catch(reportError);
