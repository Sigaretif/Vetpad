// stderr reporting shared by the entrypoints (src/cli.ts, src/ci.ts), so both write the
// run's cost and their errors in one format. stdout is left to the review JSON.
import { ReviewerError, type ReviewMeta } from "./errors.ts";

// One line per run with its cost — after a success and after a failure alike.
export function logMeta(meta: ReviewMeta): void {
  const line = {
    subtype: meta.subtype,
    num_turns: meta.numTurns,
    total_cost_usd: meta.costUsd,
    usage: meta.usage,
  };
  process.stderr.write(`[code-reviewer] ${JSON.stringify(line)}\n`);
}

// Reports a failed run and marks the process as failed.
export function reportError(error: unknown): void {
  if (error instanceof ReviewerError) {
    if (error.meta) logMeta(error.meta);
    process.stderr.write(`[code-reviewer] error (${error.code}): ${error.message}\n`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[code-reviewer] error: ${message}\n`);
  }
  process.exitCode = 1;
}
