---
change_id: testing-audit-cost-durability
title: Test rollout phase 3 — audit cost and durability (risks #2, #3)
status: implemented
created: 2026-10-12
updated: 2026-10-12
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Audit cost and durability".
Risks covered: #2 (Denial of Wallet — the paid AI audit can be triggered repeatedly: a loop, a double click, concurrent requests, or a request without a session, each call billed), #3 (a paid audit result is lost — the model answered but the write failed or the request timed out, and the same audit has to be paid for again). Test types planned: integration (provider stub at the HTTP edge).
Risk response intent:

- #2: a second audit request for the same offer while one is in flight does not call the provider; an unauthenticated request never calls it; the stub's billed-call count is asserted, never only a 200 status.
- #3: when the provider answered and the write failed, the result is recoverable or the failure is explicit; "in progress" does not hang forever; a retry does not pay for a result that already exists; network and database edges are stubbed, never internal modules.
  Context: S-04 (context/archive/2026-10-06-grounded-listing-audit) already shipped with its own audit tests and test-plan §6.4 is filled. This phase proves what those tests leave unproven for #2 and #3 and adds only the missing evidence — it does not duplicate existing coverage. No test, script or agent action may send a request the model provider would answer.
  Dialog w języku polskim.
  After creating the folder, follow the downstream continuation rule.
