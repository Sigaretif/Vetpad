---
change_id: review-agent-modules
title: Modularny agent code review na Claude Agent SDK query()
status: implementing
created: 2026-10-16
updated: 2026-10-16
archived_at: null
---

## Notes

I want to convert 'packages/code-reviewer/src/index.ts' into a well-organized, modular code review agent based on the Claude Agent SDK query(). Use https://code.claude.com/docs/en/agent-sdk/typescript to understand its API. Keep the structured output schema from src/review-schema.ts as the single contract and move prompts into their own modules. Make sure the agent module is reusable and exports our reviewer so that we can run promptfoo evals on it in the future. Do not configure the eval environment in this change.
