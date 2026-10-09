---
"@zitadel/cli": patch
---

`plan --json` and `apply --json` now enumerate what they touch: a
`data.changes` array with one `{kind, action, file, id?, previous_id?}`
row per resource (action ∈ create/update/revision/delete). Plan rows
preview the pending sync; apply rows report what happened, carrying the
resulting platform ids (created ids, newly published revision ids), so
agents can verify an edit did what they intended without re-applying.
`apply` also gains `next_actions`/`next_commands` ("changes are live" +
a versioned `plan` follow-up), and `schemas list` emits `created_at` in
snake_case like every other envelope field. Counters and
`files_updated` (local write-backs only) are unchanged.
