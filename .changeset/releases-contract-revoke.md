---
"@zitadel/server": minor
---

A release can be revoked. `POST /releases/{release_id}/revoke` sets `revoked_at`, carried on every release representation, and emits `release.revoked`. A revoked release cannot be deployed and is refused wherever it would be served.
