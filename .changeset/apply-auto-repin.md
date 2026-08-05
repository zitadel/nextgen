---
"@zitadel/cli": patch
"@zitadel/config": patch
---

`apply` now re-pins flows to a freshly published schema revision in the same
run: the CLI rewrites `user_schema` in every local flow file pinned to the
superseded revision (lockfile-style, announced by `plan` and reported in the
output) and the flow update carries the new id — editing a schema and using
the new field in a flow no longer fails validation or needs a second apply.
Interrupted runs recover via a `previousId` marker in `.zitadel/state.json`.
