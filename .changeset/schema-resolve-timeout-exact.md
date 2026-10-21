---
"@zitadel/server": patch
---

Creating a schema now always fails with `sch.fetch_timeout` when fetching it
and its `$ref` chain takes longer than `schema.resolve_timeout`. Previously a
fetch that finished just after the limit could still be accepted.
