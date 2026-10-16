import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

// What a finished run cost and how it ended. Carried by a successful review and by every
// error raised after the agent sent its result, so a failed run's cost is never lost.
export interface ReviewMeta {
  model: string;
  subtype: SDKResultMessage["subtype"];
  costUsd: number;
  numTurns: number;
  usage: SDKResultMessage["usage"];
  modelUsage: SDKResultMessage["modelUsage"];
}

// Callers (the CLI, a future promptfoo provider, the CI gate) tell failures apart by code,
// never by message text.
export type ReviewerErrorCode =
  | "missing_api_key"
  | "empty_diff"
  | "invalid_options"
  | "auth_source"
  | "no_result"
  | "execution"
  | "max_turns"
  | "max_budget"
  | "structured_output_retries"
  | "model_error"
  | "no_structured_output"
  | "schema_mismatch";

export class ReviewerError extends Error {
  readonly code: ReviewerErrorCode;
  readonly meta?: ReviewMeta;

  constructor(code: ReviewerErrorCode, message: string, { meta, cause }: { meta?: ReviewMeta; cause?: unknown } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReviewerError";
    this.code = code;
    if (meta) this.meta = meta;
  }
}
