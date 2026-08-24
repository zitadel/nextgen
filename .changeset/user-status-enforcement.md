---
"@zitadel/server": patch
---

Enforce user status: a non-active (suspended, deactivated, or pending purge) user can no longer log in, deactivation revokes the user's sessions and tokens in the same transaction, and user reads hide `pending_purge` records while keeping deactivated users visible to management APIs.
