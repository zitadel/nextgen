---
"@zitadel/server": patch
---

Deleting a user (`DELETE /users/{user_id}`) now revokes every grant the user held, on any project, in the same transaction, and records an `authz.revoked` event for each one on that grant's project. Before, the grants stayed behind and kept appearing in the grants query with only the user's id.
