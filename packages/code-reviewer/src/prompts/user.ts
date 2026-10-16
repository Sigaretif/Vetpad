// The user message that carries the diff. The diff is the agent's whole input.
export function buildReviewPrompt(diff: string): string {
  return `Oceń poniższy diff.\n\n<diff>\n${diff}\n</diff>`;
}
