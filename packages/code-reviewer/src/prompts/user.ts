// The user message that carries the review's input: the diff and, from CI, the PR's title
// and description. All of it is data for the reviewer — the system prompt says so.
import { PR_BODY_MAX_CHARS } from "../config.ts";

// What the CI gate knows about the pull request beside its diff.
export interface PullRequestContext {
  title: string;
  body?: string;
}

const TRUNCATION_MARKER = `\n[… opis przycięty do ${PR_BODY_MAX_CHARS} znaków]`;

// A pasted plan must not eat the review's budget, so a long description is cut, visibly.
function prDescription(body: string): string {
  return body.length > PR_BODY_MAX_CHARS ? `${body.slice(0, PR_BODY_MAX_CHARS)}${TRUNCATION_MARKER}` : body;
}

// Without `pr` the text is exactly what the local CLI has always sent.
export function buildReviewPrompt(diff: string, pr?: PullRequestContext): string {
  const diffBlock = `<diff>\n${diff}\n</diff>`;
  if (!pr) return `Oceń poniższy diff.\n\n${diffBlock}`;

  const parts = [`<pr_title>\n${pr.title}\n</pr_title>`];
  const body = pr.body?.trim();
  if (body) parts.push(`<pr_description>\n${prDescription(body)}\n</pr_description>`);
  parts.push(diffBlock);
  return `Oceń poniższy pull request: jego tytuł, opis i diff.\n\n${parts.join("\n\n")}`;
}
