# Introducing promptfoo to project - v2

## Research

/10x-research code-review-evals Analyze the current state of '<reviewer-dir>' in the context of potential eval introduction - reusability of prompts, importability of agent, etc. My first pick for eval toolkit is promptfoo. If my tech stack is aligned with this tool, go in that direction. Otherwise, you can analyze other oss tools allowing me to eval my prompts and agents. Use Web Search or context7 to get the most up to date docs.

## Plan

/10x-plan code-review-evals Plan how to introduce promptfoo within '<reviewer-dir>', starting from `m5l3-promptfooconfig.yaml.template`. My goal is to create a first configuration that tests the same code review prompt on three different models (z-ai/glm-5.3, deepseek/deepseek-v4.1-flash and openai/gpt-5.6-luna) through OpenRouter. For test cases, there should be one, rather complex diff migrating a React 16 component into React 19+ with three impactful flaws in it. LLM-as-a-judge should verify whether code review results correctly identify what is broken. Also add a static javascript assertion checking that the review verdict is "fail".
