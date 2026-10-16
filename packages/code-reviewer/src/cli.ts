// Code-review CLI: a git diff on stdin, the structured review JSON on stdout.
//   git diff | npx tsx src/cli.ts
// Everything else (usage, cost, errors) goes to stderr, so stdout stays pipeable.
import { loadApiKey } from "./env.ts";
import { ReviewerError, type ReviewMeta } from "./errors.ts";
import { reviewDiff } from "./reviewer.ts";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new ReviewerError("empty_diff", "No diff on stdin. Usage: git diff | npx tsx src/cli.ts");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// One line per run with its cost — after a success and after a failure alike.
function logMeta(meta: ReviewMeta): void {
  const line = {
    subtype: meta.subtype,
    num_turns: meta.numTurns,
    total_cost_usd: meta.costUsd,
    usage: meta.usage,
  };
  process.stderr.write(`[code-reviewer] ${JSON.stringify(line)}\n`);
}

async function main(): Promise<void> {
  const apiKey = loadApiKey();
  const diff = await readStdin();
  const { review, meta } = await reviewDiff(diff, { apiKey });
  logMeta(meta);
  process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof ReviewerError) {
    if (error.meta) logMeta(error.meta);
    process.stderr.write(`[code-reviewer] error (${error.code}): ${error.message}\n`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[code-reviewer] error: ${message}\n`);
  }
  process.exitCode = 1;
});
