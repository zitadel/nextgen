---
"@zitadel/server": minor
---

`GET /flow/{id}` and `POST /flow/{id}/submit` reuse the deployment sealed into `_zflow` at create time. If that release was revoked since the attempt started, they answer `409` with `rel.revoked`. A mid-attempt deploy does not change the configuration under an in-flight sign-in.
