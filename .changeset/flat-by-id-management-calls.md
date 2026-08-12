---
"@zitadel/server": patch
"@zitadel/testing": patch
---

The embedded console and the test kit's `seedUser` follow the flat-by-id management contract: path-id operations (get/delete user, list passkeys, set password, get schema, get flow definition, get/update team) no longer send a `project_id` query parameter — the server resolves the scope from the resource id itself.
