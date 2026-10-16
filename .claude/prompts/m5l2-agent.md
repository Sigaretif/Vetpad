# Pierwszy Agent zespołowy - v2

## Setup

Install the AI SDK skill into your agent first (in Claude Code it lands in `.claude/skills/ai-sdk/SKILL.md`):

```bash
npx skills add vercel/ai --skill ai-sdk
```

## Goal

/goal I want to follow @.claude/skills/ai-sdk/SKILL.md and integrate AI SDK 7 (`ai@7`), the OpenRouter provider (`@openrouter/ai-sdk-provider@3`) and zod, making a basic entry point for further integration in <reviewer-dir>/src/index.ts. Copy the review schema and system prompt from `m5l2-review-schema.ts.template` into <reviewer-dir>/src/review-schema.ts. Make sure Node 22+ works well with TypeScript (ESM, `"type": "module"`), use tsx to run it, and pin the major versions above (you can use context7 for the current API).

## Plan

/10x-plan tool-loop-agent I want to convert '<reviewer-dir>/src/index.ts' into a well-organized, modular code review agent based on the AI SDK ToolLoopAgent. Use @.claude/skills/ai-sdk/SKILL.md to understand its API. Keep the structured output schema from src/review-schema.ts as the single contract and move prompts into their own modules. Make sure the agent module is reusable and exports our reviewer so that we can run promptfoo evals on it in the future. Do not configure the eval environment in this change.
