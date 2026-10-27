---
"@zitadel/server": minor
---

`GET /flow/{id}` and `POST /flow/{id}/submit` answer `409` `rel.revoked` once the release a sign-in started on has been revoked, and a deploy during a sign-in does not change that sign-in's steps.
