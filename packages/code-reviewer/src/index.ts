// Public entry of the code reviewer. Importing it runs nothing; the entrypoints are
// src/cli.ts (local) and src/ci.ts (the CI gate).
export { reviewDiff, type ReviewOptions, type ReviewOutcome } from "./reviewer.ts";
export { ReviewerError, type ReviewerErrorCode, type ReviewMeta } from "./errors.ts";
export { REVIEW_SCHEMA, REVIEW_JSON_SCHEMA, type Review } from "./review-schema.ts";
export { SYSTEM_PROMPT } from "./prompts/system.ts";
export { buildReviewPrompt, type PullRequestContext } from "./prompts/user.ts";
export { REVIEW_DEFAULTS, PR_BODY_MAX_CHARS } from "./config.ts";
export { loadApiKey } from "./env.ts";
