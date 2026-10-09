---
change_id: grounded-listing-audit
title: Grounded listing audit
status: archived
created: 2026-10-06
updated: 2026-10-09
archived_at: 2026-10-09T19:51:09Z
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

Carried from phase 3 into phase 4 (2026-10-07), for whoever implements it:

- `readAuditOffer` returns `null` for a row with a zero, a negative number or a blank text in a
  whitelisted column. The route has no reason of its own for that; if it maps it to
  `offer_read_failed`, that reason's message must stop saying "try again in a moment", which is
  false for a cause that lasts until the row is fixed.
- `groundFindings` trusts the shape of the model's answer. The route needs a runtime reader of that
  answer before calling it, so a wrong shape ends as `provider_malformed`.
- `AUDIT_OUTPUT_SCHEMA` is declared `as const`; whether the SDK's `jsonSchemaOutputFormat` accepts a
  deeply readonly schema is unverified until the SDK is installed.

Decision the user made on 2026-10-09, during `/10x-implement` phase 4, after the first real audit
was rejected by the provider with `400 invalid_request_error` and nothing in the log said why:

- **A rejected request's log entry carries what the provider said was wrong with it.** The plan had
  the provider's message never leave `runAudit`, because it can quote the request. That rule now has
  one exception, kept narrow: a `400 invalid_request_error` that is not a billing state, before the
  stream. The text is cut to 300 characters and dropped whole when any 12 characters in a row also
  stand in the message that carried the listing and the criteria (`rejectionMessage` in
  `src/lib/audit/provider.ts`). It goes to the log field `provider_error_message` and never to the
  member, who still reads the application's own sentence. Every other failure keeps the plan's rule.

Found during phase 4's first real audit (2026-10-09), for phase 6 (README) and phase 7 (runbook):

- **`npm run build` copies `.dev.vars` into `dist/server/.dev.vars`, and `npm run preview` reads the
  copy.** A key changed in `.dev.vars` reaches the preview only after a rebuild; restarting the
  preview is not enough. The symptom is `provider_auth` with status 401 when the old key was
  revoked meanwhile, while the same key passes a direct request. `dist/` is git-ignored.
- **A key that belongs to no workspace answers `400 invalid_request_error`** („This API key is not
  scoped to a workspace…"), not 401. The provider module reads it as `provider_auth`; the fix is a
  key created inside the workspace. A candidate for the runbook's "Symptoms that lie".
- **Measured on one local audit** (`claude-opus-5-5`, `medium`, a listing of 1600 characters, one
  requirement): 6033 input tokens, 771 output tokens, 10.5 s, 58 stream events, 5 findings, none
  rejected. Replaying streams through `runAudit` in Node took about 0.6 ms for 58 events and about
  5 ms for 1000 — an estimate of the stream's share of CPU, not a measurement on a Worker.

State at the pause before phase 7 (2026-10-09), for the session that resumes it:

- **Paid audits used: three of the four planned; both reserve audits untouched.** No. 1 — `claude-opus-5-5`,
  two simultaneous requests, one provider call (sent by the agent on the user's word). No. 2 —
  `claude-sonnet-5-5`, one request (the same). No. 3 — `claude-opus-5-5`, started by the user from the
  card. No. 4 is the production audit of phase 7.
- **Progress row 5.10 is open on purpose**: the user chose to commit phase 5 and close that row after
  an implementation review. Whether to run `/10x-impl-review` before the deploy is still the user's
  call — it was offered at the end of phase 6 and not yet answered.
- **Phase 7 starts with the two production secrets**, which the user sets by hand (Workers Secrets and
  the GitHub repository secret). The user asked to be told when the GitHub secret is due: it is due
  then. Suggested, not decided: a separate key for production in the same Console workspace.
- **Local data left by phase 5's free checks**: the first saved offer holds a failed attempt
  (`provider_auth`, from the deliberate wrong-key run) beside its kept result; the next successful
  audit of that offer clears it. `.env` and `.dev.vars` hold the real key; the preview is stopped.

Recorded by `/10x-impl-review` on 2026-10-09 (report: `reviews/impl-review.md`, phases 1–6, ten findings, all
triaged). What the triage changed, for the session that resumes phase 7:

- **A third migration exists and is not on the hosted project yet**:
  `supabase/migrations/20261009191000_offer_audits_ended_by_starter.sql` (finding F1). Only the member who
  started an attempt can end it; before it, another member could store findings under the starter's name
  through the Data API. It is applied to the local database (`supabase migration up`, no reset). Progress
  rows 7.1 and 7.5 were closed for the first two migrations: the dry run now has to list exactly this one,
  and the push needs the user's consent again, before the Worker deploys.
- **The card has a state the plan did not list** (F2): a stored result that does not read is `broken`
  (`loadOfferAudit`, `data-audit-state="broken"`), shown with the button that replaces it. A failed read
  stays `error`, with no button. The board still reads such an offer as „Audytowano”.
- **A twenty-third failure reason, `unexpected`** (F3), for an end of the attempt the route did not foresee;
  `interrupted` is now only the card's word for an attempt left `running` past the threshold.
- **`completeAudit` reads the row after a retried write reached none** (F4): the first write may have been
  stored with its answer lost, and that is `saved`, not `claim_lost`.
- **A label over 200 characters or a question over 400, or a blank label, takes its finding with it** (F5,
  the user's limits): counted as `dropped`, for the log, never in the card's count of findings without an
  excerpt. Whether a listing's text should be kept from imitating the message's blocks (`prompt.ts`) was
  left alone — it would touch the approved instruction.
- **`provider_error_message` is dropped when it holds seven digits or more in a row** (F6), on top of the
  twelve-character rule: a phone number is shorter than twelve characters.
- **A failed read of the criteria or of the settings says which step failed** (F7): `detail`, `db_code`,
  `db_status`, `error_name` in the route's entry.

Not in the plan and not recorded until this review (F10): `POST /api/audits` settles the session with
`getSession()` before its response leaves and passes no cookie write on afterwards, because a cookie set
once the response is on its way would fail the write of a paid result. A token the client refreshes during
the audit therefore never reaches the browser. Checked against the local Supabase Auth on 2026-10-09
(`enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`): the browser's old refresh
token, replayed 13 and 26 seconds after the rotation it never saw, was answered with the current token,
status 200 — the member is not signed out. Not checked: the hosted project's Auth settings, and a token
rotated twice before the browser's next request, which one audit cannot cause (a fresh token lasts an
hour).

Phase 7, 2026-10-09, after the review: the third migration
(`20261009191000_offer_audits_ended_by_starter.sql`) reached the hosted project with the user's consent — its
dry run listed that one file alone, and the dry run after the push reports the remote database up to date.
The note above that says it is not on the hosted project yet is superseded by this one. Progress row 5.10 was
closed on the user's word that the re-taken gate screenshots were looked at.
