---
"@zitadel/cli": minor
---

Add `zitadel pull <kind> <handle>`, which folds the newest server-side revision of a schema or flow into local `.zitadel/`, for adopting a change made through the dashboard or MCP into the git-tracked source. On write it localizes concrete cross-resource ids to handles — a flow's `user_schema` `sch_…` becomes the referenced schema's object type — so the file references its dependencies by name and a release resolves them against the revision it carries (ADR 035). A reference whose revision was deleted, or a schema with no object type to pin to, keeps the id and is reported in the envelope's `warnings`. For an already-initialized project the pulled revision is recorded in `.zitadel/state.json` so the next `plan` reads it as in sync. Targeted only: one `(kind, handle)` per run, no bulk mode. `--dry-run` reports what it would write without touching the working tree.
