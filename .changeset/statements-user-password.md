---
"@zitadel/server": patch
---

Migrate user password persistence from the v1 repository to storage v2 statements (PostgreSQL and Spanner) with a 1:1 filter-based Get/Update/Delete API (GetByUserID/DeleteByUserID kept as thin wrappers).
