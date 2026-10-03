---
"@zitadel/cli": minor
---

Add `zitadel pull <kind> <handle>`, which folds the newest server-side revision of a schema or flow into local `.zitadel/`, for adopting a change made through the dashboard or MCP into the git-tracked source. The body is written exactly as the server returns it — its references (a flow's `user_schema`) kept verbatim — so a later `apply` sends the same ids back and the server accepts them. For an already-initialized project, the pulled revision is recorded in `.zitadel/state.json` so the next `plan` reads it as in sync rather than a fresh upload. Targeted only: one `(kind, handle)` per run, no bulk mode. `--dry-run` reports what it would write without touching the working tree.
