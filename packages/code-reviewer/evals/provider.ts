// promptfoo provider: runs the real reviewDiff for one model, so the eval measures the code
// that runs in CI, not a copy of its prompt. The promptfoo prompt is ignored — the package
// builds its own from `vars.diff` and `vars.pr_title`. Nothing is logged here.
import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from "promptfoo";
import { loadApiKey, reviewDiff, ReviewerError, type ReviewMeta } from "../src/index.ts";

// Cost and tokens of a run that reached a result — a failed run's spend is reported too.
function spendOf(meta: ReviewMeta): Pick<ProviderResponse, "cost" | "tokenUsage"> {
  const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens } = meta.usage;
  const prompt = input_tokens + (cache_creation_input_tokens ?? 0) + (cache_read_input_tokens ?? 0);
  return {
    cost: meta.costUsd,
    tokenUsage: { prompt, completion: output_tokens, total: prompt + output_tokens },
  };
}

function stringVar(context: CallApiContextParams | undefined, name: string): string | undefined {
  const value = context?.vars[name];
  return typeof value === "string" ? value : undefined;
}

export default class CodeReviewerProvider implements ApiProvider {
  private readonly model: string;

  constructor(options: ProviderOptions) {
    const model: unknown = options.config?.model;
    if (typeof model !== "string" || !model.trim()) {
      throw new Error("code-reviewer provider: config.model must be a non-empty string.");
    }
    this.model = model;
  }

  id(): string {
    return `code-reviewer:${this.model}`;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const diff = stringVar(context, "diff") ?? "";
    const prTitle = stringVar(context, "pr_title");
    try {
      const apiKey = loadApiKey();
      const { review, meta } = await reviewDiff(diff, {
        apiKey,
        model: this.model,
        pr: prTitle ? { title: prTitle } : undefined,
      });
      return {
        output: JSON.stringify(review),
        ...spendOf(meta),
        metadata: { model: meta.model, subtype: meta.subtype, numTurns: meta.numTurns },
      };
    } catch (error) {
      if (error instanceof ReviewerError) {
        return {
          error: `${error.code}: ${error.message}`,
          ...(error.meta ? spendOf(error.meta) : {}),
          metadata: { code: error.code },
        };
      }
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}
