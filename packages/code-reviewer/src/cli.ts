// Code-review CLI: a git diff on stdin, the structured review JSON on stdout.
//   git diff | npx tsx src/cli.ts
// Everything else (usage, cost, errors) goes to stderr, so stdout stays pipeable.
import { loadApiKey } from "./env.ts";
import { ReviewerError } from "./errors.ts";
import { logMeta, reportError } from "./report.ts";
import { reviewDiff } from "./reviewer.ts";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new ReviewerError("empty_diff", "No diff on stdin. Usage: git diff | npx tsx src/cli.ts");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const apiKey = loadApiKey();
  const diff = await readStdin();
  const { review, meta } = await reviewDiff(diff, { apiKey });
  logMeta(meta);
  process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
}

main().catch(reportError);
