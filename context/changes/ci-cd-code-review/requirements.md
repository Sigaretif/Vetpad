## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best. The six criteria map 1:1 to the fields of `REVIEW_SCHEMA` in `packages/code-reviewer/src/review-schema.ts`. They are written for Vetpad: an Astro SSR app on Cloudflare Workers with React islands and Supabase. The rules they cite live in `CLAUDE.md`, and `AGENTS.md` mirrors it.

How the reviewer reads a diff:

- **The reviewer sees only the PR title, the description and the diff, and judges what is missing from it as well.** A change that, by `CLAUDE.md`, must come with a companion lowers the score of the criterion that companion belongs to when the companion is not in the diff. Examples:
  - a new or changed `src/pages/api/` route without its `tests/pages/api/*.test.ts` and a step in `scripts/smoke.mjs`;
  - a new integration without its `ConfigStatus` entry;
  - a new card or form state without its fixture in `/dev/*`;
  - a new env var without `.env.example`.
- **Do not re-check what CI already enforces.** `npm run lint`, `npx astro check` and `npm test` gate every PR. That covers colour literals (`tokensOnlyConfig`), `console` outside `src/lib/log.ts`, imports of the notes module in the audit, re-fetch, archive and delete paths (`*NoNotesConfig`) and misused promises. Mention one of these only when the diff weakens the rule itself, for example by adding an entry to an `ignores` list or an `eslint-disable`.
- **Scope.** The project-specific readings below apply to the files they name. A diff outside the app (`packages/code-reviewer/`, `.github/`, `.claude/`, `context/`) is read with the generic meaning of each criterion. A workflow or composite action is also checked against two rules: third-party actions are pinned to a full commit SHA, and multi-line values go through files or heredoc delimiters.
- **Hard failures.** Any one of the following scores 1 on the criterion it falls under and makes the verdict `fail`, whatever the other scores are:
  - a `service_role` / `sb_secret_…` key, or a secret read outside `astro:env/server` or reachable from a React island;
  - a new table without `enable row level security` and one policy per operation in its creating migration, or a policy with `for all` / `using (true)`;
  - members' notes, or anything outside `AUDIT_OFFER_COLUMNS`, sent to the model provider;
  - the advertiser's phone number or name stored, or `raw` built by deleting fields instead of from a whitelist;
  - an attribute the listing does not state shown as `0`, "no" or another falsy value;
  - a blank or partial offer saved after a failed fetch;
  - a non-sale or non-flat listing saved;
  - a machine action that overwrites a note or re-runs or removes an audit;
  - a test, script or step that sends a real request to the model provider.

1. **implementation correctness** — does the change keep the product invariants and handle every way the data can fail? This covers:
   - unknown versus zero, through `numericOrUnknown`;
   - the flat-sale gate on `ad.adCategory`;
   - a failed read kept as its own state, never as "empty", "no limits", "not audited" or `fresh`;
   - every write judged by its error **and** by the number of rows it reached, since a denied update returns 200 with `[]`;
   - the order of a paid action: free checks, then the claim, then the provider, with no retry, and the attempt ended on every way out;
   - grounded findings with verbatim excerpts checked against `title`/`description`;
   - archiving that changes nothing but the board;
   - no automation behind a manual action.
   - _1_: an invariant from `CLAUDE.md` § Product invariants is broken, or a failure path silently turns into success or emptiness. Examples: `rent: "0"` rendered as "0 zł", a failed `select` shown as an empty board, a zero-row update reported as saved, a second provider call on retry.
   - _10_: every invariant the diff touches holds on the happy path, on the error path and at zero rows. Each failure keeps its own distinguishable state or `?error=` message, and nothing regresses.

2. **idiomaticity** — does the change look like the reference file it should follow? This covers:
   - the zero-config pattern in all four places (`envField` with `optional: true`, a factory that returns `null`, a null-check at each call site, a `ConfigStatus` entry);
   - form routes that read `FormData` and redirect with `?error=` / `&form=` and a hidden `intent`, and JSON-line streams only for `fetch`-driven islands as in `src/pages/api/audits.ts`;
   - `.astro` by default, with islands only for state or events and an explicit `client:*`;
   - imports through `@/`, classes merged with `cn()`, and only tokens and `src/components/ui` in views (added with `npx shadcn add` and its ritual);
   - logging through `logEvent` with whitelisted fields;
   - migrations from `supabase migration new`;
   - a 404 set through `Astro.response.status` and its not-found branch;
   - Workers-safe code: no `prerender`, no `"use client"`/`"use server"`, no module-scope cache or lock, and only `node:*` modules that `nodejs_compat` supports.
   - _1_: the change ignores the established pattern and imports another stack's habits. Examples: a JSON answer from a form route, a required env field or a `throw` at module load, `process.env`, Next.js directives, a module-level cache, an unsupported `node:*` import.
   - _10_: each new file reads as a sibling of the reference that `CLAUDE.md` names for it, with the same naming, error shape, logging and module boundaries.

3. **complexity** — is this the simplest change that fits the existing mechanisms, without building a second one? This covers reusing what exists instead of re-implementing it:
   - `src/lib/map-link.ts` for map links;
   - `auditFreshness` for freshness;
   - `resolveAuthors` / `src/lib/members.ts` for naming;
   - `loadAuditCriteria` for the audit's criteria;
   - `normalizeOfferUrl` for URLs;
   - `src/components/form/` composites and `ConfirmDialog` for forms and confirmations.

   It also covers:
   - hand-rolled validation instead of a new library (`zod`/`valibot`/`jest` need the user's go-ahead);
   - one bounded `RegExp` over `__NEXT_DATA__` instead of an HTML parser;
   - one concern per module in `src/lib/audit/`;
   - no abstraction for a single caller.
   - _1_: a parallel mechanism beside an existing one, a new dependency where the repo hand-rolls, an HTML/DOM parser in the Worker, or speculative layers that make the intent hard to follow.
   - _10_: the smallest diff that solves the problem through the existing modules and components, where every new function earns its place.

4. **test / risk coverage** — are the risky paths tested the way this repo tests them? This covers:
   - tests under `tests/` at the path of the `src/` file they cover;
   - route tests stubbed at the HTTP edge (`tests/fixtures/http.ts`), never by mocking `@/lib/*`;
   - a `*.unconfigured.test.ts` beside the route test for the zero-config exit;
   - every rejected case standing beside an accepted one, with expected values written by hand;
   - a failed read standing beside a read that succeeds and finds nothing;
   - zero-row writes asserted as failures;
   - privacy canaries in fixtures that stay synthetic, never a recorded otodom payload;
   - the provider only through `tests/fixtures/anthropic.ts`, with each scenario counting requests to the provider and writes to the database.

   Outside unit tests it also covers:
   - a step in `scripts/smoke.mjs` for every change to the `src/pages/api/` surface, with denied writes checked by whole rows (`withSnapshot`);
   - a check in `scripts/account-deletion.sql` or `scripts/audit-state.sql` for every new trigger rule or column referencing `auth.users`;
   - a `/dev/*` fixture for every new card, form, board or criteria state.
   - _1_: risky logic ships untested. Examples: a new route, migration or trigger with no test and no smoke step, tests that mock the module under test, assertions on HTTP status alone for a write, a fixture with a real advertiser's data, or a test that can reach the real provider.
   - _10_: the paths most likely to break are covered in the right layer, unit, smoke, SQL or E2E as `CLAUDE.md` § Testing assigns them. Every rejection is paired with an acceptance, and the zero-config exit is covered.

5. **documentation** — can a reader who knows the repo tell _why_ the code is the way it is, and do the rules still point at the right files? This covers:
   - comments that explain non-obvious decisions, such as an otodom trap, the order of time limits, why a write is filtered by its expected state, or a route's doc comment naming an indistinguishable state;
   - an update to `CLAUDE.md`/`AGENTS.md`, `README.md` or `.env.example` in the same diff when the change adds, moves or renames a reference file, an env var, a route contract or a test surface;
   - new rules written the `CLAUDE.md` way, naming a reference path rather than a count or a paraphrase.
   - _1_: intent must be reverse-engineered. Examples: a non-obvious guard or ordering with no explanation, a reference file moved or renamed while `CLAUDE.md` still points at the old path, a new env var missing from `.env.example`/README.
   - _10_: just enough comments to explain the "why", with project docs moving in step with the code and nothing restating what the code already says.

6. **security and safety** — does the change keep data behind RLS and keep secrets and private data where they belong? This covers:
   - RLS enabled with one policy per operation and role in the creating migration;
   - authorship scoping as the PRD requires (notes and member requirements written only by their author through `auth.uid()`; offers, searches and team limits writable by any member);
   - no grants added by hand and no `service_role` workaround;
   - trigger-signed columns (`archived_by`, audit dates and people) never trusted from the client;
   - `ANTHROPIC_API_KEY` only in `src/lib/audit/provider.ts` and never imported by anything a page render or an island loads;
   - stored values that any member can write through the Data API treated as untrusted (`source_url` through `normalizeOfferUrl`, finding text rendered only as text, never `set:html`, an attribute or an island prop);
   - no PII, query strings, Postgres `details`, page HTML, prompts or model answers in logs;
   - `.dev.vars`/`.env` never committed.
   - _1_: an exploitable flaw or data leak, including any hard failure listed above, a permissive policy, user-controlled text reaching `set:html` or a URL, or private data reaching a log.
   - _10_: every new table, column, route and log entry is closed by default, untrusted input is normalised before use, and no new path leads a secret or a member's or advertiser's data out of the system.

## Verdict

- binding `verdict`: `pass` | `fail`, next to the six scores and a Markdown `summary` (contract: `m5l2-review-schema.ts.template`)
- the merge gate reads only `verdict`

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added
