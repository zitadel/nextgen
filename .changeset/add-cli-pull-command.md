---
"@zitadel/cli": minor
---

Add `zitadel pull <kind> <handle>`, which folds the newest server-side revision of a schema or flow into local `.zitadel/`, for adopting a change made through the dashboard or MCP into the git-tracked source. On write, concrete revision ids in cross-resource references become handles — a flow's `user_schema` `sch_…` becomes the referenced schema's object type — so the pulled file references its dependencies by name; a reference whose revision was deleted keeps the id and is reported in the envelope's `warnings`. Targeted only: one `(kind, handle)` per run, no bulk mode. `--dry-run` reports what it would write without touching the working tree.
