import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { ENV_FILE } from "./config.ts";
import { ReviewerError } from "./errors.ts";

// The key is read from packages/code-reviewer/.env and nowhere else — not from the
// shell's environment, and never from a Claude Code login.
export function loadApiKey(envFile: string = ENV_FILE): string {
  if (!existsSync(envFile)) {
    throw new ReviewerError(
      "missing_api_key",
      `Missing ${envFile}. Copy .env.example to .env and set ANTHROPIC_API_KEY.`,
    );
  }
  const apiKey = parseEnv(readFileSync(envFile, "utf8")).ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new ReviewerError("missing_api_key", `ANTHROPIC_API_KEY is not set in ${envFile}.`);
  }
  return apiKey;
}
