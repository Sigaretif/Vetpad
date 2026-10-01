---
change_id: testing-write-isolation
title: "Test plan Phase 2: prove a write on one member's data leaves others untouched"
status: archived
created: 2026-09-30
updated: 2026-10-01
archived_at: 2026-10-01T20:36:22Z
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Write isolation".
Risks covered: #5 (a write on X changes Y: a re-fetch overwrites notes, one member's action edits or deletes another member's note or requirements, a delete takes more or less than the PRD says it should). Test types planned: integration (smoke) — steps in scripts/smoke.mjs against local Supabase.
Risk response intent:
- #5: after every write operation, other members' rows (notes, requirements, author columns) are identical to before, and an RLS denial is recognised as such (HTTP 200 with [] on read, 42501 on a blocked write) — never assert only "no error".
After creating the folder, follow the downstream continuation rule.
