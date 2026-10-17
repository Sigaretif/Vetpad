import path from "node:path";

export const PACKAGE_DIR = path.resolve(import.meta.dirname, "..");
export const ENV_FILE = path.join(PACKAGE_DIR, ".env");

export const REVIEW_DEFAULTS = {
  model: "claude-sonnet-5-5",
  maxTurns: 2,
  // Hard cap per review; the SDK stops the run with `error_max_budget_usd` once it is crossed.
  maxBudgetUsd: 0.5,
} as const;

// The PR description is cut to this many characters before it reaches the model.
export const PR_BODY_MAX_CHARS = 4000;
