---
"@zitadel/server": patch
---

The permission store drops an index that its primary key already covered, so
creating and deleting resources maintains one index fewer. On Postgres the
upgrade removes the index without blocking reads or writes.
