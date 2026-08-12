---
"@zitadel/server": minor
---

Resolve path-id management API scope from resource_scope_index before the permission check, and drop the required project_id query parameter from by-id operations. The CLI sync/setup path matches that contract and no longer sends project_id on get/update/delete by id.
