---
"@zitadel/server": patch
---

Session deletion is idempotent. `DELETE /sessions/{id}` and `DELETE /sessions/me`
return `204` when the session is already gone (instead of `404`), and the
endpoints no longer advertise the `409 already revoked` / `state: revoked`
soft-revoke semantics — a deleted session is removed, not marked revoked.
