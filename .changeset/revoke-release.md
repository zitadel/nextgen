---
"@zitadel/server": minor
---

`POST /releases/{release_id}/revoke` marks a release revoked, once: a revoked release comes back unchanged with its first `revoked_at`, and `GET /releases` and `GET /releases/{release_id}` now report it. A release that any primary origin or live preview URL still serves answers `409` with `rel.in_use`, naming each origin and the deployment that pins it. Deploying a revoked release answers `409` with `rel.revoked`.
