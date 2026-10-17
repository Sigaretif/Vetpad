# Code reviewer evals

[promptfoo](https://www.promptfoo.dev/) evals of the code reviewer in `packages/code-reviewer`. Every model runs the real `reviewDiff` through `provider.ts`, so an eval measures the code that runs in CI (`.github/workflows/review.yml`), not a copy of its prompt. `promptfooconfig.yaml` is the eval set.

**Rule (`CLAUDE.md`, `### Paid model calls and CI review`, "The eval set runs before the reviewer's prompt or model changes"):** before a change to `packages/code-reviewer/src/prompts/system.ts` or to the reviewer's model, run this set on the current code and on the change, and compare both with the baseline below.

## Requirements

- Node ≥ 22.22 (`engines` in `package.json`).
- `npm ci` in `packages/code-reviewer` (the agent's dependencies, which `provider.ts` imports through `../src/index.ts`) and again in `packages/code-reviewer/evals` (promptfoo).
- `ANTHROPIC_API_KEY` in `packages/code-reviewer/.env` (copy `../.env.example`). The reviewer and the `llm-rubric` judge both take it from there; it is never the application's key.

## Preflight (free)

```sh
npm run preflight
```

Proves that promptfoo loads `provider.ts` and that the provider reaches `reviewDiff`, without a paid call: the diff is empty, so `reviewDiff` refuses it with `empty_diff` before anything is sent, and the test has no assertion, so no judge is called. Run it after any change to `provider.ts`, `package.json` or the package's dependencies. This is the only way an agent checks the evals.

## Eval (paid)

```sh
npm run eval
npm run view
```

`npm run eval` sends the fixture's diff to the model provider on every model in `promptfooconfig.yaml` and then asks the judge to grade each review. **Every run is paid, and the user starts it by hand** — never CI, never a test, never an agent without the user's instruction for that one run (`CLAUDE.md`, "Nothing reaches the model provider on its own"). `--no-cache` makes each run a new measurement and a new cost.

Cost estimate per run: 3 reviews, each capped at `maxBudgetUsd` in `../src/config.ts` (0.5 USD), plus 9 judge calls on Opus (3 `llm-rubric` assertions × 3 models) — under about 2 USD in total.

`npm run view` opens the results table in the browser. Results stay in `.promptfoo/` in this folder, which is git-ignored.

## What the case measures

`fixtures/react19-migration.diff` is a React 16 → 19 migration of a `MemberProfile` component with three planted flaws. Each flaw has its own `llm-rubric` metric, so the table shows which flaw a model missed, and a review passes a metric only when it names the flaw **and** its consequence:

- `flaw-default-props` — `defaultProps` on a function component, which React 19 ignores, so the default role is lost.
- `flaw-effect-deps` — a `useEffect` with `[]` instead of `[userId]`, so a new `userId` no longer fetches the profile.
- `flaw-xss` — the member's bio rendered through `dangerouslySetInnerHTML` without sanitisation.

Two more assertions stand beside them: `is-json` (the CI gate reads the verdict from the JSON) and `verdict-fail` (a change with these flaws must be rejected).

## Baseline

The first run of the reviewer prompt as it stands in `../src/prompts/system.ts` — eval `eval-3Bk-2026-10-17T15:00:51`, 2026-10-17:

| Model        | Result | Missed             | Verdict | Cost       |
| ------------ | ------ | ------------------ | ------- | ---------- |
| `haiku-5-5`  | FAIL   | `flaw-effect-deps` | `fail`  | 0.0025 USD |
| `sonnet-5-5` | PASS   | —                  | `fail`  | 0.039 USD  |
| `opus-5-5`   | PASS   | —                  | `fail`  | 0.076 USD  |

A change to the prompt or the model is measured against this table.

### Later runs

| Date       | Eval                           | Change measured                                                          | Result vs baseline                                                            |
| ---------- | ------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 2026-10-17 | `eval-0qd-2026-10-17T21:06:44` | criteria in `system.ts` updated by `otodom-apify-fallback` (Apify rules) | unchanged: haiku FAIL on `flaw-effect-deps`, sonnet and opus PASS, all `fail` |

## Privacy and telemetry

Every script sets `PROMPTFOO_DISABLE_TELEMETRY`, `PROMPTFOO_DISABLE_SHARING` and `PROMPTFOO_DISABLE_UPDATE`, and `promptfooconfig.yaml` sets `sharing: false`: nothing goes to promptfoo's servers. `PROMPTFOO_CONFIG_DIR=.promptfoo` keeps promptfoo's database here rather than in `~/.promptfoo`.

## Adding a case

Add a diff to `fixtures/` and a test to `tests` in `promptfooconfig.yaml`, with one `llm-rubric` metric per planted flaw that asks for the flaw and its consequence. A fixture is synthetic and hand-written: no real person's data, no recorded listing, no secrets — the repository is public, and the diff is sent to the model provider. `PROMPTFOO_DISABLE_TEMPLATING` in `promptfooconfig.yaml` keeps a diff verbatim, so `{{ … }}` in JSX needs no escaping. Run `npm run preflight` after the change; the paid run that measures the new case is the user's.
