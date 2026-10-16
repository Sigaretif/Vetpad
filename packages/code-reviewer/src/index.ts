// Code-review entry point: a git diff on stdin, the structured review JSON on stdout.
//   git diff | npx tsx src/index.ts
// Everything else (usage, cost, errors) goes to stderr, so stdout stays pipeable.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { PACKAGE_DIR, REVIEW_DEFAULTS } from "./config.ts";
import { loadApiKey } from "./env.ts";
import { ReviewerError, type ReviewerErrorCode } from "./errors.ts";
import { SYSTEM_PROMPT } from "./prompts/system.ts";
import { buildReviewPrompt } from "./prompts/user.ts";
import { REVIEW_JSON_SCHEMA, REVIEW_SCHEMA, type Review } from "./review-schema.ts";

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

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new ReviewerError("empty_diff", "No diff on stdin. Usage: git diff | npx tsx src/index.ts");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const diff = Buffer.concat(chunks).toString("utf8");
  if (!diff.trim()) {
    throw new ReviewerError("empty_diff", "The diff on stdin is empty — nothing to review.");
  }
  return diff;
}

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

function logResult(result: SDKResultMessage): void {
  const line = {
    subtype: result.subtype,
    num_turns: result.num_turns,
    total_cost_usd: result.total_cost_usd,
    usage: result.usage,
  };
  process.stderr.write(`[code-reviewer] ${JSON.stringify(line)}\n`);
}

async function review(diff: string, apiKey: string): Promise<Review> {
  const configDir = mkdtempSync(path.join(tmpdir(), "code-reviewer-"));
  const abortController = new AbortController();
  let result: SDKResultMessage | undefined;
  try {
    const run = query({
      prompt: buildReviewPrompt(diff),
      options: {
        model: REVIEW_DEFAULTS.model,
        systemPrompt: SYSTEM_PROMPT,
        // Isolation: no filesystem settings, no CLAUDE.md, no tools — the diff is the whole input.
        settingSources: [],
        tools: [],
        mcpServers: {},
        strictMcpConfig: true,
        maxTurns: REVIEW_DEFAULTS.maxTurns,
        maxBudgetUsd: REVIEW_DEFAULTS.maxBudgetUsd,
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
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }

  if (!result) throw new ReviewerError("no_result", "The agent ended without a result message.");
  logResult(result);

  if (result.subtype !== "success") {
    throw new ReviewerError(
      RESULT_ERROR_CODES[result.subtype],
      `Review failed (${result.subtype}): ${result.errors.join("; ") || "no details"}`,
    );
  }
  if (result.is_error) {
    throw new ReviewerError("model_error", `Review failed: ${result.result}`);
  }

  const parsed = REVIEW_SCHEMA.safeParse(result.structured_output);
  if (!parsed.success) {
    throw new ReviewerError("schema_mismatch", `The structured output does not match REVIEW_SCHEMA: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function main(): Promise<void> {
  const apiKey = loadApiKey();
  const diff = await readStdin();
  const result = await review(diff, apiKey);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[code-reviewer] error: ${message}\n`);
  process.exitCode = 1;
});
