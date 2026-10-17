// The code-review agent: the one module that calls the Claude Agent SDK's query().
// It writes nothing to stdout or stderr — the caller gets the review and the run's cost
// back as `meta`, or a ReviewerError with a code (and `meta` once the agent sent a result).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { PACKAGE_DIR, REVIEW_DEFAULTS } from "./config.ts";
import { ReviewerError, type ReviewerErrorCode, type ReviewMeta } from "./errors.ts";
import { SYSTEM_PROMPT } from "./prompts/system.ts";
import { buildReviewPrompt, type PullRequestContext } from "./prompts/user.ts";
import { REVIEW_JSON_SCHEMA, REVIEW_SCHEMA, type Review } from "./review-schema.ts";

export interface ReviewOptions {
  // Taken as given — the library never reads a key itself. loadApiKey() is the CLI's source.
  apiKey: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  // The PR's title and description, from the CI gate. Without it the prompt is the diff alone.
  pr?: PullRequestContext;
}

export interface ReviewOutcome {
  review: Review;
  meta: ReviewMeta;
}

// Variables that would let the Claude Code subprocess authenticate some other way
// than with our API key. They are stripped from its environment.
const FOREIGN_AUTH_VARS = [
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_BASE_URL",
];

const RESULT_ERROR_CODES = {
  error_during_execution: "execution",
  error_max_turns: "max_turns",
  error_max_budget_usd: "max_budget",
  error_max_structured_output_retries: "structured_output_retries",
} as const satisfies Record<Exclude<SDKResultMessage["subtype"], "success">, ReviewerErrorCode>;

function subprocessEnv(apiKey: string, configDir: string): Record<string, string | undefined> {
  const inherited = Object.entries(process.env).filter(([name]) => !FOREIGN_AUTH_VARS.includes(name));
  return {
    ...Object.fromEntries(inherited),
    ANTHROPIC_API_KEY: apiKey,
    // An empty config dir holds no stored login, so the subprocess has nothing to fall back to.
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_AGENT_SDK_CLIENT_APP: "code-reviewer/0.0.1",
  };
}

// Everything that can be checked for free, before a temp dir or a subprocess exists.
function resolveOptions(diff: string, options: ReviewOptions): Required<Omit<ReviewOptions, "pr">> {
  if (!diff.trim()) {
    throw new ReviewerError("empty_diff", "The diff is empty — nothing to review.");
  }
  // `??`, not a spread: an explicit `undefined` from the caller still means "use the default".
  const resolved = {
    apiKey: options.apiKey,
    model: options.model ?? REVIEW_DEFAULTS.model,
    maxTurns: options.maxTurns ?? REVIEW_DEFAULTS.maxTurns,
    maxBudgetUsd: options.maxBudgetUsd ?? REVIEW_DEFAULTS.maxBudgetUsd,
  };
  if (!resolved.apiKey.trim()) {
    throw new ReviewerError("invalid_options", "apiKey is empty.");
  }
  if (!Number.isInteger(resolved.maxTurns) || resolved.maxTurns <= 0) {
    throw new ReviewerError("invalid_options", `maxTurns must be a positive integer, got ${resolved.maxTurns}.`);
  }
  if (!Number.isFinite(resolved.maxBudgetUsd) || resolved.maxBudgetUsd <= 0) {
    throw new ReviewerError(
      "invalid_options",
      `maxBudgetUsd must be a positive finite number, got ${resolved.maxBudgetUsd}.`,
    );
  }
  return resolved;
}

function metaOf(result: SDKResultMessage, model: string): ReviewMeta {
  return {
    model,
    subtype: result.subtype,
    costUsd: result.total_cost_usd,
    numTurns: result.num_turns,
    usage: result.usage,
    modelUsage: result.modelUsage,
  };
}

export async function reviewDiff(diff: string, options: ReviewOptions): Promise<ReviewOutcome> {
  const { apiKey, model, maxTurns, maxBudgetUsd } = resolveOptions(diff, options);

  const configDir = mkdtempSync(path.join(tmpdir(), "code-reviewer-"));
  const abortController = new AbortController();
  let result: SDKResultMessage | undefined;
  try {
    const run = query({
      prompt: buildReviewPrompt(diff, options.pr),
      options: {
        model,
        systemPrompt: SYSTEM_PROMPT,
        // Isolation: no filesystem settings, no CLAUDE.md, no tools — the diff is the whole input.
        settingSources: [],
        tools: [],
        mcpServers: {},
        strictMcpConfig: true,
        maxTurns,
        maxBudgetUsd,
        outputFormat: { type: "json_schema", schema: REVIEW_JSON_SCHEMA },
        persistSession: false,
        cwd: PACKAGE_DIR,
        env: subprocessEnv(apiKey, configDir),
        abortController,
      },
    });

    for await (const message of run) {
      if (message.type === "system" && message.subtype === "init" && message.apiKeySource !== "ANTHROPIC_API_KEY") {
        abortController.abort();
        throw new ReviewerError(
          "auth_source",
          `Refusing to run: the agent authenticated via "${message.apiKeySource}", not ANTHROPIC_API_KEY.`,
        );
      }
      if (message.type === "result") result = message;
    }
  } catch (error) {
    if (error instanceof ReviewerError) throw error;
    // In one-shot mode the SDK throws after it has sent an error result; that result
    // (and its cost) is what we report. Without one, the run itself failed.
    if (!result) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ReviewerError("execution", `The agent run failed: ${detail}`, { cause: error });
    }
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }

  if (!result) throw new ReviewerError("no_result", "The agent ended without a result message.");
  const meta = metaOf(result, model);

  if (result.subtype !== "success") {
    throw new ReviewerError(
      RESULT_ERROR_CODES[result.subtype],
      `Review failed (${result.subtype}): ${result.errors.join("; ") || "no details"}`,
      { meta },
    );
  }
  if (result.is_error) {
    throw new ReviewerError("model_error", `Review failed: ${result.result}`, { meta });
  }
  if (result.structured_output === undefined) {
    throw new ReviewerError("no_structured_output", "The agent returned no structured output.", { meta });
  }

  const parsed = REVIEW_SCHEMA.safeParse(result.structured_output);
  if (!parsed.success) {
    throw new ReviewerError(
      "schema_mismatch",
      `The structured output does not match REVIEW_SCHEMA: ${parsed.error.message}`,
      { meta },
    );
  }
  return { review: parsed.data, meta };
}
