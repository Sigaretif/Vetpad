---
change_id: grounded-listing-audit
title: Grounded listing audit
status: implementing
created: 2026-10-06
updated: 2026-10-07
archived_at: null
---

## Notes

Decisions the user made on 2026-10-06, during `/10x-research`. `/10x-plan` builds on them and does
not ask again:

- **Provider**: Anthropic, called directly, on prepaid credits. Credits are bought and auto-reload
  is off in the Claude Console. Reasons and billing facts: `provider-selection.md`.
- **Integration**: the official Anthropic SDK, not plain `fetch`.
- **Default model**: `claude-opus-5-5`. `CLAUDE.md` (Product invariants) was updated to say so.
- **Default reasoning effort**: `medium` — the user's compromise between `low` (their first choice,
  for cost) and `high`. It is also what `claude-opus-5-5` uses when no effort is sent; the audit
  sends it explicitly all the same, so the default does not move if the provider's does.
- **Model and effort are not hard-coded** at the call site.

Questions the user wants `/10x-plan` to put to them:

1. **Should a member be able to choose the model, and the reasoning effort, from inside the
   application?** The alternative is one configured default that only a deploy changes.
2. **What should the audit concentrate on?** The user wants a deliberate instruction written for the
   model that runs the audit, and expects it to weigh on token cost. The finding categories are
   fixed by FR-011; the question is emphasis within them.

The user also wants the plan to carry the feature through to production: a phase that deploys it
and verifies it there, and an update to `context/foundation/deployment-runbook.md` with whatever
that deploy shows. What such a phase has to cover, from the runbook as it stands:

- **Order.** The migration reaches the hosted project with `npx supabase db push` before the Worker
  that needs it deploys — dry run shown, user's consent asked. The provider key is set by a human
  in Workers Secrets and in the GitHub repository secrets. The code then leaves through `/git-ship`
  or `/git-land`, whichever the user picks, and Workers Builds deploys on the push to `master`.
- **A deploy without the key is safe and visible**: the audit degrades and every page shows the
  missing-configuration banner. A key set before the code arrives changes nothing.
- **Verification that costs nothing**: the runbook's existing pass, plus the audit route answering
  an unauthenticated request with the sign-in redirect.
- **Verification that costs one audit**: a human runs one real audit on the longest saved listing
  and reads the per-request CPU in the Workers dashboard and the audit's entries in
  `npx wrangler tail`. This closes `research.md` Open Questions 1 and 3 and is the measurement the
  runbook has been asking for since deploy zero.
- **Runbook sections the deploy will make stale**: "Current state" (secrets in production), "Logs"
  (the audit's event), "Verifying a deploy", "Symptoms that lie" (an exhausted credit balance or a
  reached spend limit reads like a broken feature), "The CPU ceiling is reached" (replace the
  prediction about FR-010 with the measured number) and "Adding the model provider key (FR-010)".

Raised by the agent in the same conversation, not yet answered by the user:

- **No effort level has been measured on Polish listings.** The agent objected to `low` because the
  PRD ranks audit correctness above cost; the user answered with `medium`. Comparing levels on a
  handful of real listings (the manual golden set in `context/foundation/test-plan.md`) stays an
  optional way to check that choice, not a blocker.
- **If the model is selectable in the application**, the agent's suggestions: offer a fixed list
  rather than free text, because the choice sets what one audit costs and any member could
  otherwise pick the most expensive model; and store the model and effort with each audit, so a
  finding can be traced to what produced it.
- **Notes are never an input to the audit** (PRD, Business Logic and Non-Functional Requirements),
  so the instruction is written from the listing and the criteria alone.

Decisions the user made on 2026-10-07, during `/10x-implement` phase 3, after reading the first
draft of the model's instruction (`src/lib/audit/prompt.ts`) and the agent's two reviews of it — one
against the PRD, one from general knowledge of Polish sale listings and of how models follow such
instructions. The instruction holds more than the plan's seven parts on purpose; a review should not
read these as drift:

- **One requirement, several expectations.** A member's requirements are one free text; each
  expectation the listing is silent on gets its own entry under the same `Wn`, written exactly as
  the message numbers it. `groundFindings` already kept several findings per `Wn`.
- **A generality is not a value.** "Low rent" does not state the rent: the attribute is missing and
  the question asks for the figure.
- **Questions reach further.** One sentence, no greeting, and where the listing does not say it: the
  land register and encumbrances beside the ownership form, what the rent covers, the kind of
  heating and how it is billed, the lift beside the floor. The list of nine attributes is unchanged.
- **Costs and conditions are defined by kind**, costs as anything beyond the purchase price that the
  text names (PRD, FR-011).
- **Red flags**: a contradiction with a parameter counts; "anything about the legal or technical
  state" was narrowed to an encumbrance, an unsettled legal state, a defect or a needed renovation;
  and an open list names the legal matters to highlight wherever the text mentions one.
- **One fragment, one field**: a cost, else a condition, else a red flag.
- **A listing's standard formulas are not findings**, unless one names a cost or a condition.
- **The excerpt rule says why it is strict** (the application checks every excerpt), asks for the
  listing's own typographic characters, and for an excerpt that reads without the rest of the text.
- **The listing is read to its last sentence**: the instruction says so, and the message ends with
  the request, after the last block.

Not changed, and why: attributes beyond the nine (land register, lift, handover date, parking) are
not added to the list, because the code tells a missing attribute by an empty column and these have
none — a member writes them as additional requirements on `/criteria`, which the audit already asks
about. A requirement contradicted only by a stated parameter is reported nowhere; that is
`context/foundation/prd.md`, Open Questions, 2. The PRD's resolved block records the decisions above.
