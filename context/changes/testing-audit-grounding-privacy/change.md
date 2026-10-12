---
change_id: testing-audit-grounding-privacy
title: Test audit grounding and prompt privacy (test-plan Phase 4)
status: implemented
created: 2026-10-12
updated: 2026-10-12
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Audit grounding and prompt privacy".
Risks covered: #4 (the audit reports an ungrounded finding — a red flag, cost or mandatory condition with no excerpt, with an excerpt that is not verbatim listing text, or a missing-information finding outside the decision-critical attributes), #6 prompt side (personal data escapes — the seller's phone or name reaches the audit prompt, or members' notes reach the model provider). Test types planned: unit, optional manual golden set.
Risk response intent:

- #4: prove that a positive finding without an excerpt, or whose excerpt is not a verbatim substring of the stored listing text, is rejected, and that a missing-data finding carries no excerpt; challenge "the prompt tells the model to quote, so it quotes"; avoid using an LLM to judge whether a quote is grounded when a deterministic comparison exists.
- #6 (prompt): prove that the built prompt contains no seller phone or name from the portal's contact fields and no notes — also when the fixture carries all of them — while a phone or name the advertiser typed into the title or description is kept verbatim; challenge "the mapper whitelist is enough, so the prompt is clean"; avoid asserting only that expected fields are present and never that forbidden ones are absent, and avoid "fixing" a canary hit by redacting the description.
  S-04 (grounded-listing-audit) has shipped, so the phase is no longer blocked; it already brought tests of its own, so research must first establish what is covered before anything is added. Nothing in this phase may send a request the model provider would answer.
  After creating the folder, follow the downstream continuation rule.
